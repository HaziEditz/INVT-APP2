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

test('TapToPay tears down only when connectedReader is present', () => {
  const sheet = readFileSync(join(root, 'components/TapToPaySheet.tsx'), 'utf8');
  assert.match(sheet, /async function teardownTapReader/);
  assert.match(sheet, /cancelCollectPaymentMethod/);
  assert.match(sheet, /disconnectReader/);
  // Guard: never disconnect on cold start
  const teardownFn = sheet.slice(
    sheet.indexOf('async function teardownTapReader'),
    sheet.indexOf('function discoverTapToPayReader'),
  );
  assert.match(teardownFn, /if\s*\(\s*!terminal\?\.connectedReader\s*\)\s*return/);
  assert.doesNotMatch(
    teardownFn,
    /else if \(typeof terminal\.disconnectReader/,
    'must not disconnect when connectedReader is absent',
  );

  const startIdx = sheet.indexOf('const start = useCallback');
  const startFn = sheet.slice(startIdx, sheet.indexOf('}, [amountCents, bookingId'));
  assert.match(startFn, /if\s*\(\s*terminal\.connectedReader\s*\)/);
  assert.match(startFn, /skip teardown \(no connectedReader\)/);
  assert.match(sheet, /handleClose/);
});

test('TapToPay acquires readers via onUpdateDiscoveredReaders (not post-await discoveredReaders)', () => {
  const sheet = readFileSync(join(root, 'components/TapToPaySheet.tsx'), 'utf8');
  assert.match(sheet, /onUpdateDiscoveredReaders/);
  assert.match(sheet, /function discoverTapToPayReader/);
  assert.match(sheet, /useStripeTerminal\(\s*\{\s*onUpdateDiscoveredReaders/);
  assert.doesNotMatch(sheet, /terminal\.discoveredReaders\s*\?\.\s*\[\s*0\s*\]/);
  assert.match(sheet, /discoverTapToPayReader\(terminal,\s*discoverWaiterRef/);
});

test('eas.json does not enable simulated Tap to Pay', () => {
  const eas = readFileSync(join(root, 'eas.json'), 'utf8');
  assert.doesNotMatch(eas, /EXPO_PUBLIC_STRIPE_TERMINAL_SIMULATED["']?\s*:\s*["']1["']/);
});

test('eas.json preview/production bake Terminal location ID', () => {
  const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
  for (const profile of ['development', 'preview', 'production', 'preview-production']) {
    assert.equal(
      eas.build[profile].env.EXPO_PUBLIC_STRIPE_TERMINAL_LOCATION_ID,
      'tml_GnUMTgohbETmrc',
      `${profile} must set Terminal location`,
    );
  }
});

test('TapToPay keeps hardcoded location fallback for OTA (eas.json env not applied on update)', () => {
  const sheet = readFileSync(join(root, 'components/TapToPaySheet.tsx'), 'utf8');
  assert.match(sheet, /BOOKAWAKA_TERMINAL_LOCATION_ID\s*=\s*['"]tml_GnUMTgohbETmrc['"]/);
  assert.match(sheet, /BOOKAWAKA_TERMINAL_LOCATION_ID/);
  const cfg = readFileSync(join(root, 'app.config.js'), 'utf8');
  assert.match(cfg, /stripeTerminalLocationId/);
  assert.match(cfg, /tml_GnUMTgohbETmrc/);
});
