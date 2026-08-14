/**
 * Offline TM config + confirm-time timestamp preservation through sync.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isTmConfigReadyForConfirm,
  parseTmConfigRecord,
  tmConfigConfirmBlockReason,
} from '../lib/tmConfigLogic.ts';
import { withTimeout } from '../lib/asyncTimeout.ts';
import {
  closedJobFieldsForJournal,
  resolveClosedJobCompletedAtMs,
  stepTimesToClosedMirrors,
} from '../lib/closedJobSync.ts';
import { buildTmTripStatusSeed } from '../lib/tmPaymentPersist.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function neverResolves() {
  return new Promise(() => {});
}

test('withTimeout rejects hanging Firebase-style get (tmConfig class)', async () => {
  await assert.rejects(
    () => withTimeout(neverResolves(), 80, 'loadTmConfig'),
    /loadTmConfig timed out/,
  );
});

test('tmConfig.ts is cache-first with hard fetch timeout', () => {
  const src = readFileSync(join(root, 'lib/tmConfig.ts'), 'utf8');
  assert.match(src, /TM_CONFIG_FETCH_TIMEOUT_MS/);
  assert.match(src, /withTimeout/);
  assert.match(src, /loadCachedTmConfig/);
  assert.match(src, /using cache/);
  // Cache read before network get
  const cacheIdx = src.indexOf('loadCachedTmConfig(companyId)');
  const getIdx = src.indexOf('get(ref(');
  assert.ok(cacheIdx > 0 && getIdx > cacheIdx, 'cache must load before Firebase get');
});

test('PaymentModal hydrates cached TM config before network settle', () => {
  const src = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
  assert.match(src, /loadCachedTmConfig/);
  assert.match(src, /isTmConfigReadyForConfirm\(cached\)/);
  assert.match(src, /Cache-first/);
});

test('valid cached config unblocks confirm; 0% still blocks', () => {
  const ready = parseTmConfigRecord({ councilSubsidyPercent: 65, councilCapAmount: 40 });
  assert.equal(isTmConfigReadyForConfirm(ready), true);
  assert.equal(tmConfigConfirmBlockReason(ready), null);
  assert.equal(tmConfigConfirmBlockReason(ready, { loading: false }), null);
  assert.match(String(tmConfigConfirmBlockReason(null, { loading: true })), /still loading/i);
  const zero = parseTmConfigRecord({ councilSubsidyPercent: 0 });
  assert.equal(isTmConfigReadyForConfirm(zero), false);
  assert.match(String(tmConfigConfirmBlockReason(zero)), /subsidy percent/i);
});

test('closedJobFieldsForJournal includes JobCompleteTime from stepTimes', () => {
  const confirmAt = 1_700_000_000_000;
  const fields = closedJobFieldsForJournal({
    id: '1',
    pickup: 'A',
    dropoff: 'B',
    stepTimes: { completeAt: confirmAt, onboardAt: confirmAt - 600_000 },
  });
  assert.equal(fields.JobCompleteTime, new Date(confirmAt).toISOString());
  const mirrors = stepTimesToClosedMirrors({ completeAt: confirmAt });
  assert.equal(mirrors.JobCompleteTime, new Date(confirmAt).toISOString());
});

test('resolveClosedJobCompletedAtMs prefers confirm/stepTimes over flush clock', () => {
  const confirmAt = 1_700_000_111_000;
  assert.equal(
    resolveClosedJobCompletedAtMs(
      { id: '1', pickup: 'A', dropoff: 'B', stepTimes: { completeAt: confirmAt } },
      undefined,
    ),
    confirmAt,
  );
  assert.equal(
    resolveClosedJobCompletedAtMs(
      { id: '1', pickup: 'A', dropoff: 'B', stepTimes: { completeAt: confirmAt - 50_000 } },
      confirmAt,
    ),
    confirmAt,
  );
});

test('writeClosedJob skips closedJobs push when completedJobs exists (source gate)', () => {
  const src = readFileSync(join(root, 'lib/closedJobs.ts'), 'utf8');
  assert.match(src, /alreadyHasCompleted/);
  assert.match(src, /skip closedJobs push/i);
  assert.match(src, /resolveClosedJobCompletedAtMs/);
  assert.match(src, /completedAtMs/);
});

test('pendingClosedJob passes confirm-time completedAt into writeClosedJob', () => {
  const src = readFileSync(join(root, 'lib/pendingClosedJob.ts'), 'utf8');
  assert.match(src, /completedAtMs:\s*row\.completedAt/);
});

test('tripJournalFlush forwards JobCompleteTime mirrors on complete', () => {
  const src = readFileSync(join(root, 'lib/tripJournalFlush.ts'), 'utf8');
  assert.match(src, /stepTimesToClosedMirrors/);
  assert.match(src, /JobCompleteTime/);
});

test('buildTmTripStatusSeed can pin submittedAt to trip complete time', () => {
  const seed = buildTmTripStatusSeed(
    '860869',
    'cncl_test',
    {
      meterFare: 40,
      councilPays: 26,
      passengerPays: 14,
      totalFare: 40,
      tmCardNumber: '123',
      hoistTotal: 0,
      hoistCount: 0,
    },
    { submittedAt: 1_700_000_000_000 },
  );
  assert.equal(seed.submittedAt, 1_700_000_000_000);
});
