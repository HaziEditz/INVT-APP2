/**
 * Driver tariff → dispatch Active: keep tariff on online/current even when meter is not running.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'lib/liveMeterPresence.ts'), 'utf8');
const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');

test('loadLiveMeterPresenceFields keeps tariff + jobId when meter not running', () => {
  assert.match(src, /if \(!meter \|\| !meter\.running\)/);
  assert.match(src, /currentJobId: jobId/);
  assert.match(src, /currentTariffName: tariffName \|\| null/);
  assert.doesNotMatch(
    src,
    /if \(!meter \|\| !jobId \|\| !meter\.running\) \{\s*return CLEAR_LIVE_METER_FIELDS/,
  );
});

test('patchOnlineCurrentTariff exported and used on setSelectedTariff', () => {
  assert.match(src, /export async function patchOnlineCurrentTariff/);
  assert.match(ctx, /patchOnlineCurrentTariff/);
  assert.match(ctx, /tariffId: t\.id/);
  assert.match(ctx, /tariffName: t\.name/);
});
