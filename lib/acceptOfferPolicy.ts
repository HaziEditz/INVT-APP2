/**
 * Accept claim UX — concurrent lock + hung-network budgets.
 * Keep messages stable so Offer-tab / modal share the same copy.
 */

export const ACCEPT_ALREADY_PROCESSING_TITLE = 'Already processing';
export const ACCEPT_ALREADY_PROCESSING_MESSAGE =
  'An accept is already in progress. Wait a moment, then try again.';

/** True when a second Accept should be blocked (show feedback, never silent no-op). */
export function isAcceptAlreadyInFlight(accepting: boolean): boolean {
  return !!accepting;
}
