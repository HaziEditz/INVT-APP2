import { JobStage } from '@/types';

/** Driver-facing lifecycle phases for the home status bar (display only). */
export type DriverTripDisplayPhase =
  | 'off'
  | 'away'
  | 'available'
  | 'offer'
  | 'accepted'
  | 'onTheWay'
  | 'arrived'
  | 'onBoard'
  | 'hail';

/** Align with dispatch Assign (#4f6ef7), Offer/Offer-popup (green), Active (#ef4444). */
export const TRIP_DISPLAY_COLORS: Record<DriverTripDisplayPhase, string> = {
  off: '#9CA3AF',
  away: '#F59E0B',
  available: '#22C55E',
  offer: '#22C55E',
  accepted: '#4F6EF7',
  onTheWay: '#4F6EF7',
  arrived: '#F59E0B',
  onBoard: '#EF4444',
  hail: '#EF4444',
};

export const TRIP_DISPLAY_LABELS: Record<DriverTripDisplayPhase, string> = {
  off: 'Off',
  away: 'Away',
  available: 'Avail',
  offer: 'Offer',
  accepted: 'Accepted',
  onTheWay: 'On the way',
  arrived: 'Arrived',
  onBoard: 'On Board',
  hail: 'Hail',
};

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function resolveTripDisplayPhase(input: {
  shiftActive: boolean;
  hasOfferPopup: boolean;
  hailActive: boolean;
  meterRunning: boolean;
  activeStage?: JobStage;
  paymentOpen: boolean;
  tripOnTheWay: boolean;
  isAway: boolean;
  isAvailable: boolean;
}): DriverTripDisplayPhase {
  if (!input.shiftActive) return 'off';
  if (input.hasOfferPopup) return 'offer';
  if (input.hailActive) return input.meterRunning ? 'onBoard' : 'hail';
  if (input.paymentOpen) return 'onBoard';
  if (input.activeStage) {
    if (input.activeStage === 'onboard' || input.meterRunning) return 'onBoard';
    if (input.activeStage === 'arrived') return 'arrived';
    if (input.activeStage === 'pickup') {
      return input.tripOnTheWay ? 'onTheWay' : 'accepted';
    }
  }
  if (input.isAway) return 'away';
  if (input.isAvailable) return 'available';
  return 'away';
}

export function tripDisplayStyle(phase: DriverTripDisplayPhase): { label: string; color: string } {
  return {
    label: TRIP_DISPLAY_LABELS[phase],
    color: TRIP_DISPLAY_COLORS[phase],
  };
}
