import { get, onValue, ref, type DataSnapshot } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { sendDriverMessage } from '@/lib/dispatchApi';
import { chatLiveFingerprint, shouldAcceptLiveChatSnap } from '@/lib/chatLivePolicy';
import { chatThreadDbPaths } from '@/lib/chatThreadPaths';
import type { ChatMessage } from '@/types';

export { chatLiveFingerprint, shouldAcceptLiveChatSnap } from '@/lib/chatLivePolicy';

/** Parse legacy bookingid: "senderName,body,datetime,companyId,Source" */
export function parseChatBookingId(bookingid: string): { senderName: string; text: string } {
  const parts = String(bookingid || '').split(',');
  if (parts.length < 2) return { senderName: 'Dispatcher', text: bookingid };
  const senderName = parts[0] || 'Dispatcher';
  // senderName,message,datetime,companyId,sourceTag — message is always parts[1]
  if (parts.length >= 4) {
    return { senderName, text: parts[1] || '' };
  }
  return { senderName, text: parts.slice(1).join(',') || parts[1] || '' };
}

export function chatPayloadToMessage(
  id: string,
  val: Record<string, unknown>,
  driverId: string,
): ChatMessage | null {
  const bookingid = String(val.bookingid ?? '');
  const content = String(val.content ?? val.message ?? '');
  if (bookingid.endsWith(',Dispatcher')) {
    return {
      id,
      sender: 'dispatcher',
      text: parseChatBookingId(bookingid).text || content,
      timestamp: parseInt(String(val.timestamp ?? ''), 10) || Date.now(),
    };
  }
  if (bookingid.endsWith(',Driver') || content) {
    const parsed = bookingid ? parseChatBookingId(bookingid) : { senderName: 'You', text: content };
    const fromSelf = bookingid.endsWith(',Driver');
    return {
      id,
      sender: fromSelf ? 'driver' : 'dispatcher',
      text: fromSelf ? parsed.text || content : parsed.text || content,
      timestamp: parseInt(String(val.timestamp ?? ''), 10) || Date.now(),
    };
  }
  if (content && content !== 'You have New Message') {
    return {
      id,
      sender: 'dispatcher',
      text: content,
      timestamp: parseInt(String(val.timestamp ?? ''), 10) || Date.now(),
    };
  }
  return null;
}

function historyRowToMessage(key: string, row: Record<string, unknown>, driverId: string): ChatMessage | null {
  const text = String(row.message ?? row.Message ?? '').trim();
  if (!text) return null;
  const senderId = String(row.senderId ?? row.SenderId ?? '');
  const createdAt = parseInt(String(row.createdAt ?? ''), 10) || Date.now();
  const isDriver = senderId === String(driverId) || senderId === driverId;
  return {
    id: `hist-${key}`,
    sender: isDriver ? 'driver' : 'dispatcher',
    text,
    timestamp: createdAt,
  };
}

export function parseChatHistoryVal(
  val: Record<string, Record<string, unknown>> | null,
  driverId: string,
): ChatMessage[] {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val)
    .map(([key, row]) => historyRowToMessage(key, row, driverId))
    .filter((m): m is ChatMessage => m != null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function mergeChatMessageLists(lists: ChatMessage[][]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const list of lists) {
    for (const m of list) {
      const key = `${m.sender}|${m.text}|${m.timestamp}`;
      const prev = map.get(key);
      if (!prev || m.timestamp >= prev.timestamp) map.set(key, m);
    }
  }
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function loadChatHistory(companyId: string, driverId: string): Promise<ChatMessage[]> {
  const lists: ChatMessage[][] = [];
  for (const path of chatThreadDbPaths(companyId, driverId)) {
    try {
      const snap = await get(ref(getDatabaseInstance(), path));
      lists.push(parseChatHistoryVal(snap.val() as Record<string, Record<string, unknown>> | null, driverId));
    } catch (err) {
      console.warn('[chat] history', path, err);
    }
  }
  return mergeChatMessageLists(lists);
}

/** Live thread: MessageInsert dual-writes chatMessages + messages. Merge both. */
export function subscribeChatThread(
  companyId: string,
  driverId: string,
  onUpdate: (msgs: ChatMessage[]) => void,
): () => void {
  const db = getDatabaseInstance();
  const bags = new Map<string, ChatMessage[]>();
  const unsubs = chatThreadDbPaths(companyId, driverId).map((path) =>
    onValue(
      ref(db, path),
      (snap) => {
        bags.set(
          path,
          parseChatHistoryVal(snap.val() as Record<string, Record<string, unknown>> | null, driverId),
        );
        onUpdate(mergeChatMessageLists([...bags.values()]));
      },
      (err) => {
        console.warn('[chat] thread', path, err);
      },
    ),
  );
  return () => unsubs.forEach((u) => u());
}

export function subscribeChat(
  driverId: string,
  onMessage: (msg: ChatMessage) => void,
  opts?: { minTimestamp?: number; ignoreInitial?: boolean },
): () => void {
  const chatRef = ref(getDatabaseInstance(), `chat/${driverId}`);
  let lastStamp = Number(opts?.minTimestamp) || 0;
  let lastFingerprint = '';
  let primed = false;
  const handleSnap = (snap: DataSnapshot) => {
    const val = snap.val() as Record<string, unknown> | null;
    if (!val) {
      primed = true;
      return;
    }
    const ts = parseInt(String(val.timestamp ?? ''), 10) || 0;
    const fingerprint = chatLiveFingerprint(val);
    const decision = shouldAcceptLiveChatSnap({
      primed,
      ignoreInitial: opts?.ignoreInitial,
      ts,
      minTs: Number(opts?.minTimestamp) || 0,
      lastStamp,
      fingerprint,
      lastFingerprint,
    });
    primed = true;
    if (decision === 'skip-initial') {
      lastStamp = Math.max(lastStamp, ts);
      lastFingerprint = fingerprint;
      return;
    }
    if (decision === 'skip-dup') return;
    lastStamp = Math.max(lastStamp, ts);
    lastFingerprint = fingerprint;
    const msgId = String(val.messageId ?? (ts || fingerprint));
    const msg = chatPayloadToMessage(msgId, val, driverId);
    if (msg && msg.sender === 'dispatcher') onMessage(msg);
  };
  return onValue(chatRef, handleSnap);
}

export async function sendChatToDispatch(message: string): Promise<void> {
  await sendDriverMessage(message.trim());
}
