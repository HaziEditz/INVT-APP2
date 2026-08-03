import type { MeterFareBreakdown, Tariff } from '@/types';

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

/** Parse a fare field from Firebase/API — returns undefined for blank or non-finite values. */
export function parseFiniteFare(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function formatFareAmount(amount: number | undefined | null): string {
  if (amount == null || !Number.isFinite(amount)) return '0.00';
  return amount.toFixed(2);
}
