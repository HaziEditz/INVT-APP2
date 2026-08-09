/**
 * Guardrail: LazyPaymentModalHost must use a relative require so Metro can resolve it.
 * (require('@/…') returns undefined under Expo Metro without babel-plugin-module-resolver.)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = path.join(root, 'components', 'LazyPaymentModalHost.tsx');

test('LazyPaymentModalHost uses relative require for PaymentModal', () => {
  const src = fs.readFileSync(hostPath, 'utf8');
  assert.match(src, /require\(['"]\.\/PaymentModal['"]\)/);
  assert.doesNotMatch(src, /require\(['"]@\/components\/PaymentModal['"]\)/);
});

test('PaymentModal defers CardScan/Tap native modules via relative require', () => {
  const src = fs.readFileSync(path.join(root, 'components', 'PaymentModal.tsx'), 'utf8');
  assert.match(src, /require\(['"]\.\/CardScanModal['"]\)/);
  assert.match(src, /require\(['"]\.\/TapToPaySheet['"]\)/);
  assert.doesNotMatch(src, /import \{ CardScanModal \}/);
  assert.doesNotMatch(src, /import \{ TapToPaySheet \}/);
});
