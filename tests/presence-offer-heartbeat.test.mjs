import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LASTSEEN_REPAIR_MS,
  PRESENCE_OFFER_HEARTBEAT_MS,
} from '../lib/presenceHeartbeatPolicy.ts';

test('offer-pending heartbeat is faster than mid-offer 10s threshold', () => {
  assert.equal(PRESENCE_HEARTBEAT_MS, 20_000);
  assert.equal(PRESENCE_LASTSEEN_REPAIR_MS, 15_000);
  assert.equal(PRESENCE_OFFER_HEARTBEAT_MS, 5_000);
  // Mid-offer heal is 10s (strict >). Two offer stamps fit inside that window.
  assert.ok(PRESENCE_OFFER_HEARTBEAT_MS < 10_000);
  assert.ok(PRESENCE_OFFER_HEARTBEAT_MS * 2 <= 10_000);
  // Idle Available repair cadence is slower than the old 10s pre-offer gate (now 25s on server).
  assert.ok(PRESENCE_HEARTBEAT_MS > 10_000);
  assert.ok(PRESENCE_LASTSEEN_REPAIR_MS > 10_000);
  // Pre-offer gate (25s) must sit above idle heartbeat so healthy parked drivers stay eligible.
  assert.ok(25_000 > PRESENCE_HEARTBEAT_MS);
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
