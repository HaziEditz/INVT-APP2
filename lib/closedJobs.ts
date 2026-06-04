import { push, ref, set } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { ActiveJob, PaymentExtras, PaymentType } from '@/types';

export async function writeClosedJob(
  companyId: string,
  driverId: string,
  job: ActiveJob,
  paymentType: PaymentType | string,
  extras: PaymentExtras,
  totalFare: number,
): Promise<string> {
  const database = getDatabaseInstance();
  const entryRef = push(ref(database, `closedJobs/${companyId}`));
  const id = entryRef.key ?? job.id;
  const now = Date.now();

  await set(entryRef, {
    jobId: job.id,
    driverId,
    type: job.type,
    pickup: job.pickup,
    dropoff: job.dropoff,
    passengerName: job.passengerName ?? '',
    passengerPhone: job.passengerPhone ?? '',
    paymentType,
    fare: totalFare,
    baseFare: job.fare,
    extras,
    distanceKm: job.distanceKm,
    durationMin: job.durationMin,
    source: job.source ?? '',
    notes: job.notes ?? '',
    completedAt: now,
    closedAt: now,
    status: 'closed',
  });

  return id;
}
