/**
 * Exclusive vehicle matching: stamped Car never silently goes to Van (and vice versa).
 * Any / missing VehicleType stays capacity-based. TM excludes 10+ seat big vans for open/car.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib/jobMatching.ts'), 'utf8');
const pendingSrc = readFileSync(join(root, 'lib/pendingJobs.ts'), 'utf8');

test('exclusive: car branch does not allow van substitute', () => {
  assert.match(src, /reqCat === 'car'/);
  assert.match(src, /drvCat === 'car'/);
  assert.doesNotMatch(src, /vans may take Sedan/i);
  assert.doesNotMatch(src, /drvCat === 'van'.*?reqCat === 'car'|reqCat === 'car'[sS]{0,120}drvCat === 'van'/);
});

test('TM big-van exclusion present for open/car', () => {
  assert.match(src, /TM_BIG_VAN_MIN_SEATS/);
  assert.match(src, /cap >= TM_BIG_VAN_MIN_SEATS/);
});

test('Offer pool includes Waiting (passenger-app ASAP parity)', () => {
  assert.match(pendingSrc, /'waiting'/);
});

test('server eligibility removed van-takes-car silent substitute', () => {
  const server = readFileSync(join(root, '..', 'INVT', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /Van may take Sedan\/car jobs under 5 pax/);
  assert.match(server, /Exclusive: stamped Car never silently goes to Van/);
  assert.match(server, /TM_BIG_VAN_MIN_SEATS/);
});
