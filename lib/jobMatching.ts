import { JobOffer, JobType, Vehicle } from '@/types';

function norm(s: string): string {
  return s.trim().toLowerCase();
}

const OPEN_VEHICLE_TYPES = new Set(['', 'any', 'all', 'not specified']);

/** Seat capacity at/above this is a "big van" (HiAce-class) — not a default TM substitute. */
export const TM_BIG_VAN_MIN_SEATS = 10;

function normalizeCategory(raw?: string): string | null {
  const s = norm(String(raw ?? ''));
  if (!s || OPEN_VEHICLE_TYPES.has(s)) return null;
  if (s.includes('van') || s.includes('minibus')) return 'van';
  if (s.includes('wav') || s.includes('wheelchair')) return 'wav';
  if (s.includes('car') || s.includes('sedan') || s.includes('suv') || s.includes('saloon')) return 'car';
  return s;
}

function mapServiceToJobType(raw: string): JobType {
  const s = norm(raw);
  if (s.includes('food')) return 'Food';
  if (s.includes('freight')) return 'Freight';
  if (s.includes('tow')) return 'Tow';
  return 'Taxi';
}

export function serviceTypeToJobType(raw?: string): JobType {
  return mapServiceToJobType(String(raw ?? 'taxi'));
}

function isTmOffer(offer: JobOffer): boolean {
  return !!(
    offer.isTotalMobility ||
    offer.paymentType === 'TM' ||
    offer.tmCardNumber
  );
}

/** Whether this pending/offer job can be taken by the driver's current vehicle & services. */
export function jobMatchesDriverVehicle(offer: JobOffer, vehicle: Vehicle | undefined): boolean {
  if (!vehicle) return false;

  const jobType = offer.type ?? serviceTypeToJobType(offer.serviceTypeRaw);
  if (jobType === 'Food' && !vehicle.hasFoodService) return false;
  if (jobType === 'Freight' && !vehicle.hasFreightService) return false;

  const body = norm(vehicle.bodyType || vehicle.displayType || '');
  const drvCat =
    normalizeCategory(vehicle.bodyType || vehicle.displayType) ||
    (body.includes('van') || body.includes('minibus')
      ? 'van'
      : body.includes('wav')
        ? 'wav'
        : 'car');
  const reqPax = Math.max(1, offer.passengers ?? 1);
  const cap = vehicle.seatCapacity || 4;
  // Mirror server _driverEligibleForJob: 5+ passengers require a van.
  let reqCat = normalizeCategory(offer.vehicleTypeRequired);
  if (reqPax >= 5) reqCat = 'van';

  // TM open/car jobs: never auto-substitute 10–11 seat big vans (Estima-class OK).
  // Explicit Van (or WAV) selection may still use a big van.
  if (isTmOffer(offer) && cap >= TM_BIG_VAN_MIN_SEATS && (!reqCat || reqCat === 'car')) {
    return false;
  }

  if (reqCat === 'wav') return vehicle.isWav && cap >= reqPax;

  if (reqCat === 'van') {
    const isVanBody = drvCat === 'van' || body.includes('van') || body.includes('minibus');
    return isVanBody && cap >= reqPax;
  }

  if (reqCat === 'car') {
    // Exclusive: stamped Car/Sedan/SUV jobs never silently go to vans.
    return drvCat === 'car' && cap >= reqPax;
  }

  // "Any" / missing VehicleType → capacity-based open matching.
  if (!reqCat) return cap >= reqPax;

  if (reqCat === drvCat) return cap >= reqPax;
  const reqExact = norm(offer.vehicleTypeRequired ?? '');
  const drvExact = body;
  return !!reqExact && reqExact === drvExact && cap >= reqPax;
}
