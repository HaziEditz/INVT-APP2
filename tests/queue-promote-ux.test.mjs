/**
 * Source contracts for Offers lock restore + queue-promote attention (no modal).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('queue promote uses ~5s looping beep + flash (no Alert modal)', () => {
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /signalQueuePromoteAttention/);
  assert.match(ctx, /longerBeep:\s*true/);
  assert.match(ctx, /setQueuePromoteFlash\(true\)/);
  assert.match(ctx, /5200/);
  assert.doesNotMatch(
    ctx,
    /adoptPromotedQueueOfferAsActive[\s\S]{0,800}Alert\.alert\(\s*['"]Queued/,
  );
  const sound = readFileSync(join(root, 'lib/notificationSound.ts'), 'utf8');
  assert.match(sound, /setIsLoopingAsync\(true\)/);
  assert.match(sound, /5000/);
  const flash = readFileSync(join(root, 'components/QueuePromoteFlash.tsx'), 'utf8');
  assert.match(flash, /queuePromoteFlash/);
  assert.match(flash, /pointerEvents="none"/);
  assert.match(flash, /iterations:\s*8/);
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

test('HomeMainTabs hides Offers and Queue tabs when locked', () => {
  const tabs = readFileSync(join(root, 'components/home/HomeMainTabs.tsx'), 'utf8');
  assert.match(tabs, /offersLocked\s*\?\s*\[\s*\]/);
  assert.match(tabs, /id: 'queue'/);
  // Queue only rendered when not locked (same gate as Offers).
  assert.match(
    tabs,
    /offersLocked\s*\?\s*\[\s*\]\s*:\s*\[\s*\{\s*id:\s*'queue'/,
  );
});

test('presence listener keeps readyForJobs during queue promote Busy', () => {
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /promotingQueue && !onTrip/);
  assert.match(ctx, /queuePromoteCandidateIdRef\.current \|\| queuedOffersRef/);
});

test('trip layout uses window height so details stay readable after Accept', () => {
  const index = readFileSync(join(root, 'app/(tabs)/index.tsx'), 'utf8');
  assert.match(index, /useWindowDimensions/);
  assert.match(index, /tripLayout\.workMin/);
  assert.match(index, /tripLayout\.mapMax/);
  assert.match(index, /mainTab === 'queue'/);
});
