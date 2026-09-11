/** Per-company chat kill-switch. Missing flag = enabled (existing companies keep chat). */

export function isCompanyChatEnabled(val: unknown): boolean {
  if (val == null || typeof val !== 'object') return true;
  const rec = val as Record<string, unknown>;
  if (rec.chatEnabled === false) return false;
  const features = rec.features;
  if (features && typeof features === 'object' && (features as Record<string, unknown>).chatEnabled === false) {
    return false;
  }
  return true;
}

/** Expo Router hides a tab when `href` is null — do not grey it out. */
export function driverChatTabHref(chatEnabled: boolean): undefined | null {
  return chatEnabled ? undefined : null;
}
