import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coordsFromAddressOrFields,
  isCoordLikeAddress,
  needsHailAddressResolve,
  resolveHailPickupSnapshot,
  resolveReadableAddress,
} from '../lib/hailAddressResolve.ts';

test('isCoordLikeAddress matches bare and Hail-prefixed coords', () => {
  assert.equal(isCoordLikeAddress('-36.84846, 174.76333'), true);
  assert.equal(isCoordLikeAddress('Hail - -36.84846, 174.76333'), true);
  assert.equal(isCoordLikeAddress('12 Queen Street'), false);
  assert.equal(isCoordLikeAddress(''), false);
});

test('needsHailAddressResolve covers placeholders', () => {
  assert.equal(needsHailAddressResolve('-36.84, 174.76'), true);
  assert.equal(needsHailAddressResolve('Current location (address unavailable)'), true);
  assert.equal(needsHailAddressResolve('Locating…'), true);
  assert.equal(needsHailAddressResolve('88 Karangahape Rd'), false);
});

test('coordsFromAddressOrFields prefers explicit lat/lng', () => {
  assert.deepEqual(
    coordsFromAddressOrFields('12 Queen St', -36.1, 174.2),
    { lat: -36.1, lng: 174.2 },
  );
  assert.deepEqual(coordsFromAddressOrFields('-36.84846, 174.76333'), {
    lat: -36.84846,
    lng: 174.76333,
  });
});

test('resolveReadableAddress reverse-geocodes coord placeholders', async () => {
  const resolved = await resolveReadableAddress(
    { address: '-36.84846, 174.76333', lat: -36.84846, lng: 174.76333 },
    async () => '12 Queen Street, Auckland',
  );
  assert.equal(resolved, '12 Queen Street, Auckland');
});

test('resolveReadableAddress keeps street address without calling geocoder', async () => {
  let called = 0;
  const resolved = await resolveReadableAddress(
    { address: '12 Queen Street', lat: -36.8, lng: 174.7 },
    async () => {
      called += 1;
      return 'should not use';
    },
  );
  assert.equal(resolved, '12 Queen Street');
  assert.equal(called, 0);
});

test('resolveHailPickupSnapshot upgrades journal pickup on reconnect', async () => {
  const next = await resolveHailPickupSnapshot(
    { address: '-36.84846, 174.76333', lat: -36.84846, lng: 174.76333 },
    async () => '1 Customs Street East',
  );
  assert.equal(next.address, '1 Customs Street East');
  assert.equal(next.lat, -36.84846);
});

test('resolveReadableAddress: hanging geocode keeps placeholder (hard timeout)', async () => {
  const started = Date.now();
  const resolved = await resolveReadableAddress(
    { address: '-36.84846, 174.76333', lat: -36.84846, lng: 174.76333 },
    () => new Promise(() => {}),
    { timeoutMs: 80 },
  );
  assert.equal(resolved, '-36.84846, 174.76333');
  assert.ok(Date.now() - started < 400);
});
