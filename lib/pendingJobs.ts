import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { collectJobNotes } from '@/lib/jobNotes';
import { parseSchedulingMetaFromRecord } from '@/lib/jobDisplayMeta';
import { isDispatchWindowOpen } from '@/lib/dispatchWindow';
import { readDropoffAddress, readPickupAddress } from '@/lib/jobAddressFields';
import { jobMatchesDriverVehicle, serviceTypeToJobType } from '@/lib/jobMatching';
import { normalizeDriverPaymentType, readAccountFieldsFromRecord } from '@/lib/driverPayment';
import { parseFiniteFare } from '@/lib/tariffs';
import { JobOffer, Vehicle } from '@/types';

function parseLatLng(raw?: string): { lat?: number; lng?: number } {
  if (!raw || typeof raw !== 'string') return {};
  const parts = raw.split(',').map((x) => parseFloat(x.trim()));
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    // Reject Null Island sentinel written by older hail/create paths.
    if (parts[0] === 0 && parts[1] === 0) return {};
    return { lat: parts[0], lng: parts[1] };
  }
  return {};
}

export function parseJobOfferRecord(
  id: string,
  val: Record<string, unknown>,
  opts?: { requirePending?: boolean; requireDispatchWindow?: boolean },
): JobOffer | null {
  if (val.claimedBy || val.takenBy) return null;
  if (
    val.jobEditing === true ||
    val.dispatcherEditing === true ||
    val.editLockActive === true
  ) {
    return null;
  }
  const status = String(val.Status ?? val.status ?? 'Pending').toLowerCase();
  // Option 1: pool browse includes Pending and Offered (exclusive offer stuck
  // while busy must still appear in Offers tab).
  if (
    opts?.requirePending !== false &&
    status &&
    status !== 'pending' &&
    status !== 'offered' &&
    status !== 'offer' &&
    status !== 'offering'
  ) {
    return null;
  }
  if (opts?.requireDispatchWindow !== false && !isDispatchWindowOpen(val)) return null;

  const pickup = readPickupAddress(val);
  const dropoff = readDropoffAddress(val);
  if (!pickup && !dropoff) return null;

  const serviceRaw = String(val.ServiceType ?? val.serviceType ?? 'taxi');
  const pickLl = parseLatLng(String(val.PickLatLng ?? val.pickLatLng ?? ''));
  const dropLl = parseLatLng(String(val.DropLatLng ?? val.dropLatLng ?? ''));
  const allNotes = collectJobNotes(val);
  const primaryNote = allNotes.map((n) => n.text).join('\n\n') || undefined;
  const scheduling = parseSchedulingMetaFromRecord(val);
  const rawPayment = val.PaymentMethod ?? val.paymentMethod ?? val.PaymentType ?? val.paymentType;
  const paymentType =
    normalizeDriverPaymentType(rawPayment != null ? String(rawPayment) : undefined) ??
    undefined;
  const accountFields = readAccountFieldsFromRecord(val);
  const isTotalMobility = !!(
    val.isTotalMobility ||
    val.isTM ||
    val.IsTM ||
    val.tmUsed ||
    paymentType === 'TM' ||
    val.tmCardNumber ||
    val.tmVoucherNo
  );

  return {
    id: String(val.BookingId ?? val.bookingRef ?? val.bookingId ?? id),
    type: serviceTypeToJobType(serviceRaw),
    pickup,
    dropoff,
    passengerName: String(val.PassengerName ?? val.Name ?? val.passengername ?? val.passengerName ?? '').trim() || undefined,
    passengerPhone: String(val.PhoneNo ?? val.passengerPhone ?? '').trim() || undefined,
    fixedFare: parseFiniteFare(val.Fare ?? val.fixedFare ?? val.estimatedFare),
    estimatedFare: parseFiniteFare(val.Fare ?? val.estimatedFare ?? val.fixedFare),
    vehicleTypeRequired: (() => {
      const raw = String(
        val.VehicleType ?? val.vehicleType ?? val.jobvehicletype ?? val.jobVehicleType ?? '',
      ).trim();
      if (!raw) return undefined;
      if (raw.toLowerCase() === 'not specified' || raw.toLowerCase() === 'any') return 'Any';
      return raw;
    })(),
    passengers: Number(val.Passengers ?? val.passengers ?? 1) || 1,
    serviceTypeRaw: serviceRaw,
    paymentType,
    ...accountFields,
    isTotalMobility,
    tmCardNumber:
      String(val.tmCardNumber ?? val.tmVoucherNo ?? '').trim() || undefined,
    paymentStatus:
      String(val.paymentStatus ?? val.PaymentStatus ?? '')
        .trim()
        .toLowerCase() || undefined,
    isPrePaid: !!(
      val.isPrePaid ||
      val.isPrepaid ||
      String(val.paymentStatus ?? val.PaymentStatus ?? '')
        .trim()
        .toLowerCase() === 'paid'
    ),
    isFixedPrice:
      String(val.TarriffId ?? val.TariffId ?? val.tariffId ?? '') === '-1' ||
      val.isFixedPrice === true,
    expiresAt: Date.now() + 3600000,
    postedAt: (() => {
      const raw = val.createdAt ?? val.CreatedAt ?? val.OfferedAt ?? val.offeredAt;
      if (raw == null) return Date.now();
      const n = typeof raw === 'number' ? raw : Date.parse(String(raw));
      return Number.isFinite(n) ? n : Date.now();
    })(),
    source: String(
      val.BookingSource ??
        val.bookingSource ??
        val.Source ??
        val.jobBookingSrc ??
        val.CreatedBy ??
        val.source ??
        '',
    ).trim() || undefined,
    bookingSource: String(
      val.BookingSource ?? val.bookingSource ?? val.Source ?? val.jobBookingSrc ?? '',
    ).trim() || undefined,
    pickupPin: String(val.PickupPin ?? val.pickupPin ?? '').trim() || undefined,
    pickupVerifiedAt: String(val.pickupVerifiedAt ?? val.PickupVerifiedAt ?? '').trim() || undefined,
    noShowDeadlineAt: String(val.noShowDeadlineAt ?? '').trim() || undefined,
    imComingAt: String(val.imComingAt ?? val.ImComingAt ?? '').trim() || undefined,
    notes: primaryNote,
    allNotes: allNotes.length ? allNotes : undefined,
    dispatcherName:
      String(val.DispatcherName ?? val.dispatcherName ?? '').trim() || undefined,
    pickupLat: pickLl.lat,
    pickupLng: pickLl.lng,
    dropoffLat: dropLl.lat,
    dropoffLng: dropLl.lng,
    silent: true,
    returnReason:
      String(val.returnReason ?? val.ReturnReason ?? '').trim() || undefined,
    lastOfferDriverId:
      String(val.lastOfferDriverId ?? val.LastOfferDriverId ?? '').trim() || undefined,
    ...scheduling,
  };
}

export function parsePendingJobNode(id: string, val: Record<string, unknown>): JobOffer | null {
  return parseJobOfferRecord(id, val);
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
