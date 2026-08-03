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
