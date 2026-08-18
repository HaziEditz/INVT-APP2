import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CID_A,
  CID_B,
  RULE_IS_COMPANY_MEMBER,
  RULE_IS_COMPANY_ADMIN,
  buildDriverTransferUpdate,
  buildBrokenFlatOnlyTransferUpdate,
  assertTransferMovesNestedLeaf,
  allocateNextDriverId,
  collectUsedDriverIds,
  normalizeDriverId,
} from '../security/rtdb/membershipHelpers.mjs';

describe('rtdb membership helpers (Option B)', () => {
  it('exports Option B rule expressions referencing nested drivers and adminAccess', () => {
    assert.match(RULE_IS_COMPANY_MEMBER, /drivers'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.match(RULE_IS_COMPANY_MEMBER, /adminAccess'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.match(RULE_IS_COMPANY_ADMIN, /adminAccess'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.equal(CID_A, '860869');
    assert.equal(CID_B, '860870');
  });

  it('allocateNextDriverId walks from D001 and skips used slots', () => {
    assert.equal(allocateNextDriverId([]), 'D001');
    assert.equal(allocateNextDriverId(['D001', 'D002']), 'D003');
    assert.equal(allocateNextDriverId(new Set(['D001', 'D003'])), 'D002');
    assert.equal(
      allocateNextDriverId({
        u1: { id: 'D001' },
        u2: { driverId: 'D002' },
      }),
      'D003',
    );
    assert.equal(normalizeDriverId('d5'), 'D005');
  });

  it('transfer with no collision still assigns sequential dest id (not blind keep of old high id)', () => {
    const uid = 'uid_transfer';
    // Dest empty — next free is D001 even if transferor was D009 at old company.
    const update = buildDriverTransferUpdate({
      uid,
      fromCompanyId: CID_A,
      toCompanyId: CID_B,
      profile: { id: 'D009', email: 't@test.local', name: 'Alex' },
      usedDestinationIds: [],
    });
    assertTransferMovesNestedLeaf(update, { uid, fromCompanyId: CID_A, toCompanyId: CID_B });
    const dest = update[`drivers/${CID_B}/${uid}`];
    assert.equal(dest.companyId, CID_B);
    assert.equal(dest.id, 'D001');
    assert.equal(dest.driverId, 'D001');
    assert.equal(update[`drivers/${uid}/id`], 'D001');
    assert.equal(update[`drivers/${uid}/companyId`], CID_B);
  });

  it('transfer when old id is taken at dest gets next free (no collision)', () => {
    const uid = 'uid_transfer';
    const update = buildDriverTransferUpdate({
      uid,
      fromCompanyId: CID_A,
      toCompanyId: CID_B,
      profile: { id: 'D001', email: 'mover@test.local' },
      usedDestinationIds: collectUsedDriverIds({
        other: { id: 'D001', email: 'incumbent@test.local' },
        another: { id: 'D002' },
      }),
    });
    const dest = update[`drivers/${CID_B}/${uid}`];
    assert.equal(dest.id, 'D003');
    assert.equal(dest.driverId, 'D003');
    assert.equal(dest.email, 'mover@test.local');
    assert.equal(update[`drivers/${CID_A}/${uid}`], null);
  });

  it('requires usedDestinationIds (no silent blind id copy)', () => {
    assert.throws(() =>
      buildDriverTransferUpdate({
        uid: 'x',
        fromCompanyId: CID_A,
        toCompanyId: CID_B,
        profile: { id: 'D001' },
      }),
    );
  });

  it('broken flat-only transfer leaves nested membership unchanged', () => {
    const uid = 'uid_transfer';
    const broken = buildBrokenFlatOnlyTransferUpdate({ uid, toCompanyId: CID_B });
    assert.deepEqual(Object.keys(broken), [`drivers/${uid}/companyId`]);
  });

  it('rejects same-company transfer', () => {
    assert.throws(() =>
      buildDriverTransferUpdate({
        uid: 'x',
        fromCompanyId: CID_A,
        toCompanyId: CID_A,
        profile: {},
        usedDestinationIds: [],
      }),
    );
  });
});
