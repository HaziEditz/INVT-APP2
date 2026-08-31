/**
 * Always-visible compact job meta strip (vehicle · created · source).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Mirrors lib/jobDisplayMeta.ts vehicleTypeDisplayLabel. */
function vehicleTypeDisplayLabel(job) {
  const raw = String(job.vehicleTypeRequired ?? job.vehicleType ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'not specified' || lower === 'any' || lower === 'all') return 'Any';
  if (/wav|wheelchair|accessible/i.test(raw)) return 'Wheelchair';
  return raw;
}

/** Mirrors lib/jobDisplayMeta.ts sourceBadgeLabel + sourceDisplayLabel. */
function sourceBadgeLabel(src) {
  const s = String(src ?? '')
    .toLowerCase()
    .replace(/_/g, ' ');
  if (!s) return '';
  if (s.includes('dispatch') || s === 'phone' || s.includes('console') || s === 'desk') return 'DESK';
  if (s.includes('hail')) return 'HAIL';
  if (s.includes('passenger') || s === 'app') return 'APP';
  if (s.includes('web') || s.includes('website')) return 'WEB';
  return s.slice(0, 8).toUpperCase();
}

function sourceDisplayLabel(src, createdBy, dispatcherName) {
  const badge = sourceBadgeLabel(src ?? createdBy);
  if (!badge) return createdBy?.trim() || null;
  if (badge === 'DESK') {
    const who = (dispatcherName || createdBy || '').trim();
    return who ? `DESK · ${who}` : 'DESK';
  }
  if (badge === 'WEB') return 'Website';
  if (badge === 'APP') return 'Passenger App';
  if (badge === 'HAIL') return 'Hail';
  return badge;
}

test('vehicleTypeDisplayLabel normalizes Any / WAV', () => {
  assert.equal(vehicleTypeDisplayLabel({ vehicleTypeRequired: 'Not Specified' }), 'Any');
  assert.equal(vehicleTypeDisplayLabel({ vehicleTypeRequired: 'any' }), 'Any');
  assert.equal(vehicleTypeDisplayLabel({ vehicleType: 'WAV' }), 'Wheelchair');
  assert.equal(vehicleTypeDisplayLabel({ vehicleTypeRequired: 'Sedan' }), 'Sedan');
  assert.equal(vehicleTypeDisplayLabel({}), null);
});

test('sourceDisplayLabel maps WEB / DESK / APP', () => {
  assert.equal(sourceDisplayLabel('Website', 'WEB'), 'Website');
  assert.equal(sourceDisplayLabel('Dispatch Console', 'desk', 'Alex'), 'DESK · Alex');
  assert.equal(sourceDisplayLabel('PassengerApp'), 'Passenger App');
});

test('jobDisplayMeta exports vehicleTypeDisplayLabel', () => {
  const src = readFileSync(join(root, 'lib/jobDisplayMeta.ts'), 'utf8');
  assert.match(src, /export function vehicleTypeDisplayLabel/);
  assert.match(src, /not specified/);
  assert.match(src, /Wheelchair/);
});

test('CurrentTripPanel shows JobDispatchMetaSection in pinned band outside Expand', () => {
  const src = readFileSync(join(root, 'components/home/CurrentTripPanel.tsx'), 'utf8');
  assert.match(src, /pinnedBand/);
  assert.match(src, /detailsExpandSheet/);
  const pinIdx = src.indexOf('accessibilityLabel="Trip details summary"');
  const pinSlice = src.slice(pinIdx, pinIdx + 2200);
  assert.match(pinSlice, /JobDispatchMetaSection job=\{activeJob\}/, 'meta strip inside pinned band');
  assert.match(pinSlice, /showPassengerContact/);
  const expandModalIdx = src.indexOf('detailsExpandSheet');
  assert.ok(pinIdx > 0 && expandModalIdx > pinIdx, 'Expand sheet after pinned band markup');
});

test('Offer + Queue + Modal render JobDispatchMetaSection strip', () => {
  for (const rel of [
    'components/home/OffersPanel.tsx',
    'components/home/QueuePanel.tsx',
    'components/JobOfferModal.tsx',
  ]) {
    const src = readFileSync(join(root, rel), 'utf8');
    assert.match(src, /JobDispatchMetaSection/, rel);
  }
  const strip = readFileSync(join(root, 'components/JobDispatchMetaSection.tsx'), 'utf8');
  assert.match(strip, /showPassengerContact/);
  assert.match(strip, /person-outline/);
  assert.match(strip, /car-outline/);
  assert.match(strip, /vehicleTypeDisplayLabel/);
  assert.match(strip, /bookedLabel/);
  assert.match(strip, /sourceLabel/);
});
