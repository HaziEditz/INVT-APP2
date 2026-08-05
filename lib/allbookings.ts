import { get, ref, update } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { readDropoffAddress, readPickupAddress } from '@/lib/jobAddressFields';

/** Read pickup/dropoff from allbookings when ActiveJob snapshot is sparse. */
export async function readBookingTripAddresses(
  companyId: string,
  bookingId: string,
): Promise<{ pickup: string; dropoff: string } | null> {
  if (!companyId || !bookingId) return null;
  try {
    const snap = await get(
      ref(getDatabaseInstance(), `allbookings/${companyId}/${bookingId}`),
    );
    if (!snap.exists()) return null;
    const val = (snap.val() ?? {}) as Record<string, unknown>;
    const pickup = readPickupAddress(val);
    const dropoff = readDropoffAddress(val);
    if (!pickup && !dropoff) return null;
    return { pickup, dropoff };
  } catch (err) {
    console.warn('[allbookings] readBookingTripAddresses failed:', err);
    return null;
  }
}

export async function markBookingCompleted(
  companyId: string,
  bookingId: string,
  payload: {
    fare: number;
    paymentType: string;
    driverId: string;
    completedAt: number;
    distanceKm?: number;
    pickup?: string;
    dropoff?: string;
    passengerName?: string;
    passengerPhone?: string;
    stepTimes?: Record<string, unknown>;
    stepTimeMirrors?: Record<string, unknown>;
    fareBreakdown?: Record<string, unknown> | null;
    vehicleType?: string;
    accountId?: string;
    accountName?: string;
    createdAt?: number;
  },
): Promise<void> {
  if (!companyId || !bookingId) return;
  const database = getDatabaseInstance();
  const pickup = String(payload.pickup || '').trim();
  const dropoff = String(payload.dropoff || '').trim();
  const vehicleType = String(payload.vehicleType || '').trim();
  const accountId = String(payload.accountId || '').trim();
  const accountName = String(payload.accountName || '').trim();
  const breakdown =
    payload.fareBreakdown && typeof payload.fareBreakdown === 'object'
      ? payload.fareBreakdown
      : undefined;
  const distanceKm =
    typeof payload.distanceKm === 'number' && Number.isFinite(payload.distanceKm)
      ? payload.distanceKm
      : undefined;
  const createdAt =
    typeof payload.createdAt === 'number' && Number.isFinite(payload.createdAt)
      ? payload.createdAt
      : undefined;
  const mirrors =
    payload.stepTimeMirrors && typeof payload.stepTimeMirrors === 'object'
      ? payload.stepTimeMirrors
      : {};

  // Never pass undefined into Firebase update() — it rejects the whole write.
  await update(ref(database, `allbookings/${companyId}/${bookingId}`), {
    status: 'completed',
    jobstatus: 'completed',
    BookingStatus: 'Completed',
    fare: payload.fare,
    TotalFare: payload.fare,
    paymentType: payload.paymentType,
    paymentMethod: payload.paymentType,
    driverId: payload.driverId,
    completedAt: payload.completedAt,
    updatedAt: payload.completedAt,
    ...(distanceKm != null ? { distanceKm } : {}),
    ...(createdAt != null ? { createdAt, CreatedAt: createdAt } : {}),
    ...(pickup
      ? { PickAddress: pickup, pickup, pickupAddress: pickup }
      : {}),
    ...(dropoff
      ? { DropAddress: dropoff, dropoff, dropAddress: dropoff }
      : {}),
    ...(payload.passengerName
      ? { PassengerName: payload.passengerName, passengerName: payload.passengerName }
      : {}),
    ...(payload.passengerPhone
      ? { PassengerPhone: payload.passengerPhone, passengerPhone: payload.passengerPhone }
      : {}),
    ...(payload.stepTimes && typeof payload.stepTimes === 'object'
      ? { stepTimes: payload.stepTimes }
      : {}),
    ...mirrors,
    ...(breakdown
      ? { fareBreakdown: breakdown, FareBreakdown: breakdown }
      : {}),
    ...(vehicleType ? { VehicleType: vehicleType, vehicleType } : {}),
    ...(accountId
      ? {
          Account_id: accountId,
          AccountId: accountId,
          jobAccountId: accountId,
          accountId,
        }
      : {}),
    ...(accountName
      ? {
          Account_Name: accountName,
          AccountName: accountName,
          jobAccountName: accountName,
          accountName,
        }
      : {}),
  });
}
