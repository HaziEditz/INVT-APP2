import { MeterFareBreakdown, MeterState, Tariff, TariffSegmentBreakdown, TariffSnapshot } from '@/types';

export const NO_TARIFF_CONFIGURED: Tariff = {
  id: '__none__',
  name: 'No tariff configured',
  flagFall: 0,
  ratePerKm: 0,
  waitingPerMin: 0,
};

export function isTariffConfigured(tariff: Tariff): boolean {
  return tariff.id !== NO_TARIFF_CONFIGURED.id;
}

export function tariffToSnapshot(tariff: Tariff): TariffSnapshot {
  return {
    id: tariff.id,
    name: tariff.name,
    flagFall: tariff.flagFall,
    ratePerKm: tariff.ratePerKm,
    waitingPerMin: tariff.waitingPerMin,
  };
}

/** Cumulative fare: flag fall + distance charge + waiting charge (single tariff). */
export function calcMeterBreakdown(
  tariff: Tariff,
  distanceKm: number,
  waitingMinutes: number,
): MeterFareBreakdown {
  const flagFall = tariff.flagFall;
  const distanceCharge = distanceKm * tariff.ratePerKm;
  const waitingCharge = waitingMinutes * tariff.waitingPerMin;
  const total = flagFall + distanceCharge + waitingCharge;
  return {
    flagFall,
    distanceKm,
    distanceCharge,
    waitingMinutes,
    waitingCharge,
    total,
  };
}

export function calcMeterFare(
  tariff: Tariff,
  distanceKm: number,
  waitingMinutes: number,
): number {
  return calcMeterBreakdown(tariff, distanceKm, waitingMinutes).total;
}

function pushSegment(
  segments: TariffSegmentBreakdown[],
  tariff: { name: string; ratePerKm: number; waitingPerMin: number },
  prevDist: number,
  prevWaitMs: number,
  distEnd: number,
  waitEnd: number,
  changedAt?: number,
): { prevDist: number; prevWaitMs: number } {
  const segDist = Math.max(0, distEnd - prevDist);
  const segWaitMin = Math.max(0, (waitEnd - prevWaitMs) / 60000);
  const distanceCharge = segDist * tariff.ratePerKm;
  const waitingCharge = segWaitMin * tariff.waitingPerMin;
  if (segDist > 0 || segWaitMin > 0 || segments.length === 0) {
    segments.push({
      tariffName: tariff.name,
      changedAt,
      distanceKm: segDist,
      waitingMinutes: segWaitMin,
      ratePerKm: tariff.ratePerKm,
      waitingPerMin: tariff.waitingPerMin,
      distanceCharge,
      waitingCharge,
      rideSubtotal: distanceCharge + waitingCharge,
    });
  }
  return { prevDist: distEnd, prevWaitMs: waitEnd };
}

/** Multi-tariff trip: base charge once + per-segment distance/waiting at each tariff's rates. */
export function calcSegmentedMeterBreakdown(
  meter: Pick<MeterState, 'startTariff' | 'tariffChanges' | 'distanceKm' | 'waitingMs'>,
  currentTariff: Tariff,
): MeterFareBreakdown {
  const start =
    meter.startTariff ??
    tariffToSnapshot(currentTariff);
  const changes = [...(meter.tariffChanges ?? [])].sort((a, b) => a.at - b.at);
  const waitMin = meter.waitingMs / 60000;

  if (changes.length === 0) {
    return calcMeterBreakdown(currentTariff, meter.distanceKm, waitMin);
  }

  const segments: TariffSegmentBreakdown[] = [];
  let prevDist = 0;
  let prevWaitMs = 0;

  const first = changes[0];
  ({ prevDist, prevWaitMs } = pushSegment(
    segments,
    start,
    prevDist,
    prevWaitMs,
    first.distanceKmAtChange,
    first.waitingMsAtChange,
  ));

  for (let i = 0; i < changes.length - 1; i++) {
    const ch = changes[i];
    const next = changes[i + 1];
    ({ prevDist, prevWaitMs } = pushSegment(
      segments,
      { name: ch.tariffName, ratePerKm: ch.newRatePerKm, waitingPerMin: ch.newWaitingPerMin },
      prevDist,
      prevWaitMs,
      next.distanceKmAtChange,
      next.waitingMsAtChange,
      next.at,
    ));
  }

  const last = changes[changes.length - 1];
  pushSegment(
    segments,
    { name: last.tariffName, ratePerKm: last.newRatePerKm, waitingPerMin: last.newWaitingPerMin },
    prevDist,
    prevWaitMs,
    meter.distanceKm,
    meter.waitingMs,
  );

  const distanceCharge = segments.reduce((sum, s) => sum + s.distanceCharge, 0);
  const waitingCharge = segments.reduce((sum, s) => sum + s.waitingCharge, 0);
  const flagFall = start.flagFall;

  return {
    flagFall,
    distanceKm: meter.distanceKm,
    distanceCharge,
    waitingMinutes: waitMin,
    waitingCharge,
    total: flagFall + distanceCharge + waitingCharge,
    segments,
  };
}
