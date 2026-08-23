/**
 * Client queue-promote retry policy (backup when server auto-promote wins the race).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideQueuePromoteRetryTick,
  nextQueuePromoteDelayMs,
  pickPromotedQueuedBookingId,
  QUEUE_PROMOTE_MAX_ATTEMPTS,
  QUEUE_PROMOTE_RETRY_INITIAL_MS,
  QUEUE_PROMOTE_RETRY_INTERVAL_MS,
  queuePromoteBlockedByTrip,
  shouldRememberAssignedQueueCandidate,
} from '../lib/queuePromoteRetry.ts';

const idleGate = {
  shiftActive: true,
  hailActive: false,
  hasActiveJob: false,
  hasPaymentJob: false,
  readyForJobs: true,
  pendingTripSync: false,
};

test('trip/payment blocks promote until clear', () => {
  assert.equal(
    queuePromoteBlockedByTrip({ ...idleGate, hasPaymentJob: true }),
    true,
  );
  assert.equal(queuePromoteBlockedByTrip(idleGate), false);
});

test('retry waits while paymentJob/hail still active (does not silent no-op forever)', () => {
  const d = decideQueuePromoteRetryTick({
    attempt: 0,
    gate: { ...idleGate, hasPaymentJob: true },
    localQueuedId: '8692608207',
  });
  assert.equal(d.action, 'wait');
  assert.equal(d.reason, 'trip_or_payment_active');
});

test('remember Assigned candidate even when trip still active (#8236)', () => {
  assert.equal(
    shouldRememberAssignedQueueCandidate({ allbookingsStatus: 'Assigned' }),
    true,
  );
  assert.equal(
    shouldRememberAssignedQueueCandidate({ allbookingsStatus: 'Queued' }),
    false,
  );
});

test('known candidate keeps waiting past early empty-queue stop', () => {
  const d = decideQueuePromoteRetryTick({
    attempt: 5,
    gate: idleGate,
    localQueuedId: null,
    knownCandidateId: '8692608236',
  });
  assert.equal(d.action, 'wait');
  assert.equal(d.reason, 'await_assigned_fanout_for_candidate');
});

test('pickPromotedQueuedBookingId from complete body', () => {
  assert.equal(pickPromotedQueuedBookingId({ promotedQueuedBookingId: 8692608236 }), '8692608236');
  assert.equal(pickPromotedQueuedBookingId({ ok: true }), null);
});

test('retry promotes when local queued and gates clear', () => {
  const d = decideQueuePromoteRetryTick({
    attempt: 1,
    gate: idleGate,
    localQueuedId: '8692608207',
  });
  assert.equal(d.action, 'promote');
});

test('retry adopts when server already Assigned (queue node cleared)', () => {
  const d = decideQueuePromoteRetryTick({
    attempt: 2,
    gate: idleGate,
    localQueuedId: null,
    assignedOrphanId: '8692608207',
  });
  assert.equal(d.action, 'adopt_assigned');
  assert.equal(d.action === 'adopt_assigned' && d.bookingId, '8692608207');
});

test('retry stops at max attempts', () => {
  const d = decideQueuePromoteRetryTick({
    attempt: QUEUE_PROMOTE_MAX_ATTEMPTS,
    gate: idleGate,
    localQueuedId: '8692608207',
  });
  assert.equal(d.action, 'stop');
  assert.equal(d.reason, 'max_attempts');
});

test('retry stops when recalled', () => {
  const d = decideQueuePromoteRetryTick({
    attempt: 1,
    gate: idleGate,
    localQueuedId: null,
    recalledOrGone: true,
  });
  assert.equal(d.action, 'stop');
  assert.equal(d.reason, 'recalled_or_gone');
});

test('early empty queue waits for fanout; later stops', () => {
  assert.equal(
    decideQueuePromoteRetryTick({
      attempt: 0,
      gate: idleGate,
      localQueuedId: null,
    }).action,
    'wait',
  );
  assert.equal(
    decideQueuePromoteRetryTick({
      attempt: 5,
      gate: idleGate,
      localQueuedId: null,
    }).action,
    'stop',
  );
});

test('delay cadence: first 600ms then 2s', () => {
  assert.equal(nextQueuePromoteDelayMs(0), QUEUE_PROMOTE_RETRY_INITIAL_MS);
  assert.equal(nextQueuePromoteDelayMs(1), QUEUE_PROMOTE_RETRY_INTERVAL_MS);
  assert.equal(QUEUE_PROMOTE_RETRY_INITIAL_MS, 600);
  assert.equal(QUEUE_PROMOTE_RETRY_INTERVAL_MS, 2_000);
});
