import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { parseJobOfferRecord } from '@/lib/pendingJobs';
import { isValidBookingId, normalizeBookingId } from '@/lib/bookingId';
import { JobOffer, Vehicle } from '@/types';

/** Orphaned driverQueue ghosts older than this are hidden and pruned server-side. */
export const DRIVER_QUEUE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function isDriverQueueEntryTooOld(queuedAt: number | undefined, now = Date.now()): boolean {
  if (!queuedAt || queuedAt <= 0) return true;
  return now - queuedAt > DRIVER_QUEUE_MAX_AGE_MS;
}

export function allbookingsConfirmsQueued(
  rec: Record<string, unknown> | null | undefined,
  driverId: string,
): boolean {
  if (!rec) return false;
  const st = String(rec.BookingStatus ?? rec.Status ?? rec.status ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (st !== 'queued') return false;
  const drv = String(rec.DriverId ?? rec.driverId ?? '').trim();
  if (!drv || drv === '0') return true;
  return drv === String(driverId).trim();
}

export async function fetchAllbookingsRecord(
  companyId: string,
  bookingId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await get(ref(getDatabaseInstance(), `allbookings/${companyId}/${bookingId}`));
    if (!snap.exists()) return null;
    const val = snap.val();
    return val && typeof val === 'object' ? (val as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function filterLiveDriverQueueOffers(
  companyId: string,
  driverId: string,
  offers: JobOffer[],
): Promise<JobOffer[]> {
  const live: JobOffer[] = [];
  for (const offer of offers) {
    if (!isValidBookingId(offer.id)) continue;
    if (isDriverQueueEntryTooOld(offer.queuedAt)) continue;
    const ab = await fetchAllbookingsRecord(companyId, offer.id);
    if (!allbookingsConfirmsQueued(ab, driverId)) continue;
    live.push(offer);
  }
  return live;
}

export function parseDriverQueueNode(id: string, val: Record<string, unknown>): JobOffer | null {
  const offer = parseJobOfferRecord(id, {
    ...val,
    BookingId: val.BookingId ?? val.jobId ?? id,
  }, { requirePending: false, requireDispatchWindow: false });
  if (!offer) return null;
  const bookingId = normalizeBookingId(val.jobId ?? val.BookingId ?? val.bookingId ?? offer.id ?? id);
  if (!isValidBookingId(bookingId)) {
    console.warn('[driverQueue] skipping queued node without valid booking id:', id);
    return null;
  }
  return {
    ...offer,
    id: bookingId,
    queuedAt: Number(val.queuedAt ?? val.acceptedAt ?? offer.postedAt ?? Date.now()),
    originalStatus: String(val.originalStatus ?? 'pending'),
    source: 'queue',
  };
}

export function subscribeDriverQueue(
  companyId: string,
  driverId: string,
  vehicle: Vehicle | undefined,
  onChange: (offers: JobOffer[]) => void,
): () => void {
  const qRef = ref(getDatabaseInstance(), `driverQueue/${companyId}/${driverId}/queued`);
  return onValue(qRef, (snap) => {
    const val = snap.val();
    if (!val || typeof val !== 'object') {
      onChange([]);
      return;
    }
    const out: JobOffer[] = [];
    for (const [key, item] of Object.entries(val)) {
      if (!item || typeof item !== 'object') continue;
      const offer = parseDriverQueueNode(key, item as Record<string, unknown>);
      if (offer) out.push(offer);
    }
    out.sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));
    onChange(out);
  });
}

export async function loadDriverQueueOnce(
  companyId: string,
  driverId: string,
): Promise<JobOffer[]> {
  const snap = await get(ref(getDatabaseInstance(), `driverQueue/${companyId}/${driverId}/queued`));
  const val = snap.val();
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val)
    .map(([key, item]) =>
      item && typeof item === 'object'
        ? parseDriverQueueNode(key, item as Record<string, unknown>)
        : null,
    )
    .filter((o): o is JobOffer => o != null);
}
