/**
 * Pure helpers for post-login offer sequencing.
 * Keeps popup + auto-dispatch eligibility aligned with readyForJobs.
 */

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
