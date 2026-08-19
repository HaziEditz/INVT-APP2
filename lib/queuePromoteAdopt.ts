/**
 * Queue promote → local active trip.
 *
 * Server promote-queued marks Assigned immediately (dispatch Assign tab).
 * If the driver app only sets jobOffer and waits for Accept, the modal can be
 * invisible (Syncing banner / paymentJob / pendingTripSync) while the booking is
 * already Assigned — #81952/#81956 style orphans. Auto-adopt closes that gap.
 */

export type OfferModalHoldState = {
  hailActive?: boolean;
  activeJob?: boolean;
  paymentJob?: boolean;
  isOffline?: boolean;
  pendingTripSync?: boolean;
  syncingBanner?: boolean;
};

/** True when JobOfferModal returns null even though jobOffer state may be set. */
export function isJobOfferModalHeldHidden(state: OfferModalHoldState): boolean {
  return !!(
    state.hailActive ||
    state.activeJob ||
    state.paymentJob ||
    state.isOffline ||
    state.pendingTripSync ||
    state.syncingBanner
  );
}

/**
 * After a successful Queued→Assigned promote from the post-trip release path,
 * the driver must adopt the job as activeJob without requiring Accept.
 */
export function shouldAutoAdoptPromotedQueueJob(opts: {
  promoteSucceeded: boolean;
  alreadyHasActiveJob: boolean;
}): boolean {
  return opts.promoteSucceeded && !opts.alreadyHasActiveJob;
}
