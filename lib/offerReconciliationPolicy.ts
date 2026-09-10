export type ReturnedOfferLike = {
  returnReason?: string;
  lastOfferDriverId?: string;
  /** Live BookingStatus/Status when known (pendingjobs may still be Offered). */
  status?: string;
  /** Live assigned DriverId when known. */
  driverId?: string;
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
  const self = normalizeId(driverId);
  const status = String(offer.status ?? '')
    .trim()
    .toLowerCase();
  const liveDrv = normalizeId(offer.driverId);
  // Exclusive re-offer to this driver is live — leftover Declined/Timeout
  // returnReason on the pendingjobs node must not hide/kill the popup.
  if (
    (status === 'offered' || status === 'offer' || status === 'offering') &&
    liveDrv &&
    liveDrv === self
  ) {
    return false;
  }
  const lastDriver = normalizeId(offer.lastOfferDriverId);
  const reason = String(offer.returnReason ?? '').trim();
  return (
    !!lastDriver &&
    lastDriver === self &&
    RETURNED_OFFER_REASON.test(reason)
  );
}

const POOL_AVAILABLE_STATUS = new Set(['', 'pending', 'waiting', 'no one', 'noone']);

function isOfferedStatus(status: string): boolean {
  return status === 'offered' || status === 'offer' || status === 'offering';
}

/**
 * Accept stamps the booking id locally so lagging pendingjobs cannot bounce it
 * back onto Offer tab. A genuine pool restore (recall → Pending, or Offered to
 * someone else) must release that stamp so the recalling driver sees the job
 * the same way other drivers who never accepted it already do.
 *
 * Timeout / decline / network-return still stay suppressed (C4).
 */
export function shouldReleaseSuppressedPoolOffer(
  offer: ReturnedOfferLike,
  driverId: string,
): boolean {
  if (shouldSuppressReturnedPoolOffer(offer, driverId)) return false;
  const self = normalizeId(driverId);
  const status = String(offer.status ?? '')
    .trim()
    .toLowerCase();
  if (POOL_AVAILABLE_STATUS.has(status)) return true;
  if (isOfferedStatus(status)) {
    const liveDrv = normalizeId(offer.driverId);
    // Lagging exclusive to self after accept must stay hidden on Offer tab.
    if (liveDrv && liveDrv === self) return false;
    return true;
  }
  return false;
}

/**
 * Lagging allbookings Pending/removed from a prior decline must not dismiss a
 * fresh exclusive popup (a cached pool restore can arrive after the new offer
 * mounts). A newer seq, or assignment to another driver, is a real take-back.
 */
export function liveExclusiveOfferBeatsLaggingPoolRestore(opts: {
  liveExpiresAt: number;
  liveVersion?: number;
  snapshotSeq?: number;
  snapshotDriverId?: string;
  selfDriverId?: string;
  now?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  if (!(Number(opts.liveExpiresAt) > now)) return false;
  const snapDrv = normalizeId(opts.snapshotDriverId);
  const self = normalizeId(opts.selfDriverId);
  if (snapDrv && snapDrv !== '0' && snapDrv !== '-1' && self && snapDrv !== self) {
    return false;
  }
  const liveVer = Number(opts.liveVersion) || 0;
  const snapSeq = Number(opts.snapshotSeq) || 0;
  if (liveVer > 0 && snapSeq > liveVer) return false;
  return true;
}

/** A direct offer remains live only while dispatch still has it Offered to this driver. */
export function isDirectOfferStillLive(
  record: Record<string, unknown> | null,
  driverId: string,
): boolean {
  if (!record || recordStatus(record) !== 'offered') return false;
  return recordDriverId(record) === normalizeId(driverId);
}
