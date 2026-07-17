import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDirectOfferStillLive,
  shouldSuppressReturnedPoolOffer,
} from '../lib/offerReconciliationPolicy.ts';
import {
  connectionNoticeForTransition,
  dispatchIsConnected,
} from '../lib/dispatchConnectionPolicy.ts';

test('C4 suppresses returned offer only for its previous driver', () => {
  const returned = {
    returnReason: 'Offer expired (stale offered job)',
    lastOfferDriverId: 'D001',
  };
  assert.equal(shouldSuppressReturnedPoolOffer(returned, 'D001'), true);
  assert.equal(shouldSuppressReturnedPoolOffer(returned, 'D002'), false);
  assert.equal(
    shouldSuppressReturnedPoolOffer(
      { returnReason: '', lastOfferDriverId: 'D001' },
      'D001',
    ),
    false,
  );
});

test('C4 keeps direct offer only while Offered to the same driver', () => {
  assert.equal(
    isDirectOfferStillLive(
      { BookingStatus: 'Offered', DriverId: 'D001' },
      'D001',
    ),
    true,
  );
  assert.equal(
    isDirectOfferStillLive(
      { BookingStatus: 'Pending', DriverId: '0' },
      'D001',
    ),
    false,
  );
  assert.equal(
    isDirectOfferStillLive(
      { BookingStatus: 'Offered', DriverId: 'D002' },
      'D001',
    ),
    false,
  );
  assert.equal(isDirectOfferStillLive(null, 'D001'), false);
});

test('C6 combines device and RTDB connectivity', () => {
  assert.equal(dispatchIsConnected(false, true), false);
  assert.equal(dispatchIsConnected(true, false), false);
  assert.equal(dispatchIsConnected(true, true), true);
  assert.equal(dispatchIsConnected(null, null), true);
});

test('C6 notice persists offline and announces recovery only after outage', () => {
  assert.equal(connectionNoticeForTransition(null, true), null);
  assert.equal(connectionNoticeForTransition(true, false), 'offline');
  assert.equal(connectionNoticeForTransition(false, false), 'offline');
  assert.equal(connectionNoticeForTransition(false, true), 'back_online');
});
