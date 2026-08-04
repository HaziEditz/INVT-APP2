/**
 * Weak-signal / hanging-HTTP simulations — NetInfo may still say "connected".
 * Mirrors the End Shift hang tests: never-resolving remotes must journal, not block UI.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withTimeout } from '../lib/asyncTimeout.ts';
import {
  AUTH_TOKEN_REFRESH_TIMEOUT_MS,
  COMPLETE_ENRICH_TIMEOUT_MS,
  COMPLETE_HTTP_MAX_ATTEMPTS,
  COMPLETE_HTTP_TIMEOUT_MS,
  HAIL_CREATE_TIMEOUT_MS,
  STAGE_HTTP_MAX_ATTEMPTS,
  STAGE_HTTP_TIMEOUT_MS,
  STAGE_VERIFY_TIMEOUT_MS,
  isTransportLikeError,
  runOnlineCompleteWithJournalFallback,
  runOnlineHailCreateWithJournalFallback,
  runOnlineStageWithJournalFallback,
} from '../lib/weakSignalPolicy.ts';

function neverResolves() {
  return new Promise(() => {});
}

function transportTimeout(ms = 100) {
  const err = new Error(`Request timed out after ${ms}ms`);
  err.name = 'StageTransportError';
  return err;
}

test('P0 budgets are short (not the old 45s×retry walls)', () => {
  assert.ok(STAGE_HTTP_TIMEOUT_MS <= 12_000);
  assert.ok(COMPLETE_HTTP_TIMEOUT_MS <= 15_000);
  assert.ok(HAIL_CREATE_TIMEOUT_MS <= 10_000);
  assert.ok(AUTH_TOKEN_REFRESH_TIMEOUT_MS <= 5_000);
  assert.ok(COMPLETE_ENRICH_TIMEOUT_MS <= 5_000);
  assert.ok(STAGE_VERIFY_TIMEOUT_MS <= 5_000);
  assert.equal(STAGE_HTTP_MAX_ATTEMPTS, 1);
  assert.equal(COMPLETE_HTTP_MAX_ATTEMPTS, 1);
});

test('isTransportLikeError detects StageTransportError and timeout messages', () => {
  assert.equal(isTransportLikeError(transportTimeout()), true);
  assert.equal(isTransportLikeError(new Error('Network request failed')), true);
  assert.equal(isTransportLikeError(new Error('getIdToken(true) timed out after 3000ms')), true);
  assert.equal(isTransportLikeError(new Error('invalid_transition')), false);
});

test('Arrived/OnBoard: hanging sync journals and returns without waiting forever', async () => {
  let journaled = false;
  const started = Date.now();
  const outcome = await runOnlineStageWithJournalFallback({
    syncStage: async () => {
      await withTimeout(neverResolves(), 120, 'syncJobStage');
    },
    journalStage: async () => {
      journaled = true;
    },
    verifyFirebase: async () => {
      assert.fail('verify must not run for transport timeout');
      return false;
    },
  });
  assert.equal(outcome, 'journal_fallback');
  assert.equal(journaled, true);
  assert.ok(Date.now() - started < 800);
});

test('Arrived/OnBoard: successful sync does not journal', async () => {
  let journaled = false;
  const outcome = await runOnlineStageWithJournalFallback({
    syncStage: async () => {},
    journalStage: async () => {
      journaled = true;
    },
  });
  assert.equal(outcome, 'synced');
  assert.equal(journaled, false);
});

test('Arrived/OnBoard: non-transport error uses short verify then journals if unverified', async () => {
  let journaled = false;
  let verified = false;
  const outcome = await runOnlineStageWithJournalFallback({
    syncStage: async () => {
      throw new Error('version_conflict');
    },
    journalStage: async () => {
      journaled = true;
    },
    verifyFirebase: async () => {
      verified = true;
      return false;
    },
  });
  assert.equal(verified, true);
  assert.equal(outcome, 'journal_fallback');
  assert.equal(journaled, true);
});

test('Complete: first transport fail journals (no long retry wall)', async () => {
  let completeCalls = 0;
  let journaled = false;
  const started = Date.now();
  const outcome = await runOnlineCompleteWithJournalFallback({
    completePayment: async () => {
      completeCalls += 1;
      throw transportTimeout(COMPLETE_HTTP_TIMEOUT_MS);
    },
    journalComplete: async () => {
      journaled = true;
    },
  });
  assert.equal(outcome, 'journal_fallback');
  assert.equal(completeCalls, 1);
  assert.equal(journaled, true);
  assert.ok(Date.now() - started < 500);
});

test('Complete: hanging enrich is skipped via withTimeout race', async () => {
  let closed = { pickup: '', dropoff: '' };
  const started = Date.now();
  try {
    await withTimeout(
      (async () => {
        await neverResolves();
        closed = { pickup: 'A', dropoff: 'B' };
      })(),
      100,
      'completeAddressEnrich',
    );
  } catch {
    // expected
  }
  assert.equal(closed.pickup, '');
  assert.ok(Date.now() - started < 400);
});

test('Complete: online success clears without journal', async () => {
  let journaled = false;
  const outcome = await runOnlineCompleteWithJournalFallback({
    completePayment: async () => {},
    journalComplete: async () => {
      journaled = true;
    },
  });
  assert.equal(outcome, 'completed');
  assert.equal(journaled, false);
});

test('Hail create: hanging create journals pending hail and continues', async () => {
  let journaled = false;
  const started = Date.now();
  const outcome = await runOnlineHailCreateWithJournalFallback({
    createHail: async () => {
      await withTimeout(neverResolves(), 100, 'createHailJobOnDispatch');
      return { jobId: '1' };
    },
    createPendingJournal: async () => {
      journaled = true;
    },
  });
  assert.equal(outcome.mode, 'journal_fallback');
  assert.equal(journaled, true);
  assert.ok(Date.now() - started < 500);
});

test('Hail create: success returns online mode', async () => {
  const outcome = await runOnlineHailCreateWithJournalFallback({
    createHail: async () => ({ jobId: '8692606166', updateSeq: 1 }),
    createPendingJournal: async () => {
      assert.fail('must not journal on success');
    },
  });
  assert.equal(outcome.mode, 'online');
  assert.equal(outcome.result.jobId, '8692606166');
});

test('getIdToken hang falls back via withTimeout (auth path simulation)', async () => {
  const started = Date.now();
  let usedCached = false;
  try {
    await withTimeout(neverResolves(), 80, 'getIdToken(true)');
  } catch {
    usedCached = true;
    const token = await withTimeout(Promise.resolve('cached-token'), 80, 'getIdToken(cached)');
    assert.equal(token, 'cached-token');
  }
  assert.equal(usedCached, true);
  assert.ok(Date.now() - started < 400);
});
