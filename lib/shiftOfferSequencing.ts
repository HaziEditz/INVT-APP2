/**
 * Pure helpers for post-login offer sequencing.
 * Keeps popup + auto-dispatch eligibility aligned with readyForJobs.
 */

/** Cap GPS wait during startShift so badge→popup stays under ~3s. */
export const SHIFT_BOOTSTRAP_GPS_BUDGET_MS = 2_000;

/** Exclusive offer popup only after shift bootstrap finishes (GPS + Available stamp). */
export function shouldShowOfferPopupNow(readyForJobs: boolean): boolean {
  return !!readyForJobs;
}

/**
 * Auto-dispatch must not see Available until the phone is ready to show popups
 * and has stamped a fresh lastSeen. Bootstrap uses Away.
 */
export function isAutoDispatchEligibleStatus(vehiclestatus: string | null | undefined): boolean {
  return String(vehiclestatus || '').trim().toLowerCase() === 'available';
}

/**
 * Open the popup gate (readyForJobs) before writing Available so auto-dispatch
 * offers that arrive on the Available edge can show the modal immediately —
 * not sit as an Offer-tab badge until a later effect runs.
 */
export function shouldOpenPopupGateBeforeAvailableWrite(): boolean {
  return true;
}

export type DeferredOfferLike = {
  id: string;
  postedAt?: number;
  expiresAt?: number;
};

/** Newest non-expired deferred broadcast offer (for sync flush after readyForJobs). */
export function pickBestDeferredOfferPopup<T extends DeferredOfferLike>(
  offers: Iterable<T>,
  now = Date.now(),
): T | null {
  let best: T | null = null;
  for (const o of offers) {
    if (!o?.id) continue;
    if (typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt) && o.expiresAt <= now) {
      continue;
    }
    if (!best || (o.postedAt || 0) > (best.postedAt || 0)) best = o;
  }
  return best;
}

/**
 * Ordering for startShift after Away bootstrap:
 * GPS (budgeted) → open popup gate → Available → sync flush deferred popup.
 */
export function shiftBootstrapOfferReadySteps(): readonly string[] {
  return [
    'startShiftOnlineAway',
    'startBackgroundTrackingBudgeted',
    'openPopupGate',
    'writeAvailable',
    'flushDeferredOfferPopupSync',
  ] as const;
}
