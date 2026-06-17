import { JobOffer } from '@/types';

export type PickupTypeLabel = 'ASAP' | 'LATER';

function parseTimestamp(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number') {
    return !Number.isNaN(raw) && raw > 0 ? raw : undefined;
  }
  const s = String(raw).trim();
  if (!s) return undefined;
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const ms = Date.parse(normalized);
  return !Number.isNaN(ms) && ms > 0 ? ms : undefined;
}

/** Extract pickup / booking scheduling fields from a Firebase or offer payload. */
export function parseSchedulingMetaFromRecord(
  val: Record<string, unknown>,
): Pick<
  JobOffer,
  | 'pickupTimeMs'
  | 'bookedAtMs'
  | 'pickupType'
  | 'createdBy'
  | 'dispatchBeforeMinutes'
  | 'notifyDispatchAt'
  | 'bookingType'
> {
  const scheduledFor = Number(val.ScheduledFor ?? val.ScheduledForMs ?? val.scheduledFor ?? 0);
  let pickupTimeMs: number | undefined;
  if (scheduledFor > 0 && !Number.isNaN(scheduledFor)) {
    pickupTimeMs = scheduledFor;
  } else {
    pickupTimeMs = parseTimestamp(
      val.BookingDateTime ??
        val.Pickingtime ??
        val.PickingTime ??
        val.pickingTime ??
        val.pickupTime,
    );
  }

  const dispatchBeforeMinutes =
    parseInt(String(val.DispatchTimebefore ?? val.Dispatchbefore ?? val.dispatchBeforeMinutes ?? '0'), 10) ||
    0;
  const notifyDispatchAtRaw = val.NotifyDispatchAt ?? val.notifyDispatchAt;
  const notifyDispatchAt = notifyDispatchAtRaw ? String(notifyDispatchAtRaw) : undefined;
  const status = String(val.Status ?? val.status ?? val.BookingStatus ?? '').toLowerCase();
  const bookingType = String(val.bookingType ?? val.BookingType ?? '').trim() || undefined;
  const createdBy = String(val.CreatedBy ?? val.createdBy ?? '').trim() || undefined;

  let bookedAtMs: number | undefined;
  if (val.createdAt != null) {
    const n = Number(val.createdAt);
    if (!Number.isNaN(n) && n > 0) bookedAtMs = n;
  }
  if (!bookedAtMs) {
    for (const key of ['CreatedAt', 'bookedAt', 'BookedAt', 'bookingCreatedAt', 'OfferedAt', 'offeredAt'] as const) {
      bookedAtMs = parseTimestamp(val[key]);
      if (bookedAtMs) break;
    }
  }

  const now = Date.now();
  const preBooked =
    dispatchBeforeMinutes > 0 ||
    !!notifyDispatchAt ||
    status === 'scheduled' ||
    bookingType?.toUpperCase() === 'SCHEDULED' ||
    (pickupTimeMs != null && pickupTimeMs > now) ||
    (bookedAtMs != null && pickupTimeMs != null && pickupTimeMs - bookedAtMs > 60_000);

  const pickupType: PickupTypeLabel = preBooked ? 'LATER' : 'ASAP';

  return {
    pickupTimeMs,
    bookedAtMs,
    pickupType,
    createdBy,
    dispatchBeforeMinutes: dispatchBeforeMinutes || undefined,
    notifyDispatchAt,
    bookingType,
  };
}

/** Compact card datetime — Today/Tmr/weekday + time (matches dispatch console). */
export function formatJobDateTimeCompact(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `Today ${time}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  if (isTomorrow) return `Tmr ${time}`;

  const datePart = d.toLocaleDateString('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${datePart} ${time}`;
}

export function pickupTypeLabelFromOffer(job: JobOffer): PickupTypeLabel {
  if (job.pickupType) return job.pickupType;
  const now = Date.now();
  if ((job.dispatchBeforeMinutes ?? 0) > 0) return 'LATER';
  if (job.notifyDispatchAt) return 'LATER';
  if (job.bookingType?.toUpperCase() === 'SCHEDULED') return 'LATER';
  if (job.pickupTimeMs != null && job.pickupTimeMs > now) return 'LATER';
  if (
    job.bookedAtMs != null &&
    job.pickupTimeMs != null &&
    job.pickupTimeMs - job.bookedAtMs > 60_000
  ) {
    return 'LATER';
  }
  return 'ASAP';
}

/** Short source badge — DESK / HAIL / WEB / APP (matches dispatch JobCard). */
export function sourceBadgeLabel(src?: string): string {
  const s = String(src ?? '')
    .toLowerCase()
    .replace(/_/g, ' ');
  if (!s) return '';
  if (s.includes('dispatch') || s === 'phone' || s.includes('console') || s === 'desk') return 'DESK';
  if (s.includes('hail')) return 'HAIL';
  if (s.includes('passenger') || s === 'app') return 'APP';
  if (s.includes('web') || s.includes('website')) return 'WEB';
  return s.slice(0, 8).toUpperCase();
}

/** Human-readable source line for driver job details. */
export function sourceDisplayLabel(
  src?: string,
  createdBy?: string,
  dispatcherName?: string,
): string | null {
  const badge = sourceBadgeLabel(src ?? createdBy);
  if (!badge) return createdBy?.trim() || null;
  if (badge === 'DESK') {
    const who = dispatcherName?.trim() || createdBy?.trim();
    return who ? `DESK · ${who}` : 'DESK';
  }
  if (badge === 'WEB') return 'Website';
  if (badge === 'APP') return 'Passenger App';
  if (badge === 'HAIL') return 'Hail';
  return badge;
}
