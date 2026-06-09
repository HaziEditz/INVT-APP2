import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { parsePendingJobNode } from '@/lib/pendingJobs';
import { JobOffer, Vehicle } from '@/types';

export function parseDriverQueueNode(id: string, val: Record<string, unknown>): JobOffer | null {
  const offer = parsePendingJobNode(id, {
    ...val,
    Status: 'Queued',
    BookingId: val.BookingId ?? val.jobId ?? id,
  });
  if (!offer) return null;
  return {
    ...offer,
    id: String(val.jobId ?? val.BookingId ?? id),
    queuedAt: Number(val.queuedAt ?? val.acceptedAt ?? Date.now()),
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
