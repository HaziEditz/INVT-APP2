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
  const normalized = normalizeForThread(raw);
  if (normalized) ids.add(normalized);
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
