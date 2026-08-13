/**
 * TM payment persist — expiry UX, closed-job fields, claim filters / status seed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTmPersistFields,
  buildTmTripStatusSeed,
  formatTmCardExpiryInput,
  isCompleteCardholderName,
  isTmCompletedJobRecord,
  pickTmFieldsFromPayload,
} from '../lib/tmPaymentPersist.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const saRoot = join(root, '..', 'INVT-superadmin', 'taxitime.co.nz', 'superadmin360taxi');
const saSrcRoot = join(root, '..', 'INVT-superadmin', 'src', 'routes');
const adminRoot = join(root, '..', 'INVT-admin');
const invtRoot = join(root, '..', 'INVT');

test('formatTmCardExpiryInput inserts slash after month', () => {
  assert.equal(formatTmCardExpiryInput('1'), '1');
  assert.equal(formatTmCardExpiryInput('12'), '12');
  assert.equal(formatTmCardExpiryInput('123'), '12/3');
  assert.equal(formatTmCardExpiryInput('1227'), '12/27');
  assert.equal(formatTmCardExpiryInput('12/27'), '12/27');
  assert.equal(formatTmCardExpiryInput('12-27'), '12/27');
  assert.equal(formatTmCardExpiryInput('122799'), '12/27');
});

test('isCompleteCardholderName requires first and last', () => {
  assert.equal(isCompleteCardholderName(''), false);
  assert.equal(isCompleteCardholderName('Marianne'), false);
  assert.equal(isCompleteCardholderName('Marianne Hodges'), true);
  assert.equal(isCompleteCardholderName('  Jane   Doe  '), true);
});

test('isTmCompletedJobRecord accepts remainder Cash + TM economics', () => {
  assert.equal(isTmCompletedJobRecord({ paymentType: 'Cash' }), false);
  assert.equal(
    isTmCompletedJobRecord({
      paymentType: 'Cash',
      isTotalMobility: true,
      tmCouncilPays: 12.5,
      tmCardNumber: '123456',
    }),
    true,
  );
  assert.equal(
    isTmCompletedJobRecord({ paymentType: 'total_mobility' }),
    true,
  );
  assert.equal(
    isTmCompletedJobRecord({ paymentType: 'Card', tmVoucherNo: '99' }),
    true,
  );
});

test('buildTmPersistFields keeps remainder method separate from TM markers', () => {
  const fields = buildTmPersistFields(
    {
      councilPays: 26,
      passengerPays: 14,
      meterFare: 40,
      tmSubsidyFare: 26,
      hoistTotal: 10,
      tmSubsidyHoist: 10,
      hoistCount: 1,
      tmCardNumber: '555',
      tmCardName: 'Jane Doe',
      tmCardExpiry: '12/27',
      totalFare: 50,
      councilId: 'cncl_icc',
    },
    { remainderPaymentType: 'Cash', councilId: 'cncl_icc' },
  );
  assert.equal(fields.isTotalMobility, true);
  assert.equal(fields.tmPaymentType, 'total_mobility');
  assert.equal(fields.tmCouncilPays, 26);
  assert.equal(fields.tmSubsidy, 26);
  assert.equal(fields.tmPassengerPays, 14);
  assert.equal(fields.tmCardNumber, '555');
  assert.equal(fields.tmVoucherNo, '555');
  assert.equal(fields.tmCardName, 'Jane Doe');
  assert.equal(fields.tmRemainderPaymentType, 'Cash');
  assert.equal(fields.councilId, 'cncl_icc');
  assert.equal(fields.hoistTotal, 10);
});

test('buildTmPersistFields refuses silent $0 meter subsidy with positive meter', () => {
  assert.throws(
    () =>
      buildTmPersistFields({
        councilPays: 0,
        passengerPays: 5.55,
        meterFare: 5.55,
        tmSubsidyFare: 0,
        totalFare: 5.55,
      }),
    /subsidy is \$0/i,
  );
});

test('buildTmPersistFields writes meter claim only — hoist stays separate', () => {
  // Driver UI grand total still includes hoist in councilPays; persist must strip it.
  const fields = buildTmPersistFields({
    councilPays: 36, // 26 meter + 10 hoist (UI total)
    passengerPays: 14,
    meterFare: 40,
    tmSubsidyFare: 26,
    hoistTotal: 10,
    tmSubsidyHoist: 10,
    hoistCount: 1,
    totalFare: 50,
  });
  assert.equal(fields.tmCouncilPays, 26);
  assert.equal(fields.tmSubsidy, 26);
  assert.equal(fields.councilPays, 26);
  assert.equal(fields.tmSubsidyFare, 26);
  assert.equal(fields.tmSubsidyHoist, 10);
  assert.equal(fields.hoistTotal, 10);
});

test('buildTmPersistFields stamps hoistUsedConfirmed only when explicit Yes', () => {
  const yes = buildTmPersistFields({
    councilPays: 26,
    passengerPays: 14,
    tmSubsidyFare: 26,
    hoistTotal: 10,
    hoistCount: 1,
    hoistUsedConfirmed: true,
    totalFare: 50,
    tmCardNumber: '44818303',
  });
  assert.equal(yes.hoistUsedConfirmed, true);
  const no = buildTmPersistFields({
    councilPays: 26,
    passengerPays: 14,
    tmSubsidyFare: 26,
    totalFare: 40,
    tmCardNumber: '44818303',
  });
  assert.equal(no.hoistUsedConfirmed, undefined);
});

test('buildTmPersistFields subtracts hoist when tmSubsidyFare missing', () => {
  const fields = buildTmPersistFields({
    councilPays: 36,
    passengerPays: 14,
    hoistTotal: 10,
    tmSubsidyHoist: 10,
    totalFare: 50,
  });
  assert.equal(fields.tmCouncilPays, 26);
  assert.equal(fields.tmSubsidy, 26);
});

test('buildTmTripStatusSeed is pending for council portal', () => {
  const seed = buildTmTripStatusSeed('860869', 'cncl_icc', {
    councilPays: 30,
    passengerPays: 10,
    tmSubsidyFare: 20,
    tmSubsidyHoist: 10,
    hoistTotal: 10,
    totalFare: 40,
    tmCardNumber: '111',
  });
  assert.equal(seed.status, 'pending');
  assert.equal(seed.councilId, 'cncl_icc');
  assert.equal(seed.companyId, '860869');
  assert.equal(seed.source, 'driver_complete');
  assert.equal(seed.tmCouncilPays, 20);
});

test('pickTmFieldsFromPayload rebuilds from TmPaymentDetails journal shape', () => {
  const picked = pickTmFieldsFromPayload({
    councilPays: 15,
    passengerPays: 5,
    tmCardNumber: '777',
    totalFare: 20,
    paymentType: 'EFTPOS',
    councilId: 'cncl_x',
  });
  assert.ok(picked);
  assert.equal(picked.isTotalMobility, true);
  assert.equal(picked.tmCouncilPays, 15);
  assert.equal(picked.tmRemainderPaymentType, 'EFTPOS');
  assert.equal(picked.councilId, 'cncl_x');
});

test('PaymentModal wires expiry formatter + cardholder name', () => {
  const src = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
  assert.match(src, /formatTmCardExpiryInput/);
  assert.match(src, /isCompleteCardholderName/);
  assert.match(src, /tmCardName/);
  assert.match(src, /Full passenger name \(first & last\)/);
  assert.match(src, /sourceCouncilId/);
});

test('closedJobs seeds tmTripStatus when councilId present', () => {
  const src = readFileSync(join(root, 'lib/closedJobs.ts'), 'utf8');
  assert.match(src, /tmTripStatus\/\$\{companyId\}\/\$\{job\.id\}/);
  assert.match(src, /buildTmTripStatusSeed/);
  assert.match(src, /buildTmPersistFields/);
});

test('dispatch complete whitelist + tmTripStatus seed', () => {
  const src = readFileSync(join(invtRoot, 'server.js'), 'utf8');
  assert.match(src, /tmCouncilPays/);
  assert.match(src, /tmRemainderPaymentType/);
  assert.match(src, /tmTripStatus\/\$\{_cid\}\/\$\{bookingId\}/);
  assert.match(src, /isTotalMobility/);
});

test('Closed Job UI shows TM when remainder is Cash', () => {
  const lib = readFileSync(join(invtRoot, 'src/lib/closedJobs.ts'), 'utf8');
  const modal = readFileSync(
    join(invtRoot, 'src/components/jobs/ClosedJobDetailModal.tsx'),
    'utf8',
  );
  assert.match(lib, /closedJobIsTotalMobility/);
  assert.match(lib, /closedJobTmSummary/);
  assert.match(lib, /TM · /);
  assert.match(modal, /closedJobTmSummary/);
  assert.match(modal, /Total Mobility/);
});

test('owner panel extractTmTrips accepts driver TM economics', () => {
  const src = readFileSync(join(adminRoot, 'server.js'), 'utf8');
  assert.match(src, /function isOwnerTmCompletedJob/);
  assert.match(src, /function mergeOwnerTmJobMap/);
  assert.match(src, /isTotalMobility === true/);
  assert.match(src, /tmCouncilPays/);
  assert.match(src, /adminRead\('closedJobs\/' \+ cid\)/);
  assert.match(src, /tmCardNumber \|\| t\.tmVoucherNo/);
});

test('SA TM pages use isTmCompletedJob helper', () => {
  const helpers = readFileSync(join(saRoot, 'assets/js/tm-helpers.js'), 'utf8');
  assert.match(helpers, /window\.isTmCompletedJob/);
  for (const page of ['TM-Trips.aspx', 'TM-Batches.aspx', 'TM-Reports.aspx', 'TM-Flagged.aspx']) {
    const src = readFileSync(join(saRoot, page), 'utf8');
    assert.match(src, /isTmCompletedJob/, page);
  }
  const council = readFileSync(join(saSrcRoot, 'council.ts'), 'utf8');
  assert.match(council, /isTotalMobility === true/);
  assert.match(council, /tmTripStatus/);
});
