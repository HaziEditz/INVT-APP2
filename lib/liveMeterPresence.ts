import { getData, STORAGE_KEYS } from '@/lib/storage';
import type { ActiveJob, MeterState } from '@/types';

/** Clears stale live-meter keys on online/current when no trip meter is active. */
const CLEAR_LIVE_METER_FIELDS: Record<string, null> = {
  fare: null,
  meterFare: null,
  jobfare: null,
  jobFare: null,
  distanceKm: null,
  JobDistance: null,
  currentTariffName: null,
  TariffName: null,
  tariffName: null,
  currentJobId: null,
  bookingId: null,
};

/**
 * Read persisted meter + active job for piggyback onto syncDriverLocation (~15s GPS).
 * No extra Firebase writes — merged into the existing online/current heartbeat.
 */
export async function loadLiveMeterPresenceFields(): Promise<Record<string, unknown>> {
  const [meter, activeJob] = await Promise.all([
    getData<MeterState>(STORAGE_KEYS.meterState),
    getData<ActiveJob>(STORAGE_KEYS.activeJob),
  ]);

  const jobId = activeJob?.id?.trim();
  if (!meter || !jobId || !meter.running) {
    return CLEAR_LIVE_METER_FIELDS;
  }

  const fare = Number(meter.fare);
  if (!Number.isFinite(fare)) {
    return CLEAR_LIVE_METER_FIELDS;
  }

  const distanceKm = Number(meter.distanceKm);
  const tariffName = meter.tariffName?.trim();

  return {
    fare,
    meterFare: fare,
    jobfare: fare,
    jobFare: fare,
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
    JobDistance: Number.isFinite(distanceKm) ? distanceKm : 0,
    currentTariffName: tariffName || null,
    TariffName: tariffName || null,
    tariffName: tariffName || null,
    currentJobId: jobId,
    bookingId: jobId,
  };
}
