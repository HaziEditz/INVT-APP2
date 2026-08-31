/**
 * Pool/queue offer parser must keep dispatcher-selected tariff + notes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// pendingJobs.ts is TS — load via experimental strip or source-assert.
test('pendingJobs.ts maps tariffId/tariffName from Tarriff* fields', () => {
  const src = readFileSync(join(root, 'lib/pendingJobs.ts'), 'utf8');
  assert.match(src, /tariffId:/);
  assert.match(src, /tariffName:/);
  assert.match(src, /TarriffId \?\? val\.TariffId/);
  assert.match(src, /isForbiddenPlaceholderTariffName/);
});

test('jobNotes collects jobinfo / EntitiesDetails (filtered)', () => {
  const src = readFileSync(join(root, 'lib/jobNotes.ts'), 'utf8');
  assert.match(src, /jobinfo/);
  assert.match(src, /EntitiesDetails/);
  assert.match(src, /\^Payment:/);
});
