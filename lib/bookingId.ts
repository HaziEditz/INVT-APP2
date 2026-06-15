/** Numeric dispatch booking IDs (e.g. 8692606166) or hail_* local ids. */
export function isValidBookingId(id: string | number | undefined | null): boolean {
  const s = String(id ?? '').trim();
  if (!s) return false;
  if (s.startsWith('hail_')) return true;
  return /^\d{8,}$/.test(s);
}

export function normalizeBookingId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (s.includes(',')) return s.split(',')[0].trim();
  return s;
}
