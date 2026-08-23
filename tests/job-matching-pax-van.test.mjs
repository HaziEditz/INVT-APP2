/**
 * Client vehicle match mirrors server: 5+ passengers require a van.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib/jobMatching.ts'), 'utf8');

test('jobMatchesDriverVehicle forces van for 5+ passengers (server parity)', () => {
  assert.match(src, /if\s*\(\s*reqPax\s*>=\s*5\s*\)\s*reqCat\s*=\s*['"]van['"]/);
});

test('Offers pool lock disabled for Option 1 (browsable while busy)', () => {
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(
    ctx,
    /function isDispatchEnrouteOffersLocked[\s\S]*?\{\s*return false;\s*\}/,
  );
});
