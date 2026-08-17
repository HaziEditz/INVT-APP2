import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('platformPaymentApi hard-caps fetch and token work', () => {
  const src = readFileSync(join(root, 'lib/platformPaymentApi.ts'), 'utf8');
  assert.match(src, /PAYMENTS_API_TIMEOUT_MS/);
  assert.match(src, /AbortController/);
  assert.match(src, /payments\.getIdToken/);
  assert.match(src, /AUTH_TOKEN_REFRESH_TIMEOUT_MS/);
});

test('shouldSimulateTapToPay is explicit opt-in only (not __DEV__)', () => {
  const src = readFileSync(join(root, 'lib/platformPaymentApi.ts'), 'utf8');
  assert.match(src, /EXPO_PUBLIC_STRIPE_TERMINAL_SIMULATED/);
  const fn = src.slice(src.indexOf('export function shouldSimulateTapToPay'));
  assert.doesNotMatch(fn, /__DEV__/);
  const sheet = readFileSync(join(root, 'components/TapToPaySheet.tsx'), 'utf8');
  assert.match(sheet, /shouldSimulateTapToPay/);
  assert.doesNotMatch(sheet, /simulated:\s*__DEV__/);
});

test('TapToPay uses server PI via retrievePaymentIntent (no dual create)', () => {
  const sheet = readFileSync(join(root, 'components/TapToPaySheet.tsx'), 'utf8');
  assert.match(sheet, /retrievePaymentIntent\(intent\.clientSecret\)/);
  assert.doesNotMatch(sheet, /terminal\.createPaymentIntent/);
  assert.match(sheet, /recordTapLedger failed \(continuing to close trip\)/);
});

test('TapToPay tears down reader before rediscover and after decline/fail', () => {
  const sheet = readFileSync(join(root, 'components/TapToPaySheet.tsx'), 'utf8');
  assert.match(sheet, /async function teardownTapReader/);
  assert.match(sheet, /cancelCollectPaymentMethod/);
  assert.match(sheet, /disconnectReader/);
  assert.match(sheet, /Resetting reader/);
  // teardown before discover, and on catch after fail (decline path)
  const startIdx = sheet.indexOf('const start = useCallback');
  const startFn = sheet.slice(startIdx, sheet.indexOf('}, [amountCents, bookingId'));
  assert.match(startFn, /await teardownTapReader\(terminal\)/);
  assert.ok(
    (startFn.match(/await teardownTapReader\(terminal\)/g) || []).length >= 2,
    'teardown must run before discover and after failure/success',
  );
  assert.match(sheet, /handleClose/);
});

test('eas.json does not enable simulated Tap to Pay', () => {
  const eas = readFileSync(join(root, 'eas.json'), 'utf8');
  assert.doesNotMatch(eas, /EXPO_PUBLIC_STRIPE_TERMINAL_SIMULATED["']?\s*:\s*["']1["']/);
});
