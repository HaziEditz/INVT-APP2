/**
 * Hail offline fallback stores bare "lat, lng" when reverse-geocode fails.
 * Re-resolve those placeholders once connectivity returns.
 */

import { withTimeout } from './asyncTimeout.ts';
import { GEOCODE_TIMEOUT_MS } from './tripJournalFlushPolicy.ts';

export type LatLng = { lat: number; lng: number };

export type HailPickupSnapshot = {
  address: string;
  lat?: number;
  lng?: number;
};

/** Match bare coords, "Hail - lat, lng", or "Dropoff (lat, lng)" placeholders. */
const COORD_ADDRESS_RE =
  /^(?:Hail\s*-\s*)?(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/i;
const LABELLED_COORD_ADDRESS_RE =
  /^(?:Dropoff|Pickup|Hail)\s*\(\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\)\s*$/i;

/** Bare coords or labelled coord placeholders — not a real street address. */
export function isCoordLikeAddress(address: string | null | undefined): boolean {
  const s = String(address || '').trim();
  if (!s) return false;
  return COORD_ADDRESS_RE.test(s) || LABELLED_COORD_ADDRESS_RE.test(s);
}

export function needsHailAddressResolve(address: string | null | undefined): boolean {
  const s = String(address || '').trim();
  if (!s) return true;
  if (isCoordLikeAddress(s)) return true;
  if (/^Current location/i.test(s)) return true;
  if (/^Locating/i.test(s)) return true;
  return false;
}

export function coordsFromAddressOrFields(
  address: string | null | undefined,
  lat?: number | null,
  lng?: number | null,
): LatLng | null {
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  ) {
    return { lat, lng };
  }
  const s = String(address || '').trim();
  const m = s.match(COORD_ADDRESS_RE) || s.match(LABELLED_COORD_ADDRESS_RE);
  if (!m) return null;
  const parsedLat = Number(m[1]);
  const parsedLng = Number(m[2]);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}

export type ReverseGeocodeFn = (lat: number, lng: number) => Promise<string>;

/**
 * If address is a coord placeholder (or empty) and we have lat/lng, reverse-geocode.
 * Returns original address when already readable or geocode fails.
 */
export async function resolveReadableAddress(
  args: {
    address: string;
    lat?: number | null;
    lng?: number | null;
  },
  reverseGeocode: ReverseGeocodeFn,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const current = String(args.address || '').trim();
  if (!needsHailAddressResolve(current) && current) return current;

  const coords = coordsFromAddressOrFields(current, args.lat, args.lng);
  if (!coords) return current;

  const timeoutMs = opts?.timeoutMs ?? GEOCODE_TIMEOUT_MS;
  try {
    const resolved = String(
      (await withTimeout(
        reverseGeocode(coords.lat, coords.lng),
        timeoutMs,
        'reverseGeocode',
      )) || '',
    ).trim();
    if (resolved && !isCoordLikeAddress(resolved) && !needsHailAddressResolve(resolved)) {
      return resolved;
    }
    // reverseGeocodeCoords itself falls back to coords — keep trying later.
    if (resolved && !isCoordLikeAddress(resolved)) return resolved;
  } catch {
    // timeout / offline / geocoder unavailable — keep placeholder
  }
  return current || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
}

export async function resolveHailPickupSnapshot(
  pickup: HailPickupSnapshot,
  reverseGeocode: ReverseGeocodeFn,
  opts?: { timeoutMs?: number },
): Promise<HailPickupSnapshot> {
  const address = await resolveReadableAddress(
    { address: pickup.address, lat: pickup.lat, lng: pickup.lng },
    reverseGeocode,
    opts,
  );
  return { ...pickup, address };
}
