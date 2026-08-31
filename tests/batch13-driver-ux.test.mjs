/**
 * Guards for driver prepaid payment title + trip panel UX.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('PaymentModal uses Payment Summary for prepaid card', () => {
  const src = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
  assert.match(src, /isAlreadyPaidCard \? 'Payment Summary' : 'Collect Payment'/);
});

test('CurrentTripPanel has one-tap verify + expand/minimize + Call passenger', () => {
  const src = readFileSync(join(root, 'components/home/CurrentTripPanel.tsx'), 'utf8');
  assert.match(src, /Confirm PIN & name — unlock On Board/);
  assert.doesNotMatch(src, /Step 1 — Confirm: PIN matches/);
  assert.match(src, /Minimize/);
  assert.match(src, /Expand/);
  assert.match(src, /Call passenger/);
  assert.match(src, /expandedInline/);
  assert.match(src, /detailsExpandSheet/);
  assert.match(src, /pinnedBand/);
  assert.match(src, /detailsHeaderRaised/);
  assert.match(src, /zIndex: 60/);
  assert.match(src, /prepaidSheet/);
  assert.match(src, /prepaidSheetExpanded/);
  assert.match(src, /animationType="slide"/);
  assert.match(src, /Wrong passenger/);
  assert.match(src, /Walk-up hail/);
  assert.match(src, /No Show/);
});

test('CurrentTripPanel pins details band outside ScrollView and Expand uses a sheet', () => {
  const src = readFileSync(join(root, 'components/home/CurrentTripPanel.tsx'), 'utf8');
  const pinIdx = src.indexOf('accessibilityLabel="Trip details summary"');
  const scrollAfterPin = src.indexOf('style={styles.detailsScroll}', pinIdx);
  const expandSheetIdx = src.indexOf('detailsExpandSheet');
  const actionIdx = src.indexOf('style={styles.actionBar}', pinIdx);
  assert.ok(pinIdx > 0, 'pinned band accessibility label must exist');
  assert.ok(scrollAfterPin > pinIdx, 'detailsScroll must follow pinned band in main trip UI');
  assert.ok(actionIdx > scrollAfterPin, 'action bar stays after scroll');
  assert.ok(expandSheetIdx > 0, 'Expand must use a real sheet surface');
  assert.match(src, /pinnedBand:[\s\S]{0,120}flexShrink:\s*0/);
  assert.match(src, /JobDispatchMetaSection job=\{activeJob\}/);
  assert.doesNotMatch(
    src.slice(scrollAfterPin, Math.min(src.length, scrollAfterPin + 900)),
    /JobDispatchMetaSection job=\{activeJob\}/,
    'meta strip must not live only inside crushed ScrollView',
  );
});
