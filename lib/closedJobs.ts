import { push, ref, set } from 'firebase/database';
import { ensureAuthUserForRtdbWrite, getDatabaseInstance } from '@/lib/firebase';
import { sanitizeForFirebase } from '@/lib/sanitizeForFirebase';
import {
  ActiveJob,
  extrasForFirebase,
  PaymentExtras,
  PaymentRecord,
  PaymentType,
} from '@/types';

export async function writeClosedJob(
  companyId: string,
  driverId: string,
  job: ActiveJob,
  paymentType: PaymentType | string,
  extras: PaymentExtras,
  totalFare: number,
  paymentDetails?: PaymentRecord,
): Promise<string> {
  await ensureAuthUserForRtdbWrite(`writeClosedJob → closedJobs/${companyId}`);
  const database = getDatabaseInstance();
  const entryRef = push(ref(database, `closedJobs/${companyId}`));
  const id = entryRef.key ?? job.id;
  const now = Date.now();
  const meter = job.meterSnapshot;

  await set(
    entryRef,
    sanitizeForFirebase({
      jobId: job.id,
      driverId,
      type: job.type,
      pickup: job.pickup,
      dropoff: job.dropoff,
      passengerName: job.passengerName ?? '',
      passengerPhone: job.passengerPhone ?? '',
      paymentType,
      amount: totalFare,
      fare: totalFare,
      baseFare: job.fare,
      extras: extrasForFirebase(extras),
      paymentDetails: paymentDetails ?? { paymentType, amount: totalFare },
      distanceKm: meter?.distanceKm ?? job.distanceKm,
      durationMin: job.durationMin,
      waitingMs: meter?.waitingMs,
      pausedMs: meter?.pausedMs,
      movingMs: meter?.movingMs,
      totalRideMs: meter?.startedAt
        ? (meter.finishedAt ?? now) - meter.startedAt
        : undefined,
      stepTimes: job.stepTimes,
      tariffId: meter?.tariffId,
      tariffName: meter?.tariffName,
      tariffChanges: job.tariffChanges?.length ? job.tariffChanges : meter?.tariffChanges,
      fareBreakdown: meter?.breakdown,
      meterFare: meter?.fare,
      source: job.source ?? '',
      notes: job.notes ?? '',
      completedAt: now,
      closedAt: now,
      status: 'closed',
    }),
  );

  return id;
}
