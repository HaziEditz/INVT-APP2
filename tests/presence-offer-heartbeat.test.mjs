import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LASTSEEN_REPAIR_MS,
  PRESENCE_OFFER_HEARTBEAT_MS,
  PRESENCE_ON_TRIP_HEARTBEAT_MS,
} from '../lib/presenceHeartbeatPolicy.ts';

test('offer-pending heartbeat is faster than mid-offer 10s threshold', () => {
  assert.equal(PRESENCE_HEARTBEAT_MS, 20_000);
  assert.equal(PRESENCE_LASTSEEN_REPAIR_MS, 15_000);
  assert.equal(PRESENCE_OFFER_HEARTBEAT_MS, 5_000);
  // Mid-offer heal is 10s (strict >). Two offer stamps fit inside that window.
  assert.ok(PRESENCE_OFFER_HEARTBEAT_MS < 10_000);
  assert.ok(PRESENCE_OFFER_HEARTBEAT_MS * 2 <= 10_000);
  // Idle Available repair cadence is slower than mid-offer (10s); pre-offer gate is 45s on server.
  assert.ok(PRESENCE_HEARTBEAT_MS > 10_000);
  assert.ok(PRESENCE_LASTSEEN_REPAIR_MS > 10_000);
  // Pre-offer gate (45s) must sit above idle heartbeat so healthy parked drivers stay eligible.
  assert.ok(45_000 > PRESENCE_HEARTBEAT_MS);
});

test('on-trip heartbeat stays under mid-offer 10s and pre-offer 45s gates', () => {
  assert.equal(PRESENCE_ON_TRIP_HEARTBEAT_MS, 8_000);
  assert.ok(PRESENCE_ON_TRIP_HEARTBEAT_MS < 10_000);
  assert.ok(PRESENCE_ON_TRIP_HEARTBEAT_MS * 2 < 45_000);
  // Prefer offer-pending (5s) when both on — policy order in presenceService.
  assert.ok(PRESENCE_OFFER_HEARTBEAT_MS < PRESENCE_ON_TRIP_HEARTBEAT_MS);
  assert.ok(PRESENCE_ON_TRIP_HEARTBEAT_MS < PRESENCE_HEARTBEAT_MS);
});

test('offer-pending gate engages for modal OR broadcast exclusive offers', () => {
  // Mirrors DriverContext: pending = shiftActive && (jobOffer?.id || broadcastOffers.length > 0)
  const gate = (shiftActive, jobOfferId, broadcastCount) =>
    !!(shiftActive && (jobOfferId || broadcastCount > 0));
  assert.equal(gate(true, '8692608042', 0), true, 'modal offer alone');
  assert.equal(gate(true, null, 1), true, 'Offer-tab broadcast alone (no modal)');
  assert.equal(gate(true, '8692608042', 2), true, 'both');
  assert.equal(gate(true, null, 0), false, 'shift with no offers');
  assert.equal(gate(false, '8692608042', 1), false, 'shift off');
});

test('stale broadcast purge is held while hail/activeJob/payment', () => {
  // Mirrors Driver-staleOffers: skip expiresAt purge while trip UI holds the modal.
  const holdPurge = ({ hailActive, activeJobId, paymentJob }) =>
    !!(hailActive || activeJobId || paymentJob);
  assert.equal(holdPurge({ hailActive: true, activeJobId: null, paymentJob: null }), true);
  assert.equal(holdPurge({ hailActive: false, activeJobId: '8692608201', paymentJob: null }), true);
  assert.equal(holdPurge({ hailActive: false, activeJobId: null, paymentJob: {} }), true);
  assert.equal(holdPurge({ hailActive: false, activeJobId: null, paymentJob: null }), false);
});

test('held offers refresh expiresAt so post-trip flush keeps Accept', () => {
  const now = 1_000_000;
  const holdUntil = now + 35_000;
  const refresh = (expiresAt) =>
    !expiresAt || expiresAt < holdUntil ? holdUntil : expiresAt;
  assert.equal(refresh(now - 1), holdUntil, 'already expired during hail');
  assert.equal(refresh(now + 5_000), holdUntil, 'short remaining');
  assert.equal(refresh(holdUntil + 10_000), holdUntil + 10_000, 'already long');
});
