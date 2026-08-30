/**
 * Pure NZTA shift-window helpers (no storage / Firebase).
 * Keeps End Shift from reusing a months-old lastShiftStartAt after the 14h window expired.
 */
import type { NztaHoursState } from '../types/index.ts';

/** Keep in sync with constants/theme.ts */
const NZTA_MAX_SHIFT_HOURS = 14;
const NZTA_REST_CONTINUE_HOURS = 10;
const NZTA_BREAK_AFTER_HOURS = 7;
/** After weekly 70h — continuous rest that unlocks / resets the weekly counter. */
const NZTA_WEEKLY_LOCKOUT_HOURS = 24;
const NZTA_WEEKLY_MAX_MINUTES = 70 * 60;

const MS_HOUR = 3600000;
const MS_MINUTE = 60000;
/** Genuine 14h sign-out may trail window end by up to one compliance tick. */
const STALE_LOCKOUT_WINDOW_SLACK_MS = 30 * MS_MINUTE;

function clearExpiredLockoutPure(state: NztaHoursState, now: number): NztaHoursState {
  if (state.lockoutUntil != null && state.lockoutUntil <= now) {
    return { ...state, lockoutUntil: null, lockoutReason: null };
  }
  return state;
}

/**
 * Phantom weekly70h end: auto sign-out / blocked start with no real work in the stint.
 * These refresh lastShiftEndAt on every login attempt and permanently defeat a 24h rest check.
 */
export function isPhantomWeeklyLockoutEnd(entry: {
  workedMinutes?: number | null;
  shiftStartAt?: number | null;
  sessionStartedAt?: number | null;
  weeklyWorkedMinutes?: number | null;
}): boolean {
  const worked = Math.max(0, Number(entry.workedMinutes) || 0);
  const weekly = Math.max(0, Number(entry.weeklyWorkedMinutes) || 0);
  const hadStart = !!(entry.shiftStartAt || entry.sessionStartedAt);
  return worked <= 0 && !hadStart && weekly >= NZTA_WEEKLY_MAX_MINUTES;
}

/**
 * Clear weekly 70h after a completed 24h rest.
 *
 * IMPORTANT: do not trust a freshly stamped lastShiftEndAt from phantom weekly70h
 * lockout writes (workedMinutes=0). Prefer lastGenuineShiftEndAt when provided;
 * also clear when a weekly_rest lockout itself has expired.
 */
export function applyCompletedWeeklyRest(
  state: NztaHoursState,
  now = Date.now(),
  opts?: { lastGenuineShiftEndAt?: number | null },
): NztaHoursState {
  const hadWeeklyLockout =
    state.lockoutReason === 'weekly_rest' || state.pendingLimitSignOut === 'weekly70h';
  const lockoutExpired =
    state.lockoutUntil != null && state.lockoutUntil <= now;

  let next = clearExpiredLockoutPure(state, now);

  // Primary: the 24h weekly_rest lockout finished → counter must clear
  // (even if phantom ends refreshed lastShiftEndAt during the lockout).
  if (hadWeeklyLockout && lockoutExpired) {
    return {
      ...next,
      weeklyWorkedMinutes: 0,
      lockoutUntil: null,
      lockoutReason: null,
      pendingLimitSignOut: null,
    };
  }

  if (next.weeklyWorkedMinutes < NZTA_WEEKLY_MAX_MINUTES && !hadWeeklyLockout) {
    return next;
  }

  const genuineEnd =
    opts?.lastGenuineShiftEndAt != null && Number.isFinite(opts.lastGenuineShiftEndAt)
      ? opts.lastGenuineShiftEndAt
      : null;
  const localEnd = next.lastShiftEndAt;
  const localIsPhantom =
    localEnd != null &&
    isPhantomWeeklyLockoutEnd({
      workedMinutes: next.lastWorkedMinutes,
      shiftStartAt: next.lastShiftStartAt,
      sessionStartedAt: next.sessionStartedAt,
      weeklyWorkedMinutes: next.weeklyWorkedMinutes,
    });

  // Rest anchor: genuine remote end, else non-phantom local end.
  const restAnchor =
    genuineEnd ??
    (localEnd != null && !localIsPhantom ? localEnd : genuineEnd);

  if (restAnchor == null) {
    // At/over weekly limit with only phantom anchors and no active lockout —
    // treat as rest completed (cannot prove a fresh genuine shift).
    if (
      next.weeklyWorkedMinutes >= NZTA_WEEKLY_MAX_MINUTES &&
      (next.lockoutUntil == null || next.lockoutUntil <= now) &&
      localIsPhantom
    ) {
      return {
        ...next,
        weeklyWorkedMinutes: 0,
        lockoutUntil: null,
        lockoutReason: null,
        pendingLimitSignOut: null,
      };
    }
    return next;
  }

  const hoursSinceEnd = (now - restAnchor) / MS_HOUR;
  if (hoursSinceEnd < NZTA_WEEKLY_LOCKOUT_HOURS) return next;

  return {
    ...next,
    weeklyWorkedMinutes: 0,
    lockoutUntil: null,
    lockoutReason: null,
    pendingLimitSignOut: null,
  };
}

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
export function healStaleNztaState(
  state: NztaHoursState,
  now = Date.now(),
  opts?: { lastGenuineShiftEndAt?: number | null },
): NztaHoursState {
  let next = applyCompletedWeeklyRest(state, now, opts);

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
