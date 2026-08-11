/**
 * Weekly Total must receive the same End Shift wall-clock catch-up as Work Time.
 * Otherwise background/kill under-reports toward the NZTA 70h weekly limit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEndShiftHourTotals } from '../lib/nztaShiftWindow.ts';

const MS_MINUTE = 60_000;

test('End Shift: wall ahead of ticks catch-up applies equally to work and weekly', () => {
  const now = 1_700_000_000_000;
  const shiftStartedAt = now - 133 * MS_MINUTE; // 2h 13m wall
  const totals = resolveEndShiftHourTotals(
    {
      shiftStartedAt,
      workedMinutes: 8, // ticks only (app mostly backgrounded)
      weeklyWorkedMinutes: 8,
      breakMinutes: 0,
    },
    now,
  );
  assert.equal(totals.shiftElapsedMinutes, 133);
  assert.equal(totals.workedMinutes, 133);
  assert.equal(totals.catchUpMinutes, 125);
  assert.equal(totals.weeklyWorkedMinutes, 8 + 125);
  assert.equal(totals.breakMinutes, 0);
});

test('End Shift: no catch-up when ticks already match or exceed wall', () => {
  const now = 1_700_000_000_000;
  const shiftStartedAt = now - 80 * MS_MINUTE;
  const totals = resolveEndShiftHourTotals(
    {
      shiftStartedAt,
      workedMinutes: 80,
      weeklyWorkedMinutes: 200,
      breakMinutes: 15,
    },
    now,
  );
  assert.equal(totals.catchUpMinutes, 0);
  assert.equal(totals.workedMinutes, 80);
  assert.equal(totals.weeklyWorkedMinutes, 200, 'must not invent weekly minutes');
  assert.equal(totals.breakMinutes, 15);
});

test('End Shift: catch-up only adds the wall-tick delta (preserves prior weekly)', () => {
  const now = 1_700_000_000_000;
  const shiftStartedAt = now - 100 * MS_MINUTE;
  const totals = resolveEndShiftHourTotals(
    {
      shiftStartedAt,
      workedMinutes: 40,
      weeklyWorkedMinutes: 500, // earlier shifts this week
      breakMinutes: 0,
    },
    now,
  );
  assert.equal(totals.workedMinutes, 100);
  assert.equal(totals.catchUpMinutes, 60);
  assert.equal(totals.weeklyWorkedMinutes, 560);
});

test('End Shift: no active shiftStartedAt → no wall catch-up', () => {
  const totals = resolveEndShiftHourTotals(
    {
      shiftStartedAt: null,
      workedMinutes: 12,
      weeklyWorkedMinutes: 12,
      breakMinutes: 0,
    },
    1_700_000_000_000,
  );
  assert.equal(totals.shiftElapsedMinutes, 0);
  assert.equal(totals.workedMinutes, 12);
  assert.equal(totals.catchUpMinutes, 0);
  assert.equal(totals.weeklyWorkedMinutes, 12);
});
