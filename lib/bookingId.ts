/** Numeric dispatch booking IDs (e.g. 8692606166), hail_* legacy, or local: provisional (Phase 5c). */
export function isValidBookingId(id: string | number | undefined | null): boolean {
  const s = String(id ?? '').trim();
  if (!s) return false;
  if (s.startsWith('hail_')) return true;
  if (s.startsWith('local:')) return true;
  return /^\d{8,}$/.test(s);
}

/** True for offline-provisional hail ids that must not hit stage/complete APIs yet. */
export function isProvisionalBookingId(id: string | number | undefined | null): boolean {
  const s = String(id ?? '').trim();
  return s.startsWith('local:') || s.startsWith('hail_');
}

export function localJobIdFromClientTripId(clientTripId: string): string {
  return `local:${String(clientTripId || '').trim()}`;
}

export function normalizeBookingId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (s.includes(',')) return s.split(',')[0].trim();
  return s;
}
