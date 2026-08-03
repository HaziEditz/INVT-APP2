/** Prefer the first non-empty trimmed string (empty string is not authoritative). */
export function firstNonEmptyString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return '';
}

/** Pickup aliases used across offer notifications, pool, and allbookings. */
export function readPickupAddress(val: Record<string, unknown> | null | undefined): string {
  if (!val) return '';
  return firstNonEmptyString(
    val.pickup,
    val.from,
    val.jobpickup,
    val.PickAddress,
    val.pickAddress,
    val.PickupAddress,
    val.pickupAddress,
  );
}

/** Dropoff aliases — parseJobOffer historically missed DropAddress. */
export function readDropoffAddress(val: Record<string, unknown> | null | undefined): string {
  if (!val) return '';
  return firstNonEmptyString(
    val.dropoff,
    val.to,
    val.jobdropoff,
    val.DropAddress,
    val.dropAddress,
    val.DropLocation,
    val.dropoffAddress,
    val.finalDropAddress,
  );
}
