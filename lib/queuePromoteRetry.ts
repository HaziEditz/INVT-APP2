/**
 * Client backup for Queued → Assigned after trip clear.
 * Server now auto-promotes on complete; this retries until adopt succeeds
 * or the queued job is gone (recalled / already promoted elsewhere).
 */

export const QUEUE_PROMOTE_RETRY_INITIAL_MS = 600;
export const QUEUE_PROMOTE_RETRY_INTERVAL_MS = 2_000;
export const QUEUE_PROMOTE_MAX_ATTEMPTS = 15;

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
  if (!opts.gate.readyForJobs) {
    return { action: 'wait', reason: 'not_ready_for_jobs' };
  }
  if (opts.gate.pendingTripSync) {
    return { action: 'wait', reason: 'pending_trip_sync' };
  }
  if (opts.localQueuedId) {
    return { action: 'promote', reason: 'local_queued' };
  }
  if (opts.assignedOrphanId) {
    return {
      action: 'adopt_assigned',
      reason: 'server_already_assigned',
      bookingId: opts.assignedOrphanId,
    };
  }
  if (opts.lastPromoteSucceeded) {
    return { action: 'wait', reason: 'promote_ok_awaiting_adopt' };
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
