import NetInfo from '@react-native-community/netinfo';
import { createHailJobOnDispatch, DispatchApiError, syncJobStageOnDispatch } from '@/lib/dispatchApi';
import {
  listPendingHailCreates,
  listPendingStageFlushes,
  markTripJournalEventSynced,
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
  /** Called after a stage event flush updates version (optional UI sync). */
  onStageSynced?: (args: {
    serverJobId: string;
    status: string;
    version?: number;
  }) => void | Promise<void>;
};

function isRetryableFlushError(err: unknown): boolean {
  if (!(err instanceof DispatchApiError)) return true;
  if (err.status >= 500) return true;
  if (err.status === 0 || err.status === 408 || err.status === 429) return true;
  // Version conflicts — retry with rolled-forward version next reconnect.
  if (err.errorCode === 'version_conflict') return true;
  return false;
}

function stageStatusForEvent(type: string): string | null {
  if (type === 'Arrived') return 'Arrived';
  if (type === 'OnBoard') return 'Active';
  return null;
}

/**
 * Phase 5c/5d — flush pending hail creates, then unsynced Arrived/OnBoard stages.
 * Does not call /api/syncOfflineTrip (full trip journal — 5e+).
 */
export async function flushTripJournal(hooks: TripJournalFlushHooks = {}): Promise<number> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  let flushed = 0;

  const pendingHail = await listPendingHailCreates();
  for (const journal of pendingHail) {
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

  const pendingStages = await listPendingStageFlushes();
  for (const { journal, events } of pendingStages) {
    const jobId = String(journal.serverJobId || '').trim();
    const driverId = String(journal.driverId || '').trim();
    if (!jobId || !driverId) continue;

    let version: number | undefined;
    for (const ev of events) {
      const fromPayload = ev.payload?.updateSeq;
      if (typeof fromPayload === 'number' && Number.isFinite(fromPayload)) {
        version = fromPayload;
        break;
      }
    }

    for (const ev of events) {
      const status = stageStatusForEvent(ev.type);
      if (!status) continue;
      try {
        const result = await syncJobStageOnDispatch(jobId, status, driverId, version);
        if (result.version != null) version = result.version;
        await markTripJournalEventSynced(journal.clientTripId, ev.id);
        await hooks.onStageSynced?.({ serverJobId: jobId, status, version });
        flushed += 1;
        console.log('[trip-journal] flushed stage', {
          jobId,
          type: ev.type,
          status,
          version,
          idempotent: !!result.idempotent,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRetryableFlushError(err)) {
          console.warn('[trip-journal] stage will retry', { jobId, type: ev.type, error: msg });
          break;
        }
        // Terminal: drop this event so we do not loop forever.
        await markTripJournalEventSynced(journal.clientTripId, ev.id);
        console.warn('[trip-journal] stage dropped (terminal)', { jobId, type: ev.type, error: msg });
      }
    }
  }

  return flushed;
}
