import { markBookingCompleted, readBookingTripAddresses } from '@/lib/allbookings';
import { writeClosedJob } from '@/lib/closedJobs';
import { isProvisionalBookingId } from '@/lib/bookingId';
import {
  needsHailAddressResolve,
  resolveReadableAddress,
} from '@/lib/hailAddressResolve';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import {
  applyTripFieldsToJob,
  pendingClosedJobMatches,
  type PendingClosedJobRecord,
} from '@/lib/closedJobSync';

async function loadAll(): Promise<PendingClosedJobRecord[]> {
  const rows = (await getData<PendingClosedJobRecord[]>(STORAGE_KEYS.pendingClosedJobs)) ?? [];
  return Array.isArray(rows) ? rows : [];
}

async function saveAll(rows: PendingClosedJobRecord[]): Promise<void> {
  await storeData(STORAGE_KEYS.pendingClosedJobs, rows);
}

export async function listPendingClosedJobs(): Promise<PendingClosedJobRecord[]> {
  return loadAll();
}

export async function upsertPendingClosedJob(
  record: PendingClosedJobRecord,
): Promise<void> {
  const rows = await loadAll();
  const idx = rows.findIndex(
    (r) =>
      pendingClosedJobMatches(r, {
        localJobId: record.localJobId,
        clientTripId: record.clientTripId,
        serverJobId: String(record.job.id),
      }),
  );
  if (idx >= 0) rows[idx] = record;
  else rows.push(record);
  await saveAll(rows);
}

export async function removePendingClosedJob(args: {
  serverJobId?: string;
  clientTripId?: string;
  localJobId?: string;
}): Promise<void> {
  const rows = await loadAll();
  const next = rows.filter((r) => !pendingClosedJobMatches(r, args));
  if (next.length !== rows.length) await saveAll(next);
}

/** Bind hail provisional ids to the numeric server job id before Firebase write. */
export async function bindPendingClosedJobServerId(args: {
  clientTripId: string;
  serverJobId: string;
}): Promise<PendingClosedJobRecord | null> {
  const rows = await loadAll();
  const idx = rows.findIndex((r) => r.clientTripId === args.clientTripId);
  if (idx < 0) return null;
  const next: PendingClosedJobRecord = {
    ...rows[idx],
    job: { ...rows[idx].job, id: args.serverJobId },
  };
  rows[idx] = next;
  await saveAll(rows);
  return next;
}

/** Retry Firebase closed-job writes that failed while offline. */
export async function flushPendingClosedJobs(opts?: {
  only?: { serverJobId?: string; clientTripId?: string; localJobId?: string };
  /** Merge journal payload trip fields onto the stored snapshot before write. */
  tripFields?: Record<string, unknown>;
}): Promise<number> {
  const rows = await loadAll();
  let wrote = 0;
  for (const row of rows) {
    if (opts?.only && !pendingClosedJobMatches(row, opts.only)) continue;
    let job = applyTripFieldsToJob(row.job, opts?.tripFields);
    const jobId = String(job.id || row.localJobId || '').trim();
    if (!jobId || isProvisionalBookingId(jobId) || jobId.startsWith('hail_')) {
      continue;
    }
    // Dispatch dropoff often missing on ActiveJob — backfill from allbookings on flush.
    if (!String(job.dropoff || '').trim() || !String(job.pickup || '').trim()) {
      const fromBooking = await readBookingTripAddresses(row.companyId, jobId);
      if (fromBooking) {
        job = applyTripFieldsToJob(job, fromBooking);
      }
    }
    // Hail offline: upgrade bare "lat, lng" placeholders once reverse-geocode works.
    if (
      needsHailAddressResolve(job.pickup) ||
      needsHailAddressResolve(job.dropoff)
    ) {
      try {
        const { reverseGeocodeCoords } = await import('@/services/locationService');
        const pickup = await resolveReadableAddress(
          { address: job.pickup, lat: job.pickupLat, lng: job.pickupLng },
          reverseGeocodeCoords,
        );
        const dropoff = await resolveReadableAddress(
          {
            address: job.dropoff,
            lat: job.dropoffLat,
            lng: job.dropoffLng,
          },
          reverseGeocodeCoords,
        );
        job = { ...job, pickup, dropoff };
      } catch (geoErr) {
        console.warn('[pendingClosedJob] reverse-geocode failed:', geoErr);
      }
    }
    try {
      await writeClosedJob(
        row.companyId,
        row.driverId,
        { ...job, id: jobId },
        row.paymentType,
        row.extras,
        row.totalFare,
        row.tmDetails,
        { driverName: row.driverName, vehicleId: row.vehicleId },
      );
      try {
        await markBookingCompleted(row.companyId, jobId, {
          fare: row.totalFare,
          paymentType: row.paymentType,
          driverId: row.driverId,
          completedAt: row.completedAt,
          distanceKm: job.distanceKm ?? job.meterSnapshot?.distanceKm,
          pickup: job.pickup,
          dropoff: job.dropoff,
          passengerName: job.passengerName,
          passengerPhone: job.passengerPhone,
        });
      } catch (err) {
        console.warn('[pendingClosedJob] markBookingCompleted failed:', err);
      }
      await removePendingClosedJob({
        localJobId: row.localJobId,
        clientTripId: row.clientTripId,
        serverJobId: jobId,
      });
      wrote += 1;
    } catch (err) {
      console.warn('[pendingClosedJob] writeClosedJob retry failed:', err);
    }
  }
  return wrote;
}
