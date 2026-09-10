/**
 * Dispatcher chat unread / alert policy.
 * Firebase `chat/{driverId}` is a leftover last-message node (never deleted).
 * onValue fires it again on every login — that must not look like a new unread.
 */

export function shouldAlertIncomingDispatcherChat(opts: {
  messageTimestamp: number;
  lastReadTimestamp: number;
  lastAlertKey?: string;
  alertKey: string;
}): boolean {
  const ts = Number(opts.messageTimestamp) || 0;
  const read = Number(opts.lastReadTimestamp) || 0;
  const key = String(opts.alertKey || '').trim();
  if (key && key === String(opts.lastAlertKey || '').trim()) return false;
  // Already opened chat at/after this message (or leftover node with no ts).
  if (read > 0 && !(ts > read)) return false;
  return true;
}
