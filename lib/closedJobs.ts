import { get, push, ref, set, update } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { cleanObject } from '@/lib/cleanObject';
import { resolveClosedJobCompletedAtMs } from '@/lib/closedJobSync';
import { buildTmPersistFields, buildTmTripStatusSeed } from '@/lib/tmPaymentPersist';
import { ActiveJob, PaymentExtras, PaymentType, TmPaymentDetails } from '@/types';

export { resolveClosedJobCompletedAtMs } from '@/lib/closedJobSync';

function encodeRoutePolyline(points: { lat: number; lng: number }[]): string {
  if (!points.length) return '';
  const parts: string[] = [];
  let prevLat = 0;
  let prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    parts.push(`${lat - prevLat},${lng - prevLng}`);
    prevLat = lat;
    prevLng = lng;
  }
  return parts.join(';');
}

function fillIfEmpty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value == null || value === '') return;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
    return;
  }
  const prev = target[key];
  if (prev != null && prev !== '') return;
  target[key] = value;
}

export async function writeClosedJob(
  companyId: string,
  driverId: string,
  job: ActiveJob,
  paymentType: PaymentType | string,
  extras: PaymentExtras,
  totalFare: number,
  tmDetails?: TmPaymentDetails,
  meta?: { driverName?: string; vehicleId?: string; completedAtMs?: number },
): Promise<string> {
  const database = getDatabaseInstance();
  const completedAtMs = resolveClosedJobCompletedAtMs(job, meta?.completedAtMs);
  const meter = job.meterSnapshot;
  const routePoints = meter?.routePoints ?? [];
  const routePolyline = encodeRoutePolyline(routePoints);

  const record = cleanObject({
    jobId: job.id,
    bookingId: job.id,
    driverId,
    driverName: meta?.driverName ?? '',
    vehicleId: meta?.vehicleId ?? '',
    type: job.type,
    pickup: job.pickup,
    dropoff: job.dropoff,
    pickupAddress: job.pickup,
    dropAddress: job.dropoff,
    passengerName: job.passengerName ?? '',
    passengerPhone: job.passengerPhone ?? '',
    paymentType,
    paymentMethod: paymentType,
    Account_id: job.accountId || '',
    AccountId: job.accountId || '',
    jobAccountId: job.accountId || '',
    Account_Name: job.accountName || '',
    AccountName: job.accountName || '',
    jobAccountName: job.accountName || '',
    accountId: job.accountId || '',
    accountName: job.accountName || '',
    fare: totalFare,
    totalFare,
    baseFare: job.fare,
    extras,
    distanceKm: meter?.distanceKm ?? job.distanceKm,
    durationMin: job.durationMin,
    waitingMs: meter?.waitingMs,
    waitingMinutes: meter?.waitingMs != null ? meter.waitingMs / 60000 : undefined,
    pausedMs: meter?.pausedMs,
    movingMs: meter?.movingMs,
    totalRideMs: meter?.startedAt
      ? (meter.finishedAt ?? completedAtMs) - meter.startedAt
      : undefined,
    stepTimes: job.stepTimes,
    createdAt: job.bookedAtMs ?? job.postedAt ?? job.startedAt,
    CreatedAt: job.bookedAtMs ?? job.postedAt ?? job.startedAt,
    DriverAcceptedAt: job.stepTimes?.acceptedAt
      ? new Date(job.stepTimes.acceptedAt).toISOString()
      : undefined,
    ArrivedAt: job.stepTimes?.arrivedAt
      ? new Date(job.stepTimes.arrivedAt).toISOString()
      : undefined,
    OnBoardAt:
      job.stepTimes?.onboardAt != null || job.stepTimes?.hailStartedAt != null
        ? new Date(
            (job.stepTimes.onboardAt ?? job.stepTimes.hailStartedAt) as number,
          ).toISOString()
        : undefined,
    JobCompleteTime: new Date(completedAtMs).toISOString(),
    tariffId: meter?.tariffId,
    tariffName: meter?.tariffName,
    tariffChanges: job.tariffChanges?.length ? job.tariffChanges : meter?.tariffChanges,
    fareBreakdown: meter?.breakdown,
    FareBreakdown: meter?.breakdown,
    meterFare: meter?.fare,
    flagFall: meter?.breakdown?.flagFall,
    distanceCharge: meter?.breakdown?.distanceCharge,
    waitingCharge: meter?.breakdown?.waitingCharge,
    VehicleType: job.vehicleType || job.vehicleTypeRequired || '',
    vehicleType: job.vehicleType || job.vehicleTypeRequired || '',
    gpsRoute: routePoints,
    routePolyline,
    route_polyline: routePolyline,
    source: job.source ?? '',
    notes: job.notes ?? '',
    completedAt: completedAtMs,
    closedAt: completedAtMs,
    status: 'closed',
    BookingStatus: 'Completed',
    ...(tmDetails
      ? buildTmPersistFields(tmDetails, {
          councilId: tmDetails.councilId,
          remainderPaymentType: String(paymentType || ''),
        })
      : {}),
  });

  const completedRef = ref(database, `completedJobs/${companyId}/${job.id}`);
  let alreadyHasCompleted = false;
  try {
    const existing = await get(completedRef);
    alreadyHasCompleted = existing.exists();
  } catch {
    alreadyHasCompleted = false;
  }

  // Idempotent: skip closedJobs push when completedJobs already exists (server
  // upsert or a prior flush already wrote the trip).
  let closedPushKey = String(job.id);
  if (!alreadyHasCompleted) {
    const entryRef = push(ref(database, `closedJobs/${companyId}`));
    closedPushKey = entryRef.key ?? String(job.id);
    await set(entryRef, record);
  }

  try {
    if (alreadyHasCompleted) {
      const existingVal = (await get(completedRef)).val() as Record<string, unknown> | null;
      const merged: Record<string, unknown> = {
        ...(existingVal && typeof existingVal === 'object' ? existingVal : {}),
      };
      for (const [k, v] of Object.entries({
        ...record,
        bookingId: job.id,
        companyId,
        status: 'Completed',
      })) {
        fillIfEmpty(merged, k, v);
      }
      // Never let a late flush overwrite confirm-time completion stamps.
      if (
        typeof existingVal?.completedAt === 'number' &&
        existingVal.completedAt > 0 &&
        existingVal.completedAt < completedAtMs
      ) {
        merged.completedAt = existingVal.completedAt;
        merged.closedAt = existingVal.closedAt ?? existingVal.completedAt;
        if (existingVal.JobCompleteTime) merged.JobCompleteTime = existingVal.JobCompleteTime;
      }
      await update(completedRef, cleanObject(merged));
    } else {
      await set(completedRef, {
        ...record,
        bookingId: job.id,
        companyId,
        status: 'Completed',
      });
    }
  } catch {
    // non-fatal — closedLogs push is primary when we pushed
  }

  // Seed claim pipeline so council portal / SA batches can see the trip.
  const councilId = String(tmDetails?.councilId || '').trim();
  if (tmDetails && councilId) {
    try {
      const statusRef = ref(database, `tmTripStatus/${companyId}/${job.id}`);
      const statusSnap = await get(statusRef);
      if (!statusSnap.exists()) {
        await set(
          statusRef,
          buildTmTripStatusSeed(companyId, councilId, tmDetails, {
            submittedAt: completedAtMs,
          }),
        );
      }
    } catch (err) {
      console.warn('[closedJobs] tmTripStatus seed failed:', err);
    }
  }

  return closedPushKey;
}
