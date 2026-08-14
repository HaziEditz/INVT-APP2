import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import {
  dispatchJournalKey,
  localJobIdFromClientTripId,
  resolveJournalClientTripId,
} from '@/lib/bookingId';
import { newClientTripId } from '@/lib/dispatchApi';
import {
  hasPendingTripJournalWorkFromRows,
  journalHasOrphanTerminals,
  journalIsFailedHailStillPending,
  journalMatchesCompletedTrip,
  markJournalStageEventsSynced,
} from '@/lib/tripJournalFlushPolicy';
import type {
  TripJournal,
  TripJournalEvent,
  TripJournalEventType,
  TripJournalHailCreate,
  TripJournalSyncState,
} from '@/types';

async function loadAll(): Promise<TripJournal[]> {
  const rows = (await getData<TripJournal[]>(STORAGE_KEYS.tripJournal)) ?? [];
  return Array.isArray(rows) ? rows : [];
}

async function saveAll(rows: TripJournal[]): Promise<void> {
  await storeData(STORAGE_KEYS.tripJournal, rows);
}

export async function listTripJournals(): Promise<TripJournal[]> {
  const rows = await loadAll();
  return [...rows].sort((a, b) => a.createdAt - b.createdAt);
}

export async function getTripJournal(clientTripId: string): Promise<TripJournal | null> {
  const id = String(clientTripId || '').trim();
  if (!id) return null;
  const rows = await loadAll();
  return rows.find((j) => j.clientTripId === id) ?? null;
}

export async function upsertTripJournal(journal: TripJournal): Promise<TripJournal> {
  const rows = await loadAll();
  const idx = rows.findIndex((j) => j.clientTripId === journal.clientTripId);
  const next = { ...journal, updatedAt: Date.now() };
  if (idx >= 0) rows[idx] = next;
  else rows.push(next);
  await saveAll(rows);
  return next;
}

function makeEvent(type: TripJournalEventType, payload?: Record<string, unknown>): TripJournalEvent {
  const at = Date.now();
  return {
    id: newClientTripId(),
    type,
    at,
    isoTimestamp: new Date(at).toISOString(),
    payload,
    synced: false,
  };
}

/** Phase 5c — create a pending hail journal (offline start). */
export async function createPendingHailJournal(params: {
  clientTripId: string;
  companyId: string;
  driverId: string;
  vehicleId: string;
  hailCreate: TripJournalHailCreate;
}): Promise<TripJournal> {
  const clientTripId = String(params.clientTripId || '').trim();
  if (!clientTripId) throw new Error('clientTripId required');
  const now = Date.now();
  const existing = await getTripJournal(clientTripId);
  if (existing) {
    return upsertTripJournal({
      ...existing,
      companyId: params.companyId,
      driverId: params.driverId,
      vehicleId: params.vehicleId,
      hailCreate: params.hailCreate,
      syncState: existing.syncState === 'synced' ? 'synced' : 'pending',
      lastError: undefined,
    });
  }
  const journal: TripJournal = {
    clientTripId,
    localJobId: localJobIdFromClientTripId(clientTripId),
    companyId: params.companyId,
    driverId: params.driverId,
    vehicleId: params.vehicleId,
    source: 'hail',
    syncState: 'pending',
    createdAt: now,
    updatedAt: now,
    hailCreate: params.hailCreate,
    events: [makeEvent('HailCreate', { ...params.hailCreate })],
  };
  return upsertTripJournal(journal);
}

export async function setTripJournalSyncState(
  clientTripId: string,
  syncState: TripJournalSyncState,
  patch?: Partial<Pick<TripJournal, 'serverJobId' | 'lastError'>>,
): Promise<TripJournal | null> {
  const row = await getTripJournal(clientTripId);
  if (!row) return null;
  return upsertTripJournal({
    ...row,
    syncState,
    serverJobId: patch?.serverJobId ?? row.serverJobId,
    lastError: patch && 'lastError' in patch ? patch.lastError : row.lastError,
  });
}

/** How long a hail may stay `creating` before reconnect flush may re-POST. */
export const HAIL_CREATING_STALE_MS = 60_000;

export async function listPendingHailCreates(nowMs: number = Date.now()): Promise<TripJournal[]> {
  const rows = await listTripJournals();
  return rows.filter((j) => {
    if (j.source !== 'hail' || !j.hailCreate || j.serverJobId) return false;
    if (j.syncState === 'pending' || j.syncState === 'failed') return true;
    if (j.syncState === 'creating') {
      const updated = Number(j.updatedAt || j.createdAt || 0);
      // Only retry when the lease is genuinely stale — overlapping flushes must
      // not re-POST while the first create is still in flight.
      return updated > 0 && nowMs - updated >= HAIL_CREATING_STALE_MS;
    }
    return false;
  });
}

export { dispatchJournalKey, resolveJournalClientTripId };

/** Phase 5d — ensure a journal row exists for an online-created dispatch job. */
export async function ensureDispatchTripJournal(params: {
  jobId: string;
  companyId: string;
  driverId: string;
  vehicleId: string;
}): Promise<TripJournal> {
  const jobId = String(params.jobId || '').trim();
  if (!jobId || !/^\d+$/.test(jobId)) throw new Error('numeric jobId required');
  const clientTripId = dispatchJournalKey(jobId);
  const existing = await getTripJournal(clientTripId);
  if (existing) {
    return upsertTripJournal({
      ...existing,
      serverJobId: existing.serverJobId || jobId,
      localJobId: existing.localJobId || jobId,
      companyId: params.companyId || existing.companyId,
      driverId: params.driverId || existing.driverId,
      vehicleId: params.vehicleId || existing.vehicleId,
    });
  }
  const now = Date.now();
  return upsertTripJournal({
    clientTripId,
    localJobId: jobId,
    serverJobId: jobId,
    companyId: params.companyId,
    driverId: params.driverId,
    vehicleId: params.vehicleId,
    source: 'dispatch',
    syncState: 'synced',
    createdAt: now,
    updatedAt: now,
    events: [],
  });
}

/**
 * Phase 5e — ensure a journal row for hail or dispatch so terminal events can append.
 * Returns the journal clientTripId key.
 */
export async function ensureJournalForJob(params: {
  jobId: string;
  clientTripId?: string;
  companyId: string;
  driverId: string;
  vehicleId: string;
  source?: 'hail' | 'dispatch';
}): Promise<string> {
  const jobId = String(params.jobId || '').trim();
  const key = resolveJournalClientTripId({
    id: jobId,
    clientTripId: params.clientTripId,
  });
  if (!key) throw new Error('job is not journalable');

  const existing = await getTripJournal(key);
  const numericId = /^\d+$/.test(jobId) ? jobId : undefined;
  const source =
    params.source ??
    (key.startsWith('job:') ? 'dispatch' : 'hail');

  if (existing) {
    await upsertTripJournal({
      ...existing,
      serverJobId: existing.serverJobId || numericId,
      companyId: params.companyId || existing.companyId,
      driverId: params.driverId || existing.driverId,
      vehicleId: params.vehicleId || existing.vehicleId,
      syncState:
        existing.serverJobId || numericId
          ? existing.syncState === 'pending' || existing.syncState === 'creating'
            ? existing.syncState
            : 'synced'
          : existing.syncState,
    });
    return key;
  }

  if (key.startsWith('job:') && numericId) {
    await ensureDispatchTripJournal({
      jobId: numericId,
      companyId: params.companyId,
      driverId: params.driverId,
      vehicleId: params.vehicleId,
    });
    return key;
  }

  const now = Date.now();
  await upsertTripJournal({
    clientTripId: key,
    localJobId: jobId.startsWith('local:') ? jobId : localJobIdFromClientTripId(key),
    serverJobId: numericId,
    companyId: params.companyId,
    driverId: params.driverId,
    vehicleId: params.vehicleId,
    source,
    syncState: numericId ? 'synced' : 'pending',
    createdAt: now,
    updatedAt: now,
    events: [],
  });
  return key;
}

export async function appendTripJournalEvent(
  clientTripId: string,
  type: TripJournalEventType,
  payload?: Record<string, unknown>,
): Promise<TripJournal | null> {
  const row = await getTripJournal(clientTripId);
  if (!row) return null;
  // Avoid duplicate unsynced stage taps.
  const hasPendingSame = row.events.some((e) => e.type === type && e.synced !== true);
  if (hasPendingSame) return row;
  return upsertTripJournal({
    ...row,
    events: [...row.events, makeEvent(type, payload)],
  });
}

export async function markTripJournalEventSynced(
  clientTripId: string,
  eventId: string,
): Promise<void> {
  const row = await getTripJournal(clientTripId);
  if (!row) return;
  await upsertTripJournal({
    ...row,
    events: row.events.map((e) => (e.id === eventId ? { ...e, synced: true } : e)),
  });
}

/**
 * After a successful online /api/job/complete, mark leftover journal stages/terminals
 * for that trip synced so Syncing/Busy does not stick on already-archived jobs.
 */
export async function markTripJournalSyncedForCompletedTrip(params: {
  jobId?: string | null;
  clientTripId?: string | null;
}): Promise<number> {
  const jobId = String(params.jobId || '').trim();
  const clientTripId = String(params.clientTripId || '').trim();
  if (!jobId && !clientTripId) return 0;
  const rows = await listTripJournals();
  let cleared = 0;
  for (const row of rows) {
    if (!journalMatchesCompletedTrip(row, jobId, clientTripId)) continue;
    const nextEvents = row.events.map((e) => (e.synced === true ? e : { ...e, synced: true }));
    await upsertTripJournal({
      ...row,
      serverJobId:
        row.serverJobId || (jobId && /^\d+$/.test(jobId) ? jobId : row.serverJobId),
      syncState: 'synced',
      lastError: undefined,
      events: nextEvents,
    });
    cleared += 1;
  }
  return cleared;
}

/**
 * Weak-signal complete: local Completed is journalled but Arrived/OnBoard may still
 * look pending. Clear stages only so Syncing tracks the terminal flush; Completed
 * stays unsynced until /api/job/complete succeeds (including idempotent).
 */
export async function markTripJournalStagesSyncedForTrip(params: {
  jobId?: string | null;
  clientTripId?: string | null;
}): Promise<number> {
  const jobId = String(params.jobId || '').trim();
  const clientTripId = String(params.clientTripId || '').trim();
  if (!jobId && !clientTripId) return 0;
  const rows = await listTripJournals();
  let cleared = 0;
  for (const row of rows) {
    if (!journalMatchesCompletedTrip(row, jobId, clientTripId)) continue;
    const nextEvents = markJournalStageEventsSynced(row.events);
    const changed = nextEvents.some((e, i) => e.synced !== row.events[i]?.synced);
    if (!changed) continue;
    await upsertTripJournal({
      ...row,
      serverJobId:
        row.serverJobId || (jobId && /^\d+$/.test(jobId) ? jobId : row.serverJobId),
      events: nextEvents,
    });
    cleared += 1;
  }
  return cleared;
}

const STAGE_EVENT_TYPES = new Set<TripJournalEventType>(['Arrived', 'OnBoard']);
const TERMINAL_EVENT_TYPES = new Set<TripJournalEventType>(['Completed', 'Cancelled', 'NoShow']);

/** Journals with unsynced Arrived/OnBoard events and a numeric server job id. */
export async function listPendingStageFlushes(): Promise<
  Array<{ journal: TripJournal; events: TripJournalEvent[] }>
> {
  const rows = await listTripJournals();
  const out: Array<{ journal: TripJournal; events: TripJournalEvent[] }> = [];
  for (const journal of rows) {
    const jobId = String(journal.serverJobId || '').trim();
    if (!jobId || !/^\d+$/.test(jobId)) continue;
    const events = journal.events
      .filter((e) => STAGE_EVENT_TYPES.has(e.type) && e.synced !== true)
      .sort((a, b) => a.at - b.at);
    if (events.length) out.push({ journal, events });
  }
  return out.sort((a, b) => a.journal.createdAt - b.journal.createdAt);
}

/** Phase 5e — unsynced Completed/Cancelled/NoShow with numeric server job id. */
export async function listPendingTerminalFlushes(): Promise<
  Array<{ journal: TripJournal; events: TripJournalEvent[] }>
> {
  const rows = await listTripJournals();
  const out: Array<{ journal: TripJournal; events: TripJournalEvent[] }> = [];
  for (const journal of rows) {
    const jobId = String(journal.serverJobId || '').trim();
    if (!jobId || !/^\d+$/.test(jobId)) continue;
    const events = journal.events
      .filter((e) => TERMINAL_EVENT_TYPES.has(e.type) && e.synced !== true)
      .sort((a, b) => a.at - b.at);
    if (events.length) out.push({ journal, events });
  }
  return out.sort((a, b) => a.journal.createdAt - b.journal.createdAt);
}

export async function hasPendingTripJournalWork(): Promise<boolean> {
  const rows = await listTripJournals();
  const hail = await listPendingHailCreates();
  const stages = await listPendingStageFlushes();
  const terminals = await listPendingTerminalFlushes();
  let orphanTerminalJournals = 0;
  let failedHailStillPending = 0;
  for (const row of rows) {
    if (journalHasOrphanTerminals(row)) orphanTerminalJournals += 1;
    if (journalIsFailedHailStillPending(row)) failedHailStillPending += 1;
  }
  return hasPendingTripJournalWorkFromRows({
    pendingHailCreates: hail.length,
    pendingStages: stages.length,
    pendingTerminalsWithServerId: terminals.length,
    orphanTerminalJournals,
    failedHailStillPending,
  });
}
