/** Shared live Direct/Inbox/Broadcast thread: chatMessages + messages, raw + D-normalized ids. */

function normalizeForThread(id: string): string {
  const trimmed = id.trim();
  const s = trimmed.replace(/[\s\-_.]/g, '');
  const withLetter = s.match(/^([dD])(\d+)$/);
  if (withLetter) return 'D' + String(parseInt(withLetter[2], 10)).padStart(3, '0');
  return trimmed;
}

export function chatThreadDriverIds(driverId: string): string[] {
  const raw = String(driverId || '').trim();
  if (!raw) return [];
  const ids = new Set<string>([raw]);
  const stripped = raw.replace(/[\s\-_.]/g, '');
  const withLetter = stripped.match(/^([dD])(\d+)$/);
  const digits = stripped.match(/^(\d+)$/);
  if (withLetter) {
    const n = parseInt(withLetter[2], 10);
    ids.add('D' + String(n).padStart(3, '0'));
    ids.add(String(n));
  } else if (digits) {
    const n = parseInt(digits[1], 10);
    ids.add('D' + String(n).padStart(3, '0'));
    ids.add(String(n));
  } else {
    const normalized = normalizeForThread(raw);
    if (normalized) ids.add(normalized);
  }
  return [...ids];
}

/** Dispatcher / broadcast senders sit on the inbound (left) side in the driver app. */
export function isDispatcherSenderId(senderId: unknown): boolean {
  const sid = String(senderId ?? '').trim();
  if (!sid || sid === '0') return true;
  return /^dispatcher/i.test(sid);
}

export function conversationSortMs(row: {
  createdAt?: number;
  timestamp?: number;
  Date?: unknown;
  Time?: unknown;
  date?: unknown;
  time?: unknown;
  Id?: number;
  id?: string | number;
}): number {
  const created = Number(row.createdAt ?? row.timestamp) || 0;
  if (created > 1e12) return created;
  if (created > 1e9 && created < 1e12) return created * 1000;
  const date = String(row.Date ?? row.date ?? '').trim();
  const time = String(row.Time ?? row.time ?? '').trim();
  if (date) {
    const clock = time.length >= 8 ? time : time.length >= 5 ? `${time}:00` : '00:00:00';
    const parsed = Date.parse(`${date}T${clock}`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const id = Number(row.Id ?? row.id) || 0;
  if (id > 1e12) return id;
  return id;
}

export function chatHistoryRowToMessage(
  key: string,
  row: Record<string, unknown>,
  _driverId: string,
): { id: string; sender: 'driver' | 'dispatcher'; text: string; timestamp: number } | null {
  const text = String(row.message ?? row.Message ?? '').trim();
  if (!text) return null;
  const senderId = row.senderId ?? row.SenderId;
  const senderName = String(row.senderName ?? row.SenderName ?? '');
  const fromDispatch = isDispatcherSenderId(senderId) || /^dispatcher/i.test(senderName);
  const timestamp =
    conversationSortMs({
      createdAt: Number(row.createdAt) || 0,
      Date: row.date ?? row.Date,
      Time: row.time ?? row.Time,
      Id: Number(row.id ?? row.Id) || 0,
    }) || Date.now();
  return {
    id: `hist-${key}`,
    sender: fromDispatch ? 'dispatcher' : 'driver',
    text,
    timestamp,
  };
}

export function chatThreadDbPaths(companyId: string, driverId: string): string[] {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  const paths: string[] = [];
  for (const id of chatThreadDriverIds(driverId)) {
    paths.push(`chatMessages/${cid}/${id}`);
    paths.push(`messages/${cid}/${id}`);
  }
  return paths;
}
