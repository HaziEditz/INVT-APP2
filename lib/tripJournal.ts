/**
 * tripJournal.ts — Offline-first trip event log + trip summary storage.
 *
 * Every trip action is saved locally to AsyncStorage before any network call.
 * When the phone reconnects, syncOfflineTrips.ts reads these records and
 * uploads them to the server.  Synced records are kept for 30 days as proof.
 *
 * v12-ota22k: data-integrity hardening.
 *   - Per-trip upload attempt counter (`tj:attempts:{jobId}`) — survives app restarts
 *   - Per-trip last-error record    (`tj:lastError:{jobId}`) — for driver/admin review
 *   - Real fares are NEVER auto-deleted on HTTP 4xx — they retry forever
 *   - The dangerous "Clear ALL pending" wipe was REMOVED. Replaced with
 *     `clearSpecificStuckTrip(jobId)` so the driver acknowledges each trip
 *     individually with full fare/date context.
 *   - `getStuckTripsDetail()` returns enough info for the Profile UI to show
 *     each trip's job ID, fare, date, payment method, and last server error.
 *
 * Key layout in AsyncStorage:
 *   tj:journal:{jobId}    → JournalEntry[]  (append-only event log)
 *   tj:summary:{jobId}    → TripSummary     (final fare + payment record)
 *   tj:attempts:{jobId}   → number          (upload attempt count, persistent)
 *   tj:lastError:{jobId}  → LastError       (most recent server error if any)
 *   tj:pending            → string[]        (jobIds with unsynced data)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type JournalEventType =
  | 'Accepted'
  | 'EnRoute'
  | 'Arrived'
  | 'PickedUp'
  | 'MeterOn'
  | 'MeterOff'
  | 'Completed'
  | 'Cancelled'
  | 'PositionUpdate';

export interface JournalEntry {
  jobId:      string;
  companyId:  string;
  driverId:   string;
  vehicleId:  string;
  eventType:  JournalEventType;
  timestamp:  string;
  lat:        number;
  lng:        number;
  synced:     boolean;
  meta?:      Record<string, any>;
}

export interface TripSummary {
  jobId:          string;
  companyId:      string;
  driverId:       string;
  vehicleId:      string;
  passengerName:  string;
  pickupAddress:  string;
  dropoffAddress: string;
  pickupTime:     string;
  dropoffTime:    string;
  duration_mins:  number;
  distance_km:    number;
  fare: {
    base:           number;
    distanceCharge: number;
    timeCharge:     number;
    extras:         number;
    total:          number;
    currency:       string;
  };
  payment: {
    method:     string;
    received?:  number;
    change?:    number;
    cardLast4?: string | null;
    receiptNo:  string;
  };
  status:           'Completed' | 'Cancelled';
  completedOffline: boolean;
  synced:           boolean;
  savedAt:          string;
}

export interface LastError {
  status:  number;            // HTTP status (0 if network failure)
  message: string;            // human-readable error
  body?:   string;            // server response body (truncated)
  when:    string;            // ISO timestamp of last attempt
}

/** Detail packet returned to the UI for the "Review Stuck Uploads" screen. */
export interface StuckTripDetail {
  jobId:         string;
  fare:          number;
  currency:      string;
  paymentMethod: string;
  passengerName: string;
  dropoffAddress: string;
  savedAt:       string;          // ISO
  attempts:      number;
  lastError:     LastError | null;
  hasSummary:    boolean;
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const JOURNAL_KEY     = (jobId: string) => `tj:journal:${jobId}`;
const SUMMARY_KEY     = (jobId: string) => `tj:summary:${jobId}`;
const ATTEMPTS_KEY    = (jobId: string) => `tj:attempts:${jobId}`;
const LAST_ERROR_KEY  = (jobId: string) => `tj:lastError:${jobId}`;
const PENDING_KEY                        = 'tj:pending';
const THIRTY_DAYS_MS                     = 30 * 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function addToPending(jobId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  if (!ids.includes(jobId)) {
    ids.push(jobId);
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(ids));
  }
}

async function removeFromPending(jobId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  const next = ids.filter(id => id !== jobId);
  if (next.length !== ids.length) {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(next));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append one event to the journal for this job.
 * Called at every state transition — before any network call.
 */
export async function appendJournalEntry(
  entry: Omit<JournalEntry, 'synced'>,
): Promise<void> {
  try {
    const key  = JOURNAL_KEY(entry.jobId);
    const raw  = await AsyncStorage.getItem(key);
    const list: JournalEntry[] = raw ? JSON.parse(raw) : [];
    list.push({ ...entry, synced: false });
    await AsyncStorage.setItem(key, JSON.stringify(list));
    await addToPending(entry.jobId);
  } catch (e: any) {
    console.warn('[TripJournal] appendJournalEntry failed:', e?.message);
  }
}

/**
 * Save the full trip summary when a job ends (Completed or Cancelled).
 * This is the payment record used for reconciliation.
 */
export async function saveTripSummary(
  summary: Omit<TripSummary, 'synced' | 'savedAt'>,
): Promise<void> {
  try {
    const record: TripSummary = {
      ...summary,
      synced:  false,
      savedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(SUMMARY_KEY(summary.jobId), JSON.stringify(record));
    await addToPending(summary.jobId);
  } catch (e: any) {
    console.warn('[TripJournal] saveTripSummary failed:', e?.message);
  }
}

/** Return all jobIds that still have unsynced data. */
export async function getPendingTripIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Return all journal entries for one job. */
export async function getJournalEntries(jobId: string): Promise<JournalEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(JOURNAL_KEY(jobId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Return the trip summary for one job, or null if not saved yet. */
export async function getTripSummary(jobId: string): Promise<TripSummary | null> {
  try {
    const raw = await AsyncStorage.getItem(SUMMARY_KEY(jobId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Mark a job's journal + summary as synced and remove it from the pending list.
 * Called after a successful upload to the server.
 *
 * v12-ota22k: also clears attempts + lastError so a future retry of the same
 * jobId (shouldn't happen, but defensive) starts fresh.
 */
export async function markTripSynced(jobId: string): Promise<void> {
  try {
    const jRaw = await AsyncStorage.getItem(JOURNAL_KEY(jobId));
    if (jRaw) {
      const entries: JournalEntry[] = JSON.parse(jRaw);
      await AsyncStorage.setItem(
        JOURNAL_KEY(jobId),
        JSON.stringify(entries.map(e => ({ ...e, synced: true }))),
      );
    }

    const sRaw = await AsyncStorage.getItem(SUMMARY_KEY(jobId));
    if (sRaw) {
      const summary: TripSummary = JSON.parse(sRaw);
      await AsyncStorage.setItem(
        SUMMARY_KEY(jobId),
        JSON.stringify({ ...summary, synced: true }),
      );
    }

    await AsyncStorage.multiRemove([ATTEMPTS_KEY(jobId), LAST_ERROR_KEY(jobId)]);
    await removeFromPending(jobId);
  } catch (e: any) {
    console.warn('[TripJournal] markTripSynced failed:', e?.message);
  }
}

/** How many jobs are pending upload right now. */
export async function getPendingCount(): Promise<number> {
  const ids = await getPendingTripIds();
  return ids.length;
}

// ── v12-ota22k: per-trip retry tracking ──────────────────────────────────────

/** Get current upload attempt count for one trip (0 if never tried). */
export async function getTripAttempts(jobId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(ATTEMPTS_KEY(jobId));
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Increment attempt count for one trip. Returns the new value. */
export async function incrementTripAttempts(jobId: string): Promise<number> {
  const current = await getTripAttempts(jobId);
  const next = current + 1;
  try {
    await AsyncStorage.setItem(ATTEMPTS_KEY(jobId), String(next));
  } catch {}
  return next;
}

/** Save the last upload error for one trip, for the Profile review UI. */
export async function recordTripError(jobId: string, err: LastError): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ERROR_KEY(jobId), JSON.stringify(err));
  } catch {}
}

/** Get the last recorded upload error for one trip, or null. */
export async function getTripLastError(jobId: string): Promise<LastError | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ERROR_KEY(jobId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * v12-ota22k: Return full detail for every pending trip — for the Profile
 * "Review Stuck Uploads" screen so the driver sees fare/date/payment/error
 * BEFORE deciding whether to clear anything.
 */
export async function getStuckTripsDetail(): Promise<StuckTripDetail[]> {
  const ids = await getPendingTripIds();
  const out: StuckTripDetail[] = [];
  for (const jobId of ids) {
    const [summary, attempts, lastError] = await Promise.all([
      getTripSummary(jobId),
      getTripAttempts(jobId),
      getTripLastError(jobId),
    ]);
    out.push({
      jobId,
      fare:           summary?.fare?.total ?? 0,
      currency:       summary?.fare?.currency ?? 'NZD',
      paymentMethod:  summary?.payment?.method ?? '—',
      passengerName:  summary?.passengerName ?? '',
      dropoffAddress: summary?.dropoffAddress ?? '',
      savedAt:        summary?.savedAt ?? '',
      attempts,
      lastError,
      hasSummary:     !!summary,
    });
  }
  // Sort newest first
  out.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  return out;
}

/**
 * v12-ota22k: Clear ONE specific stuck trip after the driver has explicitly
 * acknowledged the fare + details on the Review screen. Returns true on success.
 *
 * This is the ONLY supported way to remove a pending trip from the device.
 * The previous bulk "Clear ALL pending" was removed because it could destroy
 * legitimate fare data the driver hasn't been paid for yet.
 */
export async function clearSpecificStuckTrip(jobId: string): Promise<boolean> {
  try {
    await AsyncStorage.multiRemove([
      JOURNAL_KEY(jobId),
      SUMMARY_KEY(jobId),
      ATTEMPTS_KEY(jobId),
      LAST_ERROR_KEY(jobId),
    ]);
    await removeFromPending(jobId);
    console.log('[TripJournal] Cleared specific stuck trip', jobId, '(driver-confirmed)');
    return true;
  } catch (e: any) {
    console.warn('[TripJournal] clearSpecificStuckTrip failed:', e?.message);
    return false;
  }
}

/**
 * Delete local records that are older than 30 days AND already synced.
 * Call once per shift start to keep device storage clean.
 */
export async function cleanOldTrips(): Promise<void> {
  try {
    const keys       = await AsyncStorage.getAllKeys();
    const summaryKeys = keys.filter(k => k.startsWith('tj:summary:'));
    const now         = Date.now();
    const toRemove: string[] = [];

    for (const sk of summaryKeys) {
      const raw = await AsyncStorage.getItem(sk);
      if (!raw) continue;
      const s: TripSummary = JSON.parse(raw);
      if (s.synced && now - new Date(s.savedAt).getTime() > THIRTY_DAYS_MS) {
        const jobId = sk.replace('tj:summary:', '');
        toRemove.push(sk, JOURNAL_KEY(jobId));
      }
    }

    if (toRemove.length) {
      await AsyncStorage.multiRemove(toRemove);
      console.log('[TripJournal] Cleaned', toRemove.length / 2, 'old synced trips');
    }
  } catch (e: any) {
    console.warn('[TripJournal] cleanOldTrips failed:', e?.message);
  }
}
