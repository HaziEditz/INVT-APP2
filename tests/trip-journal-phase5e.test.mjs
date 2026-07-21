import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchJournalKey,
  resolveJournalClientTripId,
} from '../lib/bookingId.ts';
import { choosePendingSyncBanner } from '../lib/pendingSyncBannerChoice.ts';

test('Phase 5e resolveJournalClientTripId prefers clientTripId', () => {
  assert.equal(
    resolveJournalClientTripId({ id: '86926061661', clientTripId: 'uuid-1' }),
    'uuid-1',
  );
});

test('Phase 5e resolveJournalClientTripId: local: and numeric dispatch', () => {
  assert.equal(
    resolveJournalClientTripId({ id: 'local:abc-def' }),
    'abc-def',
  );
  assert.equal(
    resolveJournalClientTripId({ id: '86926061661' }),
    dispatchJournalKey('86926061661'),
  );
  assert.equal(resolveJournalClientTripId({ id: 'hail_legacy' }), null);
  assert.equal(resolveJournalClientTripId({ id: '' }), null);
});

test('Phase 5e banner reason complete is allowed on PendingSyncBanner union', () => {
  const at = 1_700_000_000_000;
  // Journal pending (includes terminals) → Syncing…
  assert.deepEqual(choosePendingSyncBanner([], true, at), {
    message: 'Syncing…',
    reason: 'stages',
    at,
  });
  // Explicit complete banner shape used by DriverContext.applySyncingBanner
  assert.equal(
    choosePendingSyncBanner(['cancel'], false, at)?.reason,
    'cancel',
  );
});

test('Phase 5e journalable decision: dispatch + hail have keys; bare hail_ does not', () => {
  const journalable = (job) => resolveJournalClientTripId(job) != null;
  assert.equal(journalable({ id: '86926061661' }), true);
  assert.equal(journalable({ id: 'local:ct-1', clientTripId: 'ct-1' }), true);
  assert.equal(journalable({ id: 'x', clientTripId: 'ct-2' }), true);
  assert.equal(journalable({ id: 'hail_old' }), false);
});
