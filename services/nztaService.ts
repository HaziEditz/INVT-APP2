import {
  NZTA_MAX_SHIFT_HOURS,
  NZTA_REST_CONTINUE_HOURS,
  NZTA_WEEKLY_LOCKOUT_HOURS,
  NZTA_WEEKLY_MAX_HOURS,
} from '@/constants/theme';
import { attemptWithTimeout, END_SHIFT_RTDB_TIMEOUT_MS } from '@/lib/asyncTimeout';
import { journalShiftEndLogFailure } from '@/lib/pendingShiftEnd';
import {
  healStaleNztaState,
  isBreakDueByActiveWork,
  isShiftWindowExpired,
  isStaleShiftRestLockout,
  applyCompletedWeeklyRest,
  isPhantomWeeklyLockoutEnd,
  resolveEndShiftHourTotals,
  resolveShiftStartAtForEndLog,
  sanitizeLastShiftStartAt,
  shiftWindowEndMs,
} from '@/lib/nztaShiftWindow';
import { loadLastShiftEnd, loadLastGenuineShiftEnd, writeShiftEndLog } from '@/lib/shiftLogs';
import { getData, nztaHoursStorageKey, removeData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { notifyBreakReminder } from '@/services/notificationService';
import type { NztaHoursState, NztaLimitSignOutReason, NztaLockoutReason } from '@/types';

export type EndShiftReason = 'manual' | NztaLimitSignOutReason;

export {
  healStaleNztaState,
  isBreakDueByActiveWork,
  isShiftWindowExpired,
  isStaleShiftRestLockout,
  applyCompletedWeeklyRest,
  isPhantomWeeklyLockoutEnd,
  resolveEndShiftHourTotals,
  resolveShiftStartAtForEndLog,
  sanitizeLastShiftStartAt,
  shiftWindowEndMs,
} from '@/lib/nztaShiftWindow';

export const NZTA_BREAK_REMINDER_MESSAGE =
  'You have been working 7 hours. Please take a break when possible.';

export const NZTA_SHIFT_LIMIT_SIGNOUT_MESSAGE =
  'Your 14-hour shift limit has been reached. You have been automatically signed out.';

export const NZTA_WEEKLY_LIMIT_SIGNOUT_MESSAGE =
  'Weekly 70-hour limit reached. You require a 24-hour break before starting a new shift.';

const DEFAULT: NztaHoursState = {
  shiftStartedAt: null,
  shiftWindowEndsAt: null,
  sessionStartedAt: null,
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
  // Offline-safe heal: phantom local ends can clear without Firebase.
  // initializeNztaOnLogin supplies lastGenuineShiftEndAt for the poisoned-timestamp case.
  const healed = healStaleNztaState(applyCompletedWeeklyRest(merged));
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

function clearExpiredLockout(state: NztaHoursState, now = Date.now()): NztaHoursState {
  if (state.lockoutUntil != null && state.lockoutUntil <= now) {
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
  const last = await loadLastShiftEnd(companyId, uid);
  const genuine = await loadLastGenuineShiftEnd(companyId, uid);
  const genuineEndAt = genuine?.shiftEndAt ?? null;

  let state = healStaleNztaState(
    applyCompletedWeeklyRest(ensureWeekBucket(await loadNztaHours(companyId, uid)), Date.now(), {
      lastGenuineShiftEndAt: genuineEndAt,
    }),
    Date.now(),
  );

  const lastIsPhantom = !!(last && isPhantomWeeklyLockoutEnd(last));
  // Rest / weekly decisions MUST ignore phantom weekly70h ends (D001 live loop).
  const restAnchorEnd = genuineEndAt ?? (lastIsPhantom ? null : last?.shiftEndAt ?? null);
  const lastEnd =
    restAnchorEnd ??
    (lastIsPhantom ? state.lastShiftEndAt : state.lastShiftEndAt ?? last?.shiftEndAt ?? null);

  // Never re-poison from an expired shiftStartAt on the latest Firebase end-log
  // (live bug: Jul 10 start reused across dozens of Aug end writes).
  const lastStart = sanitizeLastShiftStartAt(
    state.lastShiftStartAt ??
      genuine?.shiftStartAt ??
      (lastIsPhantom ? null : last?.shiftStartAt ?? null),
  );
  const lastWorked =
    state.lastWorkedMinutes ||
    genuine?.workedMinutes ||
    (lastIsPhantom ? 0 : last?.workedMinutes) ||
    state.workedMinutes ||
    0;

  // Do NOT re-poison weekly minutes from Firebase after a completed 24h rest —
  // remote end-logs still carry the pre-rest weekly total (incl. phantom rows).
  const hoursSinceGenuineRest = restAnchorEnd
    ? (Date.now() - restAnchorEnd) / MS_HOUR
    : Infinity;
  const weeklyResetByRest =
    state.weeklyWorkedMinutes === 0 || hoursSinceGenuineRest >= NZTA_WEEKLY_LOCKOUT_HOURS;
  const remoteWeekly =
    lastIsPhantom ? (genuine?.weeklyWorkedMinutes ?? 0) : (last?.weeklyWorkedMinutes ?? 0);
  const lastWeekly = weeklyResetByRest
    ? 0
    : Math.max(state.weeklyWorkedMinutes, remoteWeekly);

  const hoursSinceEndForContinue = lastEnd ? (Date.now() - lastEnd) / MS_HOUR : Infinity;
  const canContinueWindow =
    hoursSinceEndForContinue < NZTA_REST_CONTINUE_HOURS &&
    !!lastStart &&
    !isShiftWindowExpired(lastStart);

  // Hard lockout after 14h / 70h auto sign-out — cannot start a shift yet.
  // (applyCompletedWeeklyRest above already cleared weekly_rest when genuine rest ≥24h.)
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
        sessionStartedAt: null,
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
    // sessionStartedAt is set when startShiftClock actually goes online.
    next = {
      ...state,
      shiftStartedAt: lastStart,
      shiftWindowEndsAt: shiftWindowEndMs(lastStart!),
      sessionStartedAt: null,
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
      sessionStartedAt: null,
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
  let base = healStaleNztaState(
    applyCompletedWeeklyRest(
      clearExpiredLockout(ensureWeekBucket(await loadNztaHours(cid, id))),
    ),
  );
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
    // Every Start Shift / resume is a new online stint — even inside the same 14h window.
    sessionStartedAt: now,
    workedMinutes: resume ? base.workedMinutes : 0,
    // Fresh break cycle per online stint (offline gaps must not keep a stale "already reminded").
    breakReminderShown: false,
    breakDeferredUntil: null,
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
  const totals = resolveEndShiftHourTotals(state);
  return {
    workedMinutes: totals.workedMinutes,
    weeklyWorkedMinutes: totals.weeklyWorkedMinutes,
    breakMinutes: totals.breakMinutes,
    shiftElapsedMinutes: totals.shiftElapsedMinutes,
  };
}

/** Local NZTA end-shift only — never touches RTDB (Profile path uses this via endShiftRemoteFlow). */
export async function persistLocalNztaEndShift(
  companyId: string,
  uid: string,
  driverId: string,
  reason: EndShiftReason = 'manual',
): Promise<{
  state: NztaHoursState;
  shiftEndAt: number;
  shiftStartAt?: number;
  sessionStartedAt?: number;
  workedMinutes: number;
  weeklyWorkedMinutes: number;
  /** True when this end would poison the 24h rest clock — callers must skip shiftLogs write. */
  skipShiftLogWrite: boolean;
}> {
  const state = clearExpiredLockout(ensureWeekBucket(await loadNztaHours(companyId, uid)));
  const now = Date.now();
  const totals = resolveEndShiftHourTotals(state, now);
  const elapsed = totals.workedMinutes;
  // CRITICAL: never fall back to lastShiftStartAt — that reused Jul 10 across Aug end-logs.
  const shiftStartAt = resolveShiftStartAtForEndLog(state);
  const sessionStartedAt = state.sessionStartedAt ?? undefined;

  // Phantom weekly70h: blocked re-login with no real work — must not refresh lastShiftEndAt
  // or restart the 24h lockout clock (live D001 loop).
  const phantomWeeklyLockout =
    reason === 'weekly70h' &&
    isPhantomWeeklyLockoutEnd({
      workedMinutes: elapsed,
      shiftStartAt,
      sessionStartedAt,
      weeklyWorkedMinutes: totals.weeklyWorkedMinutes,
    });

  let lockoutUntil: number | null = null;
  let lockoutReason: NztaLockoutReason = null;
  if (reason === 'shift14h') {
    lockoutUntil = now + NZTA_REST_CONTINUE_HOURS * MS_HOUR;
    lockoutReason = 'shift_rest';
  } else if (reason === 'weekly70h') {
    if (phantomWeeklyLockout) {
      if (state.lockoutReason === 'weekly_rest' && state.lockoutUntil && state.lockoutUntil > now) {
        // Preserve existing rest clock — do not restart from this attempt.
        lockoutUntil = state.lockoutUntil;
        lockoutReason = 'weekly_rest';
      } else {
        // No active lockout: do not invent a fresh 24h; genuine-rest heal clears on login.
        lockoutUntil = null;
        lockoutReason = null;
      }
    } else {
      lockoutUntil = now + NZTA_WEEKLY_LOCKOUT_HOURS * MS_HOUR;
      lockoutReason = 'weekly_rest';
    }
  }

  const next: NztaHoursState = {
    ...state,
    shiftStartedAt: null,
    shiftWindowEndsAt: null,
    sessionStartedAt: null,
    workedMinutes: elapsed,
    lastShiftEndAt: phantomWeeklyLockout ? state.lastShiftEndAt : now,
    // Only remember this shift's real start (or clear) — do not preserve a stale last.
    lastShiftStartAt: state.shiftStartedAt ?? null,
    lastWorkedMinutes: elapsed,
    weeklyWorkedMinutes: totals.weeklyWorkedMinutes,
    lockoutUntil,
    lockoutReason,
    pendingLimitSignOut: null,
    continuedWindow: false,
    breakReminderShown: reason === 'manual' ? state.breakReminderShown : false,
    breakDeferredUntil: null,
  };
  await saveNztaHours(companyId, uid, next);
  return {
    state: next,
    shiftEndAt: phantomWeeklyLockout ? (state.lastShiftEndAt ?? now) : now,
    shiftStartAt,
    sessionStartedAt,
    workedMinutes: elapsed,
    weeklyWorkedMinutes: totals.weeklyWorkedMinutes,
    skipShiftLogWrite: phantomWeeklyLockout,
  };
}

/**
 * Local NZTA end + best-effort shiftLogs write (hard timeout).
 * Prefer runEndShiftRemoteFlow from the Profile button path.
 */
export async function endShiftClock(
  companyId: string,
  uid: string,
  driverId: string,
  reason: EndShiftReason = 'manual',
  opts?: { vehicleId?: string | null; skipRemoteWrite?: boolean; remoteTimeoutMs?: number },
) {
  const local = await persistLocalNztaEndShift(companyId, uid, driverId, reason);

  if (local.skipShiftLogWrite) {
    return local.state;
  }

  if (opts?.skipRemoteWrite) {
    await journalShiftEndLogFailure({
      companyId,
      uid,
      driverId,
      vehicleId: opts?.vehicleId,
      reason,
      shiftEndAt: local.shiftEndAt,
      shiftStartAt: local.shiftStartAt,
      sessionStartedAt: local.sessionStartedAt,
      workedMinutes: local.workedMinutes,
      weeklyWorkedMinutes: local.weeklyWorkedMinutes,
    }).catch((journalErr) => {
      console.warn('[NZTA] journalShiftEndLogFailure failed:', journalErr);
    });
    return local.state;
  }

  const timeoutMs = opts?.remoteTimeoutMs ?? END_SHIFT_RTDB_TIMEOUT_MS;
  const ok = await attemptWithTimeout(
    writeShiftEndLog(companyId, uid, {
      shiftEndAt: local.shiftEndAt,
      shiftStartAt: local.shiftStartAt,
      sessionStartedAt: local.sessionStartedAt,
      workedMinutes: local.workedMinutes,
      weeklyWorkedMinutes: local.weeklyWorkedMinutes,
      driverId,
      vehicleId: opts?.vehicleId ? String(opts.vehicleId).trim() : undefined,
    }),
    timeoutMs,
    'writeShiftEndLog',
  );
  if (!ok) {
    await journalShiftEndLogFailure({
      companyId,
      uid,
      driverId,
      vehicleId: opts?.vehicleId,
      reason,
      shiftEndAt: local.shiftEndAt,
      shiftStartAt: local.shiftStartAt,
      sessionStartedAt: local.sessionStartedAt,
      workedMinutes: local.workedMinutes,
      weeklyWorkedMinutes: local.weeklyWorkedMinutes,
    }).catch((journalErr) => {
      console.warn('[NZTA] journalShiftEndLogFailure failed:', journalErr);
    });
  }

  return local.state;
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

/** 7-hour dismissible break reminder — active/worked minutes only (not window wall). */
export function needsBreak(state: NztaHoursState) {
  return isBreakDueByActiveWork(state);
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
  const s = applyCompletedWeeklyRest(ensureWeekBucket(state));
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
