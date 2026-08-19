/**
 * Assigned-orphan: promote without local adopt leaves dispatch Assign + blank driver UI.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isJobOfferModalHeldHidden,
  shouldAutoAdoptPromotedQueueJob,
} from '../lib/queuePromoteAdopt.ts';

test('JobOfferModal hidden under Syncing even when jobOffer is set (Assigned-orphan window)', () => {
  assert.equal(
    isJobOfferModalHeldHidden({ syncingBanner: true }),
    true,
    'Syncing must hide Accept UI',
  );
  assert.equal(
    isJobOfferModalHeldHidden({ paymentJob: true }),
    true,
    'paymentJob must hide Accept UI',
  );
  assert.equal(
    isJobOfferModalHeldHidden({ pendingTripSync: true }),
    true,
  );
  assert.equal(
    isJobOfferModalHeldHidden({}),
    false,
    'idle driver can see Accept',
  );
});

test('successful queue promote without activeJob must auto-adopt (#81952/#81956)', () => {
  assert.equal(
    shouldAutoAdoptPromotedQueueJob({
      promoteSucceeded: true,
      alreadyHasActiveJob: false,
    }),
    true,
  );
});

test('do not double-adopt when already on a trip', () => {
  assert.equal(
    shouldAutoAdoptPromotedQueueJob({
      promoteSucceeded: true,
      alreadyHasActiveJob: true,
    }),
    false,
  );
});

test('failed promote does not adopt', () => {
  assert.equal(
    shouldAutoAdoptPromotedQueueJob({
      promoteSucceeded: false,
      alreadyHasActiveJob: false,
    }),
    false,
  );
});
