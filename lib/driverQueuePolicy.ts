import { isValidBookingId } from './bookingId.ts';

/** Minimal offer shape — avoids pulling full types into node test graph. */
export type QueueOfferLike = {
  id: string;
  queuedAt?: number;
  originalStatus?: string;
  source?: string;
  [key: string]: unknown;
};

export type QueuedOfferLike = QueueOfferLike & { queuedAt: number };

/** Orphaned driverQueue ghosts older than this are hidden and pruned server-side. */
export const DRIVER_QUEUE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function isDriverQueueEntryTooOld(queuedAt: number | undefined, now = Date.now()): boolean {
  if (!queuedAt || queuedAt <= 0) return true;
  return now - queuedAt > DRIVER_QUEUE_MAX_AGE_MS;
}

function normalizeBookingStatus(rec: Record<string, unknown> | null | undefined): string {
  if (!rec) return '';
  return String(rec.BookingStatus ?? rec.Status ?? rec.status ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function driverIdMatches(rec: Record<string, unknown>, driverId: string): boolean {
  const drv = String(rec.DriverId ?? rec.driverId ?? '').trim();
  if (!drv || drv === '0') return true;
  return drv === String(driverId).trim();
}

/** Shared shape check for allbookings / pendingjobs Queued mirrors. */
export function bookingRecordConfirmsQueued(
  rec: Record<string, unknown> | null | undefined,
  driverId: string,
): boolean {
  if (!rec) return false;
  if (normalizeBookingStatus(rec) !== 'queued') return false;
  return driverIdMatches(rec, driverId);
}

/** @deprecated Prefer bookingRecordConfirmsQueued — same semantics. */
export function allbookingsConfirmsQueued(
  rec: Record<string, unknown> | null | undefined,
  driverId: string,
): boolean {
  return bookingRecordConfirmsQueued(rec, driverId);
}

/** Statuses that mean this driverQueue row must not stay on the Queue tab. */
export function bookingRecordMeansLeaveQueue(
  rec: Record<string, unknown> | null | undefined,
): boolean {
  if (!rec) return false;
  const st = normalizeBookingStatus(rec);
  if (!st) return false;
  if (st === 'queued') return false;
  return true;
}

/**
 * Keep a driverQueue subscribe row when:
 * 1) allbookings confirms Queued, or
 * 2) pendingjobs Queued mirror confirms (public-read fanout), or
 * 3) both re-confirm reads fail/null (permission / race) — trust the live driverQueue node.
 * Drop when a record exists and is clearly not Queued (terminal / recalled / promoted).
 * allbookings leave-status wins over a stale pendingjobs Queued mirror.
 */
export function shouldKeepDriverQueueOffer(opts: {
  offer: Pick<QueueOfferLike, 'id' | 'queuedAt'>;
  driverId: string;
  allbookings: Record<string, unknown> | null;
  pendingjobs: Record<string, unknown> | null;
  now?: number;
}): boolean {
  const { offer, driverId, allbookings, pendingjobs, now = Date.now() } = opts;
  if (!isValidBookingId(offer.id)) return false;
  if (isDriverQueueEntryTooOld(offer.queuedAt, now)) return false;

  if (bookingRecordMeansLeaveQueue(allbookings)) return false;
  if (bookingRecordConfirmsQueued(allbookings, driverId)) return true;
  if (bookingRecordConfirmsQueued(pendingjobs, driverId)) return true;
  if (bookingRecordMeansLeaveQueue(pendingjobs)) return false;

  return allbookings == null && pendingjobs == null;
}

export type QueueConfirmFetchers = {
  fetchAllbookings?: (companyId: string, bookingId: string) => Promise<Record<string, unknown> | null>;
  fetchPendingjobs?: (companyId: string, bookingId: string) => Promise<Record<string, unknown> | null>;
};

export async function filterLiveDriverQueueOffersWithFetchers<T extends QueueOfferLike>(
  companyId: string,
  driverId: string,
  offers: T[],
  fetchers: {
    fetchAllbookings: (companyId: string, bookingId: string) => Promise<Record<string, unknown> | null>;
    fetchPendingjobs: (companyId: string, bookingId: string) => Promise<Record<string, unknown> | null>;
  },
): Promise<T[]> {
  const live: T[] = [];
  for (const offer of offers) {
    const [ab, pj] = await Promise.all([
      fetchers.fetchAllbookings(companyId, offer.id),
      fetchers.fetchPendingjobs(companyId, offer.id),
    ]);
    if (
      shouldKeepDriverQueueOffer({
        offer,
        driverId,
        allbookings: ab,
        pendingjobs: pj,
      })
    ) {
      live.push(offer);
    }
  }
  return live;
}

/** Optimistic Queue-tab row after accept returns queued (before/without subscribe lag). */
export function toQueuedOffer<T extends QueueOfferLike>(offer: T, queuedAt = Date.now()): T & { queuedAt: number } {
  return {
    ...offer,
    queuedAt: Number(offer.queuedAt ?? queuedAt) || Date.now(),
    originalStatus: offer.originalStatus ?? 'pending',
    source: offer.source === 'queue' ? 'queue' : offer.source || 'queue',
  };
}

export function mergeOptimisticQueuedOffer<T extends QueueOfferLike>(
  prev: Array<T & { queuedAt: number }>,
  offer: T,
  queuedAt = Date.now(),
): Array<T & { queuedAt: number }> {
  const next = toQueuedOffer(offer, queuedAt);
  const without = prev.filter((o) => o.id !== next.id);
  return [...without, next].sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));
}
