import { EarningsBucket, normalizePaymentBucket, sumBreakdown } from '@/lib/earnings';
import { HistoryJob } from '@/lib/jobHistory';

export type HistoryPeriod = 'today' | 'week' | 'month' | 'all';
export type PaymentFilter = 'all' | EarningsBucket;

export const PERIOD_OPTIONS: { id: HistoryPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];

export const PAYMENT_FILTER_OPTIONS: { id: PaymentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'account', label: 'Account' },
  { id: 'tm', label: 'TM' },
  { id: 'acc', label: 'ACC' },
];

export function getPeriodStartMs(period: HistoryPeriod): number | null {
  const now = new Date();
  if (period === 'all') return null;
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (period === 'week') {
    const d = new Date(now);
    const day = d.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - daysFromMonday);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  return null;
}

export function getPeriodLabel(period: HistoryPeriod): string {
  return PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? period;
}

export function filterJobsByPeriod(jobs: HistoryJob[], period: HistoryPeriod): HistoryJob[] {
  const start = getPeriodStartMs(period);
  if (start === null) return jobs;
  return jobs.filter((j) => j.completedAt >= start);
}

export function filterJobsByPayment(jobs: HistoryJob[], payment: PaymentFilter): HistoryJob[] {
  if (payment === 'all') return jobs;
  return jobs.filter((j) => {
    if (j.status !== 'completed') return false;
    return normalizePaymentBucket(j.paymentType) === payment;
  });
}

export function applyHistoryFilters(
  jobs: HistoryJob[],
  period: HistoryPeriod,
  payment: PaymentFilter,
): HistoryJob[] {
  const byPeriod = filterJobsByPeriod(jobs, period);
  if (payment === 'all') return byPeriod;
  const completed = byPeriod.filter((j) => j.status === 'completed' && normalizePaymentBucket(j.paymentType) === payment);
  return completed;
}

export function periodSummary(jobs: HistoryJob[]) {
  const completed = jobs.filter((j) => j.status === 'completed');
  const cancelled = jobs.filter((j) => j.status === 'cancelled');
  const noshows = jobs.filter((j) => j.status === 'noshow');
  return {
    completed,
    cancelled,
    noshows,
    earnings: sumBreakdown(completed),
    completedCount: completed.length,
    cancelledCount: cancelled.length,
    noshowCount: noshows.length,
  };
}
