import {
  NZTA_BREAK_AFTER_HOURS,
  NZTA_MAX_SHIFT_HOURS,
  NZTA_REST_CONTINUE_HOURS,
  NZTA_WEEKLY_LOCKOUT_HOURS,
  NZTA_WEEKLY_MAX_HOURS,
} from '@/constants/theme';
import { journalShiftEndLogFailure } from '@/lib/pendingShiftEnd';
import { loadLastShiftEnd, writeShiftEndLog } from '@/lib/shiftLogs';
import { getData, nztaHoursStorageKey, removeData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { notifyBreakReminder } from '@/services/notificationService';
import type { NztaHoursState, NztaLimitSignOutReason, NztaLockoutReason } from '@/types';

export type EndShiftReason = 'manual' | NztaLimitSignOutReason;

export const NZTA_BREAK_REMINDER_MESSAGE =
  'You have been working 7 hours. Please take a break when possible.';

export const NZTA_SHIFT_LIMIT_SIGNOUT_MESSAGE =
  'Your 14-hour shift limit has been reached. You have been automatically signed out.';

export const NZTA_WEEKLY_LIMIT_SIGNOUT_MESSAGE =
  'Weekly 70-hour limit reached. You require a 24-hour break before starting a new shift.';

const DEFAULT: NztaHoursState = {
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
};

const MS_HOUR = 3600000;
const MS_MINUTE = 60000;
const LEGACY_MIGRATE_END_TOLERANCE_MS = 120_000;
/** Genuine 14h sign-out may trail window end by up to one compliance tick. */
const STALE_LOCKOUT_WINDOW_SLACK_MS = 30 * MS_MINUTE;

export function shiftWindowEndMs(shiftStartAt: number): number {
  return shiftStartAt + NZTA_MAX_SHIFT_HOURS * MS_HOUR;
}

/** True when wall-clock time is at or past the 14h limit from shift start. */
export function isShiftWindowExpired(shiftStartAt: number | null, now = Date.now()): boolean {
  if (!shiftStartAt) return false;
  return now >= shiftWindowEndMs(shiftStartAt);
}

/** Shift-rest lockout set after a limit breach on a window that had already expired. */
export function isStaleShiftRestLockout(state: NztaHoursState, now = Date.now()): boolean {
  if (!state.lockoutUntil || state.lockoutUntil <= now) return false;
  if (state.lockoutReason !== 'shift_rest') return false;
  const anchor = state.lastShiftStartAt ?? state.shiftStartedAt;
  if (!anchor) return false;
  const lockoutSetAt = state.lockoutUntil - NZTA_REST_CONTINUE_HOURS * MS_HOUR;
  return lockoutSetAt > shiftWindowEndMs(anchor) + STALE_LOCKOUT_WINDOW_SLACK_MS;
}

/** Drop continuation/lockout state that only exists because an ancient window was resumed. */
export function healStaleNztaState(state: NztaHoursState, now = Date.now()): NztaHoursState {
  let next = clearExpiredLockout(state);
  const anchor = next.lastShiftStartAt ?? next.shiftStartedAt;

  if (isStaleShiftRestLockout(next, now)) {
    console.log('[NZTA] clearing stale shift-rest lockout from expired window');
    next = {
      ...next,
      lockoutUntil: null,
      lockoutReason: null,
      pendingLimitSignOut: null,
    };
  }

  if (anchor && isShiftWindowExpired(anchor, now)) {
    if (next.continuedWindow || (next.shiftStartedAt && next.shiftStartedAt === anchor)) {
      console.log('[NZTA] resetting expired continued shift window');
    }
    next = {
      ...next,
      shiftStartedAt: null,
      shiftWindowEndsAt: null,
      workedMinutes: 0,
      continuedWindow: false,
      pendingLimitSignOut: null,
    };
  }

  return next;
}

function requireNztaDriver(companyId: string, uid: string) {
  const cid = String(companyId || '').trim();
  const id = String(uid || '').trim();
  if (!cid || !id) {
    throw new Error('NZTA hours require companyId and uid (per-driver storage)');
  }
  return { companyId: cid, uid: id };
}

async function maybeMigrateLegacyNztaHours(
  companyId: string,
  uid: string,
): Promise<NztaHoursState | null> {
  const legacy = await getData<NztaHoursState>(STORAGE_KEYS.nztaHours);
  if (!legacy) return null;

  const last = await loadLastShiftEnd(companyId, uid);
  const legacyEnd = legacy.lastShiftEndAt ?? null;
  const remoteEnd = last?.shiftEndAt ?? null;

  const belongsToDriver =
    legacyEnd != null &&
    remoteEnd != null &&
    Math.abs(legacyEnd - remoteEnd) <= LEGACY_MIGRATE_END_TOLERANCE_MS;

  if (!belongsToDriver) return null;

  const migrated = ensureWeekBucket({ ...DEFAULT, ...legacy });
  await storeData(nztaHoursStorageKey(companyId, uid), migrated);
  await removeData(STORAGE_KEYS.nztaHours);
  console.log('[NZTA] migrated legacy shared hours state to per-driver storage');
  return migrated;
}

export async function loadNztaHours(companyId: string, uid: string): Promise<NztaHoursState> {
  const { companyId: cid, uid: id } = requireNztaDriver(companyId, uid);
  const key = nztaHoursStorageKey(cid, id);
  let saved = await getData<NztaHoursState>(key);
  if (!saved) {
    saved = await maybeMigrateLegacyNztaHours(cid, id);
  }
  const merged = ensureWeekBucket({ ...DEFAULT, ...saved });
  const healed = healStaleNztaState(merged);
  if (JSON.stringify(healed) !== JSON.stringify(merged)) {
    await storeData(key, healed);
  }
  return healed;
}

export async function saveNztaHours(companyId: string, uid: string, state: NztaHoursState) {
  const { companyId: cid, uid: id } = requireNztaDriver(companyId, uid);
  await storeData(nztaHoursStorageKey(cid, id), ensureWeekBucket(state));
}

/** Monday 00:00:00.000 local time for the week containing `now`. */
export function startOfWeekMondayMs(now = Date.now()): number {
  const d = new Date(now);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d.getTime();
}

export function ensureWeekBucket(state: NztaHoursState): NztaHoursState {
  const weekStart = startOfWeekMondayMs();
  if (state.weekStartedAt === weekStart) return state;
  if (state.weekStartedAt == null) {
    return { ...state, weekStartedAt: weekStart };
  }
  // New Monday–Sunday week — reset weekly minutes.
  return {
    ...state,
    weekStartedAt: weekStart,
    weeklyWorkedMinutes: 0,
  };
}

function clearExpiredLockout(state: NztaHoursState): NztaHoursState {
  if (state.lockoutUntil != null && state.lockoutUntil <= Date.now()) {
    return { ...state, lockoutUntil: null, lockoutReason: null };
  }
  return state;
}

export function formatLockoutRemaining(remainingMs: number): string {
  const totalMins = Math.max(0, Math.ceil(remainingMs / MS_MINUTE));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h} hours ${m} minutes`;
}

export function getShiftLockout(state: NztaHoursState): {
  blocked: boolean;
  message: string;
  remainingMs: number;
  reason: NztaLockoutReason;
} {
  const cleared = clearExpiredLockout(state);
  if (!cleared.lockoutUntil || cleared.lockoutUntil <= Date.now()) {
    return { blocked: false, message: '', remainingMs: 0, reason: null };
  }
  const remainingMs = cleared.lockoutUntil - Date.now();
  return {
    blocked: true,
    remainingMs,
    reason: cleared.lockoutReason,
    message: `Rest period required — ${formatLockoutRemaining(remainingMs)} remaining before you can start a new shift.`,
  };
}

export async function initializeNztaOnLogin(companyId: string, uid: string): Promise<NztaHoursState> {
  let state = healStaleNztaState(ensureWeekBucket(await loadNztaHours(companyId, uid)));
  const last = await loadLastShiftEnd(companyId, uid);
  const lastEnd = state.lastShiftEndAt ?? last?.shiftEndAt ?? null;
  const lastStart = state.lastShiftStartAt ?? last?.shiftStartAt ?? null;
  const lastWorked = state.lastWorkedMinutes || last?.workedMinutes || state.workedMinutes || 0;
  const lastWeekly = Math.max(state.weeklyWorkedMinutes, last?.weeklyWorkedMinutes ?? 0);

  const hoursSinceEnd = lastEnd ? (Date.now() - lastEnd) / MS_HOUR : Infinity;
  const canContinueWindow =
    hoursSinceEnd < NZTA_REST_CONTINUE_HOURS &&
    !!lastStart &&
    !isShiftWindowExpired(lastStart);

  // Hard lockout after 14h / 70h auto sign-out — cannot start a shift yet.
  if (state.lockoutUntil && state.lockoutUntil > Date.now()) {
    if (isStaleShiftRestLockout(state)) {
      state = {
        ...state,
        lockoutUntil: null,
        lockoutReason: null,
        pendingLimitSignOut: null,
      };
    } else {
      const next: NztaHoursState = {
        ...state,
        lastShiftEndAt: lastEnd,
        lastShiftStartAt: lastStart,
        lastWorkedMinutes: lastWorked,
        weeklyWorkedMinutes: lastWeekly,
        shiftStartedAt: null,
        shiftWindowEndsAt: null,
        continuedWindow: false,
        pendingLimitSignOut: null,
      };
      await saveNztaHours(companyId, uid, next);
      return next;
    }
  }

  let next: NztaHoursState;
  if (canContinueWindow) {
    // Same shift continues — clock resumes from original start.
    next = {
      ...state,
      shiftStartedAt: lastStart,
      shiftWindowEndsAt: shiftWindowEndMs(lastStart!),
      workedMinutes: lastWorked,
      weeklyWorkedMinutes: lastWeekly,
      lastShiftEndAt: lastEnd,
      lastShiftStartAt: lastStart,
      lastWorkedMinutes: lastWorked,
      continuedWindow: true,
      pendingLimitSignOut: null,
      lockoutUntil: null,
      lockoutReason: null,
    };
  } else {
    // Fresh 14h clock on next startShiftClock; weekly bucket preserved (Mon–Sun).
    next = {
      ...state,
      shiftStartedAt: null,
      shiftWindowEndsAt: null,
      workedMinutes: 0,
      weeklyWorkedMinutes: lastWeekly,
      lastShiftEndAt: lastEnd,
      lastShiftStartAt: lastStart,
      lastWorkedMinutes: lastWorked,
      continuedWindow: false,
      pendingLimitSignOut: null,
      breakReminderShown: false,
      breakDeferredUntil: null,
      lockoutUntil: null,
      lockoutReason: null,
    };
  }

  await saveNztaHours(companyId, uid, next);
  return next;
}

export async function startShiftClock(companyId: string, uid: string) {
  const { companyId: cid, uid: id } = requireNztaDriver(companyId, uid);
  let base = healStaleNztaState(clearExpiredLockout(ensureWeekBucket(await loadNztaHours(cid, id))));
  if (!base.shiftStartedAt && !base.continuedWindow) {
    base = await initializeNztaOnLogin(cid, id);
  }
  base = healStaleNztaState(base);
  const lockout = getShiftLockout(base);
  if (lockout.blocked) {
    throw new Error(lockout.message);
  }

  const now = Date.now();
  const resumeAnchor = base.shiftStartedAt ?? base.lastShiftStartAt;
  const resume =
    !!base.continuedWindow &&
    !!resumeAnchor &&
    !isShiftWindowExpired(resumeAnchor, now);
  const next: NztaHoursState = {
    ...base,
    shiftStartedAt: resume ? resumeAnchor! : now,
    shiftWindowEndsAt: resume ? shiftWindowEndMs(resumeAnchor!) : shiftWindowEndMs(now),
    workedMinutes: resume ? base.workedMinutes : 0,
    breakReminderShown: resume ? base.breakReminderShown : false,
    breakDeferredUntil: resume ? base.breakDeferredUntil : null,
    pendingLimitSignOut: null,
    continuedWindow: resume,
  };
  await saveNztaHours(cid, id, next);
  return next;
}

export type EndShiftSummary = {
  workedMinutes: number;
  weeklyWorkedMinutes: number;
  breakMinutes: number;
  shiftElapsedMinutes: number;
};

export async function captureEndShiftSummary(companyId: string, uid: string): Promise<EndShiftSummary> {
  const state = await loadNztaHours(companyId, uid);
  return {
    workedMinutes: state.workedMinutes,
    weeklyWorkedMinutes: state.weeklyWorkedMinutes,
    breakMinutes: state.breakMinutes,
    shiftElapsedMinutes: shiftElapsedMinutes(state),
  };
}

export async function endShiftClock(
  companyId: string,
  uid: string,
  driverId: string,
  reason: EndShiftReason = 'manual',
  opts?: { vehicleId?: string | null },
) {
  const state = clearExpiredLockout(ensureWeekBucket(await loadNztaHours(companyId, uid)));
  const now = Date.now();
  const elapsed = Math.max(state.workedMinutes, shiftElapsedMinutes(state));
  const shiftStartAt = state.shiftStartedAt ?? state.lastShiftStartAt ?? undefined;

  let lockoutUntil: number | null = null;
  let lockoutReason: NztaLockoutReason = null;
  if (reason === 'shift14h') {
    lockoutUntil = now + NZTA_REST_CONTINUE_HOURS * MS_HOUR;
    lockoutReason = 'shift_rest';
  } else if (reason === 'weekly70h') {
    lockoutUntil = now + NZTA_WEEKLY_LOCKOUT_HOURS * MS_HOUR;
    lockoutReason = 'weekly_rest';
  }

  // Persist session locally FIRST — never gate end-shift UI on RTDB.
  const next: NztaHoursState = {
    ...state,
    shiftStartedAt: null,
    shiftWindowEndsAt: null,
    workedMinutes: elapsed,
    lastShiftEndAt: now,
    lastShiftStartAt: state.shiftStartedAt ?? state.lastShiftStartAt,
    lastWorkedMinutes: elapsed,
    weeklyWorkedMinutes: state.weeklyWorkedMinutes,
    lockoutUntil,
    lockoutReason,
    pendingLimitSignOut: null,
    continuedWindow: false,
    breakReminderShown: reason === 'manual' ? state.breakReminderShown : false,
    breakDeferredUntil: null,
  };
  await saveNztaHours(companyId, uid, next);

  try {
    await writeShiftEndLog(companyId, uid, {
      shiftEndAt: now,
      shiftStartAt,
      workedMinutes: elapsed,
      weeklyWorkedMinutes: state.weeklyWorkedMinutes,
      driverId,
    });
  } catch (err) {
    console.warn('[NZTA] writeShiftEndLog failed — journaling for reconnect:', err);
    await journalShiftEndLogFailure({
      companyId,
      uid,
      driverId,
      vehicleId: opts?.vehicleId,
      reason,
      shiftEndAt: now,
      shiftStartAt,
      workedMinutes: elapsed,
      weeklyWorkedMinutes: state.weeklyWorkedMinutes,
    }).catch((journalErr) => {
      console.warn('[NZTA] journalShiftEndLogFailure failed:', journalErr);
    });
  }

  return next;
}

export async function tickWorkedMinutes(companyId: string, uid: string, addMinutes = 1) {
  let state = clearExpiredLockout(ensureWeekBucket(await loadNztaHours(companyId, uid)));
  if (!state.shiftStartedAt) return state;
  const next = {
    ...state,
    workedMinutes: state.workedMinutes + addMinutes,
    weeklyWorkedMinutes: state.weeklyWorkedMinutes + addMinutes,
  };
  await saveNztaHours(companyId, uid, next);
  return next;
}

export async function setPendingLimitSignOut(
  companyId: string,
  uid: string,
  reason: NztaLimitSignOutReason,
) {
  const state = await loadNztaHours(companyId, uid);
  if (state.pendingLimitSignOut === reason) return state;
  const next = { ...state, pendingLimitSignOut: reason };
  await saveNztaHours(companyId, uid, next);
  return next;
}

export async function clearPendingLimitSignOut(companyId: string, uid: string) {
  const state = await loadNztaHours(companyId, uid);
  if (!state.pendingLimitSignOut) return state;
  const next = { ...state, pendingLimitSignOut: null };
  await saveNztaHours(companyId, uid, next);
  return next;
}

export async function addBreakMinutes(companyId: string, uid: string, minutes: number) {
  const state = await loadNztaHours(companyId, uid);
  const next = {
    ...state,
    breakMinutes: state.breakMinutes + minutes,
    lastBreakAt: Date.now(),
    breakReminderShown: true,
    breakDeferredUntil: null,
  };
  await saveNztaHours(companyId, uid, next);
  return next;
}

export function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function shiftElapsedMinutes(state: NztaHoursState) {
  if (!state.shiftStartedAt) return 0;
  return Math.floor((Date.now() - state.shiftStartedAt) / MS_MINUTE);
}

export function remainingShiftMinutes(state: NztaHoursState): number {
  if (!state.shiftWindowEndsAt) return NZTA_MAX_SHIFT_HOURS * 60;
  return Math.max(0, Math.floor((state.shiftWindowEndsAt - Date.now()) / MS_MINUTE));
}

export function remainingWeeklyMinutes(state: NztaHoursState): number {
  return Math.max(0, NZTA_WEEKLY_MAX_HOURS * 60 - state.weeklyWorkedMinutes);
}

export function remainingWorkMinutesToday(state: NztaHoursState): number {
  return remainingShiftMinutes(state);
}

/** 7-hour dismissible break reminder (wall-clock from shift start). */
export function needsBreak(state: NztaHoursState) {
  if (!state.shiftStartedAt) return false;
  if (state.breakReminderShown) return false;
  if (state.breakDeferredUntil && Date.now() < state.breakDeferredUntil) return false;
  return shiftElapsedMinutes(state) >= NZTA_BREAK_AFTER_HOURS * 60;
}

export function exceedsMaxShiftHours(state: NztaHoursState) {
  if (state.shiftWindowEndsAt && Date.now() >= state.shiftWindowEndsAt) return true;
  if (!state.shiftStartedAt) return false;
  return shiftElapsedMinutes(state) >= NZTA_MAX_SHIFT_HOURS * 60;
}

/** @deprecated use exceedsMaxShiftHours */
export function exceedsMaxWorkHours(state: NztaHoursState) {
  return exceedsMaxShiftHours(state);
}

export function exceedsWeeklyHours(state: NztaHoursState) {
  const s = ensureWeekBucket(state);
  return s.weeklyWorkedMinutes >= NZTA_WEEKLY_MAX_HOURS * 60;
}

export async function deferBreakReminder(companyId: string, uid: string, minutes: number) {
  const state = await loadNztaHours(companyId, uid);
  const next = { ...state, breakDeferredUntil: Date.now() + minutes * MS_MINUTE };
  await saveNztaHours(companyId, uid, next);
  await notifyBreakReminder(
    'Break reminder',
    `NZTA recommends a break. We'll remind you again in ${minutes} minutes.`,
    minutes,
  );
  return next;
}

export async function confirmBreakTaken(companyId: string, uid: string) {
  const state = await loadNztaHours(companyId, uid);
  const next = {
    ...state,
    lastBreakAt: Date.now(),
    breakReminderShown: true,
    breakDeferredUntil: null,
    breakMinutes: state.breakMinutes + 15,
  };
  await saveNztaHours(companyId, uid, next);
  return next;
}

export async function markBreakReminderShown(companyId: string, uid: string) {
  const state = await loadNztaHours(companyId, uid);
  const next = { ...state, breakReminderShown: true };
  await saveNztaHours(companyId, uid, next);
  return next;
}

export async function markBreakTaken(companyId: string, uid: string) {
  return confirmBreakTaken(companyId, uid);
}
