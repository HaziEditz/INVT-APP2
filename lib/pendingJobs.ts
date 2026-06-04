import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { jobMatchesDriverVehicle, serviceTypeToJobType } from '@/lib/jobMatching';
import { JobOffer, Vehicle } from '@/types';

function parseLatLng(raw?: string): { lat?: number; lng?: number } {
  if (!raw || typeof raw !== 'string') return {};
  const parts = raw.split(',').map((x) => parseFloat(x.trim()));
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return {};
}

export function parsePendingJobNode(id: string, val: Record<string, unknown>): JobOffer | null {
  if (val.claimedBy || val.takenBy) return null;
  const status = String(val.Status ?? val.status ?? 'Pending').toLowerCase();
  if (status && !['pending', 'offered', ''].includes(status)) return null;

  const pickup = String(val.PickAddress ?? val.pickAddress ?? val.pickup ?? '');
  const dropoff = String(val.DropAddress ?? val.dropAddress ?? val.dropoff ?? '');
  if (!pickup && !dropoff) return null;

  const serviceRaw = String(val.ServiceType ?? val.serviceType ?? 'taxi');
  const pickLl = parseLatLng(String(val.PickLatLng ?? val.pickLatLng ?? ''));
  const dropLl = parseLatLng(String(val.DropLatLng ?? val.dropLatLng ?? ''));

  return {
    id: String(val.BookingId ?? val.bookingRef ?? val.bookingId ?? id),
    type: serviceTypeToJobType(serviceRaw),
    pickup,
    dropoff,
    passengerName: String(val.PassengerName ?? val.Name ?? val.passengerName ?? '').trim() || undefined,
    passengerPhone: String(val.PhoneNo ?? val.passengerPhone ?? '').trim() || undefined,
    fixedFare: val.Fare != null ? parseFloat(String(val.Fare)) : undefined,
    estimatedFare: val.Fare != null ? parseFloat(String(val.Fare)) : undefined,
    vehicleTypeRequired: String(val.VehicleType ?? val.vehicleType ?? ''),
    passengers: Number(val.Passengers ?? val.passengers ?? 1) || 1,
    serviceTypeRaw: serviceRaw,
    expiresAt: Date.now() + 3600000,
    source: String(val.BookingSource ?? val.CreatedBy ?? 'dispatch'),
    pickupLat: pickLl.lat,
    pickupLng: pickLl.lng,
    dropoffLat: dropLl.lat,
    dropoffLng: dropLl.lng,
    silent: true,
  };
}

export function extractPendingOffers(
  snapVal: unknown,
  vehicle: Vehicle | undefined,
): JobOffer[] {
  if (!snapVal || typeof snapVal !== 'object') return [];
  const out: JobOffer[] = [];
  const rec = snapVal as Record<string, unknown>;

  const entries =
    Array.isArray(rec)
      ? rec.map((item, i) => [String(i), item] as const)
      : Object.entries(rec);

  for (const [key, item] of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const offer = parsePendingJobNode(key, item as Record<string, unknown>);
    if (offer && jobMatchesDriverVehicle(offer, vehicle)) {
      out.push(offer);
    }
  }

  return out.sort((a, b) => (a.pickup || '').localeCompare(b.pickup || ''));
}

export function subscribePendingJobs(
  companyId: string,
  vehicle: Vehicle | undefined,
  onChange: (offers: JobOffer[]) => void,
): () => void {
  const pendingRef = ref(getDatabaseInstance(), `pendingjobs/${companyId}`);
  return onValue(pendingRef, (snap) => {
    onChange(extractPendingOffers(snap.val(), vehicle));
  });
}

export async function loadPendingJobsOnce(
  companyId: string,
  vehicle: Vehicle | undefined,
): Promise<JobOffer[]> {
  const snap = await get(ref(getDatabaseInstance(), `pendingjobs/${companyId}`));
  return extractPendingOffers(snap.val(), vehicle);
}
