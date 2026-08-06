/**
 * Phase 1 — council tmConfig ↔ company driver-split mapping + legacy tmTariffs UX.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapCouncilRecordToCompanyTmConfig,
  parseTmConfigRecord,
} from '../lib/tmConfigLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const saRoot = join(root, '..', 'INVT-superadmin', 'taxitime.co.nz', 'superadmin360taxi');
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
  assert.match(src, /legacy \/ unused|LEGACY — unused/i);
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
