/**
 * Fix A companion — active-bookings retries once on edge 502/503.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib/dispatchApi.ts'), 'utf8');

test('fetchDriverActiveBookings retries once on 502/503', () => {
  const idx = src.indexOf('export async function fetchDriverActiveBookings');
  assert.ok(idx > 0);
  const slice = src.slice(idx, idx + 1200);
  assert.match(slice, /err\.status === 502 \|\| err\.status === 503/);
  assert.match(slice, /await driverApiGet\(path\)/);
});
