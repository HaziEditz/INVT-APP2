/**
 * Live dispatcher chat vs leftover last-message node.
 * Console writes to chat/{id} often omit timestamp; after ignoreInitial that
 * used to look like a duplicate (ts=0 <= lastStamp) so the thread never updated.
 */

export function chatLiveFingerprint(val: Record<string, unknown> | null | undefined): string {
  if (!val || typeof val !== 'object') return '';
  return [
    String(val.messageId ?? ''),
    String(val.bookingid ?? ''),
    String(val.content ?? val.message ?? ''),
    String(val.timestamp ?? ''),
  ].join('|');
}

export function shouldAcceptLiveChatSnap(opts: {
  primed: boolean;
  ignoreInitial?: boolean;
  ts: number;
  minTs: number;
  lastStamp: number;
  fingerprint: string;
  lastFingerprint: string;
}): 'skip-initial' | 'skip-dup' | 'accept' {
  const fp = String(opts.fingerprint || '');
  const lastFp = String(opts.lastFingerprint || '');
  const ts = Number(opts.ts) || 0;
  const minTs = Number(opts.minTs) || 0;
  const lastStamp = Number(opts.lastStamp) || 0;

  if (!opts.primed) {
    if (opts.ignoreInitial) return 'skip-initial';
    if (!(ts > minTs)) return 'skip-initial';
    return 'accept';
  }
  if (fp && fp === lastFp) return 'skip-dup';
  if (ts > 0 && ts <= lastStamp && fp === lastFp) return 'skip-dup';
  if (fp && fp !== lastFp) return 'accept';
  if (ts > lastStamp) return 'accept';
  return 'skip-dup';
}
