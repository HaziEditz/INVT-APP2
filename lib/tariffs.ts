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

/** Exclusive: moving uses km rate only; waiting uses per-minute rate only. */
export function calcMeterBreakdown(
  tariff: Tariff,
  distanceKm: number,
  waitingMinutes: number,
  mode: 'moving' | 'waiting',
): MeterFareBreakdown {
  const flagFall = tariff.flagFall;
  const distanceCharge = mode === 'moving' ? distanceKm * tariff.ratePerKm : 0;
  const waitingCharge = mode === 'waiting' ? waitingMinutes * tariff.waitingPerMin : 0;
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
  mode: 'moving' | 'waiting' = 'moving',
): number {
  return calcMeterBreakdown(tariff, distanceKm, waitingMinutes, mode).total;
}
