import { get, onValue, ref, type DataSnapshot } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { sendDriverMessage } from '@/lib/dispatchApi';
import type { ChatMessage } from '@/types';

/** Parse legacy bookingid: "senderName,body,datetime,companyId,Source" */
export function parseChatBookingId(bookingid: string): { senderName: string; text: string } {
  const parts = String(bookingid || '').split(',');
  if (parts.length < 2) return { senderName: 'Dispatcher', text: bookingid };
  const senderName = parts[0] || 'Dispatcher';
  const text = parts.slice(1, Math.max(2, parts.length - 2)).join(',');
  return { senderName, text: text || parts[1] || '' };
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
      timestamp: Date.now(),
    };
  }
  if (bookingid.endsWith(',Driver') || content) {
    const parsed = bookingid ? parseChatBookingId(bookingid) : { senderName: 'You', text: content };
    const fromSelf = bookingid.endsWith(',Driver');
    return {
      id,
      sender: fromSelf ? 'driver' : 'dispatcher',
      text: fromSelf ? parsed.text || content : parsed.text || content,
      timestamp: Date.now(),
    };
  }
  if (content && content !== 'You have New Message') {
    return { id, sender: 'dispatcher', text: content, timestamp: Date.now() };
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

export async function loadChatHistory(companyId: string, driverId: string): Promise<ChatMessage[]> {
  const snap = await get(ref(getDatabaseInstance(), `messages/${companyId}/${driverId}`));
  const val = snap.val() as Record<string, Record<string, unknown>> | null;
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val)
    .map(([key, row]) => historyRowToMessage(key, row, driverId))
    .filter((m): m is ChatMessage => m != null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function subscribeChat(driverId: string, onMessage: (msg: ChatMessage) => void): () => void {
  const chatRef = ref(getDatabaseInstance(), `chat/${driverId}`);
  let skipInitial = true;
  const handler = (snap: DataSnapshot) => {
    if (skipInitial) return;
    const val = snap.val() as Record<string, unknown> | null;
    if (!val) return;
    const msg = chatPayloadToMessage('live', val, driverId);
    if (msg && msg.sender === 'dispatcher') onMessage(msg);
  };
  const unsub = onValue(chatRef, (snap) => {
    if (skipInitial) {
      skipInitial = false;
      return;
    }
    handler(snap);
  });
  setTimeout(() => {
    skipInitial = false;
  }, 2500);
  return unsub;
}

export async function sendChatToDispatch(message: string): Promise<void> {
  await sendDriverMessage(message.trim());
}
