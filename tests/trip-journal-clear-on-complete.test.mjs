/**
 * After online complete, leftover journal stages for that job must clear Syncing/Busy.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hasPendingTripJournalWorkFromRows } from '../lib/tripJournalFlushPolicy.ts';

/** Pure mirror of markTripJournalSyncedForCompletedTrip matching rules. */
function journalMatchesCompletedTrip(row, jobId, clientTripId) {
  const idMatch = !!jobId && String(row.serverJobId || '').trim() === jobId;
  const keyMatch = !!clientTripId && row.clientTripId === clientTripId;
  const payloadMatch =
    !!jobId &&
    row.events.some((e) => {
      const p = e.payload || {};
      return String(p.jobId || p.bookingId || '') === jobId;
    });
  return idMatch || keyMatch || payloadMatch;
}

function markEventsSynced(row) {
  return {
    ...row,
    syncState: 'synced',
    events: row.events.map((e) => ({ ...e, synced: true })),
  };
}

test('marking completed trip journal synced clears pending stage/terminal counts', () => {
  const jobId = '86926080519';
  let rows = [
    {
      clientTripId: 'ct-1',
      serverJobId: jobId,
      syncState: 'pending',
      events: [
        { type: 'Arrived', synced: false, payload: { jobId } },
        { type: 'OnBoard', synced: false, payload: { jobId } },
      ],
    },
    {
      clientTripId: 'ct-other',
      serverJobId: '999',
      syncState: 'pending',
      events: [{ type: 'Arrived', synced: false, payload: { jobId: '999' } }],
    },
  ];

  assert.equal(
    hasPendingTripJournalWorkFromRows({
      pendingHailCreates: 0,
      pendingStages: 2,
      pendingTerminalsWithServerId: 0,
      orphanTerminalJournals: 0,
      failedHailStillPending: 0,
    }),
    true,
  );

  rows = rows.map((row) =>
    journalMatchesCompletedTrip(row, jobId, 'ct-1') ? markEventsSynced(row) : row,
  );

  const pendingStages = rows.filter((r) =>
    r.events.some((e) => (e.type === 'Arrived' || e.type === 'OnBoard') && e.synced !== true),
  ).length;

  assert.equal(pendingStages, 1, 'other job stages remain');
  assert.equal(rows[0].events.every((e) => e.synced === true), true);
  assert.equal(
    hasPendingTripJournalWorkFromRows({
      pendingHailCreates: 0,
      pendingStages,
      pendingTerminalsWithServerId: 0,
      orphanTerminalJournals: 0,
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
      failedHailStillPending: 0,
    }),
    false,
  );
});

test('hydrate must not revive stored Syncing banner when journal is clear', () => {
  // Document the policy: resolvePendingSyncBanner() alone — no ?? storedBanner.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(src, /Only show Syncing when journal work is still pending/);
  assert.equal(/\?\?\s*storedBanner/.test(src), false);
  assert.match(src, /markTripJournalSyncedForCompletedTrip/);
});
