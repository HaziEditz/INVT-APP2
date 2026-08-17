/**
 * Payment back must not abandon an incomplete job — no Leave incomplete exit.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modalSrc = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
const fallbackSrc = readFileSync(join(root, 'components/PaymentModalFallback.tsx'), 'utf8');

test('PaymentModal has no Leave incomplete / dismissPayment exit from UI', () => {
  assert.match(modalSrc, /remindPaymentRequired/);
  assert.match(modalSrc, /Payment required/);
  assert.doesNotMatch(modalSrc, /Leave incomplete/);
  assert.doesNotMatch(modalSrc, /confirmLeaveIncompletePayment/);
  assert.doesNotMatch(modalSrc, /dismissPayment/);
  assert.doesNotMatch(modalSrc, /← Back to trip/);
});

test('PaymentModal consumes Android hardware back without dismissing payment', () => {
  assert.match(modalSrc, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(modalSrc, /onRequestClose=\{/);
  assert.match(modalSrc, /if \(cardScanOpen \|\| tapToPayOpen\) return false/);
  assert.match(modalSrc, /return true; \/\/ consume/);
});

test('PaymentModalFallback only offers Try again — never dismissPayment', () => {
  assert.match(fallbackSrc, /Try again/);
  assert.doesNotMatch(fallbackSrc, /Leave incomplete/);
  assert.doesNotMatch(fallbackSrc, /dismissPayment/);
  assert.match(fallbackSrc, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(fallbackSrc, /onRequestClose=\{stayOnPayment\}/);
});
