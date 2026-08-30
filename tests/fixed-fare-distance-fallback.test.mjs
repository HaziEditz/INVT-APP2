/**
 * Fixed-price fare summary: distance fallback + locked Total independent of components.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computePaymentFareSummary } from '../lib/tripCompletionHelpers.ts';

test('fixed-price: Total stays locked even when distance was 0 on meter', () => {
  const job = {
    id: '1',
    type: 'asap',
    stage: 'complete',
    pickup: 'A',
    dropoff: 'B',
    pickupLat: -46.413,
    pickupLng: 168.353,
    dropoffLat: -46.42,
    dropoffLng: 168.36,
    fare: 5.2,
    fixedFare: 5.2,
    isFixedPrice: true,
    isPrePaid: true,
    paymentStatus: 'paid',
    estimatedDistanceKm: 1.4,
    meterSnapshot: {
      running: false,
      paused: false,
      mode: 'waiting',
      startedAt: Date.now() - 60000,
      finishedAt: Date.now(),
      pausedMs: 0,
      movingMs: 0,
      waitingMs: 12000,
      distanceKm: 0,
      tariffId: '-1',
      tariffName: 'Fixed',
      tariffChanges: [],
      breakdown: {
        flagFall: 5,
        distanceKm: 0,
        distanceCharge: 0,
        waitingMinutes: 0.2,
        waitingCharge: 0.2,
        total: 5.2,
      },
      fare: 5.2,
      trackOnly: true,
      lockedFare: 5.2,
      routePoints: [{ lat: -46.413, lng: 168.353, at: Date.now() }],
    },
  };
  const tariff = {
    id: 't1',
    name: 'Std',
    flagFall: 5,
    ratePerKm: 2.5,
    waitingPerMin: 1,
  };
  const s = computePaymentFareSummary(job, tariff);
  assert.equal(s.tripTotal, 5.2, 'passenger locked charge unchanged');
  assert.ok(s.distanceKm > 0.5, `expected estimate/straight fallback, got ${s.distanceKm}`);
  assert.ok(s.distanceCharge > 0, 'reference distance charge should be non-zero');
  // Total is NOT recomputed as flag+dist+wait
  assert.notEqual(
    s.tripTotal,
    s.flagFall + s.distanceCharge + s.waitingCharge,
    'locked total must not equal component sum when distance restored',
  );
});
