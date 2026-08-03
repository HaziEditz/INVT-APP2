/**
 * Hail offline fallback stores bare "lat, lng" when reverse-geocode fails.
 * Re-resolve those placeholders once connectivity returns.
 */

export type LatLng = { lat: number; lng: number };

export type HailPickupSnapshot = {
  address: string;
  lat?: number;
  lng?: number;
};

/** Bare coords or legacy "Hail - lat, lng" — not a real street address. */
export function isCoordLikeAddress(address: string | null | undefined): boolean {
  const s = String(address || '').trim();
  if (!s) return false;
  return /^(?:Hail\s*-\s*)?(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/i.test(s);
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
  const m = s.match(/^(?:Hail\s*-\s*)?(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/i);
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
): Promise<string> {
  const current = String(args.address || '').trim();
  if (!needsHailAddressResolve(current) && current) return current;

  const coords = coordsFromAddressOrFields(current, args.lat, args.lng);
  if (!coords) return current;

  try {
    const resolved = String(await reverseGeocode(coords.lat, coords.lng) || '').trim();
    if (resolved && !isCoordLikeAddress(resolved) && !needsHailAddressResolve(resolved)) {
      return resolved;
    }
    // reverseGeocodeCoords itself falls back to coords — keep trying later.
    if (resolved && !isCoordLikeAddress(resolved)) return resolved;
  } catch {
    // offline / geocoder unavailable
  }
  return current || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
}

export async function resolveHailPickupSnapshot(
  pickup: HailPickupSnapshot,
  reverseGeocode: ReverseGeocodeFn,
): Promise<HailPickupSnapshot> {
  const address = await resolveReadableAddress(
    { address: pickup.address, lat: pickup.lat, lng: pickup.lng },
    reverseGeocode,
  );
  return { ...pickup, address };
}
