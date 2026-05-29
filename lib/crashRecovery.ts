import { get, ref } from 'firebase/database';
import { database } from './firebase';
import type { Job, PaymentType } from '@/context/DriverContext';

export type RecoveredDriverStatus = 'Available' | 'Assigned' | 'Busy' | 'Away';

export interface RecoveredShiftState {
  shiftActive: boolean;
  status: RecoveredDriverStatus;
}

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
  return s === 'offered' || s === 'assigned' || s === 'active' ||
    s === 'picking' || s === 'on way' || s === 'onway';
}

function isTerminalStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'completed' || s === 'cancelled' || s === 'canceled' ||
    s === 'noshow' || s === 'no-show' || s === 'no_show';
}

function bookingPriority(raw: unknown): number {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'picking') return 0;
  if (s === 'active') return 1;
  if (s === 'assigned') return 2;
  if (s === 'offered') return 3;
  return 9;
}

function mapBookingToJobStatus(raw: unknown, isPrimaryActive: boolean): Job['status'] {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'offered') return 'offered';
  if (isPrimaryActive) return 'current';
  return 'queued';
}

function bookingToJob(
  bookingId: string,
  data: Record<string, unknown>,
  jobStatus: Job['status'],
): Job {
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

function mapVehicleStatusToDriverStatus(raw: unknown): RecoveredDriverStatus {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'picking' || s === 'assigned') return 'Assigned';
  if (s === 'busy') return 'Busy';
  if (s === 'away') return 'Away';
  return 'Available';
}

/**
 * Cold-start / crash recovery: scan allbookings/{companyId} for trips still
 * assigned to this driver with Status Offered / Assigned / Active / Picking.
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

      matches.push({
        bookingId,
        data,
        priority: bookingPriority(data.Status ?? data.status),
      });
    });

    if (!matches.length) return [];

    matches.sort((a, b) => a.priority - b.priority || a.bookingId.localeCompare(b.bookingId));

    const primaryIdx = matches.findIndex(m => {
      const s = String(m.data.Status ?? m.data.status ?? '').toLowerCase();
      return s !== 'offered';
    });

    return matches.map((m, idx) => {
      const statusRaw = m.data.Status ?? m.data.status;
      const isPrimaryActive = primaryIdx >= 0 ? idx === primaryIdx : false;
      const jobStatus = mapBookingToJobStatus(statusRaw, isPrimaryActive);
      return bookingToJob(m.bookingId, m.data, jobStatus);
    });
  } catch (err) {
    console.warn('[CrashRecovery] allbookings scan failed:', (err as Error)?.message ?? err);
    return [];
  }
}

/**
 * Restore shift state from Firebase online/{companyId}/{vehicleId} after a crash.
 * Falls back to an active shiftLogs entry when online presence is missing.
 */
export async function recoverShiftFromFirebase(
  companyId: string,
  vehicleId: string,
  driverId: string,
): Promise<RecoveredShiftState> {
  const idle: RecoveredShiftState = { shiftActive: false, status: 'Available' };
  if (!companyId || !vehicleId || !driverId) return idle;

  try {
    const [onlineSnap, currentSnap] = await Promise.all([
      get(ref(database, `online/${companyId}/${vehicleId}`)),
      get(ref(database, `online/${companyId}/${vehicleId}/current`)),
    ]);

    const onlineData = (onlineSnap.val() ?? {}) as Record<string, unknown>;
    const currentData = (currentSnap.val() ?? {}) as Record<string, unknown>;

    const remoteDriverId = normId(
      currentData.driverid ?? currentData.driverId ?? onlineData.driverid ?? onlineData.driverId,
    );
    const me = normId(driverId);
    if (remoteDriverId && remoteDriverId !== me) {
      console.log('[CrashRecovery] online node belongs to another driver — skip shift restore');
      return idle;
    }

    const vehicleStatus = String(
      currentData.vehiclestatus ?? currentData.VehicleStatus ??
      onlineData.vehiclestatus ?? onlineData.VehicleStatus ?? '',
    ).trim().toLowerCase();

    const isOnline = onlineData.online === true || currentData.online === true;
    const activeStatuses = new Set(['available', 'assigned', 'picking', 'busy']);

    if (vehicleStatus === 'away' || vehicleStatus === 'offline') {
      return idle;
    }

    if (activeStatuses.has(vehicleStatus) || isOnline) {
      console.log('[CrashRecovery] Shift restored from online — vehiclestatus:', vehicleStatus || '(online)');
      return {
        shiftActive: true,
        status: mapVehicleStatusToDriverStatus(vehicleStatus || 'available'),
      };
    }
  } catch (err) {
    console.warn('[CrashRecovery] online read failed:', (err as Error)?.message ?? err);
  }

  try {
    const logsSnap = await get(ref(database, `shiftLogs/${companyId}/${driverId}`));
    if (logsSnap.exists()) {
      const logs = logsSnap.val() as Record<string, Record<string, unknown>>;
      for (const key of Object.keys(logs)) {
        const log = logs[key];
        if (log?.isActive === true) {
          console.log('[CrashRecovery] Shift restored from active shiftLog:', key);
          return { shiftActive: true, status: 'Available' };
        }
      }
    }
  } catch (err) {
    console.warn('[CrashRecovery] shiftLogs read failed:', (err as Error)?.message ?? err);
  }

  return idle;
}
