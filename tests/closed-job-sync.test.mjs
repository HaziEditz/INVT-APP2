import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTripFieldsToJob,
  closedJobFieldsForCompleteApi,
  closedJobFieldsForJournal,
  extractClosedJobTripFields,
  pendingClosedJobMatches,
} from '../lib/closedJobSync.ts';

const sampleJob = {
  id: '8692608999',
  type: 'Taxi',
  stage: 'complete',
  pickup: '12 Queen St',
  dropoff: '88 Karangahape Rd',
  pickupLat: -36.84,
  pickupLng: 174.76,
  dropoffLat: -36.85,
  dropoffLng: 174.75,
  passengerName: 'Sam',
  passengerPhone: '021000',
  notes: 'Gate code 1',
  source: 'dispatch',
  clientTripId: 'ct-1',
  stepTimes: { onboardAt: 1 },
};

test('extractClosedJobTripFields keeps pickup/dropoff for closed jobs', () => {
  const fields = extractClosedJobTripFields(sampleJob);
  assert.equal(fields.pickup, '12 Queen St');
  assert.equal(fields.dropoff, '88 Karangahape Rd');
  assert.equal(fields.passengerName, 'Sam');
});

test('closedJobFieldsForJournal includes address mirrors used by history UI', () => {
  const payload = closedJobFieldsForJournal(sampleJob);
  assert.equal(payload.pickup, '12 Queen St');
  assert.equal(payload.dropoff, '88 Karangahape Rd');
  assert.equal(payload.PickAddress, '12 Queen St');
  assert.equal(payload.DropAddress, '88 Karangahape Rd');
  assert.equal(payload.finalDropAddress, '88 Karangahape Rd');
});

test('closedJobFieldsForCompleteApi uses server whitelist keys', () => {
  const api = closedJobFieldsForCompleteApi(sampleJob);
  assert.equal(api.pickupLat, -36.84);
  assert.equal(api.dropLat, -36.85);
  assert.equal(api.finalDropAddress, '88 Karangahape Rd');
  assert.equal(api.driverComments, 'Gate code 1');
});

test('applyTripFieldsToJob restores sparse jobs from journal payload', () => {
  const sparse = {
    id: '1',
    type: 'Taxi',
    stage: 'complete',
    pickup: '',
    dropoff: '',
  };
  const restored = applyTripFieldsToJob(sparse, {
    PickAddress: 'A St',
    finalDropAddress: 'B St',
    passengerName: 'Lee',
  });
  assert.equal(restored.pickup, 'A St');
  assert.equal(restored.dropoff, 'B St');
  assert.equal(restored.passengerName, 'Lee');
});

test('pendingClosedJobMatches binds clientTripId and server id', () => {
  const row = {
    companyId: '860869',
    driverId: 'D001',
    localJobId: 'local:abc',
    clientTripId: 'ct-1',
    job: { ...sampleJob, id: 'local:abc' },
    paymentType: 'Cash',
    extras: {},
    totalFare: 12,
    completedAt: 1,
  };
  assert.equal(pendingClosedJobMatches(row, { clientTripId: 'ct-1' }), true);
  assert.equal(pendingClosedJobMatches(row, { localJobId: 'local:abc' }), true);
  assert.equal(pendingClosedJobMatches(row, { serverJobId: '999' }), false);
});
