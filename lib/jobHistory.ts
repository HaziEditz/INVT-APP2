import { get, limitToLast, query, ref } from 'firebase/database';
import { database } from '@/lib/firebase';
import { JobType, PaymentType } from '@/types';

export type JobHistoryStatus = 'completed' | 'cancelled' | 'noshow';

export interface HistoryJob {
  id: string;
  status: JobHistoryStatus;
  type: JobType;
  pickup: string;
  dropoff: string;
  fare: number;
  paymentType?: PaymentType | string;
  passengerName?: string;
  completedAt: number;
  cancelledBy?: string;
}

function parseMs(isoOrMs: unknown): number {
  if (typeof isoOrMs === 'number' && Number.isFinite(isoOrMs)) return isoOrMs;
  const ms = Date.parse(String(isoOrMs ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

function parseTerminalStatus(raw: string): JobHistoryStatus | null {
  const s = raw.toLowerCase();
  if (s.includes('noshow') || s === 'no show' || s === 'no-show') return 'noshow';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('complete')) return 'completed';
  return null;
}

function mapCompletedRecord(key: string, r: Record<string, unknown>, driverId: string): HistoryJob | null {
  const rDriverId = String(r.driverId ?? r.DriverId ?? '');
  if (rDriverId && rDriverId !== driverId) return null;

  const isoStr = r.completedAt_ISO ?? r.completedAt ?? r.CompletedAt_ISO ?? '';
  const completedAt = parseMs(isoStr);
  if (!completedAt) return null;

  const fare =
    typeof r.fare === 'number'
      ? r.fare
      : typeof r.Fare === 'number'
        ? r.Fare
        : parseFloat(String(r.fare ?? r.Fare ?? r.TotalFare ?? '0')) || 0;

  return {
    id: String(r.bookingId ?? r.BookingId ?? r.Id ?? key),
    status: 'completed',
    type: (String(r.type ?? r.jobType ?? 'Taxi') as JobType) || 'Taxi',
    pickup: String(r.pickupAddress ?? r.PickAddress ?? r.pickup ?? ''),
    dropoff: String(r.dropAddress ?? r.DropAddress ?? r.dropoff ?? ''),
    fare: parseFloat(fare.toFixed(2)),
    paymentType: String(r.paymentType ?? r.PaymentType ?? 'Cash') as PaymentType,
    passengerName: String(r.passengerName ?? r.PassengerName ?? ''),
    completedAt,
  };
}

function mapBookingRecord(key: string, r: Record<string, unknown>, driverId: string): HistoryJob | null {
  const rDriverId = String(r.driverId ?? r.DriverId ?? r.driverid ?? '');
  if (rDriverId && rDriverId !== driverId) return null;

  const statusRaw = String(
    r.BookingStatus ?? r.bookingStatus ?? r.status ?? r.Status ?? '',
  );
  const terminal = parseTerminalStatus(statusRaw);
  if (!terminal || terminal === 'completed') return null;

  const completedAt = parseMs(
    r.cancelledAt ?? r.CancelledAt ?? r.updatedAt ?? r.UpdatedAt ?? r.createdAt ?? Date.now(),
  );

  const fare = parseFloat(String(r.fare ?? r.Fare ?? r.TotalFare ?? '0')) || 0;

  return {
    id: String(r.bookingId ?? r.BookingId ?? r.Id ?? key),
    status: terminal,
    type: (String(r.type ?? r.jobType ?? 'Taxi') as JobType) || 'Taxi',
    pickup: String(r.PickAddress ?? r.pickup ?? r.from ?? ''),
    dropoff: String(r.DropAddress ?? r.dropoff ?? r.to ?? ''),
    fare,
    paymentType: String(r.paymentType ?? r.PaymentType ?? ''),
    passengerName: String(r.PassengerName ?? r.passengerName ?? ''),
    completedAt,
    cancelledBy: String(r.CancelledBy ?? r.cancelledBy ?? ''),
  };
}

export async function loadDriverJobHistory(
  companyId: string,
  driverId: string,
): Promise<HistoryJob[]> {
  if (!companyId || !driverId) return [];

  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const byId = new Map<string, HistoryJob>();

  try {
    const snap = await get(
      query(ref(database, `completedJobs/${companyId}`), limitToLast(120)),
    );
    if (snap.exists()) {
      snap.forEach((child) => {
        const row = mapCompletedRecord(child.key ?? '', (child.val() ?? {}) as Record<string, unknown>, driverId);
        if (row && row.completedAt >= cutoffMs) byId.set(row.id, row);
      });
    }
  } catch (err) {
    console.warn('[JobHistory] completedJobs read failed:', err);
  }

  try {
    const snap = await get(
      query(ref(database, `allbookings/${companyId}`), limitToLast(150)),
    );
    if (snap.exists()) {
      snap.forEach((child) => {
        const row = mapBookingRecord(child.key ?? '', (child.val() ?? {}) as Record<string, unknown>, driverId);
        if (row && row.completedAt >= cutoffMs && !byId.has(row.id)) {
          byId.set(row.id, row);
        }
      });
    }
  } catch (err) {
    console.warn('[JobHistory] allbookings read failed:', err);
  }

  return [...byId.values()].sort((a, b) => b.completedAt - a.completedAt);
}
