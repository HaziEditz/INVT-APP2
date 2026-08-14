/**
 * Pure offline→online gate for PaymentModal (and similar) auto-resume.
 * Only true on a transition from known-offline to online — not on first
 * NetInfo tick, and not when already online.
 */
export function shouldBumpNetworkResume(
  wasOffline: boolean | null,
  isOfflineNow: boolean,
): boolean {
  return wasOffline === true && !isOfflineNow;
}
