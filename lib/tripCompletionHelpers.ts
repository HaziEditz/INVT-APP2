import { ActiveJob, MeterState, Tariff } from '@/types';
import { NO_TARIFF_CONFIGURED } from '@/lib/tariffs';
import { STORAGE_KEYS, storeData } from '@/lib/storage';
import { formatEndTripError } from './endHailPolicy.ts';

/** Strip heavy GPS polyline from persisted copies — keeps AsyncStorage writes fast. */
export function slimMeterForStorage(meter: MeterState | undefined): MeterState | undefined {
  if (!meter?.routePoints?.length) return meter;
  return { ...meter, routePoints: [] };
}

export function slimJobForStorage(job: ActiveJob): ActiveJob {
  if (!job.meterSnapshot?.routePoints?.length) return job;
  return {
    ...job,
    meterSnapshot: slimMeterForStorage(job.meterSnapshot),
  };
}

export function persistActiveJobAsync(job: ActiveJob): void {
  void storeData(STORAGE_KEYS.activeJob, slimJobForStorage(job)).catch((err) => {
    console.warn('[TripCompletion] persist activeJob failed:', err);
  });
}

export function persistMeterAsync(meter: MeterState | null): void {
  if (!meter) {
    void storeData(STORAGE_KEYS.meterState, null).catch(() => undefined);
    return;
  }
  void storeData(STORAGE_KEYS.meterState, slimMeterForStorage(meter) ?? meter).catch((err) => {
    console.warn('[TripCompletion] persist meterState failed:', err);
  });
}

export type PaymentFareSummary = {
  tripMs: number;
  distanceKm: number;
  waitingMin: number;
  flagFall: number;
  distanceCharge: number;
  waitingCharge: number;
  ratePerKm: number;
  waitingPerMin: number;
  tripTotal: number;
};

export function computePaymentFareSummary(
  paymentJob: ActiveJob,
  selectedTariff: Tariff | null | undefined,
): PaymentFareSummary {
  const tariff = selectedTariff?.id ? selectedTariff : NO_TARIFF_CONFIGURED;
  const meter = paymentJob.meterSnapshot;
  const breakdown = meter?.breakdown;

  const flagFall = Number(breakdown?.flagFall ?? tariff.flagFall ?? 0) || 0;
  const distanceKm = Number(breakdown?.distanceKm ?? meter?.distanceKm ?? paymentJob.distanceKm ?? 0) || 0;
  const waitingMin =
    Number(breakdown?.waitingMinutes ?? (meter?.waitingMs != null ? meter.waitingMs / 60000 : 0)) || 0;
  const ratePerKm = Number(tariff.ratePerKm ?? 0) || 0;
  const waitingPerMin = Number(tariff.waitingPerMin ?? 0) || 0;
  const distanceCharge = Number(breakdown?.distanceCharge ?? distanceKm * ratePerKm) || 0;
  const waitingCharge = Number(breakdown?.waitingCharge ?? waitingMin * waitingPerMin) || 0;

  const fixed = paymentJob.fixedFare ?? paymentJob.fare;
  const tripTotal = Number(
    breakdown?.total ??
      meter?.fare ??
      fixed ??
      flagFall + distanceCharge + waitingCharge,
  );
  const safeTripTotal = Number.isFinite(tripTotal) ? tripTotal : 0;

  const started = meter?.startedAt ?? paymentJob.startedAt;
  const finished = meter?.finishedAt ?? Date.now();
  const durationMin = Number(paymentJob.durationMin ?? 0) || 0;
  const tripMs = started
    ? Math.max(0, finished - started)
    : durationMin > 0
      ? durationMin * 60000
      : 0;

  return {
    tripMs: Number.isFinite(tripMs) ? tripMs : 0,
    distanceKm,
    waitingMin,
    flagFall,
    distanceCharge,
    waitingCharge,
    ratePerKm,
    waitingPerMin,
    tripTotal: safeTripTotal,
  };
}

export function completionErrorMessage(err: unknown): string {
  return formatEndTripError(err);
}
