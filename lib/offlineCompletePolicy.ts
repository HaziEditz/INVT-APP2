import { dispatchIsConnected } from './dispatchConnectionPolicy.ts';

/**
 * When either link is down, finalizePayment must not await HTTP/Firebase —
 * journal Completed and clear local trip state (same idea as offline Arrived/OnBoard).
 */
export function shouldOfflineJournalComplete(
  networkConnected: boolean | null,
  rtdbConnected: boolean | null,
): boolean {
  return !dispatchIsConnected(networkConnected, rtdbConnected);
}

/** Detach dispatch activeJob on End Trip when offline (mirror hail endHail). */
export function shouldDetachActiveJobOnEndTrip(
  networkConnected: boolean | null,
  rtdbConnected: boolean | null,
): boolean {
  return !dispatchIsConnected(networkConnected, rtdbConnected);
}
