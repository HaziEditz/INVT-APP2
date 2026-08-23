/**
 * Client backup for Queued → Assigned after trip clear.
 * Server now auto-promotes on complete; this retries until adopt succeeds
 * or the queued job is gone (recalled / already promoted elsewhere).
 */

export const QUEUE_PROMOTE_RETRY_INITIAL_MS = 0;
export const QUEUE_PROMOTE_RETRY_INTERVAL_MS = 500;
export const QUEUE_PROMOTE_MAX_ATTEMPTS = 20;

export type QueuePromoteRetryGate = {
  shiftActive: boolean;
  hailActive: boolean;
  hasActiveJob: boolean;
  hasPaymentJob: boolean;
  readyForJobs: boolean;
  pendingTripSync: boolean;
};

export type QueuePromoteRetryDecision =
  | { action: 'stop'; reason: string }
  | { action: 'wait'; reason: string }
  | { action: 'promote'; reason: string }
  | { action: 'adopt_assigned'; reason: string; bookingId: string };

/** True when trip UI still blocks promote/adopt. */
export function queuePromoteBlockedByTrip(gate: QueuePromoteRetryGate): boolean {
  return !!(gate.hailActive || gate.hasActiveJob || gate.hasPaymentJob);
}

/**
 * When driverQueue clears because server auto-promoted to Assigned, always
 * remember the booking id — even if hail/payment is still active. Retry waits
 * for gates; forgetting the id is what left Current blank (#8236).
 */
export function shouldRememberAssignedQueueCandidate(opts: {
  allbookingsStatus: string;
}): boolean {
  const st = String(opts.allbookingsStatus || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  return st === 'assigned' || st === 'picking';
}

/**
 * Decide the next step for a queue-promote retry tick.
 * - wait: gates not clear yet (keep retrying)
 * - promote: local queued offer ready to POST promote-queued
 * - adopt_assigned: server already promoted; adopt by booking id
 * - stop: done or give up
 */
export function decideQueuePromoteRetryTick(opts: {
  attempt: number;
  maxAttempts?: number;
  gate: QueuePromoteRetryGate;
  localQueuedId: string | null;
  /** Server-reported Assigned job for this driver with no local activeJob. */
  assignedOrphanId?: string | null;
  /** Remembered id from queue-clear / complete.promotedQueuedBookingId. */
  knownCandidateId?: string | null;
  lastPromoteSucceeded?: boolean;
  lastAdoptSucceeded?: boolean;
  recalledOrGone?: boolean;
}): QueuePromoteRetryDecision {
  const maxAttempts = opts.maxAttempts ?? QUEUE_PROMOTE_MAX_ATTEMPTS;
  if (opts.lastAdoptSucceeded) {
    return { action: 'stop', reason: 'adopted' };
  }
  if (opts.recalledOrGone) {
    return { action: 'stop', reason: 'recalled_or_gone' };
  }
  if (!opts.gate.shiftActive) {
    return { action: 'stop', reason: 'shift_off' };
  }
  if (opts.attempt >= maxAttempts) {
    return { action: 'stop', reason: 'max_attempts' };
  }
  if (queuePromoteBlockedByTrip(opts.gate)) {
    return { action: 'wait', reason: 'trip_or_payment_active' };
  }
  // Do not stall on readyForJobs when we already know a queued/promoted job —
  // post-complete Busy presence used to force ready=false and show Away for ~10s.
  const hasQueueWork = !!(
    opts.localQueuedId ||
    opts.assignedOrphanId ||
    opts.knownCandidateId
  );
  if (!opts.gate.readyForJobs && !hasQueueWork) {
    return { action: 'wait', reason: 'not_ready_for_jobs' };
  }
  // Server already Assigned: adopt even while journal Syncing (no Available write needed).
  if (opts.assignedOrphanId) {
    return {
      action: 'adopt_assigned',
      reason: opts.gate.pendingTripSync
        ? 'server_already_assigned_during_sync'
        : 'server_already_assigned',
      bookingId: opts.assignedOrphanId,
    };
  }
  if (opts.gate.pendingTripSync) {
    return { action: 'wait', reason: 'pending_trip_sync' };
  }
  if (opts.localQueuedId) {
    return { action: 'promote', reason: 'local_queued' };
  }
  if (opts.lastPromoteSucceeded) {
    return { action: 'wait', reason: 'promote_ok_awaiting_adopt' };
  }
  // Known candidate (queue cleared mid-trip / complete response) — keep polling
  // for Assigned fanout until max attempts (do not stop at attempt 3).
  if (opts.knownCandidateId) {
    return { action: 'wait', reason: 'await_assigned_fanout_for_candidate' };
  }
  // Empty queue early in the window — server may still be promoting / fanout lag.
  if (opts.attempt < 3) {
    return { action: 'wait', reason: 'await_queue_or_assigned_fanout' };
  }
  return { action: 'stop', reason: 'no_queued_job' };
}

export function nextQueuePromoteDelayMs(attempt: number): number {
  return attempt <= 0 ? QUEUE_PROMOTE_RETRY_INITIAL_MS : QUEUE_PROMOTE_RETRY_INTERVAL_MS;
}

/** Prefer complete API promotedQueuedBookingId when present. */
export function pickPromotedQueuedBookingId(completeBody: Record<string, unknown> | null | undefined): string | null {
  if (!completeBody || typeof completeBody !== 'object') return null;
  const raw =
    completeBody.promotedQueuedBookingId ??
    completeBody.promotedQueuedJobId ??
    completeBody.promotedBookingId;
  const id = String(raw ?? '').trim();
  return /^\d+$/.test(id) ? id : null;
}
