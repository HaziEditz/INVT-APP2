/** Pure Driver ID helpers — no Firebase imports (safe for unit tests). */

export const DRIVER_ID_FORMAT_ERROR = 'Enter your full Driver ID, e.g. D001';

/**
 * Canonicalize a D-prefixed Driver ID (D001 / d001 / D1 → D001).
 * Does NOT accept bare numbers like 001 or 1 — those must be rejected at login.
 */
export function normalizeDriverId(id: string): string {
  const trimmed = id.trim();
  const s = trimmed.replace(/[\s\-_.]/g, '');
  const withLetter = s.match(/^([dD])(\d+)$/);
  if (withLetter) return 'D' + String(parseInt(withLetter[2], 10)).padStart(3, '0');
  return trimmed;
}

/** True when input is a D-prefixed driver id (after trim/separator strip). */
export function isDriverIdLoginFormat(raw: string): boolean {
  const s = String(raw ?? '')
    .trim()
    .replace(/[\s\-_.]/g, '');
  return /^[dD]\d+$/.test(s);
}

/**
 * Parse login identifier that is NOT an email.
 * Requires D-prefixed format as shown in the owner panel (e.g. D001).
 * Throws DRIVER_ID_FORMAT_ERROR for bare numbers or other invalid tokens.
 */
export function parseDriverIdForLogin(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new Error(DRIVER_ID_FORMAT_ERROR);
  }
  const stripped = trimmed.replace(/[\s\-_.]/g, '');
  if (/^\d+$/.test(stripped)) {
    throw new Error(DRIVER_ID_FORMAT_ERROR);
  }
  if (!/^[dD]\d+$/.test(stripped)) {
    throw new Error(DRIVER_ID_FORMAT_ERROR);
  }
  return normalizeDriverId(trimmed);
}

export function driverIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizeDriverId(String(a ?? ''));
  const nb = normalizeDriverId(String(b ?? ''));
  if (!na || !nb) return false;
  if (!/^D\d+$/i.test(na) || !/^D\d+$/i.test(nb)) return false;
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
