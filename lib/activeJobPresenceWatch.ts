import { onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { jobIdsMatch } from '@/lib/driverNotifications';

export type ActiveJobWithdrawReason =
  | 'jobs-node-deleted'
  | 'current-cleared'
  | 'currentJobId-cleared';

function readCurrentJobId(node: Record<string, unknown>): string {
  return String(node.currentJobId ?? node.jobId ?? node.bookingId ?? node.joboffer ?? '').trim();
}

/**
 * Watch Firebase paths that prove a driver no longer owns a booking:
 * - jobs/{cid}/{vid}/{driverId}/{bookingId} removed
 * - online/{cid}/{vid}/current currentJobId cleared or changed
 */
export function subscribeActiveJobFirebaseWatch(
  companyId: string,
  vehicleId: string,
  driverId: string,
  bookingId: string,
  onWithdrawn: (reason: ActiveJobWithdrawReason) => void,
): () => void {
  const db = getDatabaseInstance();
  const unsubs: Array<() => void> = [];

  const jobsRef = ref(db, `jobs/${companyId}/${vehicleId}/${driverId}/${bookingId}`);
  unsubs.push(
    onValue(jobsRef, (snap) => {
      if (!snap.exists()) {
        onWithdrawn('jobs-node-deleted');
      }
    }),
  );

  const currentRef = ref(db, `online/${companyId}/${vehicleId}/current`);
  unsubs.push(
    onValue(currentRef, (snap) => {
      if (!snap.exists()) {
        onWithdrawn('current-cleared');
        return;
      }
      const val = snap.val();
      if (!val || typeof val !== 'object') {
        onWithdrawn('current-cleared');
        return;
      }
      const cur = val as Record<string, unknown>;
      const nodeDriverId = String(cur.driverid ?? cur.driverId ?? '').trim();
      if (nodeDriverId && driverId && nodeDriverId !== driverId) {
        return;
      }
      const currentJobId = readCurrentJobId(cur);
      if (!currentJobId || currentJobId === '0' || !jobIdsMatch(currentJobId, bookingId)) {
        onWithdrawn('currentJobId-cleared');
      }
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
