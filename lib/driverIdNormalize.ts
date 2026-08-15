/** Pure Driver ID helpers — no Firebase imports (safe for unit tests). */

/** Normalize D001 / d1 / 001 / 1 → D001. Leaves other tokens unchanged. */
export function normalizeDriverId(id: string): string {
  const trimmed = id.trim();
  const s = trimmed.replace(/[\s\-_.]/g, '');
  const withLetter = s.match(/^([dD])(\d+)$/i);
  if (withLetter) return 'D' + String(parseInt(withLetter[2], 10)).padStart(3, '0');
  // Bare numeric driver IDs (common when drivers omit the D prefix)
  if (/^\d+$/.test(s)) return 'D' + String(parseInt(s, 10)).padStart(3, '0');
  return trimmed;
}

export function driverIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizeDriverId(String(a ?? ''));
  const nb = normalizeDriverId(String(b ?? ''));
  if (!na || !nb) return false;
  return na.toLowerCase() === nb.toLowerCase();
}

export function extractDriverIdFromRecord(fb: Record<string, unknown> | null | undefined): string {
  if (!fb || typeof fb !== 'object') return '';
  return normalizeDriverId(
    String(fb.id ?? fb.driverId ?? fb.DriverId ?? fb.dispatcherId ?? ''),
  );
}

export function looksLikeFirebaseAuthUid(key: string | null | undefined): boolean {
  const k = String(key || '');
  return /^[A-Za-z0-9]{20,}$/.test(k) && !k.startsWith('-');
}

export function looksLikeCompanyId(key: string | null | undefined): boolean {
  return /^\d{4,}$/.test(String(key || ''));
}
