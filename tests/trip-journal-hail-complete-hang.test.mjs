/**
 * Hang-simulation for hail Complete spine:
 * - reverse-geocode never resolves → Complete still proceeds with placeholder
 * - orphan Completed / failed hail create count as pending work
 * - Completed never dropped on ambiguous failures
 * - expired deferred offers purged (no miss→Away)
 * - same-pass Complete after hail bind
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withTimeout } from '../lib/asyncTimeout.ts';
import {
  needsHailAddressResolve,
  resolveReadableAddress,
} from '../lib/hailAddressResolve.ts';
import {
  GEOCODE_TIMEOUT_MS,
  hasPendingTripJournalWorkFromRows,
  journalHasOrphanTerminals,
  journalIsFailedHailStillPending,
  shouldDropTerminalOnFlushError,
  shouldPurgeExpiredDeferredOffer,
  shouldSuppressMissAway,
} from '../lib/tripJournalFlushPolicy.ts';

function neverResolves() {
  return new Promise(() => {});
}

/**
 * Mirrors flushTerminalEvent Completed geocode + completeJobPayment ordering.
 * Geocode hang must not block Complete.
 */
async function flushCompletedWithGeocodeBudget(deps) {
  let finalDropAddress = deps.dropAddress;
  const started = Date.now();
  if (
    finalDropAddress &&
    needsHailAddressResolve(finalDropAddress) &&
    deps.dropLat != null &&
    deps.dropLng != null
  ) {
    finalDropAddress = await resolveReadableAddress(
      { address: finalDropAddress, lat: deps.dropLat, lng: deps.dropLng },
      deps.reverseGeocode,
      { timeoutMs: deps.timeoutMs ?? 100 },
    );
  }
  await deps.completePayment({ finalDropAddress });
  return { finalDropAddress, elapsedMs: Date.now() - started };
}

/**
 * Mirrors flushTripJournal pass order after a successful hail create bind.
 */
function flushPassSequence(args) {
  const steps = [];
  for (const hail of args.pendingHailCreates) {
    steps.push({ phase: 'hailCreate', clientTripId: hail.clientTripId });
    if (hail.bindServerJobId) {
      steps.push({
        phase: 'boundTerminalSamePass',
        clientTripId: hail.clientTripId,
        serverJobId: hail.bindServerJobId,
      });
    }
  }
  for (const stage of args.pendingStages) {
    steps.push({ phase: 'stage', clientTripId: stage.clientTripId });
  }
  for (const term of args.pendingTerminals) {
    if (args.justBoundIds?.has(term.clientTripId)) continue;
    steps.push({ phase: 'terminal', clientTripId: term.clientTripId });
  }
  return steps;
}

test('hanging reverse-geocode does not block Completed flush (placeholder kept)', async () => {
  let completedPayload = null;
  const result = await flushCompletedWithGeocodeBudget({
    dropAddress: '-36.84846, 174.76333',
    dropLat: -36.84846,
    dropLng: 174.76333,
    timeoutMs: 80,
    reverseGeocode: () => neverResolves(),
    completePayment: async (payload) => {
      completedPayload = payload;
    },
  });
  assert.ok(completedPayload, 'Complete must run');
  assert.equal(completedPayload.finalDropAddress, '-36.84846, 174.76333');
  assert.ok(result.elapsedMs < 500, `must not hang; elapsed=${result.elapsedMs}`);
});

test('endHail-style geocode withTimeout keeps placeholder under hang', async () => {
  const placeholder = '-36.84, 174.76';
  const started = Date.now();
  const dropoffAddress = await withTimeout(
    neverResolves(),
    80,
    'endHail.reverseGeocode.drop',
  ).catch(() => placeholder);
  assert.equal(dropoffAddress, placeholder);
  assert.ok(Date.now() - started < 400);
});

test('GEOCODE_TIMEOUT_MS is a hard short budget (not multi-minute)', () => {
  assert.ok(GEOCODE_TIMEOUT_MS > 0);
  assert.ok(GEOCODE_TIMEOUT_MS <= 5_000);
});

test('orphan Completed + failed hail create count as pending work', () => {
  assert.equal(
    journalHasOrphanTerminals({
      serverJobId: null,
      events: [{ type: 'Completed', synced: false }],
    }),
    true,
  );
  assert.equal(
    journalHasOrphanTerminals({
      serverJobId: '8692606166',
      events: [{ type: 'Completed', synced: false }],
    }),
    false,
  );
  assert.equal(
    journalIsFailedHailStillPending({
      source: 'hail',
      syncState: 'failed',
      hailCreate: { tariffId: '1' },
      serverJobId: null,
      events: [{ type: 'Completed', synced: false }],
    }),
    true,
  );
  assert.equal(
    hasPendingTripJournalWorkFromRows({
      pendingHailCreates: 0,
      pendingStages: 0,
      pendingTerminalsWithServerId: 0,
      orphanTerminalJournals: 1,
      failedHailStillPending: 0,
    }),
    true,
  );
  assert.equal(
    hasPendingTripJournalWorkFromRows({
      pendingHailCreates: 0,
      pendingStages: 0,
      pendingTerminalsWithServerId: 0,
      orphanTerminalJournals: 0,
      failedHailStillPending: 1,
    }),
    true,
  );
  assert.equal(
    hasPendingTripJournalWorkFromRows({
      pendingHailCreates: 0,
      pendingStages: 0,
      pendingTerminalsWithServerId: 0,
      orphanTerminalJournals: 0,
      failedHailStillPending: 0,
    }),
    false,
  );
});

test('Completed never dropped on ambiguous / permanent-looking failures', () => {
  assert.equal(
    shouldDropTerminalOnFlushError('Completed', { status: 400, errorCode: 'bad_request' }),
    false,
  );
  assert.equal(
    shouldDropTerminalOnFlushError('Completed', { status: 404, errorCode: 'not_found' }),
    false,
  );
  assert.equal(
    shouldDropTerminalOnFlushError('Completed', { status: 409, errorCode: 'invalid_transition' }),
    false,
  );
  assert.equal(
    shouldDropTerminalOnFlushError('Completed', new Error('Network request failed')),
    false,
  );
  // Non-Completed may still drop true permanent client errors if ever classified that way.
  assert.equal(
    shouldDropTerminalOnFlushError('Cancelled', { status: 403, errorCode: 'forbidden' }),
    true,
  );
});

test('same flush pass attempts Completed immediately after hail create binds', () => {
  const steps = flushPassSequence({
    pendingHailCreates: [{ clientTripId: 'ct_hail_1', bindServerJobId: '8692606166' }],
    pendingStages: [{ clientTripId: 'job:111' }],
    pendingTerminals: [
      { clientTripId: 'ct_hail_1' },
      { clientTripId: 'job:222' },
    ],
    justBoundIds: new Set(['ct_hail_1']),
  });
  assert.deepEqual(
    steps.map((s) => s.phase),
    ['hailCreate', 'boundTerminalSamePass', 'stage', 'terminal'],
  );
  assert.equal(steps[1].serverJobId, '8692606166');
  assert.equal(steps[3].clientTripId, 'job:222');
});

test('suppress miss→Away while pending trip sync; purge expired deferred offers', () => {
  assert.equal(shouldSuppressMissAway(true), true);
  assert.equal(shouldSuppressMissAway(false), false);
  const now = 1_700_000_000_000;
  assert.equal(shouldPurgeExpiredDeferredOffer(now - 1, now), true);
  assert.equal(shouldPurgeExpiredDeferredOffer(now + 30_000, now), false);
  assert.equal(shouldPurgeExpiredDeferredOffer(undefined, now), false);
});
