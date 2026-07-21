import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { dispatchJournalKey, localJobIdFromClientTripId } from '@/lib/bookingId';
import { newClientTripId } from '@/lib/dispatchApi';
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

export async function listPendingHailCreates(): Promise<TripJournal[]> {
  const rows = await listTripJournals();
  return rows.filter(
    (j) =>
      j.source === 'hail' &&
      !!j.hailCreate &&
      (j.syncState === 'pending' || j.syncState === 'creating') &&
      !j.serverJobId,
  );
}

export { dispatchJournalKey };

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

const STAGE_EVENT_TYPES = new Set<TripJournalEventType>(['Arrived', 'OnBoard']);

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

export async function hasPendingTripJournalWork(): Promise<boolean> {
  const hail = await listPendingHailCreates();
  if (hail.length) return true;
  const stages = await listPendingStageFlushes();
  return stages.length > 0;
}
