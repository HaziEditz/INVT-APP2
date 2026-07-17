export type ReturnedOfferLike = {
  returnReason?: string;
  lastOfferDriverId?: string;
};

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function recordStatus(record: Record<string, unknown>): string {
  return String(record.BookingStatus ?? record.Status ?? record.status ?? '')
    .trim()
    .toLowerCase();
}

function recordDriverId(record: Record<string, unknown>): string {
  return normalizeId(
    record.DriverId ??
      record.driverId ??
      record.AssignedDriverId ??
      record.assignedDriverId ??
      record.AssignedDriver,
  );
}

const RETURNED_OFFER_REASON =
  /(offer expired|offer timeout|no response|network issue|unreachable|declined)/i;

/**
 * A Pending pool row that was just returned from this driver is not a fresh
 * actionable offer for that same driver. Other drivers may still see it.
 */
export function shouldSuppressReturnedPoolOffer(
  offer: ReturnedOfferLike,
  driverId: string,
): boolean {
  const lastDriver = normalizeId(offer.lastOfferDriverId);
  const reason = String(offer.returnReason ?? '').trim();
  return (
    !!lastDriver &&
    lastDriver === normalizeId(driverId) &&
    RETURNED_OFFER_REASON.test(reason)
  );
}

/** A direct offer remains live only while dispatch still has it Offered to this driver. */
export function isDirectOfferStillLive(
  record: Record<string, unknown> | null,
  driverId: string,
): boolean {
  if (!record || recordStatus(record) !== 'offered') return false;
  return recordDriverId(record) === normalizeId(driverId);
}
