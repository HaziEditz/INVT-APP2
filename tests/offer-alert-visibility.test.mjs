import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isJobOfferModalHeldHidden,
  shouldPlayOfferAlertSound,
} from '../lib/queuePromoteAdopt.ts';

test('shouldPlayOfferAlertSound: only when offer exists and modal not held', () => {
  assert.equal(shouldPlayOfferAlertSound({ hasJobOffer: false }), false);
  assert.equal(shouldPlayOfferAlertSound({ hasJobOffer: true }), true);
  assert.equal(
    shouldPlayOfferAlertSound({ hasJobOffer: true, paymentJob: true }),
    false,
  );
  assert.equal(
    shouldPlayOfferAlertSound({ hasJobOffer: true, pendingTripSync: true }),
    false,
  );
  assert.equal(
    shouldPlayOfferAlertSound({ hasJobOffer: true, syncingBanner: true }),
    false,
  );
  assert.equal(
    shouldPlayOfferAlertSound({ hasJobOffer: true, activeJob: true }),
    false,
  );
  assert.equal(
    shouldPlayOfferAlertSound({ hasJobOffer: true, hailActive: true }),
    false,
  );
  assert.equal(
    shouldPlayOfferAlertSound({ hasJobOffer: true, isOffline: true }),
    false,
  );
});

test('isJobOfferModalHeldHidden mirrors sound gate holds', () => {
  assert.equal(isJobOfferModalHeldHidden({}), false);
  assert.equal(isJobOfferModalHeldHidden({ paymentJob: true }), true);
});
