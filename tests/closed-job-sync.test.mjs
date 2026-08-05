import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTripFieldsToJob,
  closedJobFieldsForCompleteApi,
  closedJobFieldsForJournal,
  extractClosedJobTripFields,
  pendingClosedJobMatches,
  stepTimesToClosedMirrors,
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
  distanceKm: 2.5,
  vehicleType: 'Sedan',
  meterSnapshot: {
    running: false,
    paused: false,
    mode: 'moving',
    startedAt: 1,
    pausedMs: 0,
    movingMs: 1000,
    waitingMs: 60000,
    distanceKm: 2.5,
    tariffId: 't1',
    tariffName: 'Day',
    tariffChanges: [],
    breakdown: {
      flagFall: 3.5,
      distanceKm: 2.5,
      distanceCharge: 5,
      waitingMinutes: 1,
      waitingCharge: 0.8,
      total: 9.3,
    },
    fare: 9.3,
  },
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
  const api = closedJobFieldsForCompleteApi({
    ...sampleJob,
    bookedAtMs: 1_700_000_000_000,
    stepTimes: { acceptedAt: 1_700_000_100_000, onboardAt: 1_700_000_200_000, completeAt: 1_700_000_300_000 },
  });
  assert.equal(api.pickupLat, -36.84);
  assert.equal(api.dropLat, -36.85);
  assert.equal(api.finalDropAddress, '88 Karangahape Rd');
  assert.equal(api.DropAddress, '88 Karangahape Rd');
  assert.equal(api.PickAddress, '12 Queen St');
  assert.equal(api.driverComments, 'Gate code 1');
  assert.equal(api.VehicleType, 'Sedan');
  assert.equal(api.createdAt, 1_700_000_000_000);
  assert.ok(api.DriverAcceptedAt);
  assert.ok(api.OnBoardAt);
  assert.ok(api.JobCompleteTime);
  assert.equal(api.fareBreakdown.flagFall, 3.5);
  assert.equal(api.waitingCost, 0.8);
  assert.equal(api.tariffName, 'Day');
  assert.equal(api.TarriffType, 'Day');
  assert.equal(api.TarriffName, 'Day');
});

test('complete API prefers meter tariffChanges and final tariff aliases', () => {
  const api = closedJobFieldsForCompleteApi({
    ...sampleJob,
    tariffChanges: [],
    meterSnapshot: {
      ...sampleJob.meterSnapshot,
      tariffId: '2',
      tariffName: 'Total mobility',
      tariffChanges: [{ tariffId: '2', tariffName: 'Total mobility', at: 1 }],
    },
  });
  assert.equal(api.tariffName, 'Total mobility');
  assert.equal(api.TarriffType, 'Total mobility');
  assert.equal(api.tariffId, '2');
  assert.equal(api.tariffChanges.length, 1);
  assert.equal(api.tariffChanges[0].tariffName, 'Total mobility');
});

test('complete API keeps Fixed / -1 for fixed-fare jobs (ignores meter tariff)', () => {
  const api = closedJobFieldsForCompleteApi({
    ...sampleJob,
    isFixedPrice: true,
    fixedFare: 40,
    fare: 40,
    meterSnapshot: {
      ...sampleJob.meterSnapshot,
      tariffId: '527',
      tariffName: 'Total Mobility',
    },
  });
  assert.equal(api.tariffId, '-1');
  assert.equal(api.TarriffId, '-1');
  assert.equal(api.tariffName, 'Fixed');
  assert.equal(api.TarriffType, 'Fixed');
  assert.equal(api.fixedPrice, true);
});

test('complete API sends fareBreakdown after Payment-modal-style rebuild', () => {
  // Mirror withCompleteFareBreakdown / calcMeterBreakdown arithmetic.
  const flagFall = 3.5;
  const distanceKm = 2.5;
  const waitingMinutes = 1;
  const distanceCharge = distanceKm * 2;
  const waitingCharge = waitingMinutes * 0.8;
  const breakdown = {
    flagFall,
    distanceKm,
    distanceCharge,
    waitingMinutes,
    waitingCharge,
    total: flagFall + distanceCharge + waitingCharge,
  };
  const rebuilt = {
    ...sampleJob,
    meterSnapshot: {
      running: false,
      paused: false,
      mode: 'moving',
      startedAt: 1,
      finishedAt: 2,
      pausedMs: 0,
      movingMs: 1000,
      waitingMs: 60000,
      distanceKm: 2.5,
      tariffId: 't1',
      tariffName: 'Day',
      tariffChanges: [],
      breakdown,
      fare: breakdown.total,
    },
  };
  const api = closedJobFieldsForCompleteApi(rebuilt);
  assert.equal(api.fareBreakdown.flagFall, 3.5);
  assert.equal(api.fareBreakdown.distanceKm, 2.5);
  assert.equal(api.fareBreakdown.waitingMinutes, 1);
  assert.equal(api.fareBreakdown.total, breakdown.total);
});

test('stepTimesToClosedMirrors writes ISO timeline keys', () => {
  const mirrors = stepTimesToClosedMirrors({
    acceptedAt: 1_700_000_100_000,
    arrivedAt: 1_700_000_200_000,
    onboardAt: 1_700_000_300_000,
    completeAt: 1_700_000_400_000,
  });
  assert.match(String(mirrors.DriverAcceptedAt), /T/);
  assert.match(String(mirrors.ArrivedAt), /T/);
  assert.match(String(mirrors.OnBoardAt), /T/);
  assert.match(String(mirrors.JobCompleteTime), /T/);
});

test('closedJobFieldsForJournal includes meter + vehicle for offline rebuild', () => {
  const payload = closedJobFieldsForJournal({
    ...sampleJob,
    accountId: 'acct-1',
    accountName: 'Acme Co',
  });
  assert.equal(payload.VehicleType, 'Sedan');
  assert.ok(payload.meterSnapshot);
  assert.equal(payload.fareBreakdown.total, 9.3);
  assert.deepEqual(payload.stepTimes, { onboardAt: 1 });
  assert.equal(payload.Account_id, 'acct-1');
  assert.equal(payload.Account_Name, 'Acme Co');
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

test('applyTripFieldsToJob ignores empty dropoff string and uses DropAddress', () => {
  const sparse = {
    id: '1',
    type: 'Taxi',
    stage: 'complete',
    pickup: 'Pick St',
    dropoff: '',
  };
  const restored = applyTripFieldsToJob(sparse, {
    dropoff: '',
    DropAddress: 'Drop St from booking',
  });
  assert.equal(restored.dropoff, 'Drop St from booking');
});

test('applyTripFieldsToJob rebuilds meterSnapshot and vehicleType from journal', () => {
  const sparse = {
    id: '1',
    type: 'Taxi',
    stage: 'complete',
    pickup: 'A',
    dropoff: 'B',
    stepTimes: {},
    distanceKm: 0,
  };
  const restored = applyTripFieldsToJob(sparse, closedJobFieldsForJournal(sampleJob));
  assert.equal(restored.vehicleType, 'Sedan');
  assert.equal(restored.meterSnapshot?.breakdown?.total, 9.3);
  assert.deepEqual(restored.stepTimes, { onboardAt: 1 });
  assert.equal(restored.distanceKm, 2.5);
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
