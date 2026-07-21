import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { localJobIdFromClientTripId } from '@/lib/bookingId';
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
