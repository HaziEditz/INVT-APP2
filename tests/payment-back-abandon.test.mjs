/**
 * Payment back must not silently abandon an incomplete job.
 * Source-level guardrails for PaymentModal + Fallback.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modalSrc = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
const fallbackSrc = readFileSync(join(root, 'components/PaymentModalFallback.tsx'), 'utf8');

test('PaymentModal Back to trip requires incomplete-payment confirmation', () => {
  assert.match(modalSrc, /confirmLeaveIncompletePayment/);
  assert.match(modalSrc, /Payment not complete/);
  assert.match(modalSrc, /onPress=\{requestLeavePayment\}/);
  assert.doesNotMatch(
    modalSrc,
    /<Pressable onPress=\{dismissPayment\} style=\{styles\.backLink\}>/,
  );
});

test('PaymentModal consumes Android hardware back (with nested-overlay carve-out)', () => {
  assert.match(modalSrc, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(modalSrc, /onRequestClose=\{/);
  assert.match(modalSrc, /if \(cardScanOpen \|\| tapToPayOpen\) return false/);
  assert.match(modalSrc, /return true; \/\/ consume/);
});

test('PaymentModalFallback cannot leave incomplete payment without confirm', () => {
  assert.match(fallbackSrc, /Payment not complete/);
  assert.match(fallbackSrc, /Leave incomplete/);
  assert.match(fallbackSrc, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(fallbackSrc, /onRequestClose=\{requestLeavePayment\}/);
  assert.doesNotMatch(fallbackSrc, /onPress=\{dismissPayment\}/);
});
