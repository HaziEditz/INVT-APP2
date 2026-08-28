import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { JobOffer, JobStage } from '@/types';

import { isForbiddenPlaceholderTariffName } from '@/lib/tariffGuard';

export type BookingUpdate = {
  bookingId: string;
  cancelled: boolean;
  /** Server closed the booking (Completed / Cancelled / No Show). */
  terminal: boolean;
  status: string;
  pickup: string;
  dropoff: string;
  passengerName?: string;
  passengerPhone?: string;
  notes?: string;
  paymentType?: string;
  tariffId?: string;
  tariffName?: string;
  raw: Record<string, unknown>;
};

export function parseBookingNode(val: unknown): Partial<BookingUpdate> | null {
  if (!val || typeof val !== 'object') return null;
  const b = val as Record<string, unknown>;
  const statusRaw = String(b.Status ?? b.status ?? b.BookingStatus ?? '');
  const status = statusRaw.toLowerCase();
  const cancelled =
    status.includes('cancel') ||
    status.includes('void') ||
    !!b.cancelled ||
    !!b.Cancelled;
  const completed = status.includes('complete');
  const noShow = status.includes('no show') || status.includes('noshow');
  const terminal = cancelled || completed || noShow;
  return {
    bookingId: String(b.BookingId ?? b.bookingId ?? b.Id ?? b.id ?? ''),
    cancelled,
    terminal,
    status,
    pickup: String(b.PickAddress ?? b.pickup ?? b.pickAddress ?? b.PickupAddress ?? ''),
    dropoff: String(b.DropAddress ?? b.dropoff ?? b.dropAddress ?? b.DropoffAddress ?? ''),
    passengerName: String(b.PassengerName ?? b.Name ?? b.passengerName ?? '').trim() || undefined,
    passengerPhone: String(b.PhoneNo ?? b.passengerPhone ?? '').trim() || undefined,
    notes: b.notes ? String(b.notes) : b.Info ? String(b.Info) : undefined,
    paymentType: b.paymentType ? String(b.paymentType) : b.PaymentType ? String(b.PaymentType) : undefined,
    raw: b,
  };
}

/** Job returned to U-A pool — driver should drop it from their UI. */
export function isReturnedToDispatchPool(status: string): boolean {
  const s = status.toLowerCase().replace(/\s+/g, ' ');
  return s === 'pending' || s === 'no one' || s === 'noone' || s === 'unassigned';
}

export function subscribeBooking(
  companyId: string,
  bookingId: string,
  onUpdate: (update: BookingUpdate) => void,
): () => void {
  const bookingRef = ref(getDatabaseInstance(), `allbookings/${companyId}/${bookingId}`);
  return onValue(bookingRef, (snap) => {
    if (!snap.exists()) {
      onUpdate({
        bookingId,
        cancelled: true,
        terminal: true,
        status: 'removed',
        pickup: '',
        dropoff: '',
        raw: {},
      });
      return;
    }
    const parsed = parseBookingNode(snap.val());
    if (!parsed) return;
    // Path bookingId is authoritative — many allbookings rows omit Id/BookingId after cancel fanout.
    const update = { ...parsed, bookingId: String(parsed.bookingId || bookingId) } as BookingUpdate;
    if (isReturnedToDispatchPool(update.status)) {
      onUpdate({
        ...update,
        terminal: true,
        status: 'removed',
      });
      return;
    }
    onUpdate(update);
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
    { key: 'dropoff', label: 'Dropoff', pick: (b) => String(b.DropAddress ?? b.dropoff ?? b.DropoffAddress ?? '') },
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

    const oldTariffId = String(prev.TariffId ?? prev.TarriffId ?? prev.tariffId ?? '');
    const newTariffId = String(next.TariffId ?? next.TarriffId ?? next.tariffId ?? '');
    const oldTariffName = String(prev.TarriffType ?? prev.TariffName ?? prev.tariffName ?? '');
    const newTariffNameRaw = String(next.TarriffType ?? next.TariffName ?? next.tariffName ?? '');
    const newTariffName = isForbiddenPlaceholderTariffName(newTariffNameRaw) ? '' : newTariffNameRaw;
    if (oldTariffId !== newTariffId && newTariffId) {
      changes.push(`Tariff: ${newTariffName || newTariffId}`);
      allowed.tariffId = newTariffId;
      if (newTariffName) allowed.tariffName = newTariffName;
    } else if (oldTariffName !== newTariffName && newTariffName) {
      changes.push(`Tariff: ${newTariffName}`);
      allowed.tariffName = newTariffName;
    }
  }

  return { allowed, blocked, changes };
}

export function stageAllowsMeter(stage: JobStage): boolean {
  return stage === 'onboard';
}

function bookingStatusFromRecord(b: Record<string, unknown>): string {
  return String(b.BookingStatus ?? b.Status ?? b.status ?? '').trim();
}

function updateSeqFromRecord(b: Record<string, unknown>): number | undefined {
  const n = parseInt(String(b.updateSeq ?? b._seq ?? b.version ?? ''), 10);
  return Number.isNaN(n) ? undefined : n;
}

function statusesMatchStage(expectedStatus: string, actual: string): boolean {
  const e = expectedStatus.toLowerCase().replace(/\s+/g, '');
  const a = actual.toLowerCase().replace(/\s+/g, '');
  if (e === a) return true;
  if (e === 'active' && (a === 'active' || a === 'ontrip')) return true;
  return false;
}

/** Confirm dispatch stage advanced on Firebase after a transport-layer failure. */
export async function verifyJobStageOnFirebase(
  companyId: string,
  bookingId: string,
  expectedStatus: string,
  minUpdateSeq?: number,
): Promise<{ verified: boolean; updateSeq?: number; status?: string }> {
  try {
    const snap = await get(ref(getDatabaseInstance(), `allbookings/${companyId}/${bookingId}`));
    if (!snap.exists()) return { verified: false };
    const raw = snap.val() as Record<string, unknown>;
    const status = bookingStatusFromRecord(raw);
    const updateSeq = updateSeqFromRecord(raw);
    if (statusesMatchStage(expectedStatus, status)) {
      return { verified: true, updateSeq, status };
    }
    if (minUpdateSeq != null && updateSeq != null && updateSeq > minUpdateSeq) {
      return { verified: true, updateSeq, status };
    }
    return { verified: false, updateSeq, status };
  } catch {
    return { verified: false };
  }
}
