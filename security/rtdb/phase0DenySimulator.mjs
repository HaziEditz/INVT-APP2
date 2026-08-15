/**
 * Pure-JS Option B membership evaluator for Phase 0 deny-matrix
 * when the Firebase RTDB emulator (requires Java) is unavailable.
 *
 * This is NOT a full RTDB rules engine — it evaluates only the Option B
 * membership predicates used by the Phase 0 shadow paths.
 */

/**
 * @param {Record<string, unknown>} db
 * @param {string | null} uid
 * @param {string} companyId
 */
export function isCompanyMember(db, uid, companyId) {
  if (!uid) return false;
  const drivers = db.drivers?.[companyId]?.[uid];
  const admin = db.adminAccess?.[companyId]?.[uid];
  return drivers != null || admin != null;
}

/**
 * @param {Record<string, unknown>} db
 * @param {string | null} uid
 * @param {string} companyId
 */
export function isCompanyAdmin(db, uid, companyId) {
  if (!uid) return false;
  return db.adminAccess?.[companyId]?.[uid] != null;
}

/**
 * Phase 0 shadow path allow matrix (mirrors database.rules.phase0-shadow.json).
 * @param {{ path: string, op: 'read'|'write', uid: string|null, db: any }} args
 */
export function allowPhase0Path({ path, op, uid, db }) {
  const closed = path.match(/^closedJobs\/([^/]+)(?:\/|$)/);
  if (closed) {
    return isCompanyMember(db, uid, closed[1]);
  }

  const tm = path.match(/^tmTripStatus\/([^/]+)\/([^/]+)$/);
  if (tm) {
    return isCompanyMember(db, uid, tm[1]);
  }

  const settings = path.match(/^companySettings\/([^/]+)/);
  if (settings) {
    if (op === 'write') return isCompanyAdmin(db, uid, settings[1]);
    return isCompanyMember(db, uid, settings[1]);
  }

  const completedLeaf = path.match(/^completedJobs\/([^/]+)\/([^/]+)$/);
  if (completedLeaf) {
    const cid = completedLeaf[1];
    if (!isCompanyMember(db, uid, cid)) return false;
    if (isCompanyAdmin(db, uid, cid)) return true;
    if (op === 'write') return isCompanyMember(db, uid, cid);
    const row = db.completedJobs?.[cid]?.[completedLeaf[2]];
    if (!row) return isCompanyMember(db, uid, cid);
    const driverNode = db.drivers?.[cid]?.[uid];
    const driverId = driverNode?.id;
    return (
      row.PlayerId === uid ||
      row.driverId === driverId ||
      row.DriverId === driverId ||
      row.driverid === driverId
    );
  }

  const completedRoot = path.match(/^completedJobs\/([^/]+)$/);
  if (completedRoot) {
    return isCompanyMember(db, uid, completedRoot[1]);
  }

  throw new Error(`unsupported path in Phase 0 simulator: ${path}`);
}

export function seedFixtureDb() {
  const CID_A = '860869';
  const CID_B = '860870';
  const DRIVER_A = 'driverA_uid_860869';
  const DRIVER_B = 'driverB_uid_860870';
  const ADMIN_A = 'adminA_uid_860869';

  return {
    CID_A,
    CID_B,
    DRIVER_A,
    DRIVER_B,
    ADMIN_A,
    OUTSIDER: 'outsider_uid',
    db: {
      drivers: {
        [CID_A]: {
          [DRIVER_A]: { id: 'D001', companyId: CID_A },
        },
        [CID_B]: {
          [DRIVER_B]: { id: 'D002', companyId: CID_B },
        },
        [DRIVER_A]: { companyId: CID_A, id: 'D001' },
      },
      adminAccess: {
        [CID_A]: { [ADMIN_A]: { role: 'dispatcher' } },
      },
      closedJobs: {
        [CID_A]: { job_1001: { bookingId: '1001' } },
        [CID_B]: { job_2001: { bookingId: '2001' } },
      },
      completedJobs: {
        [CID_A]: {
          '1001': { bookingId: '1001', driverId: 'D001', PlayerId: DRIVER_A },
        },
        [CID_B]: {
          '2001': { bookingId: '2001', driverId: 'D002', PlayerId: DRIVER_B },
        },
      },
      tmTripStatus: {
        [CID_A]: { '1001': { status: 'pending' } },
        [CID_B]: { '2001': { status: 'pending' } },
      },
      companySettings: {
        [CID_A]: { name: 'A' },
        [CID_B]: { name: 'B' },
      },
    },
  };
}

/**
 * Apply multi-path update like RTDB update().
 * @param {any} db
 * @param {Record<string, unknown>} update
 */
export function applyUpdate(db, update) {
  for (const [path, value] of Object.entries(update)) {
    const parts = path.split('/');
    let cur = db;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete cur[last];
    else cur[last] = value;
  }
}
