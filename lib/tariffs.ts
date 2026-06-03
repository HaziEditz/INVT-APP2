import { Tariff } from '@/types';

export const DEFAULT_TARIFFS: Tariff[] = [
  { id: 'standard', name: 'Standard', flagFall: 4.5, ratePerKm: 3.2, waitingPerMin: 0.85 },
  { id: 'night', name: 'Night', flagFall: 5.5, ratePerKm: 3.8, waitingPerMin: 0.95 },
  { id: 'holiday', name: 'Holiday', flagFall: 6.0, ratePerKm: 4.2, waitingPerMin: 1.1 },
];

export function calcMeterFare(
  tariff: Tariff,
  distanceKm: number,
  waitingMinutes: number,
): number {
  return tariff.flagFall + distanceKm * tariff.ratePerKm + waitingMinutes * tariff.waitingPerMin;
}
