/**
 * Pure NZTA shift-window helpers (no storage / Firebase).
 * Keeps End Shift from reusing a months-old lastShiftStartAt after the 14h window expired.
 */
import type { NztaHoursState } from '../types/index.ts';

/** Keep in sync with constants/theme.ts */
const NZTA_MAX_SHIFT_HOURS = 14;
const NZTA_REST_CONTINUE_HOURS = 10;
const NZTA_BREAK_AFTER_HOURS = 7;

const MS_HOUR = 3600000;
const MS_MINUTE = 60000;
/** Genuine 14h sign-out may trail window end by up to one compliance tick. */
const STALE_LOCKOUT_WINDOW_SLACK_MS = 30 * MS_MINUTE;

export function shiftWindowEndMs(shiftStartAt: number): number {
  return shiftStartAt + NZTA_MAX_SHIFT_HOURS * MS_HOUR;
}

/** True when wall-clock time is at or past the 14h limit from shift start. */
export function isShiftWindowExpired(shiftStartAt: number | null | undefined, now = Date.now()): boolean {
  if (!shiftStartAt) return false;
  return now >= shiftWindowEndMs(shiftStartAt);
}

/**
 * 7h break reminder — based on accumulated active/worked minutes (ticks),
 * NOT wall-clock since the 14h window opened (offline gaps must not count).
 */
export function isBreakDueByActiveWork(
  state: Pick<
    NztaHoursState,
    'shiftStartedAt' | 'workedMinutes' | 'breakReminderShown' | 'breakDeferredUntil'
  >,
  now = Date.now(),
): boolean {
  if (!state.shiftStartedAt) return false;
  if (state.breakReminderShown) return false;
  if (state.breakDeferredUntil && now < state.breakDeferredUntil) return false;
  return Math.max(0, Number(state.workedMinutes) || 0) >= NZTA_BREAK_AFTER_HOURS * 60;
}

/**
 * Start timestamp written to shiftLogs on End Shift.
 * ONLY the in-progress shiftStartedAt — never lastShiftStartAt (that caused Jul→Aug phantom gaps).
 */
export function resolveShiftStartAtForEndLog(
  state: Pick<NztaHoursState, 'shiftStartedAt'>,
): number | undefined {
  return state.shiftStartedAt ?? undefined;
}

export type EndShiftHourTotals = {
  workedMinutes: number;
  weeklyWorkedMinutes: number;
  breakMinutes: number;
  shiftElapsedMinutes: number;
  /** Wall ahead of tick counter — added to both work and weekly on End Shift. */
  catchUpMinutes: number;
};

/**
 * End Shift hour totals — pure, no I/O.
 * Work already uses max(tick, wall). Weekly must get the same catch-up delta
 * or the 70h NZTA counter silently under-reports after background/kill.
 */
export function resolveEndShiftHourTotals(
  state: Pick<
    NztaHoursState,
    'workedMinutes' | 'weeklyWorkedMinutes' | 'breakMinutes' | 'shiftStartedAt'
  >,
  now = Date.now(),
): EndShiftHourTotals {
  const wallElapsed =
    state.shiftStartedAt != null
      ? Math.max(0, Math.floor((now - state.shiftStartedAt) / MS_MINUTE))
      : 0;
  const tickWorked = Math.max(0, Number(state.workedMinutes) || 0);
  const workedMinutes = Math.max(tickWorked, wallElapsed);
  const catchUpMinutes = Math.max(0, workedMinutes - tickWorked);
  const weeklyWorkedMinutes =
    Math.max(0, Number(state.weeklyWorkedMinutes) || 0) + catchUpMinutes;
  return {
    workedMinutes,
    weeklyWorkedMinutes,
    breakMinutes: Math.max(0, Number(state.breakMinutes) || 0),
    shiftElapsedMinutes: wallElapsed,
    catchUpMinutes,
  };
}

/** Drop expired remote/local last starts so they cannot resume or poison End Shift. */
export function sanitizeLastShiftStartAt(
  lastStart: number | null | undefined,
  now = Date.now(),
): number | null {
  if (lastStart == null) return null;
  if (isShiftWindowExpired(lastStart, now)) return null;
  return lastStart;
}

function clearExpiredLockout(state: NztaHoursState, now: number): NztaHoursState {
  if (state.lockoutUntil != null && state.lockoutUntil <= now) {
    return { ...state, lockoutUntil: null, lockoutReason: null };
  }
  return state;
}

/** Shift-rest lockout set after a limit breach on a window that had already expired. */
export function isStaleShiftRestLockout(state: NztaHoursState, now = Date.now()): boolean {
  if (!state.lockoutUntil || state.lockoutUntil <= now) return false;
  if (state.lockoutReason !== 'shift_rest') return false;
  // Prefer the active shift start — never let a stale lastShiftStartAt decide.
  const anchor = state.shiftStartedAt ?? state.lastShiftStartAt;
  if (!anchor) return false;
  const lockoutSetAt = state.lockoutUntil - NZTA_REST_CONTINUE_HOURS * MS_HOUR;
  return lockoutSetAt > shiftWindowEndMs(anchor) + STALE_LOCKOUT_WINDOW_SLACK_MS;
}

/**
 * Drop continuation/lockout state that only exists because an ancient window was resumed.
 * Must NOT clear a fresh in-progress shiftStartedAt just because lastShiftStartAt is old.
 */
export function healStaleNztaState(state: NztaHoursState, now = Date.now()): NztaHoursState {
  let next = clearExpiredLockout(state, now);

  if (isStaleShiftRestLockout(next, now)) {
    console.log('[NZTA] clearing stale shift-rest lockout from expired window');
    next = {
      ...next,
      lockoutUntil: null,
      lockoutReason: null,
      pendingLimitSignOut: null,
    };
  }

  // Active shift: only expire based on THIS shift's start.
  if (next.shiftStartedAt && isShiftWindowExpired(next.shiftStartedAt, now)) {
    console.log('[NZTA] resetting expired active shift window');
    next = {
      ...next,
      shiftStartedAt: null,
      shiftWindowEndsAt: null,
      sessionStartedAt: null,
      workedMinutes: 0,
      continuedWindow: false,
      pendingLimitSignOut: null,
    };
  }

  // Historical lastShiftStartAt past 14h must not linger — it poisoned End Shift fallbacks.
  if (next.lastShiftStartAt && isShiftWindowExpired(next.lastShiftStartAt, now)) {
    if (!next.shiftStartedAt || next.shiftStartedAt !== next.lastShiftStartAt) {
      next = {
        ...next,
        lastShiftStartAt: next.shiftStartedAt,
        continuedWindow: next.shiftStartedAt ? next.continuedWindow : false,
      };
    }
  }

  return next;
}
