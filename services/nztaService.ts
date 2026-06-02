import { NZTA_BREAK_AFTER_HOURS, NZTA_MAX_HOURS } from '@/constants/theme';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { NztaHoursState } from '@/types';

const DEFAULT: NztaHoursState = {
  shiftStartedAt: null,
  workedMinutes: 0,
  lastBreakAt: null,
  breakReminderShown: false,
};

export async function loadNztaHours(): Promise<NztaHoursState> {
  return (await getData<NztaHoursState>(STORAGE_KEYS.nztaHours)) ?? DEFAULT;
}

export async function saveNztaHours(state: NztaHoursState) {
  await storeData(STORAGE_KEYS.nztaHours, state);
}

export async function startShiftClock() {
  const state = await loadNztaHours();
  const next = {
    ...state,
    shiftStartedAt: Date.now(),
    breakReminderShown: false,
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

export function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function needsBreak(state: NztaHoursState) {
  const hours = state.workedMinutes / 60;
  return hours >= NZTA_BREAK_AFTER_HOURS && !state.breakReminderShown;
}

export function exceedsMaxHours(state: NztaHoursState) {
  return state.workedMinutes / 60 >= NZTA_MAX_HOURS;
}

export async function markBreakTaken() {
  const state = await loadNztaHours();
  const next = {
    ...state,
    lastBreakAt: Date.now(),
    breakReminderShown: true,
  };
  await saveNztaHours(next);
  return next;
}

export async function endShiftClock() {
  await saveNztaHours(DEFAULT);
  return DEFAULT;
}
