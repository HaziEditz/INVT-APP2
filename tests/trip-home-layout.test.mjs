/**
 * Trip home layout: action bar always reserved on short-wide screens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRIP_ACTION_BAR_MIN,
  TRIP_METER_MIN,
  TRIP_STATUS_ROW,
  TRIP_TABS_MIN,
  TRIP_TARIFF_MIN,
  computeTripHomeLayout,
} from '../lib/tripHomeLayout.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function chrome(topInset) {
  return topInset + TRIP_STATUS_ROW;
}

function assertFits(windowHeight, meterLive, topInset = 0) {
  const layout = computeTripHomeLayout({ windowHeight, meterLive, topInset });
  const top = chrome(topInset);
  const tools = meterLive ? TRIP_METER_MIN : TRIP_TARIFF_MIN;
  assert.ok(
    layout.mapMax + layout.workMin + top <= windowHeight + 1,
    `overflow ${JSON.stringify({ windowHeight, meterLive, topInset, layout, top })}`,
  );
  assert.ok(
    layout.workMin >= tools + TRIP_TABS_MIN + TRIP_ACTION_BAR_MIN,
    `action bar not reserved ${JSON.stringify(layout)}`,
  );
  assert.ok(layout.mapMin <= layout.mapMax);
  return layout;
}

test('typical phone keeps a readable map after Accept', () => {
  const layout = assertFits(844, false, 47);
  assert.ok(layout.mapMax >= 180);
});

test('Fold 8 inner hail (meter live, ~740dp) still reserves End Trip', () => {
  const layout = assertFits(740, true, 24);
  assert.ok(layout.mapMax > 0);
  assert.ok(layout.workMin >= TRIP_METER_MIN + TRIP_TABS_MIN + TRIP_ACTION_BAR_MIN);
});

test('Flex Mode / half-height hail cannot clip the action bar', () => {
  const layout = assertFits(480, true, 24);
  assert.ok(layout.mapMax + layout.workMin <= 480);
});

test('extreme short window shrinks the map before the action bar', () => {
  const layout = assertFits(360, true, 12);
  assert.ok(layout.mapMax < 140);
  assert.ok(layout.workMin >= TRIP_METER_MIN + TRIP_TABS_MIN + TRIP_ACTION_BAR_MIN);
});

test('home screen uses computeTripHomeLayout; trip panel scrolls details', () => {
  const index = readFileSync(join(root, 'app/(tabs)/index.tsx'), 'utf8');
  assert.match(index, /computeTripHomeLayout/);
  assert.match(index, /useSafeAreaInsets/);
  const panel = readFileSync(join(root, 'components/home/CurrentTripPanel.tsx'), 'utf8');
  assert.match(panel, /pinnedScroll/);
  assert.match(panel, /Always-visible footer/);
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /shouldReleaseSuppressedPoolOffer/);
  assert.match(ctx, /suppressedOfferIdsRef\.current\.delete\(job\.id\)/);
});
