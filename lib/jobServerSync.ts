import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { fetchDriverActiveBookings, syncJobStageOnDispatch } from '@/lib/dispatchApi';
import { JobStage } from '@/types';

/** Server BookingStatus values required for each local stage (pickup = Assigned, no extra call). */
const STAGE_SERVER_STATUSES: Partial<Record<JobStage, string>> = {
  arrived: 'Arrived',
  onboard: 'Active',
};

const STAGE_ORDER: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];

/** Map server booking status → local trip stage (best-effort). */
export function localStageFromServerStatus(status: string): JobStage {
  const s = String(status || '').trim();
  if (s === 'Active' || s === 'OnTrip' || s === 'Busy') return 'onboard';
  if (s === 'Arrived') return 'arrived';
  return 'pickup';
}

export function serverStatusIndex(status: string): number {
  const stage = localStageFromServerStatus(status);
  return STAGE_ORDER.indexOf(stage);
}

/** Read updateSeq + status from allbookings (fallback when REST list is empty). */
export async function fetchBookingFromFirebase(
  companyId: string,
  bookingId: string,
): Promise<{ status: string; updateSeq?: number } | null> {
  try {
    const snap = await get(ref(getDatabaseInstance(), `allbookings/${companyId}/${bookingId}`));
    if (!snap.exists()) return null;
    const rec = snap.val() as Record<string, unknown>;
    const status = String(rec.BookingStatus ?? rec.Status ?? rec.status ?? '');
    const rawSeq = rec.updateSeq ?? rec._seq ?? rec.version;
    const updateSeq = rawSeq != null ? parseInt(String(rawSeq), 10) : undefined;
    return { status, updateSeq: Number.isNaN(updateSeq!) ? undefined : updateSeq };
  } catch {
    return null;
  }
}

/** Push any missing stage transitions so server catches up to local stage. */
export async function catchUpJobStagesOnDispatch(
  bookingId: string,
  driverId: string,
  localStage: JobStage,
  updateSeq?: number,
): Promise<{ version?: number; synced: string[] }> {
  const localIdx = STAGE_ORDER.indexOf(localStage);
  if (localIdx <= 0) return { version: updateSeq, synced: [] };

  let ver = updateSeq;
  const synced: string[] = [];
  for (let i = 1; i <= localIdx; i++) {
    const stage = STAGE_ORDER[i];
    const serverStatus = STAGE_SERVER_STATUSES[stage];
    if (!serverStatus) continue;
    const { version } = await syncJobStageOnDispatch(bookingId, serverStatus, driverId, ver);
    if (version != null) ver = version;
    synced.push(serverStatus);
  }
  return { version: ver, synced };
}

export interface ServerBookingRow {
  bookingId: number;
  status: string;
  version: number;
  bookingStatus?: string;
}

/** Resolve server truth for an active booking (REST first, Firebase fallback). */
export async function resolveServerBookingState(
  companyId: string,
  driverId: string,
  bookingId: string,
): Promise<ServerBookingRow | null> {
  const bid = parseInt(bookingId, 10);
  if (!bid) return null;

  try {
    const list = await fetchDriverActiveBookings(driverId);
    const hit = list.find((b) => b.bookingId === bid);
    if (hit) {
      return {
        bookingId: hit.bookingId,
        status: hit.bookingStatus || hit.status,
        version: hit.version,
      };
    }
  } catch (err) {
    console.warn('[jobServerSync] active-bookings lookup failed:', err);
  }

  const fb = await fetchBookingFromFirebase(companyId, bookingId);
  if (!fb?.status) return null;
  return {
    bookingId: bid,
    status: fb.status,
    version: fb.updateSeq ?? 0,
  };
}
