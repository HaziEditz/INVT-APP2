import { onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { jobIdsMatch } from '@/lib/driverNotifications';

export type ActiveJobWithdrawReason =
  | 'jobs-node-deleted'
  | 'current-cleared'
  | 'currentJobId-cleared';

/** Presence / offer-node signals — do NOT prove job ownership was withdrawn. */
export function isPresenceOnlyActiveJobSignal(reason: ActiveJobWithdrawReason): boolean {
  return (
    reason === 'current-cleared' ||
    reason === 'currentJobId-cleared' ||
    reason === 'jobs-node-deleted'
  );
}

function readCurrentJobId(node: Record<string, unknown>): string {
  return String(node.currentJobId ?? node.jobId ?? node.bookingId ?? node.joboffer ?? '').trim();
}

/**
 * Watch Firebase paths that *may* indicate a booking is no longer on this vehicle.
 *
 * Important: ghost-presence cleanup deletes `online/{cid}/{vid}` while the job can
 * still be Assigned/Active on the server. Offer cleanup also deletes `jobs/...`.
 * Callers must reconcile against booking ownership (allbookings / active-bookings)
 * before clearing local activeJob — never treat these signals as proof of withdraw.
 */
export function subscribeActiveJobFirebaseWatch(
  companyId: string,
  vehicleId: string,
  driverId: string,
  bookingId: string,
  onSignal: (reason: ActiveJobWithdrawReason) => void,
): () => void {
  const db = getDatabaseInstance();
  const unsubs: Array<() => void> = [];

  const jobsRef = ref(db, `jobs/${companyId}/${vehicleId}/${driverId}/${bookingId}`);
  unsubs.push(
    onValue(jobsRef, (snap) => {
      if (!snap.exists()) {
        onSignal('jobs-node-deleted');
      }
    }),
  );

  const currentRef = ref(db, `online/${companyId}/${vehicleId}/current`);
  unsubs.push(
    onValue(currentRef, (snap) => {
      if (!snap.exists()) {
        onSignal('current-cleared');
        return;
      }
      const val = snap.val();
      if (!val || typeof val !== 'object') {
        onSignal('current-cleared');
        return;
      }
      const cur = val as Record<string, unknown>;
      const nodeDriverId = String(cur.driverid ?? cur.driverId ?? '').trim();
      if (nodeDriverId && driverId && nodeDriverId !== driverId) {
        return;
      }
      const currentJobId = readCurrentJobId(cur);
      if (!currentJobId || currentJobId === '0' || !jobIdsMatch(currentJobId, bookingId)) {
        onSignal('currentJobId-cleared');
      }
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
