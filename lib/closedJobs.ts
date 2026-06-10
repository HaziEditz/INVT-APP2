import { push, ref, set } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { cleanObject } from '@/lib/cleanObject';
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
    tariffId: meter?.tariffId,
    tariffName: meter?.tariffName,
    tariffChanges: job.tariffChanges?.length ? job.tariffChanges : meter?.tariffChanges,
    fareBreakdown: meter?.breakdown,
    meterFare: meter?.fare,
    flagFall: meter?.breakdown?.flagFall,
    distanceCharge: meter?.breakdown?.distanceCharge,
    waitingCharge: meter?.breakdown?.waitingCharge,
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
      ? {
          tmCouncilPays: tmDetails.councilPays,
          tmPassengerPays: tmDetails.passengerPays,
          tmCardNumber: tmDetails.tmCardNumber ?? '',
          tmCardName: tmDetails.tmCardName ?? '',
          tmCardExpiry: tmDetails.tmCardExpiry ?? '',
          tmTotalFare: tmDetails.totalFare,
        }
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

  return id;
}
