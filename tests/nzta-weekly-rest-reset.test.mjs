/**
 * 24h continuous rest must clear the weekly 70h counter (not only lockoutUntil).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCompletedWeeklyRest, healStaleNztaState } from '../lib/nztaShiftWindow.ts';

const MS_HOUR = 3600_000;

test('applyCompletedWeeklyRest: clears weekly minutes after 24h rest', () => {
  const now = 1_700_000_000_000;
  const state = {
    shiftStartedAt: null,
    shiftWindowEndsAt: null,
    sessionStartedAt: null,
    workedMinutes: 0,
    weeklyWorkedMinutes: 70 * 60,
    weekStartedAt: now - 3 * 24 * MS_HOUR,
    breakMinutes: 0,
    lastBreakAt: null,
    breakReminderShown: false,
    breakDeferredUntil: null,
    lastShiftEndAt: now - 25 * MS_HOUR,
    lastShiftStartAt: null,
    lastWorkedMinutes: 120,
    continuedWindow: false,
    lockoutUntil: now - MS_HOUR, // expired
    lockoutReason: 'weekly_rest',
    pendingLimitSignOut: null,
  };
  const next = applyCompletedWeeklyRest(state, now);
  assert.equal(next.weeklyWorkedMinutes, 0);
  assert.equal(next.lockoutUntil, null);
  assert.equal(next.lockoutReason, null);
});

test('applyCompletedWeeklyRest: keeps weekly minutes if rest < 24h', () => {
  const now = 1_700_000_000_000;
  const state = {
    shiftStartedAt: null,
    shiftWindowEndsAt: null,
    sessionStartedAt: null,
    workedMinutes: 0,
    weeklyWorkedMinutes: 70 * 60,
    weekStartedAt: now,
    breakMinutes: 0,
    lastBreakAt: null,
    breakReminderShown: false,
    breakDeferredUntil: null,
    lastShiftEndAt: now - 10 * MS_HOUR,
    lastShiftStartAt: null,
    lastWorkedMinutes: 120,
    continuedWindow: false,
    lockoutUntil: now + 14 * MS_HOUR,
    lockoutReason: 'weekly_rest',
    pendingLimitSignOut: null,
  };
  const next = applyCompletedWeeklyRest(state, now);
  assert.equal(next.weeklyWorkedMinutes, 70 * 60);
  assert.ok(next.lockoutUntil && next.lockoutUntil > now);
});

test('healStaleNztaState applies weekly rest reset', () => {
  const now = 1_700_000_000_000;
  const healed = healStaleNztaState(
    {
      shiftStartedAt: null,
      shiftWindowEndsAt: null,
      sessionStartedAt: null,
      workedMinutes: 0,
      weeklyWorkedMinutes: 4200,
      weekStartedAt: now,
      breakMinutes: 0,
      lastBreakAt: null,
      breakReminderShown: false,
      breakDeferredUntil: null,
      lastShiftEndAt: now - 30 * MS_HOUR,
      lastShiftStartAt: null,
      lastWorkedMinutes: 0,
      continuedWindow: false,
      lockoutUntil: null,
      lockoutReason: null,
      pendingLimitSignOut: 'weekly70h',
    },
    now,
  );
  assert.equal(healed.weeklyWorkedMinutes, 0);
  assert.equal(healed.pendingLimitSignOut, null);
});
