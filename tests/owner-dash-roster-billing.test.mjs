/**
 * Owner dashboard: roster dedupe + billing overdue display consistency.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(root, '..', 'INVT-admin', 'server.js'), 'utf8');

test('dashboard Drivers (Roster) uses identity dedupe not shallow key count', () => {
  assert.match(admin, /function _driverRosterCount/);
  assert.match(admin, /drivers:\s*_driverRosterCount\(cid\)/);
  assert.doesNotMatch(admin, /drivers:\s*_shallowCount\('drivers\/' \+ cid\)/);
});

test('billing widget derives overdue when nextDueDate is past and status still active', () => {
  assert.match(admin, /status = 'overdue'/);
  assert.match(admin, /Past nextDueDate with status still "active"/);
  assert.match(admin, /d overdue/);
});

test('Your Next Bill tile also flips plan status to overdue when date past', () => {
  assert.match(admin, /if \(overdue && \(st === 'active'/);
});

test('owner submit requires councilId (no orphan tmTripStatus)', () => {
  assert.match(admin, /Cannot submit to council — this trip has no councilId/);
  assert.match(admin, /councilId: String\(councilId\)\.trim\(\)/);
});

test('isOwnerTmCompletedJob ignores bare tmSubsidyFare:0', () => {
  // Both page copies (history + usage) must require > 0 for tmSubsidyFare alone.
  const matches = admin.match(/tmSubsidyFare != null && Number\(j\.tmSubsidyFare\) > 0/g) || [];
  assert.ok(matches.length >= 2, 'expected both isOwnerTmCompletedJob copies updated, got ' + matches.length);
});
