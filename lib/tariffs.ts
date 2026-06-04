import { Tariff } from '@/types';

/** Shown in UI when `tariffs/{companyId}` has no configured tariffs. */
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

export function calcMeterFare(
  tariff: Tariff,
  distanceKm: number,
  waitingMinutes: number,
): number {
  return tariff.flagFall + distanceKm * tariff.ratePerKm + waitingMinutes * tariff.waitingPerMin;
}
