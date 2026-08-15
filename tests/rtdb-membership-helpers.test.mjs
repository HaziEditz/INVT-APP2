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
} from '../security/rtdb/membershipHelpers.mjs';

describe('rtdb membership helpers (Option B)', () => {
  it('exports Option B rule expressions referencing nested drivers and adminAccess', () => {
    assert.match(RULE_IS_COMPANY_MEMBER, /drivers'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.match(RULE_IS_COMPANY_MEMBER, /adminAccess'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.match(RULE_IS_COMPANY_ADMIN, /adminAccess'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.equal(CID_A, '860869');
    assert.equal(CID_B, '860870');
  });

  it('correct transfer moves nested leaf immediately', () => {
    const uid = 'uid_transfer';
    const update = buildDriverTransferUpdate({
      uid,
      fromCompanyId: CID_A,
      toCompanyId: CID_B,
      profile: { id: 'D009', email: 't@test.local' },
    });
    assertTransferMovesNestedLeaf(update, { uid, fromCompanyId: CID_A, toCompanyId: CID_B });
    assert.equal(update[`drivers/${CID_B}/${uid}`].companyId, CID_B);
    assert.equal(update[`drivers/${uid}/companyId`], CID_B);
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
      }),
    );
  });
});
