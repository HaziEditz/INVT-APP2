/**
 * Regression: stale lastShiftStartAt must not wipe an active shift or poison End Shift logs.
 * Live evidence: shiftStartAt 10 Jul 2026 reused with shiftEndAt 11 Aug 2026, workedMinutes 0.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  healStaleNztaState,
  isShiftWindowExpired,
  resolveShiftStartAtForEndLog,
  sanitizeLastShiftStartAt,
  shiftWindowEndMs,
} from '../lib/nztaShiftWindow.ts';

const MS_HOUR = 3600000;
const JUL_10_2026_NZ = 1783651657831; // live poisoned shiftStartAt
const AUG_11_2026_EARLY = 1786366305066; // live shiftEndAt / loggedAt

function baseState(overrides = {}) {
  return {
    shiftStartedAt: null,
    shiftWindowEndsAt: null,
    workedMinutes: 0,
    weeklyWorkedMinutes: 0,
    weekStartedAt: null,
    breakMinutes: 0,
    lastBreakAt: null,
    breakReminderShown: false,
    breakDeferredUntil: null,
    lastShiftEndAt: null,
    lastShiftStartAt: null,
    lastWorkedMinutes: 0,
    continuedWindow: false,
    lockoutUntil: null,
    lockoutReason: null,
    pendingLimitSignOut: null,
    ...overrides,
  };
}

test('Jul 10 start is expired by Aug 11', () => {
  assert.equal(isShiftWindowExpired(JUL_10_2026_NZ, AUG_11_2026_EARLY), true);
});

test('healStaleNztaState must NOT clear a fresh shiftStartedAt when lastShiftStartAt is ancient', () => {
  const now = AUG_11_2026_EARLY;
  const freshStart = now - 2 * MS_HOUR; // started 2h ago
  const healed = healStaleNztaState(
    baseState({
      shiftStartedAt: freshStart,
      shiftWindowEndsAt: shiftWindowEndMs(freshStart),
      workedMinutes: 90,
      lastShiftStartAt: JUL_10_2026_NZ, // poison from prior end-logs
      lastShiftEndAt: now - 3 * MS_HOUR,
    }),
    now,
  );
  assert.equal(healed.shiftStartedAt, freshStart, 'active shift start must survive heal');
  assert.equal(healed.workedMinutes, 90);
  assert.equal(
    healed.lastShiftStartAt,
    freshStart,
    'expired lastShiftStartAt must be replaced by active start (or cleared)',
  );
});

test('OLD heal bug reproduction: preferring lastShiftStartAt as anchor wiped active shift', () => {
  // Document the previous incorrect anchor order (last ?? active) that caused the wipe.
  const now = AUG_11_2026_EARLY;
  const freshStart = now - 2 * MS_HOUR;
  const staleLast = JUL_10_2026_NZ;
  const oldBuggyAnchor = staleLast ?? freshStart;
  assert.equal(oldBuggyAnchor, staleLast);
  assert.equal(isShiftWindowExpired(oldBuggyAnchor, now), true);
  // New heal keeps freshStart
  const healed = healStaleNztaState(
    baseState({
      shiftStartedAt: freshStart,
      shiftWindowEndsAt: shiftWindowEndMs(freshStart),
      workedMinutes: 45,
      lastShiftStartAt: staleLast,
    }),
    now,
  );
  assert.notEqual(healed.shiftStartedAt, null);
});

test('resolveShiftStartAtForEndLog never falls back to lastShiftStartAt', () => {
  assert.equal(
    resolveShiftStartAtForEndLog(
      baseState({
        shiftStartedAt: null,
        lastShiftStartAt: JUL_10_2026_NZ,
      }),
    ),
    undefined,
  );
  const start = AUG_11_2026_EARLY - 90 * 60_000;
  assert.equal(
    resolveShiftStartAtForEndLog(
      baseState({
        shiftStartedAt: start,
        lastShiftStartAt: JUL_10_2026_NZ,
      }),
    ),
    start,
  );
});

test('sanitizeLastShiftStartAt drops expired Firebase last-log starts', () => {
  assert.equal(sanitizeLastShiftStartAt(JUL_10_2026_NZ, AUG_11_2026_EARLY), null);
  const recent = AUG_11_2026_EARLY - 3 * MS_HOUR;
  assert.equal(sanitizeLastShiftStartAt(recent, AUG_11_2026_EARLY), recent);
});

test('end-log payload shape for poisoned state (no active start) writes no fake start', () => {
  const state = healStaleNztaState(
    baseState({
      shiftStartedAt: null,
      workedMinutes: 0,
      lastShiftStartAt: JUL_10_2026_NZ,
    }),
    AUG_11_2026_EARLY,
  );
  const shiftStartAt = resolveShiftStartAtForEndLog(state);
  assert.equal(shiftStartAt, undefined);
  assert.equal(state.lastShiftStartAt, null);
});
