import { JobOffer, JobType, Vehicle } from '@/types';

function norm(s: string): string {
  return s.trim().toLowerCase();
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

/** Whether this pending/offer job can be taken by the driver's current vehicle & services. */
export function jobMatchesDriverVehicle(offer: JobOffer, vehicle: Vehicle | undefined): boolean {
  if (!vehicle) return false;

  const jobType = offer.type ?? serviceTypeToJobType(offer.serviceTypeRaw);
  const reqType = norm(offer.vehicleTypeRequired ?? '');
  const reqPax = Math.max(1, offer.passengers ?? 1);
  const body = norm(vehicle.bodyType);
  const cap = vehicle.seatCapacity || 4;

  if (jobType === 'Food' && !vehicle.hasFoodService) return false;
  if (jobType === 'Freight' && !vehicle.hasFreightService) return false;

  if (reqType.includes('wav') || reqType.includes('wheelchair')) {
    return vehicle.isWav;
  }

  if (
    reqType.includes('van') ||
    reqType.includes('minibus') ||
    reqPax > 4 ||
    (reqType && !reqType.includes('sedan') && !reqType.includes('car') && reqType.includes('van'))
  ) {
    const isVanBody = body.includes('van') || body.includes('suv') || body.includes('minibus');
    return isVanBody && cap >= reqPax;
  }

  // Sedan / car / unspecified — any driver with enough seats
  if (!reqType || reqType === 'not specified' || reqType.includes('sedan') || reqType.includes('car')) {
    return cap >= reqPax;
  }

  return cap >= reqPax;
}
