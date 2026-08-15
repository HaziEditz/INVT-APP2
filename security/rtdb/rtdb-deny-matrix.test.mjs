/**
 * Phase 0 RTDB deny-matrix — runs against local emulator + shadow rules.
 * NEVER points at production. Production rules are unchanged.
 *
 * Lives in security/rtdb so firebase@10 + @firebase/rules-unit-testing stay
 * isolated from the driver app's firebase@11 dependency tree.
 *
 * Start via (from repo root): npm run test:rtdb-rules
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { get, set, ref, update } from 'firebase/database';
import {
  CID_A,
  CID_B,
  buildDriverTransferUpdate,
  buildBrokenFlatOnlyTransferUpdate,
  assertTransferMovesNestedLeaf,
} from './membershipHelpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, 'database.rules.phase0-shadow.json');
const PROJECT_ID = 'demo-bookawaka-phase0';

const DRIVER_A = 'driverA_uid_860869';
const DRIVER_B = 'driverB_uid_860870';
const ADMIN_A = 'adminA_uid_860869';
const OUTSIDER = 'outsider_uid';

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, '/'), {
      drivers: {
        [CID_A]: {
          [DRIVER_A]: { id: 'D001', companyId: CID_A, email: 'a@test.local', name: 'Driver A' },
        },
        [CID_B]: {
          [DRIVER_B]: { id: 'D002', companyId: CID_B, email: 'b@test.local', name: 'Driver B' },
        },
        // Flat legacy mirror for DRIVER_A (as SA transfer still touches today)
        [DRIVER_A]: { companyId: CID_A, id: 'D001' },
      },
      adminAccess: {
        [CID_A]: {
          [ADMIN_A]: { role: 'dispatcher', grantedAt: 1 },
        },
      },
      closedJobs: {
        [CID_A]: {
          job_1001: { bookingId: '1001', companyId: CID_A, fare: 42 },
        },
        [CID_B]: {
          job_2001: { bookingId: '2001', companyId: CID_B, fare: 99 },
        },
      },
      completedJobs: {
        [CID_A]: {
          '1001': { bookingId: '1001', driverId: 'D001', PlayerId: DRIVER_A, fare: 42 },
        },
        [CID_B]: {
          '2001': { bookingId: '2001', driverId: 'D002', PlayerId: DRIVER_B, fare: 99 },
        },
      },
      tmTripStatus: {
        [CID_A]: {
          '1001': { status: 'pending', companyId: CID_A },
        },
        [CID_B]: {
          '2001': { status: 'pending', companyId: CID_B },
        },
      },
      companySettings: {
        [CID_A]: { name: 'Company A', tmConfig: { enabled: true } },
        [CID_B]: { name: 'Company B', tmConfig: { enabled: true } },
      },
    });
  });
}

function dbAs(uid) {
  return testEnv.authenticatedContext(uid).database();
}

function dbUnauth() {
  return testEnv.unauthenticatedContext().database();
}

describe('Phase 0 membership helpers (pure)', () => {
  it('buildDriverTransferUpdate deletes from and writes to nested leaves', () => {
    const updateMap = buildDriverTransferUpdate({
      uid: DRIVER_A,
      fromCompanyId: CID_A,
      toCompanyId: CID_B,
      profile: { id: 'D001', email: 'a@test.local' },
    });
    assertTransferMovesNestedLeaf(updateMap, {
      uid: DRIVER_A,
      fromCompanyId: CID_A,
      toCompanyId: CID_B,
    });
    assert.equal(updateMap[`drivers/${CID_B}/${DRIVER_A}`].companyId, CID_B);
    assert.equal(updateMap[`drivers/${DRIVER_A}/companyId`], CID_B);
  });

  it('broken flat-only transfer does not move nested leaf', () => {
    const broken = buildBrokenFlatOnlyTransferUpdate({
      uid: DRIVER_A,
      toCompanyId: CID_B,
    });
    assert.equal(broken[`drivers/${DRIVER_A}/companyId`], CID_B);
    assert.equal(broken[`drivers/${CID_A}/${DRIVER_A}`], undefined);
    assert.equal(broken[`drivers/${CID_B}/${DRIVER_A}`], undefined);
  });
});

describe('Phase 0 RTDB deny-matrix (shadow rules + emulator)', () => {
  before(async () => {
    const rules = readFileSync(RULES_PATH, 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      database: {
        rules,
        host: '127.0.0.1',
        port: 9000,
      },
    });
    await seed();
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  it('unauthenticated cannot read closedJobs', async () => {
    await assertFails(get(ref(dbUnauth(), `closedJobs/${CID_A}/job_1001`)));
  });

  it('driver A can read own company closedJobs', async () => {
    await assertSucceeds(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_A}/job_1001`)));
  });

  it('driver A cannot read company B closedJobs (cross-tenant deny)', async () => {
    await assertFails(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_B}/job_2001`)));
  });

  it('driver B cannot write company A closedJobs', async () => {
    await assertFails(
      set(ref(dbAs(DRIVER_B), `closedJobs/${CID_A}/job_hack`), { bookingId: 'hack' }),
    );
  });

  it('driver A can write own company closedJobs', async () => {
    await assertSucceeds(
      set(ref(dbAs(DRIVER_A), `closedJobs/${CID_A}/job_1002`), {
        bookingId: '1002',
        companyId: CID_A,
      }),
    );
  });

  it('outsider with auth but no membership is denied', async () => {
    await assertFails(get(ref(dbAs(OUTSIDER), `closedJobs/${CID_A}/job_1001`)));
    await assertFails(get(ref(dbAs(OUTSIDER), `tmTripStatus/${CID_A}/1001`)));
  });

  it('adminAccess grants company A tmTripStatus + companySettings read', async () => {
    await assertSucceeds(get(ref(dbAs(ADMIN_A), `tmTripStatus/${CID_A}/1001`)));
    await assertSucceeds(get(ref(dbAs(ADMIN_A), `companySettings/${CID_A}`)));
  });

  it('admin can write companySettings; driver cannot', async () => {
    await assertSucceeds(
      set(ref(dbAs(ADMIN_A), `companySettings/${CID_A}/name`), 'Company A Renamed'),
    );
    await assertFails(
      set(ref(dbAs(DRIVER_A), `companySettings/${CID_A}/name`), 'Driver Hijack'),
    );
  });

  it('driver A cannot read company B tmTripStatus', async () => {
    await assertFails(get(ref(dbAs(DRIVER_A), `tmTripStatus/${CID_B}/2001`)));
  });

  it('driver A can read own completedJobs leaf; not company B', async () => {
    await assertSucceeds(get(ref(dbAs(DRIVER_A), `completedJobs/${CID_A}/1001`)));
    await assertFails(get(ref(dbAs(DRIVER_A), `completedJobs/${CID_B}/2001`)));
  });

  it('correct nested transfer: loses A access, gains B immediately', async () => {
    const profile = { id: 'D001', companyId: CID_A, email: 'a@test.local', name: 'Driver A' };
    const ops = buildDriverTransferUpdate({
      uid: DRIVER_A,
      fromCompanyId: CID_A,
      toCompanyId: CID_B,
      profile,
    });

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await update(ref(ctx.database()), ops);
    });

    await assertFails(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_A}/job_1001`)));
    await assertSucceeds(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_B}/job_2001`)));

    // Restore seed membership for any later tests in this file
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await update(ref(ctx.database()), {
        [`drivers/${CID_B}/${DRIVER_A}`]: null,
        [`drivers/${CID_A}/${DRIVER_A}`]: profile,
        [`drivers/${DRIVER_A}/companyId`]: CID_A,
      });
    });
  });

  it('broken flat-only transfer leaves stale A access and no B access', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await update(
        ref(ctx.database()),
        buildBrokenFlatOnlyTransferUpdate({ uid: DRIVER_A, toCompanyId: CID_B }),
      );
    });

    // Nested leaf still under A → Option B still allows A (stale)
    await assertSucceeds(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_A}/job_1001`)));
    // No nested leaf under B → denied
    await assertFails(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_B}/job_2001`)));

    // Restore flat mirror
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await update(ref(ctx.database()), {
        [`drivers/${DRIVER_A}/companyId`]: CID_A,
      });
    });
  });

  it('multi-company: second nested leaf grants B without removing A', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), `drivers/${CID_B}/${DRIVER_A}`), {
        id: 'D001',
        companyId: CID_B,
        email: 'a@test.local',
        shared: true,
      });
    });

    await assertSucceeds(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_A}/job_1001`)));
    await assertSucceeds(get(ref(dbAs(DRIVER_A), `closedJobs/${CID_B}/job_2001`)));

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), `drivers/${CID_B}/${DRIVER_A}`), null);
    });
  });
});
