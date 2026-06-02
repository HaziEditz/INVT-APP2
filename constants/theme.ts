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

export const NZTA_MAX_HOURS = 13;
export const NZTA_BREAK_AFTER_HOURS = 5;
