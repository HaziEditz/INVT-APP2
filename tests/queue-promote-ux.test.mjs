/**
 * Source contracts for Offers lock restore + queue-promote attention (no modal).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('queue promote uses longer beep + flash (no Alert modal)', () => {
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /signalQueuePromoteAttention/);
  assert.match(ctx, /longerBeep:\s*true/);
  assert.match(ctx, /setQueuePromoteFlash\(true\)/);
  assert.doesNotMatch(
    ctx,
    /adoptPromotedQueueOfferAsActive[\s\S]{0,800}Alert\.alert\(\s*['"]Queued/,
  );
  const flash = readFileSync(join(root, 'components/QueuePromoteFlash.tsx'), 'utf8');
  assert.match(flash, /queuePromoteFlash/);
  assert.match(flash, /pointerEvents="none"/);
});

test('recently-completed jobs suppress already-completed Alert on promote race', () => {
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /recentlyCompletedJobIdsRef/);
  assert.match(ctx, /recentlyCompletedLocally/);
  assert.match(
    ctx,
    /String\(activeJobIdRef\.current\) === String\(activeJob\.id\)/,
  );
});

test('HomeMainTabs hides Offers tab when locked (not merely disabled)', () => {
  const tabs = readFileSync(join(root, 'components/home/HomeMainTabs.tsx'), 'utf8');
  assert.match(tabs, /offersLocked\s*\?\s*\[\s*\]/);
});

test('trip layout uses window height so details stay readable after Accept', () => {
  const index = readFileSync(join(root, 'app/(tabs)/index.tsx'), 'utf8');
  assert.match(index, /useWindowDimensions/);
  assert.match(index, /tripLayout\.workMin/);
  assert.match(index, /tripLayout\.mapMax/);
});
