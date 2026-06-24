import { MeterFareBreakdown, Tariff } from '@/types';

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

/** Cumulative fare: flag fall + distance charge + waiting charge. */
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
