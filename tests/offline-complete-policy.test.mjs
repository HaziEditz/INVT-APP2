/**
 * Dispatch Complete offline — policy + simulated finalizePayment short-circuit.
 * Ensures HTTP/Firebase are never awaited when offline (the hang that left trips stuck).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldDetachActiveJobOnEndTrip,
  shouldOfflineJournalComplete,
} from '../lib/offlineCompletePolicy.ts';

test('offline complete when either NetInfo or RTDB is down', () => {
  assert.equal(shouldOfflineJournalComplete(false, true), true);
  assert.equal(shouldOfflineJournalComplete(true, false), true);
  assert.equal(shouldOfflineJournalComplete(false, false), true);
  assert.equal(shouldOfflineJournalComplete(true, true), false);
  assert.equal(shouldOfflineJournalComplete(null, null), false);
});

test('detach activeJob on End Trip uses same offline gate as complete', () => {
  assert.equal(shouldDetachActiveJobOnEndTrip(false, true), true);
  assert.equal(shouldDetachActiveJobOnEndTrip(true, true), false);
});

/**
 * Mirrors finalizePayment offline branch ordering:
 * skip HTTP/Firebase → journal Completed → clear local trip.
 */
async function simulateFinalizePaymentOffline(deps) {
  const offline = shouldOfflineJournalComplete(deps.networkConnected, deps.rtdbConnected);
  if (!offline) {
    await deps.completeJobPayment();
    await deps.readBookingTripAddresses();
    return { path: 'online', cleared: true };
  }

  // Must not touch these when offline.
  if (deps.completeJobPaymentCalled || deps.firebaseReadCalled) {
    throw new Error('offline path invoked network/Firebase deps incorrectly');
  }

  await deps.appendTripJournalEvent('Completed');
  deps.clearActiveJob();
  deps.clearPaymentJob();
  return { path: 'offline-journal', cleared: true };
}

test('finalizePayment offline short-circuit journals and clears without HTTP/Firebase', async () => {
  let journaled = false;
  let cleared = false;
  let httpCalled = false;
  let firebaseCalled = false;

  const result = await simulateFinalizePaymentOffline({
    networkConnected: false,
    rtdbConnected: false,
    completeJobPayment: async () => {
      httpCalled = true;
    },
    readBookingTripAddresses: async () => {
      firebaseCalled = true;
    },
    get completeJobPaymentCalled() {
      return httpCalled;
    },
    get firebaseReadCalled() {
      return firebaseCalled;
    },
    appendTripJournalEvent: async () => {
      journaled = true;
    },
    clearActiveJob: () => {
      cleared = true;
    },
    clearPaymentJob: () => {
      cleared = true;
    },
  });

  assert.equal(result.path, 'offline-journal');
  assert.equal(result.cleared, true);
  assert.equal(journaled, true);
  assert.equal(httpCalled, false);
  assert.equal(firebaseCalled, false);
});

test('finalizePayment offline ignores hanging complete API (never called)', async () => {
  const hang = () => new Promise(() => {});
  const started = Date.now();
  const result = await Promise.race([
    simulateFinalizePaymentOffline({
      networkConnected: false,
      rtdbConnected: true,
      completeJobPayment: hang,
      readBookingTripAddresses: hang,
      completeJobPaymentCalled: false,
      firebaseReadCalled: false,
      appendTripJournalEvent: async () => {},
      clearActiveJob: () => {},
      clearPaymentJob: () => {},
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('offline complete hung')), 500),
    ),
  ]);
  assert.equal(result.path, 'offline-journal');
  assert.ok(Date.now() - started < 400);
});

test('endTrip detach when offline clears trip panel before payment', () => {
  // Mirror endTrip dispatch branch: paymentJob kept, activeJob nulled offline.
  let activeJob = { id: '8692606166', stage: 'onboard' };
  let paymentJob = null;
  const offline = shouldDetachActiveJobOnEndTrip(false, false);
  const updated = { ...activeJob, stage: 'complete' };
  paymentJob = updated;
  if (offline) activeJob = null;
  else activeJob = updated;

  assert.equal(paymentJob?.stage, 'complete');
  assert.equal(activeJob, null);
});
