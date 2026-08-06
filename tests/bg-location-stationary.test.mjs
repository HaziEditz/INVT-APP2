/**
 * Fix B — background GPS must time-fire while stationary (distanceInterval: 0).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'services/locationService.ts'), 'utf8');

test('background location uses distanceInterval 0 so timeInterval fires when parked', () => {
  const idx = src.indexOf('startLocationUpdatesAsync');
  assert.ok(idx > 0);
  const slice = src.slice(idx, idx + 900);
  assert.match(slice, /timeInterval:\s*15000/);
  assert.match(slice, /distanceInterval:\s*0/);
  assert.doesNotMatch(slice, /distanceInterval:\s*25/);
});

test('startBackgroundTracking restarts updates so new distanceInterval applies', () => {
  const idx = src.indexOf('export async function startBackgroundTracking');
  assert.ok(idx > 0);
  const slice = src.slice(idx, idx + 1600);
  assert.match(slice, /stopLocationUpdatesAsync/);
  assert.match(slice, /hasStartedLocationUpdatesAsync/);
});
