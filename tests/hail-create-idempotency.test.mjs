/**
 * Hail journal flush: single-flight + stale creating lease.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('flushTripJournal is single-flight (source gate)', () => {
  const src = readFileSync(join(root, 'lib/tripJournalFlush.ts'), 'utf8');
  assert.match(src, /flushTripJournalInFlight/);
  assert.match(src, /if \(flushTripJournalInFlight\) return flushTripJournalInFlight/);
});

test('listPendingHailCreates skips fresh creating; retries only when stale', () => {
  const src = readFileSync(join(root, 'services/tripJournalService.ts'), 'utf8');
  assert.match(src, /HAIL_CREATING_STALE_MS/);
  assert.match(src, /syncState === 'creating'/);
  assert.match(src, /nowMs - updated >= HAIL_CREATING_STALE_MS/);
});

test('writeClosedJob uses deterministic closedJobs/job_{id} path', () => {
  const src = readFileSync(join(root, 'lib/closedJobs.ts'), 'utf8');
  assert.match(src, /closedJobs\/\$\{companyId\}\/job_\$\{job\.id\}/);
  assert.match(src, /closedJobsPushed/);
  assert.doesNotMatch(src, /push\(ref\(database,\s*`closedJobs/);
});
