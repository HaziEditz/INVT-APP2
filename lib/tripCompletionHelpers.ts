import type { ActiveJob, MeterFareBreakdown, MeterState, Tariff } from '../types/index.ts';
import { NO_TARIFF_CONFIGURED } from './tariffs.ts';
import { STORAGE_KEYS, storeData } from './storage.ts';
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

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Sum GPS polyline km (fallback when meter.distanceKm stayed 0). */
function routePointsDistanceKm(
  points: { lat: number; lng: number }[] | undefined,
): number {
  if (!points || points.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return km;
}

export function computePaymentFareSummary(
  paymentJob: ActiveJob,
  selectedTariff: Tariff | null | undefined,
): PaymentFareSummary {
  const tariff = selectedTariff?.id ? selectedTariff : NO_TARIFF_CONFIGURED;
  const meter = paymentJob.meterSnapshot;
  const breakdown = meter?.breakdown;

  const flagFall = Number(breakdown?.flagFall ?? tariff.flagFall ?? 0) || 0;
  const meterKm = Number(breakdown?.distanceKm ?? meter?.distanceKm ?? paymentJob.distanceKm ?? 0) || 0;
  const routeKm = routePointsDistanceKm(meter?.routePoints);
  const estKm = Number((paymentJob as { estimatedDistanceKm?: number }).estimatedDistanceKm ?? 0) || 0;
  const pickupLat = Number(paymentJob.pickupLat);
  const pickupLng = Number(paymentJob.pickupLng);
  const dropLat = Number(paymentJob.dropoffLat);
  const dropLng = Number(paymentJob.dropoffLng);
  const straightKm =
    Number.isFinite(pickupLat) &&
    Number.isFinite(pickupLng) &&
    Number.isFinite(dropLat) &&
    Number.isFinite(dropLng) &&
    (pickupLat !== dropLat || pickupLng !== dropLng)
      ? haversineKm(pickupLat, pickupLng, dropLat, dropLng)
      : 0;
  // Prefer live meter, then GPS polyline, then booking estimate, then straight-line.
  // Map "Route" is OSRM between addresses — not the meter trail — so never leave 0
  // when pickup/dropoff are genuinely apart.
  const distanceKm =
    meterKm > 0.01
      ? meterKm
      : routeKm > 0.01
        ? routeKm
        : estKm > 0.01
          ? estKm
          : straightKm;
  const waitingMin =
    Number(breakdown?.waitingMinutes ?? (meter?.waitingMs != null ? meter.waitingMs / 60000 : 0)) || 0;
  const ratePerKm = Number(tariff.ratePerKm ?? 0) || 0;
  const waitingPerMin = Number(tariff.waitingPerMin ?? 0) || 0;
  const distanceCharge = Number(
    distanceKm > 0 && (breakdown?.distanceCharge == null || Number(breakdown.distanceCharge) === 0)
      ? distanceKm * ratePerKm
      : (breakdown?.distanceCharge ?? distanceKm * ratePerKm),
  ) || 0;
  const waitingCharge = Number(breakdown?.waitingCharge ?? waitingMin * waitingPerMin) || 0;

  // Prepaid / fixed: Total is the locked passenger charge (Stripe), NOT flag+dist+wait.
  // Display components are reference-only — coincidence that Total≈flag+wait when dist=0.
  const fixed = paymentJob.fixedFare ?? paymentJob.fare;
  const tripTotal = Number(
    meter?.lockedFare ??
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

/**
 * Same arithmetic the Payment modal shows — so Closed Jobs persist the
 * displayed fare even when meterSnapshot.breakdown was never stamped.
 */
export function buildCompleteFareBreakdown(
  paymentJob: ActiveJob,
  selectedTariff: Tariff | null | undefined,
): MeterFareBreakdown {
  const summary = computePaymentFareSummary(paymentJob, selectedTariff);
  return {
    flagFall: summary.flagFall,
    distanceKm: summary.distanceKm,
    distanceCharge: summary.distanceCharge,
    waitingMinutes: summary.waitingMin,
    waitingCharge: summary.waitingCharge,
    total: summary.tripTotal,
  };
}

/** Ensure meterSnapshot carries a breakdown matching Payment modal math. */
export function withCompleteFareBreakdown(
  job: ActiveJob,
  selectedTariff: Tariff | null | undefined,
): ActiveJob {
  const breakdown = buildCompleteFareBreakdown(job, selectedTariff);
  // Fixed-fare jobs must not adopt the driver's active meter tariff name/id.
  if (job.isFixedPrice) {
    const meter = job.meterSnapshot;
    if (!meter) {
      return {
        ...job,
        distanceKm: job.distanceKm || breakdown.distanceKm,
        fare: breakdown.total,
        meterSnapshot: {
          running: false,
          paused: false,
          mode: 'waiting' as const,
          startedAt: job.startedAt || Date.now(),
          finishedAt: Date.now(),
          pausedMs: 0,
          movingMs: 0,
          waitingMs: breakdown.waitingMinutes * 60000,
          distanceKm: breakdown.distanceKm,
          tariffId: '-1',
          tariffName: 'Fixed',
          tariffChanges: job.tariffChanges || [],
          breakdown,
          fare: breakdown.total,
          trackOnly: true,
          lockedFare: breakdown.total,
        },
      };
    }
    return {
      ...job,
      distanceKm: job.distanceKm || meter.distanceKm || breakdown.distanceKm,
      fare: breakdown.total,
      meterSnapshot: {
        ...meter,
        breakdown: {
          ...breakdown,
          // Prefer live GPS distance over estimate when track-only ran.
          distanceKm: meter.distanceKm > 0 ? meter.distanceKm : breakdown.distanceKm,
          flagFall: breakdown.flagFall || meter.breakdown?.flagFall || 0,
        },
        fare: breakdown.total,
        distanceKm: meter.distanceKm || breakdown.distanceKm,
        finishedAt: meter.finishedAt ?? Date.now(),
        running: false,
        tariffId: '-1',
        tariffName: 'Fixed',
        trackOnly: true,
        lockedFare: breakdown.total,
      },
    };
  }
  const meter = job.meterSnapshot;
  const nextMeter: MeterState = meter
    ? {
        ...meter,
        breakdown,
        fare: breakdown.total,
        distanceKm: meter.distanceKm || breakdown.distanceKm,
        finishedAt: meter.finishedAt ?? Date.now(),
        running: false,
      }
    : {
        running: false,
        paused: false,
        mode: 'waiting',
        startedAt: job.startedAt || Date.now(),
        finishedAt: Date.now(),
        pausedMs: 0,
        movingMs: 0,
        waitingMs: breakdown.waitingMinutes * 60000,
        distanceKm: breakdown.distanceKm,
        tariffId: selectedTariff?.id || '',
        tariffName: selectedTariff?.name || '',
        tariffChanges: job.tariffChanges || [],
        breakdown,
        fare: breakdown.total,
      };
  return {
    ...job,
    distanceKm: job.distanceKm || breakdown.distanceKm,
    fare: breakdown.total,
    meterSnapshot: nextMeter,
  };
}

export function completionErrorMessage(err: unknown): string {
  return formatEndTripError(err);
}
