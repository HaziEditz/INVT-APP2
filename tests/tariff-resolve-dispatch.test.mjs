/**
 * Dispatch tariff priority: Auto → keep driver tariff; specific → adopt.
 * Fixed-fare complete must not stamp the driver's meter tariff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closedJobFieldsForCompleteApi } from '../lib/closedJobSync.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN = new Set(['standard', 'standard rate']);
function isForbiddenPlaceholderTariffName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  return !n || FORBIDDEN.has(n);
}

/** Mirrors lib/tariffResolve.ts */
function isDispatchAutoTariff(hints) {
  if (!hints) return true;
  const id = hints.id?.trim() ?? '';
  const name = (hints.name?.trim() ?? '').toLowerCase();
  if (!id && !name) return true;
  if (id === '0') return true;
  if (!id && (name === 'automatic' || name === 'auto')) return true;
  return false;
}

function resolveTariffFromList(tariffs, hints) {
  if (!tariffs.length || !hints) return null;
  if (isDispatchAutoTariff(hints)) return null;
  const id = hints.id?.trim();
  const name = hints.name?.trim();
  if (id && id !== '-1' && id !== '0') {
    const byId = tariffs.find((t) => t.id === id || String(t.id) === id);
    if (byId) return byId;
  }
  if (
    name &&
    !isForbiddenPlaceholderTariffName(name) &&
    name.toLowerCase() !== 'fixed' &&
    name.toLowerCase() !== 'automatic' &&
    name.toLowerCase() !== 'auto'
  ) {
    const lower = name.toLowerCase();
    const byName = tariffs.find((t) => t.name.trim().toLowerCase() === lower);
    if (byName) return byName;
  }
  return null;
}

const TARIFFS = [
  { id: '100', name: 'Day Rate', flagFall: 3, ratePerKm: 2, waitingPerMin: 0.5 },
  { id: '527', name: 'Total Mobility', flagFall: 3, ratePerKm: 2.5, waitingPerMin: 0.5 },
];

test('isDispatchAutoTariff: empty / 0 / Automatic', () => {
  assert.equal(isDispatchAutoTariff(null), true);
  assert.equal(isDispatchAutoTariff({}), true);
  assert.equal(isDispatchAutoTariff({ id: '0' }), true);
  assert.equal(isDispatchAutoTariff({ id: '0', name: 'Automatic' }), true);
  assert.equal(isDispatchAutoTariff({ name: 'Automatic' }), true);
  assert.equal(isDispatchAutoTariff({ name: 'auto' }), true);
  assert.equal(isDispatchAutoTariff({ id: '527', name: 'Total Mobility' }), false);
  assert.equal(isDispatchAutoTariff({ id: '527' }), false);
});

test('resolveTariffFromList: Auto does not resolve; specific id does', () => {
  assert.equal(resolveTariffFromList(TARIFFS, { id: '0', name: 'Automatic' }), null);
  assert.equal(resolveTariffFromList(TARIFFS, { id: '-1', name: 'Fixed' }), null);
  const match = resolveTariffFromList(TARIFFS, { id: '527', name: 'Total Mobility' });
  assert.ok(match);
  assert.equal(match.id, '527');
  assert.equal(match.name, 'Total Mobility');
});

test('tariffResolve source exports isDispatchAutoTariff and skips Auto id', () => {
  const src = readFileSync(join(root, 'lib/tariffResolve.ts'), 'utf8');
  assert.match(src, /export function isDispatchAutoTariff/);
  assert.match(src, /if \(isDispatchAutoTariff\(hints\)\) return null/);
  assert.match(src, /id !== '-1' && id !== '0'/);
});

test('accept path seeds booking raw + adopts dispatch tariff', () => {
  const src = readFileSync(join(root, 'context/DriverContext.tsx'), 'utf8');
  assert.match(src, /adoptDispatchTariffFromOffer/);
  assert.match(src, /isDispatchAutoTariff/);
  assert.match(src, /bookingRawSeedFromOffer/);
  assert.match(src, /TarriffId: id/);
});

test('withCompleteFareBreakdown source preserves Fixed for fixed-fare', () => {
  const src = readFileSync(join(root, 'lib/tripCompletionHelpers.ts'), 'utf8');
  assert.match(src, /if \(job\.isFixedPrice\)/);
  assert.match(src, /tariffId: '-1'/);
  assert.match(src, /tariffName: 'Fixed'/);
});

test('closedJobFieldsForCompleteApi keeps Fixed / -1 for fixed-fare', () => {
  const api = closedJobFieldsForCompleteApi({
    id: '1',
    type: 'Taxi',
    pickup: 'A',
    dropoff: 'B',
    expiresAt: 0,
    stage: 'complete',
    startedAt: Date.now(),
    distanceKm: 0,
    durationMin: 0,
    fare: 40,
    fixedFare: 40,
    isFixedPrice: true,
    stepTimes: {},
    tariffChanges: [],
    meterSnapshot: {
      running: false,
      paused: false,
      mode: 'waiting',
      startedAt: Date.now(),
      pausedMs: 0,
      movingMs: 0,
      waitingMs: 0,
      distanceKm: 0,
      tariffId: '527',
      tariffName: 'Total Mobility',
      tariffChanges: [],
      breakdown: {
        flagFall: 0,
        distanceKm: 0,
        distanceCharge: 0,
        waitingMinutes: 0,
        waitingCharge: 0,
        total: 40,
      },
      fare: 40,
    },
  });
  assert.equal(api.tariffId, '-1');
  assert.equal(api.TarriffType, 'Fixed');
  assert.equal(api.fixedPrice, true);
});
