import {
  NZTA_BREAK_AFTER_HOURS,
  NZTA_MAX_SHIFT_HOURS,
  NZTA_MAX_WORK_HOURS,
} from '@/constants/theme';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { notifyBreakReminder } from '@/services/notificationService';
import { NztaHoursState } from '@/types';

const DEFAULT: NztaHoursState = {
  shiftStartedAt: null,
  workedMinutes: 0,
  breakMinutes: 0,
  lastBreakAt: null,
  breakReminderShown: false,
  breakDeferredUntil: null,
};

export async function loadNztaHours(): Promise<NztaHoursState> {
  const saved = await getData<NztaHoursState>(STORAGE_KEYS.nztaHours);
  return { ...DEFAULT, ...saved };
}

export async function saveNztaHours(state: NztaHoursState) {
  await storeData(STORAGE_KEYS.nztaHours, state);
}

export async function startShiftClock() {
  const next: NztaHoursState = {
    ...DEFAULT,
    shiftStartedAt: Date.now(),
    breakReminderShown: false,
    breakDeferredUntil: null,
  };
  await saveNztaHours(next);
  return next;
}

export async function tickWorkedMinutes(addMinutes = 1) {
  const state = await loadNztaHours();
  const next = { ...state, workedMinutes: state.workedMinutes + addMinutes };
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

export function needsBreak(state: NztaHoursState) {
  if (state.breakReminderShown) return false;
  if (state.breakDeferredUntil && Date.now() < state.breakDeferredUntil) return false;
  return state.workedMinutes / 60 >= NZTA_BREAK_AFTER_HOURS;
}

export function exceedsMaxWorkHours(state: NztaHoursState) {
  return state.workedMinutes / 60 >= NZTA_MAX_WORK_HOURS;
}

export function exceedsMaxShiftHours(state: NztaHoursState) {
  if (!state.shiftStartedAt) return false;
  const shiftHours = (Date.now() - state.shiftStartedAt) / 3600000;
  return shiftHours >= NZTA_MAX_SHIFT_HOURS;
}

export async function deferBreakReminder(minutes: number) {
  const state = await loadNztaHours();
  const next = {
    ...state,
    breakDeferredUntil: Date.now() + minutes * 60000,
  };
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

export async function endShiftClock() {
  await saveNztaHours(DEFAULT);
  return DEFAULT;
}

/** @deprecated */
export async function markBreakTaken() {
  return confirmBreakTaken();
}
