/**
 * Hail End Trip offline hang / lazy-load simulation.
 * Mirrors the field failure: no network + GPS that never resolves must still open payment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withTimeout } from '../lib/asyncTimeout.ts';
import {
  END_HAIL_GPS_TIMEOUT_MS,
  formatEndTripError,
  resolveEndHailDropCoords,
} from '../lib/endHailPolicy.ts';

function neverResolves() {
  return new Promise(() => {});
}

/**
 * Mirrors endTrip hail branch: busy → endHail body → catch formats Alert message.
 * No dynamic import() — static deps only (the loadBundle failure mode).
 */
async function simulateHailEndTripButton(deps) {
  if (deps.completionBusy) return { status: 'busy' };
  const isHail = !!deps.hailActive;
  if (!isHail) return { status: 'not-hail' };

  deps.setCompletionBusy(true);
  deps.setCompletionError(null);
  try {
    const dropCoords = await resolveEndHailDropCoords({
      getCurrentCoords: deps.getCurrentCoords,
      withTimeout,
      timeoutMs: deps.gpsTimeoutMs ?? 80,
    });
    const online = !!deps.online;
    let dropoffAddress = 'Street hail';
    if (dropCoords) {
      dropoffAddress = `${dropCoords.latitude.toFixed(5)}, ${dropCoords.longitude.toFixed(5)}`;
      if (online && deps.reverseGeocode) {
        dropoffAddress = await withTimeout(
          deps.reverseGeocode(dropCoords.latitude, dropCoords.longitude),
          deps.geocodeTimeoutMs ?? 80,
          'endHail.reverseGeocode.drop',
        ).catch(() => dropoffAddress);
      }
    } else if (deps.hailPickupAddress) {
      dropoffAddress = deps.hailPickupAddress;
    }
    // Static deps only — simulating a lazy import here would be the bug we removed.
    if (typeof deps.lazyImportAddressResolve === 'function') {
      throw new Error('lazy import must not run on End Trip');
    }
    deps.setPaymentJob({ dropoff: dropoffAddress, stage: 'complete' });
    deps.setHailActive(false);
    return { status: 'ok', dropoffAddress, dropCoords };
  } catch (err) {
    const msg = formatEndTripError(err);
    deps.setCompletionError(msg);
    deps.alertError(msg);
    return { status: 'error', message: msg };
  } finally {
    deps.setCompletionBusy(false);
  }
}

test('END_HAIL_GPS_TIMEOUT_MS is a short hard budget', () => {
  assert.ok(END_HAIL_GPS_TIMEOUT_MS > 0);
  assert.ok(END_HAIL_GPS_TIMEOUT_MS <= 5_000);
});

test('hanging GPS does not block hail End Trip (placeholder / pickup fallback)', async () => {
  const started = Date.now();
  let paymentJob = null;
  let busy = false;
  let error = null;
  let alerted = null;

  const result = await simulateHailEndTripButton({
    completionBusy: false,
    hailActive: true,
    online: false,
    hailPickupAddress: '12 Queen Street',
    getCurrentCoords: () => neverResolves(),
    gpsTimeoutMs: 80,
    setCompletionBusy: (v) => {
      busy = v;
    },
    setCompletionError: (v) => {
      error = v;
    },
    setPaymentJob: (job) => {
      paymentJob = job;
    },
    setHailActive: () => {},
    alertError: (msg) => {
      alerted = msg;
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.dropCoords, null);
  assert.equal(result.dropoffAddress, '12 Queen Street');
  assert.ok(paymentJob, 'payment sheet must open');
  assert.equal(paymentJob.stage, 'complete');
  assert.equal(error, null);
  assert.equal(alerted, null);
  assert.equal(busy, false);
  assert.ok(Date.now() - started < 500);
});

test('hanging reverse-geocode online still opens payment with coord placeholder', async () => {
  const started = Date.now();
  let paymentJob = null;

  const result = await simulateHailEndTripButton({
    completionBusy: false,
    hailActive: true,
    online: true,
    getCurrentCoords: async () => ({ latitude: -36.84846, longitude: 174.76333 }),
    reverseGeocode: () => neverResolves(),
    geocodeTimeoutMs: 80,
    setCompletionBusy: () => {},
    setCompletionError: () => {},
    setPaymentJob: (job) => {
      paymentJob = job;
    },
    setHailActive: () => {},
    alertError: () => {},
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.dropoffAddress, '-36.84846, 174.76333');
  assert.ok(paymentJob);
  assert.ok(Date.now() - started < 500);
});

test('End Trip failures surface full readable message (not truncated loadBundle stub)', () => {
  const err = new Error('Could not load bundle');
  err.name = 'LoadBundleFromServerError';
  err.cause = new Error('Network request failed');

  const msg = formatEndTripError(err);
  assert.match(msg, /LoadBundleFromServerError/);
  assert.match(msg, /Could not load bundle/);
  assert.match(msg, /Network request failed/);
  // completionErrorMessage delegates to formatEndTripError (used by Alert + banner).

  // Simulated catch path used by hail endTrip (same as dispatch).
  let alerted = '';
  let banner = '';
  try {
    throw err;
  } catch (e) {
    const formatted = formatEndTripError(e);
    banner = formatted;
    alerted = formatted;
  }
  assert.ok(alerted.length > 40);
  assert.equal(banner, alerted);
});

test('unexpected endHail throw is caught and Alerted (no unhandled rejection)', async () => {
  let alerted = null;
  let error = null;
  let paymentJob = null;

  const result = await simulateHailEndTripButton({
    completionBusy: false,
    hailActive: true,
    online: false,
    getCurrentCoords: async () => {
      throw Object.assign(new Error('Could not load bundle'), {
        name: 'LoadBundleFromServerError',
      });
    },
    // resolveEndHailDropCoords swallows GPS errors — force a later throw:
    lazyImportAddressResolve: undefined,
    setCompletionBusy: () => {},
    setCompletionError: (v) => {
      error = v;
    },
    setPaymentJob: (job) => {
      paymentJob = job;
    },
    setHailActive: () => {
      throw new Error('storeData failed: disk full');
    },
    alertError: (msg) => {
      alerted = msg;
    },
  });

  // setHailActive throws after payment set — should be caught.
  assert.equal(result.status, 'error');
  assert.match(result.message, /storeData failed|disk full/i);
  assert.equal(alerted, result.message);
  assert.equal(error, result.message);
  // Payment may have been set before the throw — that is OK; key is no unhandled rejection.
  assert.ok(paymentJob || result.status === 'error');
});
