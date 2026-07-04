export const Colors = {
  background: '#0A0A0F',
  surface: '#14141C',
  surfaceElevated: '#1C1C28',
  border: '#2A2A3A',
  text: '#F5F5F7',
  textMuted: '#9CA3AF',
  accent: '#1a73e8',
  accentDark: '#1557b0',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  taxi: '#1a73e8',
  freight: '#8B5CF6',
  food: '#F97316',
  tow: '#EF4444',
  acc: '#06B6D4',
  tm: '#10B981',
} as const;

export const DISPATCH_API_URL = 'https://invt-production.up.railway.app';

export const PAYMENT_TYPES = [
  'Cash',
  'Card',
  'Account/Corporate',
  'Total Mobility',
  'ACC',
  'Gift Card',
  'Wallet',
] as const;

export const JOB_TYPES = ['Taxi', 'Freight', 'Food', 'Tow'] as const;

export const JOB_STAGES = ['pickup', 'arrived', 'onboard', 'complete'] as const;

/** Maximum total shift length (work + break time) — auto sign-out */
export const NZTA_MAX_SHIFT_HOURS = 14;
/** Break reminder after this many hours on shift (dismissible) */
export const NZTA_BREAK_AFTER_HOURS = 7;
/** NZTA weekly working limit (Monday–Sunday) */
export const NZTA_WEEKLY_MAX_HOURS = 70;
/** Resume same 14h shift if rest is under this many hours; also 14h-limit lockout length */
export const NZTA_REST_CONTINUE_HOURS = 10;
/** Lockout after weekly 70h limit */
export const NZTA_WEEKLY_LOCKOUT_HOURS = 24;
/** @deprecated use NZTA_WEEKLY_LOCKOUT_HOURS */
export const NZTA_REST_WEEKLY_RESET_HOURS = NZTA_WEEKLY_LOCKOUT_HOURS;
/** @deprecated — shift limit is NZTA_MAX_SHIFT_HOURS */
export const NZTA_MAX_WORK_HOURS = NZTA_MAX_SHIFT_HOURS;
/** @deprecated use NZTA_MAX_SHIFT_HOURS */
export const NZTA_MAX_HOURS = NZTA_MAX_SHIFT_HOURS;
