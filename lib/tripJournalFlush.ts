import NetInfo from '@react-native-community/netinfo';
import { createHailJobOnDispatch, DispatchApiError } from '@/lib/dispatchApi';
import {
  listPendingHailCreates,
  setTripJournalSyncState,
} from '@/services/tripJournalService';

export type TripJournalFlushHooks = {
  /** Called after server assigns numeric jobId for a journalled hail. */
  onHailCreated?: (args: {
    clientTripId: string;
    serverJobId: string;
    updateSeq: number;
    vehicleId: string;
    companyId: string;
  }) => void | Promise<void>;
};

function isRetryableFlushError(err: unknown): boolean {
  if (!(err instanceof DispatchApiError)) return true;
  if (err.status >= 500) return true;
  if (err.status === 0 || err.status === 408 || err.status === 429) return true;
  return false;
}

/**
 * Phase 5c — flush pending offline hail creates via idempotent /api/job/create.
 * Does not call /api/syncOfflineTrip (needs numeric jobId + stage events — 5d+).
 */
export async function flushTripJournal(hooks: TripJournalFlushHooks = {}): Promise<number> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  const pending = await listPendingHailCreates();
  if (!pending.length) return 0;

  let flushed = 0;
  for (const journal of pending) {
    const clientTripId = journal.clientTripId;
    const hail = journal.hailCreate;
    if (!hail) continue;

    await setTripJournalSyncState(clientTripId, 'creating', { lastError: undefined });
    try {
      const created = await createHailJobOnDispatch({
        companyId: journal.companyId,
        driverId: journal.driverId,
        vehicleId: journal.vehicleId,
        tariffId: hail.tariffId,
        pickup: hail.pickup,
        clientTripId,
      });
      await setTripJournalSyncState(clientTripId, 'synced', {
        serverJobId: created.jobId,
        lastError: undefined,
      });
      await hooks.onHailCreated?.({
        clientTripId,
        serverJobId: created.jobId,
        updateSeq: created.updateSeq,
        vehicleId: journal.vehicleId,
        companyId: journal.companyId,
      });
      flushed += 1;
      console.log('[trip-journal] flushed hail create', {
        clientTripId,
        jobId: created.jobId,
        existing: !!created.existing,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRetryableFlushError(err)) {
        await setTripJournalSyncState(clientTripId, 'pending', { lastError: msg });
        console.warn('[trip-journal] hail create will retry', { clientTripId, error: msg });
        continue;
      }
      await setTripJournalSyncState(clientTripId, 'failed', { lastError: msg });
      console.warn('[trip-journal] hail create failed permanently', { clientTripId, error: msg });
    }
  }
  return flushed;
}
