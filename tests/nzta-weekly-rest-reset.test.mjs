/**
 * 24h continuous rest must clear the weekly 70h counter (not only lockoutUntil).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCompletedWeeklyRest,
  healStaleNztaState,
  isPhantomWeeklyLockoutEnd,
} from '../lib/nztaShiftWindow.ts';

const MS_HOUR = 3600_000;

function baseState(over = {}) {
  return {
    shiftStartedAt: null,
    shiftWindowEndsAt: null,
    sessionStartedAt: null,
    workedMinutes: 0,
    weeklyWorkedMinutes: 70 * 60,
    weekStartedAt: 1_700_000_000_000,
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
    ...over,
  };
}

test('applyCompletedWeeklyRest: clears weekly minutes after 24h rest', () => {
  const now = 1_700_000_000_000;
  const next = applyCompletedWeeklyRest(
    baseState({
      lastShiftEndAt: now - 25 * MS_HOUR,
      lastWorkedMinutes: 120,
      lockoutUntil: now - MS_HOUR,
      lockoutReason: 'weekly_rest',
      weekStartedAt: now - 3 * 24 * MS_HOUR,
    }),
    now,
  );
  assert.equal(next.weeklyWorkedMinutes, 0);
  assert.equal(next.lockoutUntil, null);
  assert.equal(next.lockoutReason, null);
});

test('applyCompletedWeeklyRest: keeps weekly minutes if rest < 24h', () => {
  const now = 1_700_000_000_000;
  const next = applyCompletedWeeklyRest(
    baseState({
      lastShiftEndAt: now - 10 * MS_HOUR,
      lastWorkedMinutes: 120,
      lockoutUntil: now + 14 * MS_HOUR,
      lockoutReason: 'weekly_rest',
    }),
    now,
  );
  assert.equal(next.weeklyWorkedMinutes, 70 * 60);
  assert.ok(next.lockoutUntil && next.lockoutUntil > now);
});

test('healStaleNztaState applies weekly rest reset', () => {
  const now = 1_700_000_000_000;
  const healed = healStaleNztaState(
    baseState({
      weeklyWorkedMinutes: 4200,
      lastShiftEndAt: now - 30 * MS_HOUR,
      lastWorkedMinutes: 0,
      pendingLimitSignOut: 'weekly70h',
    }),
    now,
  );
  assert.equal(healed.weeklyWorkedMinutes, 0);
  assert.equal(healed.pendingLimitSignOut, null);
});

test('isPhantomWeeklyLockoutEnd: zero-work weekly70h end', () => {
  assert.equal(
    isPhantomWeeklyLockoutEnd({
      workedMinutes: 0,
      shiftStartAt: null,
      weeklyWorkedMinutes: 4235,
    }),
    true,
  );
  assert.equal(
    isPhantomWeeklyLockoutEnd({
      workedMinutes: 156,
      shiftStartAt: 1,
      weeklyWorkedMinutes: 4235,
    }),
    false,
  );
});

test('D001 phantom loop: fresh lastShiftEndAt does not defeat genuine 7-day rest', () => {
  // Live evidence: latest phantom end ~minutes ago; genuine end ~172h ago.
  const now = Date.parse('2026-08-30T13:07:47.271Z');
  const phantomEnd = Date.parse('2026-08-30T12:59:20.352Z');
  const genuineEnd = Date.parse('2026-08-23T08:44:15.084Z');
  const state = baseState({
    weeklyWorkedMinutes: 4235,
    lastShiftEndAt: phantomEnd,
    lastWorkedMinutes: 0,
    lastShiftStartAt: null,
    lockoutUntil: phantomEnd + 24 * MS_HOUR, // refreshed by phantom write
    lockoutReason: 'weekly_rest',
  });

  // Old ad2d0fa behavior (no genuine): still blocked because phantom end is fresh.
  const withoutGenuine = applyCompletedWeeklyRest(state, now);
  assert.equal(withoutGenuine.weeklyWorkedMinutes, 4235, 'phantom end alone must not clear');

  // Fix: pass genuine end → clear despite fresh phantom + active lockout.
  const withGenuine = applyCompletedWeeklyRest(state, now, {
    lastGenuineShiftEndAt: genuineEnd,
  });
  assert.equal(withGenuine.weeklyWorkedMinutes, 0);
  assert.equal(withGenuine.lockoutUntil, null);
  assert.equal(withGenuine.lockoutReason, null);
  assert.equal(withGenuine.pendingLimitSignOut, null);
});

test('expired weekly_rest lockout clears even if phantom refreshed lastShiftEndAt', () => {
  const now = 1_700_000_000_000;
  const next = applyCompletedWeeklyRest(
    baseState({
      weeklyWorkedMinutes: 4235,
      lastShiftEndAt: now - MS_HOUR, // phantom stamp during lockout
      lastWorkedMinutes: 0,
      lockoutUntil: now - 1000,
      lockoutReason: 'weekly_rest',
    }),
    now,
  );
  assert.equal(next.weeklyWorkedMinutes, 0);
  assert.equal(next.lockoutUntil, null);
});

test('phantom-only at weekly limit with no lockout clears', () => {
  const now = 1_700_000_000_000;
  const next = applyCompletedWeeklyRest(
    baseState({
      weeklyWorkedMinutes: 4235,
      lastShiftEndAt: now - MS_HOUR,
      lastWorkedMinutes: 0,
      lastShiftStartAt: null,
      lockoutUntil: null,
      lockoutReason: null,
    }),
    now,
  );
  assert.equal(next.weeklyWorkedMinutes, 0);
});
