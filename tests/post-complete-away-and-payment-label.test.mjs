/**
 * Post-complete Away suppression + Closed Jobs TM payment labels (pure).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSuppressMissAwayAfterTripClear } from '../lib/tripJournalFlushPolicy.ts';

test('miss→Away suppressed while Syncing / local completion / pending journal', () => {
  assert.equal(
    shouldSuppressMissAwayAfterTripClear({
      pendingTripSync: false,
      syncingBanner: false,
      localCompletion: false,
    }),
    false,
  );
  assert.equal(
    shouldSuppressMissAwayAfterTripClear({
      pendingTripSync: true,
      syncingBanner: false,
      localCompletion: false,
    }),
    true,
  );
  assert.equal(
    shouldSuppressMissAwayAfterTripClear({
      pendingTripSync: false,
      syncingBanner: true,
      localCompletion: false,
    }),
    true,
  );
  assert.equal(
    shouldSuppressMissAwayAfterTripClear({
      pendingTripSync: false,
      syncingBanner: false,
      localCompletion: true,
    }),
    true,
  );
});

/** Mirror of formatClosedJobPaymentLabel — keep in sync with lib/earnings.ts */
function formatClosedJobPaymentLabel(job) {
  const remainder = String(
    job.tmRemainderPaymentType || job.paymentType || job.PaymentType || '',
  ).trim();
  const tmMarker = String(job.tmPaymentType || '').toLowerCase();
  const isTm =
    !!job.tmRemainderPaymentType ||
    tmMarker.includes('mobility') ||
    tmMarker === 'tm' ||
    tmMarker.includes('total_mobility');
  if (!isTm) {
    const s = String(remainder || job.paymentType || 'cash').toLowerCase();
    if (s.includes('card')) return 'Card';
    if (s.includes('account')) return 'Account';
    return 'Cash';
  }
  const rem = String(remainder || 'Cash').toLowerCase();
  const remLabel = rem.includes('card')
    ? 'Card'
    : rem.includes('account')
      ? 'Account'
      : rem.includes('mobility') || rem === 'tm'
        ? 'Total Mobility'
        : 'Cash';
  if (remLabel === 'Total Mobility') return 'Total Mobility';
  return `TM + ${remLabel}`;
}

test('Closed Jobs list shows TM + remainder, not Cash alone', () => {
  assert.equal(
    formatClosedJobPaymentLabel({
      paymentType: 'Cash',
      tmPaymentType: 'total_mobility',
      tmRemainderPaymentType: 'Cash',
    }),
    'TM + Cash',
  );
  assert.equal(
    formatClosedJobPaymentLabel({
      paymentType: 'Card',
      tmPaymentType: 'total_mobility',
      tmRemainderPaymentType: 'Card',
    }),
    'TM + Card',
  );
  assert.equal(
    formatClosedJobPaymentLabel({
      paymentType: 'Cash',
    }),
    'Cash',
  );
});
