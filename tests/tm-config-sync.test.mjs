/**
 * Phase 1 — council tmConfig ↔ company driver-split mapping + reference price list UX.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTmHoistEntries,
  calcTmPaymentBreakdown,
  calcTmSplit,
  isTmConfigReadyForConfirm,
  mapCouncilRecordToCompanyTmConfig,
  parseTmConfigRecord,
  resolvePrimaryTmCard,
  tmConfigConfirmBlockReason,
} from '../lib/tmConfigLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const saRoot = join(root, '..', 'INVT-superadmin', 'taxitime.co.nz', 'superadmin360taxi');
const saSrcRoot = join(root, '..', 'INVT-superadmin', 'src', 'routes');
const adminRoot = join(root, '..', 'INVT-admin');

test('parseTmConfigRecord accepts council and company field aliases', () => {
  assert.deepEqual(
    parseTmConfigRecord({
      subsidyPercent: 50,
      capAmount: 40,
      hoistRatePerUse: 12,
    }),
    {
      councilSubsidyPercent: 50,
      councilCapAmount: 40,
      hoistCostPerUnit: 12,
    },
  );
  assert.deepEqual(
    parseTmConfigRecord({
      councilPercent: 65,
      hoistUnitCost: 11.5,
      councilCapAmount: 37.4,
    }),
    {
      councilSubsidyPercent: 65,
      councilCapAmount: 37.4,
      hoistCostPerUnit: 11.5,
    },
  );
});

test('mapCouncilRecordToCompanyTmConfig mirrors SA sync payload shape', () => {
  const mapped = mapCouncilRecordToCompanyTmConfig('cncl_icc', {
    subsidyPercent: 65,
    capAmount: 37.4,
    hoistRatePerUse: 11.5,
  });
  assert.equal(mapped.councilSubsidyPercent, 65);
  assert.equal(mapped.councilPercent, 65);
  assert.equal(mapped.passengerPercent, 35);
  assert.equal(mapped.councilCapAmount, 37.4);
  assert.equal(mapped.hoistCostPerUnit, 11.5);
  assert.equal(mapped.sourceCouncilId, 'cncl_icc');
});

test('SA tm-helpers syncs council economics to approved companies', () => {
  const src = readFileSync(join(saRoot, 'assets/js/tm-helpers.js'), 'utf8');
  assert.match(src, /companyTmConfigFromCouncil/);
  assert.match(src, /syncCouncilTmConfigToApprovedCompanies/);
  assert.match(src, /syncCouncilTmConfigToCompany/);
  assert.match(src, /councilSubsidyPercent/);
  assert.match(src, /sourceCouncilId/);
});

test('SA Council Config save triggers company sync', () => {
  const src = readFileSync(join(saRoot, 'TM-Council-Config.aspx'), 'utf8');
  assert.match(src, /syncCouncilTmConfigToApprovedCompanies/);
});

test('SA approve company access syncs council rates', () => {
  const src = readFileSync(join(saRoot, 'TM-Settings.aspx'), 'utf8');
  assert.match(src, /syncCouncilTmConfigToCompany/);
  assert.match(src, /Reference price list/i);
  assert.match(src, /not live metering/i);
  assert.doesNotMatch(
    src,
    /Set the metered rates used to calculate TM fares/,
  );
});

test('owner panel removes TM Tariffs from nav and marks page legacy', () => {
  const src = readFileSync(join(adminRoot, 'server.js'), 'utf8');
  assert.match(src, /LEGACY — NOT USED/);
  assert.match(src, /tm_tariffs\.aspx removed from nav/);
  assert.doesNotMatch(
    src,
    /<li><a href="TM_Tariffs\.aspx">Tariffs<\/a><\/li>/,
  );
  assert.doesNotMatch(
    src,
    /These are used for billing and council claims/,
  );
});

test('council portal Operators labels tmTariffs as Manual reference', () => {
  const src = readFileSync(join(saSrcRoot, 'council.ts'), 'utf8');
  assert.match(src, /Manual reference/i);
  assert.match(src, /Not used for live metering/);
  assert.match(src, /tmTariffs\//);
});

test('council portal card limits use SA usageLimitMonthly / usageLimitDaily', () => {
  const src = readFileSync(join(saSrcRoot, 'council.ts'), 'utf8');
  assert.match(src, /usageLimitMonthly/);
  assert.match(src, /usageLimitDaily/);
  assert.match(src, /name="usageLimitMonthly"/);
  assert.match(src, /name="usageLimitDaily"/);
  assert.match(src, /patch\.usageLimitMonthly\s*=/);
  assert.match(src, /patch\.usageLimitDaily\s*=/);
  // Form must not post the old portal-only dollar schema keys.
  assert.doesNotMatch(src, /name="monthlyLimit"/);
  assert.doesNotMatch(src, /name="maxFarePerTrip"/);
  assert.doesNotMatch(src, /name="defaultMonthlyLimit"/);
  assert.doesNotMatch(src, /name="defaultMaxFarePerTrip"/);
});

test('calcTmPaymentBreakdown keeps hoist out of meter %/cap split', () => {
  const cfg = {
    councilSubsidyPercent: 65,
    councilCapAmount: 26,
    hoistCostPerUnit: 10,
  };
  // Meter $40 → 65% = $26 (hits cap). Hoist 2×$10 = $20 full council.
  const b = calcTmPaymentBreakdown(40, 2, cfg);
  assert.equal(b.meterFare, 40);
  assert.equal(b.councilPaysMeter, 26);
  assert.equal(b.passengerPaysMeter, 14);
  assert.equal(b.hoistTotal, 20);
  assert.equal(b.councilPaysHoist, 20);
  assert.equal(b.passengerPaysHoist, 0);
  assert.equal(b.councilPays, 46); // 26 + 20
  assert.equal(b.passengerPays, 14); // hoist never charged to passenger
  assert.equal(b.totalFare, 60);
  assert.equal(b.meterSubsidyUncapped, false);
  // Regression: old bug applied %/cap to meter+hoist ($60 → would change passenger share).
  const wronglyOnCombined = calcTmPaymentBreakdown(60, 0, cfg);
  assert.notEqual(b.passengerPays, wronglyOnCombined.passengerPays);
});

test('cap===0 with valid pct uses uncapped percentage (never silent $0)', () => {
  const cfg = {
    councilSubsidyPercent: 65,
    councilCapAmount: 0,
    hoistCostPerUnit: 10,
  };
  const split = calcTmSplit(5.55, cfg);
  assert.equal(split.uncapped, true);
  assert.equal(split.councilPays, 3.61); // 65% of 5.55
  assert.equal(split.passengerPays, 1.94);
  const b = calcTmPaymentBreakdown(5.55, 0, cfg);
  assert.equal(b.councilPaysMeter, 3.61);
  assert.equal(b.meterSubsidyUncapped, true);
  // Missing/NaN cap same as 0
  const missingCap = calcTmSplit(40, {
    councilSubsidyPercent: 65,
    councilCapAmount: Number.NaN,
    hoistCostPerUnit: 0,
  });
  assert.equal(missingCap.uncapped, true);
  assert.equal(missingCap.councilPays, 26);
});

test('null/loading tmConfig blocks confirm; DEFAULT pct=0 also blocked', () => {
  assert.match(
    tmConfigConfirmBlockReason(null) || '',
    /still loading/i,
  );
  assert.match(
    tmConfigConfirmBlockReason(undefined, { loading: true }) || '',
    /still loading/i,
  );
  assert.equal(isTmConfigReadyForConfirm(null), false);
  assert.match(
    tmConfigConfirmBlockReason({
      councilSubsidyPercent: 0,
      councilCapAmount: 0,
      hoistCostPerUnit: 0,
    }) || '',
    /not configured/i,
  );
  assert.equal(
    isTmConfigReadyForConfirm({
      councilSubsidyPercent: 65,
      councilCapAmount: 0,
      hoistCostPerUnit: 10,
    }),
    true,
  );
  assert.equal(
    tmConfigConfirmBlockReason({
      councilSubsidyPercent: 65,
      councilCapAmount: 26,
      hoistCostPerUnit: 10,
    }),
    null,
  );
});

test('PaymentModal blocks TM confirm while tmConfig null/loading', () => {
  const modalSrc = readFileSync(join(root, 'components/PaymentModal.tsx'), 'utf8');
  assert.match(modalSrc, /tmConfigLoading/);
  assert.match(modalSrc, /tmConfigConfirmBlockReason/);
  assert.match(modalSrc, /TM settings not ready/);
  assert.match(modalSrc, /Waiting for TM settings/);
  assert.match(modalSrc, /disabled=\{submitting \|\| !tmConfigReady\}/);
  assert.match(modalSrc, /if \(!tmConfigReady\) return false/);
});

test('Phase 2A.1 portal config edit + audit + hoist 100% council', () => {
  const src = readFileSync(join(saSrcRoot, 'council.ts'), 'utf8');
  assert.match(src, /council-portal\/config/);
  assert.match(src, /tmConfigAudit/);
  assert.match(src, /byRole:\s*'council'/);
  assert.match(src, /hoistCoveredByCouncil:\s*true/);
  assert.match(src, /Meter [Ss]ubsidy/);
  assert.match(src, /Hoist \(council\)/);
  assert.match(src, /Council claim \(%\/cap\)/);
  const saCfg = readFileSync(join(saRoot, 'TM-Council-Config.aspx'), 'utf8');
  assert.match(saCfg, /100% council-paid/i);
  assert.match(saCfg, /tmConfigAudit/);
  assert.doesNotMatch(saCfg, /<option value="false">Passenger<\/option>/);
});

test('Phase 2A.2 multi hoist rows: 1× rate each, primary from first hoist', () => {
  const entries = buildTmHoistEntries(
    [
      { cardNumber: '111', cardExpiry: '01/27', cardName: 'Alex' },
      { cardNumber: ' 222 ', cardExpiry: '', cardName: 'Blake' },
      { cardNumber: '', cardExpiry: '03/28' }, // ignored — no card
    ],
    10,
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].amount, 10);
  assert.equal(entries[1].amount, 10);
  assert.equal(entries[0].cardNumber, '111');
  assert.equal(entries[0].cardName, 'Alex');
  assert.equal(entries[1].cardNumber, '222');
  assert.equal(entries[1].cardName, 'Blake');
  const b = calcTmPaymentBreakdown(40, entries.length, {
    councilSubsidyPercent: 65,
    councilCapAmount: 26,
    hoistCostPerUnit: 10,
  });
  assert.equal(b.hoistTotal, 20);
  assert.equal(b.passengerPays, 14);
  const primaryEmpty = resolvePrimaryTmCard('', undefined, entries);
  assert.equal(primaryEmpty.tmCardNumber, '111');
  assert.equal(primaryEmpty.tmCardExpiry, '01/27');
  assert.equal(primaryEmpty.tmCardName, 'Alex');
  const primarySet = resolvePrimaryTmCard('999', '12/30', entries, 'Casey');
  assert.equal(primarySet.tmCardNumber, '999');
  assert.equal(primarySet.tmCardExpiry, '12/30');
  assert.equal(primarySet.tmCardName, 'Casey');
});
