import { get, ref, update } from 'firebase/database';
import { getDatabaseInstance, ensureAuthUserForRtdbWrite } from '@/lib/firebase';
import { getData, STORAGE_KEYS } from '@/lib/storage';
import type { ActiveJob, MeterState, Tariff } from '@/types';

/** Clears stale live-meter fare keys on online/current when no trip meter is ticking. */
const CLEAR_LIVE_FARE_FIELDS: Record<string, null> = {
  fare: null,
  meterFare: null,
  jobfare: null,
  jobFare: null,
  distanceKm: null,
  JobDistance: null,
};

/** Full clear when no active job at all. */
const CLEAR_LIVE_METER_FIELDS: Record<string, null> = {
  ...CLEAR_LIVE_FARE_FIELDS,
  currentTariffName: null,
  TariffName: null,
  tariffName: null,
  currentJobId: null,
  bookingId: null,
};

function tariffLabelFrom(
  meter: MeterState | null | undefined,
  activeJob: ActiveJob | null | undefined,
): string | undefined {
  const fromMeter = meter?.tariffName?.trim();
  if (fromMeter) return fromMeter;
  const fromJob = String(activeJob?.tariffName ?? '').trim();
  return fromJob || undefined;
}

/**
 * Read persisted meter + active job for piggyback onto syncDriverLocation (~15s GPS).
 * No extra Firebase writes — merged into the existing online/current heartbeat.
 * Tariff + job id stay visible on dispatch Active even when the meter is not running.
 */
export async function loadLiveMeterPresenceFields(): Promise<Record<string, unknown>> {
  const [meter, activeJob] = await Promise.all([
    getData<MeterState>(STORAGE_KEYS.meterState),
    getData<ActiveJob>(STORAGE_KEYS.activeJob),
  ]);

  const jobId = activeJob?.id?.trim();
  if (!jobId) {
    return CLEAR_LIVE_METER_FIELDS;
  }

  const tariffName = tariffLabelFrom(meter, activeJob);
  const tariffId = String(meter?.tariffId || activeJob?.tariffId || '').trim();

  if (!meter || !meter.running) {
    return {
      ...CLEAR_LIVE_FARE_FIELDS,
      currentJobId: jobId,
      bookingId: jobId,
      currentTariffName: tariffName || null,
      TariffName: tariffName || null,
      tariffName: tariffName || null,
      ...(tariffId
        ? { TariffId: tariffId, TarriffId: tariffId, tariffId }
        : { TariffId: null, TarriffId: null, tariffId: null }),
    };
  }

  const fare = Number(meter.fare);
  if (!Number.isFinite(fare)) {
    return {
      ...CLEAR_LIVE_FARE_FIELDS,
      currentJobId: jobId,
      bookingId: jobId,
      currentTariffName: tariffName || null,
      TariffName: tariffName || null,
      tariffName: tariffName || null,
    };
  }

  const distanceKm = Number(meter.distanceKm);

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
    ...(tariffId ? { TariffId: tariffId, TarriffId: tariffId, tariffId } : {}),
    currentJobId: jobId,
    bookingId: jobId,
  };
}

/** Stamp currentJobId on online/current immediately after hail/dispatch assigns a booking. */
export async function patchOnlineCurrentJobId(
  companyId: string,
  vehicleId: string,
  jobId: string,
): Promise<void> {
  const cid = String(companyId || '').trim();
  const vid = String(vehicleId || '').trim();
  const bid = String(jobId || '').trim();
  if (!cid || !vid || !bid) return;
  const onlinePath = `online/${cid}/${vid}`;
  await ensureAuthUserForRtdbWrite(`patchOnlineCurrentJobId → ${onlinePath}/current`);
  const curRef = ref(getDatabaseInstance(), `${onlinePath}/current`);
  const snap = await get(curRef);
  if (!snap.exists()) return;
  await update(curRef, {
    currentJobId: bid,
    bookingId: bid,
    jobId: bid,
    lastSeen: Date.now(),
  });
}

/**
 * Push driver-selected tariff to online/current so dispatch Active updates immediately
 * (does not wait for the next GPS heartbeat).
 */
export async function patchOnlineCurrentTariff(
  companyId: string,
  vehicleId: string,
  jobId: string,
  tariff: Pick<Tariff, 'id' | 'name'>,
): Promise<void> {
  const cid = String(companyId || '').trim();
  const vid = String(vehicleId || '').trim();
  const bid = String(jobId || '').trim();
  const tariffId = String(tariff?.id ?? '').trim();
  const tariffName = String(tariff?.name ?? '').trim();
  if (!cid || !vid || !bid || (!tariffId && !tariffName)) return;
  const onlinePath = `online/${cid}/${vid}`;
  await ensureAuthUserForRtdbWrite(`patchOnlineCurrentTariff → ${onlinePath}/current`);
  const curRef = ref(getDatabaseInstance(), `${onlinePath}/current`);
  const snap = await get(curRef);
  if (!snap.exists()) return;
  const now = Date.now();
  await update(curRef, {
    currentJobId: bid,
    bookingId: bid,
    jobId: bid,
    currentTariffName: tariffName || null,
    TariffName: tariffName || null,
    tariffName: tariffName || null,
    TariffId: tariffId || null,
    TarriffId: tariffId || null,
    tariffId: tariffId || null,
    tariffChangedAt: now,
    lastSeen: now,
  });
}
