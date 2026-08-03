import { ref, update } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

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
  },
): Promise<void> {
  if (!companyId || !bookingId) return;
  const database = getDatabaseInstance();
  const pickup = String(payload.pickup || '').trim();
  const dropoff = String(payload.dropoff || '').trim();
  await update(ref(database, `allbookings/${companyId}/${bookingId}`), {
    status: 'completed',
    jobstatus: 'completed',
    BookingStatus: 'Completed',
    fare: payload.fare,
    paymentType: payload.paymentType,
    paymentMethod: payload.paymentType,
    driverId: payload.driverId,
    completedAt: payload.completedAt,
    distanceKm: payload.distanceKm,
    updatedAt: payload.completedAt,
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
  });
}
