import { PaymentType } from '@/types';

export type EarningsBucket = 'cash' | 'card' | 'account' | 'tm' | 'acc';

export interface EarningsBreakdown {
  cash: number;
  card: number;
  account: number;
  tm: number;
  acc: number;
  total: number;
}

export const EMPTY_EARNINGS: EarningsBreakdown = {
  cash: 0,
  card: 0,
  account: 0,
  tm: 0,
  acc: 0,
  total: 0,
};

export function normalizePaymentBucket(raw?: string | PaymentType | null): EarningsBucket {
  const s = String(raw ?? 'cash').toLowerCase().replace(/_/g, ' ');
  if (s.includes('card') || s.includes('eftpos')) return 'card';
  if (s.includes('account') || s.includes('corporate') || s === 'acct') return 'account';
  if (s.includes('mobility') || s === 'tm' || s.includes('total mobility')) return 'tm';
  if (s.includes('acc')) return 'acc';
  return 'cash';
}

export function addToBreakdown(
  breakdown: EarningsBreakdown,
  fare: number,
  paymentType?: string | PaymentType | null,
): EarningsBreakdown {
  const bucket = normalizePaymentBucket(paymentType);
  const next = { ...breakdown, [bucket]: breakdown[bucket] + fare, total: breakdown.total + fare };
  return next;
}

export function sumBreakdown(jobs: { fare?: number; paymentType?: string | PaymentType | null }[]): EarningsBreakdown {
  return jobs.reduce((acc, j) => addToBreakdown(acc, j.fare ?? 0, j.paymentType), { ...EMPTY_EARNINGS });
}

export const EARNINGS_LABELS: Record<EarningsBucket, string> = {
  cash: 'Cash',
  card: 'Card',
  account: 'Account',
  tm: 'Total Mobility',
  acc: 'ACC',
};

export function formatPaymentLabel(raw?: string | PaymentType | null): string {
  const bucket = normalizePaymentBucket(raw);
  return EARNINGS_LABELS[bucket];
}
