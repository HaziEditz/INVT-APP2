import { get, ref } from 'firebase/database';
import { database } from './firebase';
import type { Job, PaymentType } from '@/context/DriverContext';

function parsePaymentType(raw?: string): PaymentType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.includes('account')) return 'account';
  if (s.includes('mobility') || s === 'tm' || s.includes('total')) return 'total_mobility';
  if (s.includes('acc')) return 'acc';
  if (s.includes('card') || s.includes('eftpos')) return 'card';
  if (s.includes('cash')) return 'cash';
  if (s.includes('online') || s.includes('stripe')) return 'online';
  return 'cash';
}

function normId(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function matchesDriver(data: Record<string, unknown>, driverId: string): boolean {
  const target = normId(driverId);
  if (!target) return false;
  const fields = [
    data.AssignedDriver,
    data.assignedDriver,
    data.AssignedDriverId,
    data.assignedDriverId,
    data.DriverId,
    data.driverId,
  ];
  return fields.some(f => normId(f) === target);
}

function isRecoverableStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'active' || s === 'picking' || s === 'assigned' || s === 'on way' || s === 'onway';
}

function isTerminalStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'completed' || s === 'cancelled' || s === 'canceled' ||
    s === 'noshow' || s === 'no-show' || s === 'no_show';
}

function bookingToJob(bookingId: string, data: Record<string, unknown>, jobStatus: Job['status']): Job {
  return {
    id:              `recovered-${bookingId}`,
    bookingId,
    passengerName:   String(data.PassengerName ?? data.passengerName ?? 'Passenger').trim() || 'Passenger',
    passengerPhone:  String(data.PassengerPhone ?? data.passengerPhone ?? '').trim(),
    pickupAddress:   String(data.PickAddress ?? data.pickupAddress ?? data.PickupAddress ?? '').trim() || 'See dispatch for pickup',
    dropAddress:     String(data.DropAddress ?? data.dropAddress ?? data.DropoffAddress ?? '').trim() || 'See dispatch for drop-off',
    fare:            parseFloat(String(data.Fare ?? data.fare ?? '0')) || 0,
    distance:        String(data.Distance ?? data.distance ?? '—'),
    duration:        String(data.Duration ?? data.duration ?? '—'),
    status:          jobStatus,
    createdAt:       String(data.BookingDateTime ?? data.createdAt ?? new Date().toISOString()),
    notes:           String(data.Info ?? data.notes ?? '').trim() || undefined,
    deviceUid:       String(data.DeviceUid ?? data.deviceUid ?? '').trim() || undefined,
    paymentType:     parsePaymentType(String(data.PaymentType ?? data.AccountType ?? data.paymentType ?? '')),
    bookingType:     String(data.BookingType ?? data.bookingType ?? '').trim() || undefined,
    jobPaymentMethod: String(data.paymentMethod ?? data.PaymentMethod ?? '').trim().toLowerCase() || undefined,
    paymentStatus:   String(data.paymentStatus ?? data.PaymentStatus ?? '').trim().toLowerCase() || undefined,
    serviceType:     String(data.serviceType ?? data.ServiceType ?? '').trim().toLowerCase() || undefined,
  };
}

/**
 * Cold-start / crash recovery: scan allbookings/{companyId} for trips still
 * assigned to this driver with Status Active or Picking.
 */
export async function recoverActiveJobsFromFirebase(
  companyId: string,
  driverId: string,
): Promise<Job[]> {
  if (!companyId || !driverId) return [];

  try {
    const snap = await get(ref(database, `allbookings/${companyId}`));
    if (!snap.exists()) return [];

    const val = snap.val() as Record<string, Record<string, unknown>>;
    const matches: { bookingId: string; data: Record<string, unknown>; priority: number }[] = [];

    Object.keys(val).forEach(bookingId => {
      const data = val[bookingId];
      if (!data || typeof data !== 'object') return;
      if (!matchesDriver(data, driverId)) return;
      if (isTerminalStatus(data.Status ?? data.status)) return;
      if (!isRecoverableStatus(data.Status ?? data.status)) return;

      const statusRaw = String(data.Status ?? data.status ?? '').toLowerCase();
      const priority = statusRaw === 'picking' ? 0 : statusRaw === 'active' ? 1 : 2;
      matches.push({ bookingId, data, priority });
    });

    if (!matches.length) return [];

    matches.sort((a, b) => a.priority - b.priority);

    return matches.map((m, idx) =>
      bookingToJob(m.bookingId, m.data, idx === 0 ? 'current' : 'queued'),
    );
  } catch (err) {
    console.warn('[CrashRecovery] allbookings scan failed:', (err as Error)?.message ?? err);
    return [];
  }
}
