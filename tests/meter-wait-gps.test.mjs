import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertLiveMeterToTrackOnly,
  createInitialMeter,
  gpsAccuracyBlocksDistance,
  tickMeterWithGps,
} from '../lib/meterTick.ts';

const tariff = {
  id: 't1',
  name: 'Test',
  flagFall: 3,
  ratePerKm: 2,
  waitingPerMin: 60, // $1 per second → easy to see wait charge move
};

test('poor GPS accuracy blocks distance but not the accuracy helper', () => {
  assert.equal(gpsAccuracyBlocksDistance(null), false);
  assert.equal(gpsAccuracyBlocksDistance(20), false);
  assert.equal(gpsAccuracyBlocksDistance(50), false);
  assert.equal(gpsAccuracyBlocksDistance(51), true);
  assert.equal(gpsAccuracyBlocksDistance(200), true);
});

test('poor GPS accuracy still accrues waitingMs (does not freeze wait charge)', () => {
  let meter = createInitialMeter(tariff);
  const beforeWait = meter.waitingMs;
  const beforeFare = meter.fare;
  const beforeDist = meter.distanceKm;

  const tick = tickMeterWithGps(meter, tariff, -36.84, 174.76, 0, 120);
  meter = tick.meter;

  assert.equal(meter.mode, 'waiting');
  assert.ok(meter.waitingMs > beforeWait, `waitingMs should grow, got ${meter.waitingMs}`);
  assert.equal(meter.waitingMs, beforeWait + 2000);
  assert.equal(meter.distanceKm, beforeDist);
  assert.ok(meter.fare > beforeFare, 'wait charge should increase fare');
});

test('good GPS accuracy stationary still accrues wait', () => {
  let meter = createInitialMeter(tariff);
  meter = tickMeterWithGps(meter, tariff, -36.84, 174.76, 0, 15).meter;
  const mid = meter.waitingMs;
  meter = tickMeterWithGps(meter, tariff, -36.84, 174.76, 0, 15).meter;
  assert.equal(meter.waitingMs, mid + 2000);
});

test('GPS jump rejects distance but still accrues wait time', () => {
  let meter = createInitialMeter(tariff);
  meter = tickMeterWithGps(meter, tariff, -36.84, 174.76, 0, 15).meter;
  const waitAfterFirst = meter.waitingMs;
  const distAfterFirst = meter.distanceKm;

  // ~1 degree lat ≈ 111km — far beyond MAX_JUMP_M
  meter = tickMeterWithGps(meter, tariff, -35.84, 174.76, 0, 15).meter;
  assert.equal(meter.distanceKm, distAfterFirst);
  assert.equal(meter.waitingMs, waitAfterFirst + 2000);
});

test('convertLiveMeterToTrackOnly locks fare and stops climbing on tick', () => {
  let meter = createInitialMeter(tariff);
  meter = tickMeterWithGps(meter, tariff, -36.84, 174.76, 0, 15).meter;
  meter = { ...meter, distanceKm: 1.2, waitingMs: 60000 };
  const liveFare = meter.fare;
  assert.equal(meter.trackOnly, undefined);
  assert.ok(liveFare > 0);

  meter = convertLiveMeterToTrackOnly(meter, tariff, 9.34);
  assert.equal(meter.trackOnly, true);
  assert.equal(meter.fare, 9.34);
  assert.equal(meter.lockedFare, 9.34);
  assert.equal(meter.tariffId, '-1');
  assert.equal(meter.distanceKm, 1.2);

  const after = tickMeterWithGps(meter, tariff, -36.841, 174.761, 5, 15).meter;
  assert.equal(after.fare, 9.34, 'fixed fare must not climb after conversion');
  assert.equal(after.trackOnly, true);
});
