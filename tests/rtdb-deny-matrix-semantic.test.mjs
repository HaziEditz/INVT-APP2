import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDriverTransferUpdate,
  buildBrokenFlatOnlyTransferUpdate,
} from '../security/rtdb/membershipHelpers.mjs';
import {
  allowPhase0Path,
  seedFixtureDb,
  applyUpdate,
} from '../security/rtdb/phase0DenySimulator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHADOW = join(__dirname, '../security/rtdb/database.rules.phase0-shadow.json');

describe('Phase 0 shadow rules file contains Option B expressions', () => {
  const raw = readFileSync(SHADOW, 'utf8');
  const rules = JSON.parse(raw);

  it('closedJobs uses nested drivers/{cid}/{uid} or adminAccess', () => {
    const expr = rules.rules.closedJobs.$companyId['.read'];
    assert.match(expr, /drivers'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.match(expr, /adminAccess/);
    assert.doesNotMatch(expr, /drivers'\)\.child\(auth\.uid\)\.exists\(\)/);
  });

  it('tmTripStatus is company-member scoped (not auth-only)', () => {
    const expr = rules.rules.tmTripStatus.$companyId.$bookingId['.read'];
    assert.match(expr, /drivers'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.notEqual(expr, 'auth != null');
  });

  it('companySettings write requires adminAccess only', () => {
    const w = rules.rules.companySettings.$companyId['.write'];
    assert.match(w, /adminAccess'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.doesNotMatch(w, /drivers'\)\.child\(\$companyId\)/);
  });

  it('completedJobs write requires membership (not bare auth != null)', () => {
    const w = rules.rules.completedJobs.$companyId.$bookingId['.write'];
    assert.match(w, /drivers'\)\.child\(\$companyId\)\.child\(auth\.uid\)/);
    assert.notEqual(w, 'auth != null');
  });
});

describe('Phase 0 deny-matrix (Option B semantic simulator)', () => {
  it('cross-tenant closedJobs denied; own company allowed', () => {
    const f = seedFixtureDb();
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_A}/job_1001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      true,
    );
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_B}/job_2001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      false,
    );
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_A}/job_1001`,
        op: 'read',
        uid: null,
        db: f.db,
      }),
      false,
    );
  });

  it('outsider auth without membership denied', () => {
    const f = seedFixtureDb();
    assert.equal(
      allowPhase0Path({
        path: `tmTripStatus/${f.CID_A}/1001`,
        op: 'read',
        uid: f.OUTSIDER,
        db: f.db,
      }),
      false,
    );
  });

  it('adminAccess can read/write companySettings; driver cannot write', () => {
    const f = seedFixtureDb();
    assert.equal(
      allowPhase0Path({
        path: `companySettings/${f.CID_A}`,
        op: 'read',
        uid: f.ADMIN_A,
        db: f.db,
      }),
      true,
    );
    assert.equal(
      allowPhase0Path({
        path: `companySettings/${f.CID_A}`,
        op: 'write',
        uid: f.ADMIN_A,
        db: f.db,
      }),
      true,
    );
    assert.equal(
      allowPhase0Path({
        path: `companySettings/${f.CID_A}`,
        op: 'write',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      false,
    );
  });

  it('correct nested transfer flips access immediately', () => {
    const f = seedFixtureDb();
    const profile = f.db.drivers[f.CID_A][f.DRIVER_A];
    applyUpdate(
      f.db,
      buildDriverTransferUpdate({
        uid: f.DRIVER_A,
        fromCompanyId: f.CID_A,
        toCompanyId: f.CID_B,
        profile,
      }),
    );
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_A}/job_1001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      false,
    );
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_B}/job_2001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      true,
    );
  });

  it('broken flat-only transfer leaves stale A access and no B access', () => {
    const f = seedFixtureDb();
    applyUpdate(
      f.db,
      buildBrokenFlatOnlyTransferUpdate({ uid: f.DRIVER_A, toCompanyId: f.CID_B }),
    );
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_A}/job_1001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      true,
    );
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_B}/job_2001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      false,
    );
  });

  it('multi-company second nested leaf grants both companies', () => {
    const f = seedFixtureDb();
    f.db.drivers[f.CID_B][f.DRIVER_A] = { id: 'D001', companyId: f.CID_B };
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_A}/job_1001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      true,
    );
    assert.equal(
      allowPhase0Path({
        path: `closedJobs/${f.CID_B}/job_2001`,
        op: 'read',
        uid: f.DRIVER_A,
        db: f.db,
      }),
      true,
    );
  });
});
