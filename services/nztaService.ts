import {
  NZTA_BREAK_AFTER_HOURS,
  NZTA_MAX_SHIFT_HOURS,
  NZTA_MAX_WORK_HOURS,
  NZTA_REST_CONTINUE_HOURS,
  NZTA_REST_WEEKLY_RESET_HOURS,
  NZTA_WEEKLY_MAX_HOURS,
} from '@/constants/theme';
import { loadLastShiftEnd, writeShiftEndLog } from '@/lib/shiftLogs';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { notifyBreakReminder } from '@/services/notificationService';
import { NztaHoursState } from '@/types';

const DEFAULT: NztaHoursState = {
  shiftStartedAt: null,
  shiftWindowEndsAt: null,
  workedMinutes: 0,
  weeklyWorkedMinutes: 0,
  breakMinutes: 0,
  lastBreakAt: null,
  breakReminderShown: false,
  breakDeferredUntil: null,
  lastShiftEndAt: null,
  continuedWindow: false,
};

const MS_HOUR = 3600000;

export async function loadNztaHours(): Promise<NztaHoursState> {
  const saved = await getData<NztaHoursState>(STORAGE_KEYS.nztaHours);
  return { ...DEFAULT, ...saved };
}

export async function saveNztaHours(state: NztaHoursState) {
  await storeData(STORAGE_KEYS.nztaHours, state);
}

export async function initializeNztaOnLogin(companyId: string, uid: string): Promise<NztaHoursState> {
  const last = await loadLastShiftEnd(companyId, uid);
  const lastEnd = last?.shiftEndAt ?? null;
  const now = Date.now();
  const hoursSinceEnd = lastEnd ? (now - lastEnd) / MS_HOUR : Infinity;

  let next: NztaHoursState = { ...DEFAULT, lastShiftEndAt: lastEnd };

  if (hoursSinceEnd >= NZTA_REST_WEEKLY_RESET_HOURS) {
    next.weeklyWorkedMinutes = 0;
    next.workedMinutes = 0;
    next.continuedWindow = false;
  } else if (hoursSinceEnd < NZTA_REST_CONTINUE_HOURS && last?.shiftStartAt) {
    next.shiftStartedAt = last.shiftStartAt;
    next.shiftWindowEndsAt = last.shiftStartAt + NZTA_MAX_SHIFT_HOURS * MS_HOUR;
    next.workedMinutes = last.workedMinutes ?? 0;
    next.weeklyWorkedMinutes = last.weeklyWorkedMinutes ?? next.workedMinutes;
    next.continuedWindow = true;
  } else {
    next.workedMinutes = 0;
    next.weeklyWorkedMinutes = last?.weeklyWorkedMinutes ?? 0;
    next.continuedWindow = false;
  }

  await saveNztaHours(next);
  return next;
}

export async function startShiftClock(companyId?: string, uid?: string) {
  let base = await loadNztaHours();
  if (companyId && uid && !base.shiftStartedAt) {
    base = await initializeNztaOnLogin(companyId, uid);
  }
  const now = Date.now();
  const next: NztaHoursState = {
    ...base,
    shiftStartedAt: base.continuedWindow && base.shiftStartedAt ? base.shiftStartedAt : now,
    shiftWindowEndsAt:
      (base.continuedWindow && base.shiftWindowEndsAt
        ? base.shiftWindowEndsAt
        : now + NZTA_MAX_SHIFT_HOURS * MS_HOUR),
    breakReminderShown: false,
    breakDeferredUntil: null,
  };
  await saveNztaHours(next);
  return next;
}

export async function endShiftClock(companyId: string, uid: string, driverId: string) {
  const state = await loadNztaHours();
  const now = Date.now();
  await writeShiftEndLog(companyId, uid, {
    shiftEndAt: now,
    shiftStartAt: state.shiftStartedAt ?? undefined,
    workedMinutes: state.workedMinutes,
    weeklyWorkedMinutes: state.weeklyWorkedMinutes,
    driverId,
  });
  await saveNztaHours(DEFAULT);
  return DEFAULT;
}

export async function tickWorkedMinutes(addMinutes = 1) {
  const state = await loadNztaHours();
  const next = {
    ...state,
    workedMinutes: state.workedMinutes + addMinutes,
    weeklyWorkedMinutes: state.weeklyWorkedMinutes + addMinutes,
  };
  await saveNztaHours(next);
  return next;
}

export async function addBreakMinutes(minutes: number) {
  const state = await loadNztaHours();
  const next = {
    ...state,
    breakMinutes: state.breakMinutes + minutes,
    lastBreakAt: Date.now(),
    breakReminderShown: true,
    breakDeferredUntil: null,
  };
  await saveNztaHours(next);
  return next;
}

export function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function shiftElapsedMinutes(state: NztaHoursState) {
  if (!state.shiftStartedAt) return 0;
  return Math.floor((Date.now() - state.shiftStartedAt) / 60000);
}

export function remainingShiftMinutes(state: NztaHoursState): number {
  if (!state.shiftWindowEndsAt) return NZTA_MAX_SHIFT_HOURS * 60;
  return Math.max(0, Math.floor((state.shiftWindowEndsAt - Date.now()) / 60000));
}

export function remainingWeeklyMinutes(state: NztaHoursState): number {
  return Math.max(0, NZTA_WEEKLY_MAX_HOURS * 60 - state.weeklyWorkedMinutes);
}

export function remainingWorkMinutesToday(state: NztaHoursState): number {
  return Math.max(0, NZTA_MAX_WORK_HOURS * 60 - state.workedMinutes);
}

export function needsBreak(state: NztaHoursState) {
  if (state.breakReminderShown) return false;
  if (state.breakDeferredUntil && Date.now() < state.breakDeferredUntil) return false;
  return state.workedMinutes / 60 >= NZTA_BREAK_AFTER_HOURS;
}

export function exceedsMaxWorkHours(state: NztaHoursState) {
  return state.workedMinutes / 60 >= NZTA_MAX_WORK_HOURS;
}

export function exceedsMaxShiftHours(state: NztaHoursState) {
  if (!state.shiftWindowEndsAt) return false;
  return Date.now() >= state.shiftWindowEndsAt;
}

export async function deferBreakReminder(minutes: number) {
  const state = await loadNztaHours();
  const next = { ...state, breakDeferredUntil: Date.now() + minutes * 60000 };
  await saveNztaHours(next);
  await notifyBreakReminder(
    'Break reminder',
    `NZTA recommends a break. We'll remind you again in ${minutes} minutes.`,
    minutes,
  );
  return next;
}

export async function confirmBreakTaken() {
  const state = await loadNztaHours();
  const next = {
    ...state,
    lastBreakAt: Date.now(),
    breakReminderShown: true,
    breakDeferredUntil: null,
    breakMinutes: state.breakMinutes + 15,
  };
  await saveNztaHours(next);
  return next;
}

export async function markBreakReminderShown() {
  const state = await loadNztaHours();
  const next = { ...state, breakReminderShown: true };
  await saveNztaHours(next);
  return next;
}

export async function markBreakTaken() {
  return confirmBreakTaken();
}
