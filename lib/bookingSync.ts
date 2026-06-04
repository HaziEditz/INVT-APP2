import { onValue, ref } from 'firebase/database';
import { database } from '@/lib/firebase';
import { JobOffer, JobStage } from '@/types';

export type BookingUpdate = {
  bookingId: string;
  cancelled: boolean;
  status: string;
  pickup: string;
  dropoff: string;
  passengerName?: string;
  passengerPhone?: string;
  notes?: string;
  paymentType?: string;
  raw: Record<string, unknown>;
};

export function parseBookingNode(val: unknown): Partial<BookingUpdate> | null {
  if (!val || typeof val !== 'object') return null;
  const b = val as Record<string, unknown>;
  const status = String(b.Status ?? b.status ?? '').toLowerCase();
  const cancelled =
    status.includes('cancel') ||
    status.includes('void') ||
    !!b.cancelled ||
    !!b.Cancelled;
  return {
    bookingId: String(b.BookingId ?? b.bookingId ?? b.id ?? ''),
    cancelled,
    status,
    pickup: String(b.PickAddress ?? b.pickup ?? b.pickAddress ?? ''),
    dropoff: String(b.DropAddress ?? b.dropoff ?? b.dropAddress ?? ''),
    passengerName: String(b.PassengerName ?? b.Name ?? b.passengerName ?? '').trim() || undefined,
    passengerPhone: String(b.PhoneNo ?? b.passengerPhone ?? '').trim() || undefined,
    notes: b.notes ? String(b.notes) : b.Info ? String(b.Info) : undefined,
    paymentType: b.paymentType ? String(b.paymentType) : b.PaymentType ? String(b.PaymentType) : undefined,
    raw: b,
  };
}

export function subscribeBooking(
  companyId: string,
  bookingId: string,
  onUpdate: (update: BookingUpdate) => void,
): () => void {
  const bookingRef = ref(database, `allbookings/${companyId}/${bookingId}`);
  return onValue(bookingRef, (snap) => {
    if (!snap.exists()) return;
    const parsed = parseBookingNode(snap.val());
    if (!parsed?.bookingId) return;
    onUpdate({ ...parsed, bookingId: parsed.bookingId || bookingId } as BookingUpdate);
  });
}

export function diffBookingChanges(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
  meterStarted: boolean,
): { allowed: Partial<BookingUpdate>; blocked: string[]; changes: string[] } {
  const blocked: string[] = [];
  const changes: string[] = [];
  const allowed: Partial<BookingUpdate> = { raw: next };

  const fields: { key: string; label: string; pick: (b: Record<string, unknown>) => string }[] = [
    { key: 'pickup', label: 'Pickup', pick: (b) => String(b.PickAddress ?? b.pickup ?? '') },
    { key: 'dropoff', label: 'Dropoff', pick: (b) => String(b.DropAddress ?? b.dropoff ?? '') },
    { key: 'passengerName', label: 'Passenger', pick: (b) => String(b.PassengerName ?? b.Name ?? '') },
    { key: 'passengerPhone', label: 'Phone', pick: (b) => String(b.PhoneNo ?? '') },
  ];

  for (const f of fields) {
    const oldV = prev ? f.pick(prev) : '';
    const newV = f.pick(next);
    if (oldV !== newV && newV) {
      changes.push(`${f.label}: ${newV}`);
      if (meterStarted) blocked.push(f.label);
      else (allowed as Record<string, string>)[f.key] = newV;
    }
  }

  if (prev) {
    const oldNotes = String(prev.notes ?? prev.Info ?? '');
    const newNotes = String(next.notes ?? next.Info ?? '');
    if (oldNotes !== newNotes && newNotes) {
      changes.push(`Notes: ${newNotes}`);
      allowed.notes = newNotes;
    }
    const oldPay = String(prev.paymentType ?? prev.PaymentType ?? '');
    const newPay = String(next.paymentType ?? next.PaymentType ?? '');
    if (oldPay !== newPay && newPay) {
      changes.push(`Payment: ${newPay}`);
      allowed.paymentType = newPay;
    }
  }

  return { allowed, blocked, changes };
}

export function stageAllowsMeter(stage: JobStage): boolean {
  return stage === 'onboard';
}
