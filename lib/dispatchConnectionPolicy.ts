export type DispatchConnectionNotice = 'offline' | 'back_online' | null;

export type TripJournalFlushTrigger =
  | 'netinfo-reconnect'
  | 'rtdb-reconnect'
  | 'app-foreground'
  | 'shift-start'
  | 'hydrate';

/** Unknown startup signals are optimistic; explicit false means disconnected. */
export function dispatchIsConnected(
  networkConnected: boolean | null,
  rtdbConnected: boolean | null,
): boolean {
  const networkOk = networkConnected !== false;
  const rtdbOk = rtdbConnected !== false;
  return networkOk && rtdbOk;
}

/**
 * Offline trip journal complete/cancel/stage uses HTTP to dispatch — not RTDB.
 * Requiring both links blocked flush when NetInfo recovered but RTDB lagged,
 * leaving jobs Active on dispatch until cold remount.
 */
export function tripJournalFlushIsAllowed(networkConnected: boolean | null): boolean {
  return networkConnected !== false;
}

/** Offers are real-time claims and must never be accepted after either link drops. */
export function offerAcceptanceIsAllowed(
  networkConnected: boolean | null,
  rtdbConnected: boolean | null,
): boolean {
  return dispatchIsConnected(networkConnected, rtdbConnected);
}

export function connectionNoticeForTransition(
  previousConnected: boolean | null,
  nextConnected: boolean,
): DispatchConnectionNotice {
  if (!nextConnected) return 'offline';
  if (previousConnected === false) return 'back_online';
  return null;
}
