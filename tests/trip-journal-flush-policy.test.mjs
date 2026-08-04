/**
 * Bug #2 — multi offline completes + premature auto-dispatch while journal pending.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRetryableStageFlushError,
  isRetryableTerminalFlushError,
  journalHasUnsyncedStages,
  localStageHintFromJournalEvents,
  presenceWhilePendingTripSync,
  shouldBlockOffersForPendingTripSync,
} from '../lib/tripJournalFlushPolicy.ts';

test('journalHasUnsyncedStages blocks terminal until Arrived/OnBoard clear', () => {
  assert.equal(
    journalHasUnsyncedStages([
      { type: 'Arrived', synced: false },
      { type: 'Completed', synced: false },
    ]),
    true,
  );
  assert.equal(
    journalHasUnsyncedStages([
      { type: 'Arrived', synced: true },
      { type: 'OnBoard', synced: true },
      { type: 'Completed', synced: false },
    ]),
    false,
  );
});

test('localStageHintFromJournalEvents prefers onboard when Completed present', () => {
  assert.equal(
    localStageHintFromJournalEvents([
      { type: 'Arrived' },
      { type: 'OnBoard' },
      { type: 'Completed' },
    ]),
    'onboard',
  );
  assert.equal(localStageHintFromJournalEvents([{ type: 'Arrived' }]), 'arrived');
  assert.equal(localStageHintFromJournalEvents([]), 'pickup');
});

test('Completed invalid_transition is retryable (must not drop terminal)', () => {
  assert.equal(
    isRetryableTerminalFlushError({ status: 409, errorCode: 'invalid_transition' }),
    true,
  );
  assert.equal(
    isRetryableTerminalFlushError({ status: 409, errorCode: 'version_conflict' }),
    true,
  );
  assert.equal(
    isRetryableTerminalFlushError({ status: 400, errorCode: 'bad_request' }),
    false,
  );
  assert.equal(isRetryableTerminalFlushError(new Error('Network request failed')), true);
});

test('stage invalid_transition may drop (Arrived when already Active)', () => {
  assert.equal(
    isRetryableStageFlushError({ status: 409, errorCode: 'invalid_transition' }),
    false,
  );
  assert.equal(
    isRetryableStageFlushError({ status: 503, errorCode: '' }),
    true,
  );
});

test('pending journal keeps presence Busy and blocks auto-dispatch offers', () => {
  assert.equal(
    presenceWhilePendingTripSync({
      away: false,
      hasLocalTrip: false,
      pendingJournalWork: true,
    }),
    'Busy',
  );
  assert.equal(
    presenceWhilePendingTripSync({
      away: false,
      hasLocalTrip: false,
      pendingJournalWork: false,
    }),
    'Available',
  );
  assert.equal(shouldBlockOffersForPendingTripSync(true), true);
  assert.equal(shouldBlockOffersForPendingTripSync(false), false);
});

test('two offline completes: each journal stages must clear before its terminal', () => {
  // Simulate dispatch + hail journals independently.
  const dispatch = [
    { type: 'Arrived', synced: true },
    { type: 'OnBoard', synced: true },
    { type: 'Completed', synced: false },
  ];
  const hail = [
    { type: 'OnBoard', synced: false },
    { type: 'Completed', synced: false },
  ];
  assert.equal(journalHasUnsyncedStages(dispatch), false, 'dispatch ready for Completed');
  assert.equal(journalHasUnsyncedStages(hail), true, 'hail must wait for OnBoard');
  // After hail OnBoard syncs:
  hail[0].synced = true;
  assert.equal(journalHasUnsyncedStages(hail), false);
});
