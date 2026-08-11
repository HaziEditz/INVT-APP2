/**
 * Break reminder must use active/worked minutes — not wall clock since window open.
 * 14h auto sign-out stays on window wall (untouched here).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isBreakDueByActiveWork } from '../lib/nztaShiftWindow.ts';

const MS_HOUR = 3600000;
const MS_MINUTE = 60000;

test('break due only when active workedMinutes >= 7h (ignores long window wall)', () => {
  const now = 1_700_000_000_000;
  const windowOpen = now - 10 * MS_HOUR; // 10h wall since window open
  assert.equal(
    isBreakDueByActiveWork(
      {
        shiftStartedAt: windowOpen,
        workedMinutes: 90, // only 1.5h active
        breakReminderShown: false,
        breakDeferredUntil: null,
      },
      now,
    ),
    false,
    'must NOT fire after offline gap with little active work',
  );
  assert.equal(
    isBreakDueByActiveWork(
      {
        shiftStartedAt: windowOpen,
        workedMinutes: 7 * 60,
        breakReminderShown: false,
        breakDeferredUntil: null,
      },
      now,
    ),
    true,
  );
});

test('break suppressed when already shown or deferred', () => {
  const now = 1_700_000_000_000;
  assert.equal(
    isBreakDueByActiveWork({
      shiftStartedAt: now - MS_HOUR,
      workedMinutes: 500,
      breakReminderShown: true,
      breakDeferredUntil: null,
    }, now),
    false,
  );
  assert.equal(
    isBreakDueByActiveWork({
      shiftStartedAt: now - MS_HOUR,
      workedMinutes: 500,
      breakReminderShown: false,
      breakDeferredUntil: now + 30 * MS_MINUTE,
    }, now),
    false,
  );
});

test('no break when shift not started', () => {
  assert.equal(
    isBreakDueByActiveWork({
      shiftStartedAt: null,
      workedMinutes: 500,
      breakReminderShown: false,
      breakDeferredUntil: null,
    }),
    false,
  );
});
