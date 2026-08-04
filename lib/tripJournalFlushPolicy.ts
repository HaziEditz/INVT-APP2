/**
 * Multi-trip offline flush + auto-dispatch gating.
 * Pending journal work must keep the driver Busy so a new offer cannot queue
 * against a ghost Active trip on dispatch.
 */

export type JournalEventLike = {
  type: string;
  synced?: boolean;
};

/** Unsynced Arrived/OnBoard still outstanding for this journal. */
export function journalHasUnsyncedStages(events: JournalEventLike[]): boolean {
  return events.some(
    (e) => (e.type === 'Arrived' || e.type === 'OnBoard') && e.synced !== true,
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
  // Non-DispatchApiError (network) — retry.
  if (!('status' in (err as object))) return true;
  return false;
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

/** Presence / readyForJobs while trip journal still has pending work. */
export function presenceWhilePendingTripSync(args: {
  away: boolean;
  hasLocalTrip: boolean;
  pendingJournalWork: boolean;
}): 'Away' | 'Busy' | 'Available' {
  if (args.away) return 'Away';
  if (args.hasLocalTrip) return 'Busy';
  if (args.pendingJournalWork) return 'Busy';
  return 'Available';
}

/** Auto-dispatch / offer popup should wait until pending sync clears. */
export function shouldBlockOffersForPendingTripSync(pendingJournalWork: boolean): boolean {
  return !!pendingJournalWork;
}
