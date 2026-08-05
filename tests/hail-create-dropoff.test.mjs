/**
 * Hail create must not mirror pickup as DropAddress (Active card shows Pending).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib/dispatchApi.ts'), 'utf8');

test('createHailJobOnDispatch does not use pickup as dropoff fallback', () => {
  assert.equal(
    /dropoff:\s*\(params\.dropoff\s*\?\?\s*params\.pickup\)/.test(src),
    false,
    'must not copy pickup into dropoff',
  );
  assert.match(
    src,
    /dropoff:\s*params\.dropoff\?\.address\?\.trim\(\)/,
    'empty hail dropoff when destination unknown',
  );
  assert.match(src, /address:\s*''/);
});
