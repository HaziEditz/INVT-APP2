import { ref, update } from 'firebase/database';
import { ensureAuthUserForRtdbWrite, getDatabaseInstance } from '@/lib/firebase';
import { sanitizeForFirebase } from '@/lib/sanitizeForFirebase';

export async function markBookingCompleted(
  companyId: string,
  bookingId: string,
  payload: {
    fare: number;
    paymentType: string;
    driverId: string;
    completedAt: number;
    distanceKm?: number;
  },
): Promise<void> {
  if (!companyId || !bookingId) return;
  await ensureAuthUserForRtdbWrite(`markBookingCompleted → allbookings/${companyId}/${bookingId}`);
  const database = getDatabaseInstance();
  await update(
    ref(database, `allbookings/${companyId}/${bookingId}`),
    sanitizeForFirebase({
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
    }),
  );
}
