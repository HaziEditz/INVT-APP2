import { get, limitToLast, query, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
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

function normalizeDriverId(id: string): string {
  const s = id.trim();
  const m = s.match(/^([dD])(\d+)$/i);
  if (m) return 'D' + String(parseInt(m[2], 10)).padStart(3, '0');
  return s.toLowerCase();
}

function driverRecordMatches(
  r: Record<string, unknown>,
  driverId: string,
  driverUid?: string,
): boolean {
  const fields = [
    r.driverId,
    r.DriverId,
    r.driverid,
    r.DriverID,
    r.assignedDriverId,
    r.AssignedDriverId,
  ];
  const recordIds = fields.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (!recordIds.length) return false;

  const targets = new Set<string>();
  if (driverId) {
    targets.add(normalizeDriverId(driverId));
    targets.add(driverId.trim().toLowerCase());
  }
  if (driverUid) {
    targets.add(driverUid.trim().toLowerCase());
  }

  return recordIds.some((rid) => {
    const n = normalizeDriverId(rid);
    return targets.has(n) || targets.has(rid.toLowerCase());
  });
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

function mapCompletedRecord(
  key: string,
  r: Record<string, unknown>,
  driverId: string,
  driverUid?: string,
): HistoryJob | null {
  if (!driverRecordMatches(r, driverId, driverUid)) return null;

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
    paymentType: String(r.paymentType ?? r.PaymentType ?? 'Cash'),
    passengerName: String(r.passengerName ?? r.PassengerName ?? ''),
    completedAt,
  };
}

function mapBookingRecord(
  key: string,
  r: Record<string, unknown>,
  driverId: string,
  driverUid?: string,
): HistoryJob | null {
  if (!driverRecordMatches(r, driverId, driverUid)) return null;

  const statusRaw = String(r.BookingStatus ?? r.bookingStatus ?? r.status ?? r.Status ?? '');
  const terminal = parseTerminalStatus(statusRaw);
  if (!terminal) return null;

  const completedAt = parseMs(
    r.completedAt_ISO ??
      r.completedAt ??
      r.cancelledAt ??
      r.CancelledAt ??
      r.updatedAt ??
      r.UpdatedAt ??
      r.createdAt ??
      Date.now(),
  );

  const fare = parseFloat(String(r.fare ?? r.Fare ?? r.TotalFare ?? '0')) || 0;

  return {
    id: String(r.bookingId ?? r.BookingId ?? r.Id ?? key),
    status: terminal,
    type: (String(r.type ?? r.jobType ?? 'Taxi') as JobType) || 'Taxi',
    pickup: String(r.PickAddress ?? r.pickup ?? r.from ?? ''),
    dropoff: String(r.DropAddress ?? r.dropoff ?? r.to ?? ''),
    fare: terminal === 'completed' ? parseFloat(fare.toFixed(2)) : 0,
    paymentType: String(r.paymentType ?? r.PaymentType ?? ''),
    passengerName: String(r.PassengerName ?? r.passengerName ?? ''),
    completedAt,
    cancelledBy: String(r.CancelledBy ?? r.cancelledBy ?? ''),
  };
}

export async function loadDriverJobHistory(
  companyId: string,
  driverId: string,
  driverUid?: string,
): Promise<HistoryJob[]> {
  if (!companyId || !driverId) return [];

  const byId = new Map<string, HistoryJob>();

  const ingest = (row: HistoryJob | null) => {
    if (!row) return;
    const existing = byId.get(row.id);
    if (!existing || row.status === 'completed') {
      byId.set(row.id, row);
    }
  };

  try {
    const snap = await get(
      query(ref(getDatabaseInstance(), `completedJobs/${companyId}`), limitToLast(500)),
    );
    if (snap.exists()) {
      snap.forEach((child) => {
        ingest(
          mapCompletedRecord(child.key ?? '', (child.val() ?? {}) as Record<string, unknown>, driverId, driverUid),
        );
      });
    }
  } catch (err) {
    console.warn('[JobHistory] completedJobs read failed:', err);
  }

  try {
    const snap = await get(
      query(ref(getDatabaseInstance(), `allbookings/${companyId}`), limitToLast(500)),
    );
    if (snap.exists()) {
      snap.forEach((child) => {
        ingest(
          mapBookingRecord(child.key ?? '', (child.val() ?? {}) as Record<string, unknown>, driverId, driverUid),
        );
      });
    }
  } catch (err) {
    console.warn('[JobHistory] allbookings read failed:', err);
  }

  return [...byId.values()].sort((a, b) => b.completedAt - a.completedAt);
}
