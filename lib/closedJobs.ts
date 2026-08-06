import { push, ref, set } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { cleanObject } from '@/lib/cleanObject';
import { buildTmPersistFields, buildTmTripStatusSeed } from '@/lib/tmPaymentPersist';
import { ActiveJob, PaymentExtras, PaymentType, TmPaymentDetails } from '@/types';

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

export async function writeClosedJob(
  companyId: string,
  driverId: string,
  job: ActiveJob,
  paymentType: PaymentType | string,
  extras: PaymentExtras,
  totalFare: number,
  tmDetails?: TmPaymentDetails,
  meta?: { driverName?: string; vehicleId?: string },
): Promise<string> {
  const database = getDatabaseInstance();
  const entryRef = push(ref(database, `closedJobs/${companyId}`));
  const id = entryRef.key ?? job.id;
  const now = Date.now();
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
      ? (meter.finishedAt ?? now) - meter.startedAt
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
    completedAt: now,
    closedAt: now,
    status: 'closed',
    BookingStatus: 'Completed',
    ...(tmDetails
      ? buildTmPersistFields(tmDetails, {
          councilId: tmDetails.councilId,
          remainderPaymentType: String(paymentType || ''),
        })
      : {}),
  });

  await set(entryRef, record);

  const completedRef = ref(database, `completedJobs/${companyId}/${job.id}`);
  try {
    await set(completedRef, {
      ...record,
      bookingId: job.id,
      companyId,
      status: 'Completed',
    });
  } catch {
    // non-fatal — closedLogs push is primary
  }

  // Seed claim pipeline so council portal / SA batches can see the trip.
  const councilId = String(tmDetails?.councilId || '').trim();
  if (tmDetails && councilId) {
    try {
      await set(
        ref(database, `tmTripStatus/${companyId}/${job.id}`),
        buildTmTripStatusSeed(companyId, councilId, tmDetails),
      );
    } catch (err) {
      console.warn('[closedJobs] tmTripStatus seed failed:', err);
    }
  }

  return id;
}
