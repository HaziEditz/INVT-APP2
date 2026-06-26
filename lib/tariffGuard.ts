/** Keep in sync with INVT `src/lib/tariffGuard.ts` and `lib/tariffGuard.cjs`. */
export const FORBIDDEN_PLACEHOLDER_TARIFF_NAMES = new Set(['standard']);

export function isForbiddenPlaceholderTariffName(name: string | null | undefined): boolean {
  const n = String(name ?? '').trim().toLowerCase();
  return !n || FORBIDDEN_PLACEHOLDER_TARIFF_NAMES.has(n);
}
