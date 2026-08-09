/**
 * Multi-trip offline flush + auto-dispatch gating.
 * Pending journal work must keep the driver Busy so a new offer cannot queue
 * against a ghost Active trip on dispatch.
 */

/** Never block hail Complete / End Trip on reverse-geocode. */
export const GEOCODE_TIMEOUT_MS = 2_500;

export type JournalEventLike = {
  type: string;
  synced?: boolean;
};

export type JournalRowLike = {
  source?: string;
  syncState?: string;
  serverJobId?: string | null;
  hailCreate?: unknown;
  events: JournalEventLike[];
};

/** Unsynced Arrived/OnBoard still outstanding for this journal. */
export function journalHasUnsyncedStages(events: JournalEventLike[]): boolean {
  return events.some(
    (e) => (e.type === 'Arrived' || e.type === 'OnBoard') && e.synced !== true,
  );
}

/** Match a journal row to a completed trip (job id and/or clientTripId). */
export function journalMatchesCompletedTrip(
  row: {
    clientTripId?: string;
    serverJobId?: string | null;
    events: Array<{ payload?: Record<string, unknown> | null }>;
  },
  jobId: string,
  clientTripId: string,
): boolean {
  const id = String(jobId || '').trim();
  const key = String(clientTripId || '').trim();
  const idMatch = !!id && String(row.serverJobId || '').trim() === id;
  const keyMatch = !!key && row.clientTripId === key;
  const payloadMatch =
    !!id &&
    row.events.some((e) => {
      const p = e.payload || {};
      return String(p.jobId || p.bookingId || '') === id;
    });
  return idMatch || keyMatch || payloadMatch;
}

/**
 * After local Completed is journalled (weak-signal / offline), mark Arrived/OnBoard
 * synced so Syncing only tracks the terminal flush — not already-applied stages.
 * Does NOT mark Completed/Cancelled/NoShow (those must still flush to dispatch).
 */
export function markJournalStageEventsSynced<T extends JournalEventLike>(events: T[]): T[] {
  return events.map((e) =>
    (e.type === 'Arrived' || e.type === 'OnBoard') && e.synced !== true
      ? { ...e, synced: true }
      : e,
  );
}

/** Local stage hint for catch-up before Completed flush. */
export function localStageHintFromJournalEvents(
  events: JournalEventLike[],
): 'pickup' | 'arrived' | 'onboard' | 'complete' {
  const types = new Set(events.map((e) => e.type));
  if (types.has('Completed') || types.has('OnBoard')) return 'onboard';
  if (types.has('Arrived')) return 'arrived';
  return 'pickup';
}

/**
 * Terminal flush errors that must NOT drop the event (retry next reconnect).
 * invalid_transition on Complete usually means stages not caught up yet.
 */
export function isRetryableTerminalFlushError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const status = Number((err as { status?: number }).status);
  const code = String((err as { errorCode?: string }).errorCode || '');
  if (status >= 500 || status === 0 || status === 408 || status === 429) return true;
  if (code === 'version_conflict') return true;
  if (code === 'invalid_transition') return true;
  // Ambiguous client/server races — keep retrying (never silently drop).
  if (code === 'bad_request' || code === 'not_found' || status === 404 || status === 409) {
    return true;
  }
  // Non-DispatchApiError (network) — retry.
  if (!('status' in (err as object))) return true;
  return false;
}

/** Completed must never be marked synced on ambiguous failure. */
export function shouldDropTerminalOnFlushError(eventType: string, err: unknown): boolean {
  if (eventType === 'Completed') return false;
  return !isRetryableTerminalFlushError(err);
}

/** Unsynced terminals waiting on hail create bind (no numeric serverJobId yet). */
export function journalHasOrphanTerminals(row: JournalRowLike): boolean {
  const jobId = String(row.serverJobId || '').trim();
  if (jobId && /^\d+$/.test(jobId)) return false;
  return row.events.some(
    (e) =>
      (e.type === 'Completed' || e.type === 'Cancelled' || e.type === 'NoShow') &&
      e.synced !== true,
  );
}

/** Failed hail create that still has create intent or orphan Completed. */
export function journalIsFailedHailStillPending(row: JournalRowLike): boolean {
  if (row.source !== 'hail') return false;
  if (row.syncState !== 'failed') return false;
  if (row.hailCreate && !String(row.serverJobId || '').trim()) return true;
  return journalHasOrphanTerminals(row);
}

/** Pure pending-work decision used by hasPendingTripJournalWork. */
export function hasPendingTripJournalWorkFromRows(args: {
  pendingHailCreates: number;
  pendingStages: number;
  pendingTerminalsWithServerId: number;
  orphanTerminalJournals: number;
  failedHailStillPending: number;
}): boolean {
  return (
    args.pendingHailCreates > 0 ||
    args.pendingStages > 0 ||
    args.pendingTerminalsWithServerId > 0 ||
    args.orphanTerminalJournals > 0 ||
    args.failedHailStillPending > 0
  );
}

/** Miss→Away must not fire while Syncing / pending trip journal work. */
export function shouldSuppressMissAway(pendingTripSync: boolean): boolean {
  return !!pendingTripSync;
}

/**
 * After trip clear / during payment complete, timed-out offers must not Away the
 * driver — paymentJob is already cleared so driverHasConfirmedActiveTrip is false.
 */
export function shouldSuppressMissAwayAfterTripClear(args: {
  pendingTripSync: boolean;
  syncingBanner: boolean;
  localCompletion: boolean;
}): boolean {
  return !!(args.pendingTripSync || args.syncingBanner || args.localCompletion);
}

/** Expired deferred offers: purge — never promote to timed-out decline→Away. */
export function shouldPurgeExpiredDeferredOffer(expiresAt: number | undefined, now = Date.now()): boolean {
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt <= now;
}

/** Stage events may drop invalid_transition (e.g. Arrived when already Active). */
export function isRetryableStageFlushError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const status = Number((err as { status?: number }).status);
  const code = String((err as { errorCode?: string }).errorCode || '');
  if (status >= 500 || status === 0 || status === 408 || status === 429) return true;
  if (code === 'version_conflict') return true;
  // invalid_transition on stages: drop that stage, continue (caller marks synced).
  if (code === 'invalid_transition') return false;
  if (!('status' in (err as object))) return true;
  return false;
}

/**
 * Presence while trip journal still has pending work.
 * Pending sync / local trip always wins over Away — zombie Away+Syncing must not stick.
 */
export function presenceWhilePendingTripSync(args: {
  away: boolean;
  hasLocalTrip: boolean;
  pendingJournalWork: boolean;
}): 'Away' | 'Busy' | 'Available' {
  if (args.hasLocalTrip) return 'Busy';
  if (args.pendingJournalWork) return 'Busy';
  if (args.away) return 'Away';
  return 'Available';
}

/** Pure status for heartbeat / repairPresence writes. */
export function derivePresenceWriteStatusFromIntent(args: {
  awayIntent: 'none' | 'manual' | 'missed' | string;
  hasPaymentJob: boolean;
  activeStage?: string | null;
  hailActive: boolean;
  pendingJournalWork: boolean;
}): 'Away' | 'Busy' | 'Assigned' | 'Arrived' | 'Active' | 'Available' {
  const stageMap: Record<string, 'Assigned' | 'Arrived' | 'Active' | 'Busy'> = {
    pickup: 'Assigned',
    arrived: 'Arrived',
    onboard: 'Active',
    complete: 'Busy',
  };
  const tripStatus =
    args.hasPaymentJob || args.hailActive
      ? 'Busy'
      : args.activeStage
        ? stageMap[args.activeStage] ?? 'Busy'
        : null;
  const hasLocalTrip = !!tripStatus;
  const base = presenceWhilePendingTripSync({
    away: args.awayIntent !== 'none',
    hasLocalTrip,
    pendingJournalWork: args.pendingJournalWork,
  });
  if (base === 'Busy' && tripStatus && tripStatus !== 'Busy') return tripStatus;
  return base;
}

/** Auto-dispatch / offer popup should wait until pending sync clears. */
export function shouldBlockOffersForPendingTripSync(pendingJournalWork: boolean): boolean {
  return !!pendingJournalWork;
}
