/**
 * Seq3 — queue UI must not depend solely on a racy allbookings re-confirm.
 * Pure policy tests (no Firebase).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingRecordConfirmsQueued,
  bookingRecordMeansLeaveQueue,
  filterLiveDriverQueueOffersWithFetchers,
  mergeOptimisticQueuedOffer,
  shouldKeepDriverQueueOffer,
  toQueuedOffer,
} from '../lib/driverQueuePolicy.ts';

const OFFER = {
  id: '86926081948',
  type: 'taxi',
  pickup: '133 Pomona Street',
  dropoff: '',
  source: 'queue',
  queuedAt: Date.now() - 5_000,
};

test('pendingjobs Queued mirror keeps offer when allbookings confirm fails', () => {
  const keep = shouldKeepDriverQueueOffer({
    offer: OFFER,
    driverId: 'D001',
    allbookings: null,
    pendingjobs: {
      Status: 'Queued',
      BookingStatus: 'Queued',
      DriverId: 'D001',
    },
  });
  assert.equal(keep, true);
});

test('allbookings permission-deny + pendingjobs null trusts live driverQueue node', () => {
  const keep = shouldKeepDriverQueueOffer({
    offer: OFFER,
    driverId: 'D001',
    allbookings: null,
    pendingjobs: null,
  });
  assert.equal(keep, true);
});

test('recalled Pending on pendingjobs drops queue row', () => {
  const keep = shouldKeepDriverQueueOffer({
    offer: OFFER,
    driverId: 'D001',
    allbookings: null,
    pendingjobs: { Status: 'Pending', DriverId: '0' },
  });
  assert.equal(keep, false);
  assert.equal(bookingRecordMeansLeaveQueue({ Status: 'Pending' }), true);
});

test('Completed allbookings drops even if pendingjobs still Queued ghost', () => {
  const keep = shouldKeepDriverQueueOffer({
    offer: OFFER,
    driverId: 'D001',
    allbookings: { Status: 'Completed', DriverId: 'D001' },
    pendingjobs: { Status: 'Queued', DriverId: 'D001' },
  });
  assert.equal(keep, false);
});

test('Completed allbookings without Queued pendingjobs drops', () => {
  const keep = shouldKeepDriverQueueOffer({
    offer: OFFER,
    driverId: 'D001',
    allbookings: { Status: 'Completed', DriverId: 'D001' },
    pendingjobs: null,
  });
  assert.equal(keep, false);
});

test('filter uses pendingjobs fallback (Seq3 #81948 shape)', async () => {
  const live = await filterLiveDriverQueueOffersWithFetchers(
    '860869',
    'D001',
    [OFFER],
    {
      fetchAllbookings: async () => null,
      fetchPendingjobs: async () => ({
        Status: 'Queued',
        BookingStatus: 'Queued',
        DriverId: 'D001',
        PickAddress: '133 Pomona Street',
      }),
    },
  );
  assert.equal(live.length, 1);
  assert.equal(live[0].id, '86926081948');
});

test('filter drops when both records say Pending (recalled)', async () => {
  const live = await filterLiveDriverQueueOffersWithFetchers(
    '860869',
    'D001',
    [OFFER],
    {
      fetchAllbookings: async () => ({ Status: 'Pending', DriverId: '0' }),
      fetchPendingjobs: async () => ({ Status: 'Pending', DriverId: '0' }),
    },
  );
  assert.equal(live.length, 0);
});

test('optimistic merge puts accept into queue before subscribe', () => {
  const merged = mergeOptimisticQueuedOffer([], {
    id: '86926081948',
    type: 'taxi',
    pickup: '133 Pomona',
    dropoff: '',
  }, 1_787_122_401_501);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, '86926081948');
  assert.equal(merged[0].queuedAt, 1_787_122_401_501);
  assert.equal(toQueuedOffer(OFFER).id, '86926081948');
});

test('Seq3 post-complete popup precondition: optimistic queue non-empty after hail clear', () => {
  const afterAccept = mergeOptimisticQueuedOffer([], OFFER);
  assert.ok(afterAccept[0], 'queuedOffersRef must be non-empty so popup can fire');
  assert.equal(afterAccept[0].id, '86926081948');
  assert.equal(bookingRecordConfirmsQueued({ Status: 'Queued', DriverId: 'D001' }, 'D001'), true);
});
