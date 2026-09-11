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
