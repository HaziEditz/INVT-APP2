import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { parseJobOfferRecord } from '@/lib/pendingJobs';
import { isValidBookingId, normalizeBookingId } from '@/lib/bookingId';
import {
  DRIVER_QUEUE_MAX_AGE_MS,
  allbookingsConfirmsQueued,
  bookingRecordConfirmsQueued,
  bookingRecordMeansLeaveQueue,
  filterLiveDriverQueueOffersWithFetchers,
  isDriverQueueEntryTooOld,
  mergeOptimisticQueuedOffer,
  shouldKeepDriverQueueOffer,
  toQueuedOffer,
  type QueueConfirmFetchers,
} from '@/lib/driverQueuePolicy';
import { JobOffer, Vehicle } from '@/types';

export {
  DRIVER_QUEUE_MAX_AGE_MS,
  allbookingsConfirmsQueued,
  bookingRecordConfirmsQueued,
  bookingRecordMeansLeaveQueue,
  isDriverQueueEntryTooOld,
  mergeOptimisticQueuedOffer,
  shouldKeepDriverQueueOffer,
  toQueuedOffer,
};

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

export async function fetchPendingjobsRecord(
  companyId: string,
  bookingId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await get(ref(getDatabaseInstance(), `pendingjobs/${companyId}/${bookingId}`));
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
  fetchers?: QueueConfirmFetchers,
): Promise<JobOffer[]> {
  return filterLiveDriverQueueOffersWithFetchers(companyId, driverId, offers, {
    fetchAllbookings: fetchers?.fetchAllbookings ?? fetchAllbookingsRecord,
    fetchPendingjobs: fetchers?.fetchPendingjobs ?? fetchPendingjobsRecord,
  });
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
