/**
 * resolveEmailForLogin vs per-company Driver IDs after transfer allocation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocateNextDriverId,
  buildDriverTransferUpdate,
  collectUsedDriverIds,
} from '../security/rtdb/membershipHelpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('transfer allocator never leaves two profiles with same id at destination', () => {
  const destExisting = {
    incumbentUid: { id: 'D001', email: 'keep@co.b' },
    otherUid: { id: 'D002', email: 'other@co.b' },
  };
  const used = collectUsedDriverIds(destExisting);
  const update = buildDriverTransferUpdate({
    uid: 'moverUid',
    fromCompanyId: '860869',
    toCompanyId: '860870',
    profile: { id: 'D001', email: 'mover@co.a' },
    usedDestinationIds: used,
  });
  const destProfile = update['drivers/860870/moverUid'];
  assert.equal(destProfile.id, 'D003');
  const after = { ...destExisting, moverUid: destProfile };
  const ids = [...collectUsedDriverIds(after)];
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids inside destination company');
});

test('driverAuth still scopes ID login by scanning records — unique-per-company removes same-company ambiguity', () => {
  const src = readFileSync(join(root, 'lib/driverAuth.ts'), 'utf8');
  assert.match(src, /collectCandidatesFromDriversTree/);
  // Cross-company D001 remains valid product-wise (each company has its own D001).
  // Transfer fix guarantees we do not create a second D001 inside the receiving company.
  assert.equal(allocateNextDriverId(['D001']), 'D002');
});

test('SA-Drivers transfer uses commitDriverTransfer / allocateNextDriverIdSa', () => {
  const aspx = readFileSync(
    join(root, '../INVT-superadmin/taxitime.co.nz/superadmin360taxi/SA-Drivers.aspx'),
    'utf8',
  );
  assert.match(aspx, /function commitDriverTransfer/);
  assert.match(aspx, /allocateNextDriverIdSa/);
  assert.match(aspx, /toDriverId/);
  assert.doesNotMatch(aspx, /db\.ref\('drivers\/'\+r\.driverUid\)\.update\(\{\s*companyId:\s*r\.toCompanyId\s*\}\)/);
});
