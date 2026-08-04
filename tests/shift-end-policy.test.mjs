import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPendingShiftEnd,
  buildPendingShiftEndId,
  markPendingShiftEndSynced,
  pendingShiftEndStillOpen,
} from '../lib/shiftEndPolicy.ts';

test('buildPendingShiftEndId is stable per end time + driver', () => {
  assert.equal(buildPendingShiftEndId(1700000000000, 'D001'), 'shift-end:1700000000000:D001');
});

test('pending shift end tracks log and presence independently', () => {
  const row = buildPendingShiftEnd({
    companyId: '860869',
    uid: 'u1',
    driverId: 'D001',
    vehicleId: '201',
    reason: 'manual',
    shiftEndAt: 1700000000000,
    workedMinutes: 120,
    needsShiftLog: true,
    needsPresenceClear: true,
  });
  assert.equal(pendingShiftEndStillOpen(row), true);

  const afterLog = markPendingShiftEndSynced(row, { shiftLog: true });
  assert.ok(afterLog);
  assert.equal(afterLog.needsShiftLog, false);
  assert.equal(afterLog.needsPresenceClear, true);
  assert.equal(pendingShiftEndStillOpen(afterLog), true);

  const done = markPendingShiftEndSynced(afterLog, { presence: true });
  assert.equal(done, null);
});

test('offline end-shift journals when remote shift log write fails', () => {
  const row = buildPendingShiftEnd({
    companyId: '860869',
    uid: 'u1',
    driverId: 'D001',
    reason: 'manual',
    shiftEndAt: Date.now(),
    workedMinutes: 30,
    needsShiftLog: true,
    needsPresenceClear: false,
  });
  assert.equal(row.needsShiftLog, true);
  assert.equal(row.needsPresenceClear, false);
  assert.equal(pendingShiftEndStillOpen(row), true);
});

// Full Profile-button orchestration lives in tests/end-shift-remote-flow.test.mjs.
