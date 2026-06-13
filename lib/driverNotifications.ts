import { remove, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

export type DriverNotificationType =
  | 'job_offer'
  | 'job_removed'
  | 'job_cancelled'
  | 'job_updated'
  | 'no_show'
  | string;

export function readNotificationType(val: Record<string, unknown>): DriverNotificationType {
  const raw = val.type ?? val.eventType ?? val.content ?? '';
  const s = String(raw).toLowerCase();
  if (s === 'job_offer' || s.includes('offered new job')) return 'job_offer';
  if (s === 'job_removed' || s === 'removed' || s === 'recalled') return 'job_removed';
  if (s === 'job_cancelled' || s === 'cancelled' || s.includes('cancel')) return 'job_cancelled';
  if (s === 'job_updated' || s === 'updated' || val.editNotice) return 'job_updated';
  if (s === 'no_show' || s === 'noshow') return 'no_show';
  return s;
}

export function readNotificationJobId(val: Record<string, unknown>): string {
  const raw = val.jobId ?? val.joboffer ?? val.bookingId ?? val.bookingid ?? val.id ?? '';
  const s = String(raw);
  if (s.includes(',')) return s.split(',')[0].trim();
  return s.trim();
}

export function jobIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = readNotificationJobId({ bookingId: a });
  const nb = readNotificationJobId({ bookingId: b });
  if (!na || !nb) return false;
  return na === nb;
}

export async function clearDriverNotification(driverId: string): Promise<void> {
  if (!driverId) return;
  try {
    await remove(ref(getDatabaseInstance(), `notification/${driverId}`));
  } catch {
    // non-fatal
  }
}
