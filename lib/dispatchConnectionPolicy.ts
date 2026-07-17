export type DispatchConnectionNotice = 'offline' | 'back_online' | null;

/** Unknown startup signals are optimistic; explicit false means disconnected. */
export function dispatchIsConnected(
  networkConnected: boolean | null,
  rtdbConnected: boolean | null,
): boolean {
  const networkOk = networkConnected !== false;
  const rtdbOk = rtdbConnected !== false;
  return networkOk && rtdbOk;
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
