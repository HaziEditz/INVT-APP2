/**
 * Trip home layout: Expand + End Trip reserved on any short-wide size.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRIP_ACTION_BAR_MIN,
  TRIP_METER_MIN,
  TRIP_PINNED_HEADER_MIN,
  TRIP_TABS_MIN,
  TRIP_TARIFF_MIN,
  computeTripHomeLayout,
  isShortWideAspect,
  tripWorkChrome,
} from '../lib/tripHomeLayout.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function assertFits(availableHeight, windowWidth, meterLive) {
  const layout = computeTripHomeLayout({ availableHeight, windowWidth, meterLive });
  const chrome = tripWorkChrome(meterLive);
  assert.ok(
    layout.mapMax + layout.workMin <= availableHeight + 1,
    `overflow ${JSON.stringify({ availableHeight, windowWidth, meterLive, layout, chrome })}`,
  );
  assert.ok(
    layout.workMin >= chrome,
    `Expand+End Trip not reserved ${JSON.stringify({ layout, chrome })}`,
  );
  assert.ok(layout.mapMin <= layout.mapMax);
  return layout;
}

test('typical tall phone keeps a readable map after Accept', () => {
  const layout = assertFits(720, 390, false);
  assert.equal(isShortWideAspect(720, 390), false);
  assert.ok(layout.mapMax >= 160);
});

test('short-wide hail (fold inner / Flex) reserves Expand and End Trip', () => {
  const layout = assertFits(560, 700, true);
  assert.equal(isShortWideAspect(560, 700), true);
  assert.ok(layout.workMin >= TRIP_METER_MIN + TRIP_TABS_MIN + TRIP_PINNED_HEADER_MIN + TRIP_ACTION_BAR_MIN);
  assert.ok(layout.mapMax > 0);
});

test('a taller fold inner still reserves Expand — not one model\'s pixel height', () => {
  const a = assertFits(520, 680, true);
  const b = assertFits(640, 720, true);
  assert.ok(a.workMin >= tripWorkChrome(true));
  assert.ok(b.workMin >= tripWorkChrome(true));
});

test('half-height Flex Mode cannot clip Expand or End Trip', () => {
  const layout = assertFits(420, 840, true);
  assert.ok(layout.mapMax + layout.workMin <= 420);
  assert.ok(layout.workMin >= tripWorkChrome(true));
});

test('extreme short window shrinks the map before Expand/action bar', () => {
  const layout = assertFits(320, 400, true);
  assert.ok(layout.mapMax < 140);
  assert.ok(layout.workMin >= tripWorkChrome(true));
});

test('tariff-only (no live meter) still reserves Expand header', () => {
  const layout = assertFits(500, 700, false);
  assert.ok(layout.workMin >= TRIP_TARIFF_MIN + TRIP_TABS_MIN + TRIP_PINNED_HEADER_MIN + TRIP_ACTION_BAR_MIN);
});

test('home screen measures the trip column; Expand header is not in the shrinking scroll', () => {
  const index = readFileSync(join(root, 'app/(tabs)/index.tsx'), 'utf8');
  assert.match(index, /computeTripHomeLayout/);
  assert.match(index, /onLayout/);
  assert.match(index, /flexShrink:\s*1/);
  assert.match(index, /workSectionTrip[\s\S]{0,80}flexShrink:\s*0/);
  const panel = readFileSync(join(root, 'components/home/CurrentTripPanel.tsx'), 'utf8');
  assert.match(panel, /pinnedHeader/);
  assert.match(panel, /Always-visible footer/);
  const headerIdx = panel.indexOf('styles.pinnedHeader');
  const scrollIdx = panel.indexOf('styles.pinnedScroll');
  const expandIdx = panel.indexOf("title={detailsExpanded ? 'Minimize' : 'Expand'}");
  assert.ok(headerIdx > 0 && scrollIdx > headerIdx, 'Expand header must be above the scroll');
  assert.ok(expandIdx > 0 && expandIdx < scrollIdx, 'Expand button must not live inside pinnedScroll');
  const ctx = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(ctx, /shouldReleaseSuppressedPoolOffer/);
  assert.match(ctx, /suppressedOfferIdsRef\.current\.delete\(job\.id\)/);
});
