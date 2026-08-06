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

test('buildTmTripStatusSeed is pending for council portal', () => {
  const seed = buildTmTripStatusSeed('860869', 'cncl_icc', {
    councilPays: 20,
    passengerPays: 10,
    totalFare: 30,
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

test('PaymentModal wires expiry formatter + optional cardholder', () => {
  const src = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
  assert.match(src, /formatTmCardExpiryInput/);
  assert.match(src, /tmCardName/);
  assert.match(src, /Cardholder name \(optional\)/);
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
  assert.match(src, /isTotalMobility === true/);
  assert.match(src, /tmCouncilPays/);
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
