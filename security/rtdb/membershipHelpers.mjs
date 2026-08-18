/**
 * Option B membership helpers for RTDB hardening Phase 0.
 *
 * Membership for company-scoped paths:
 *   drivers/{companyId}/{auth.uid} exists
 *   OR adminAccess/{companyId}/{auth.uid} exists
 *
 * RTDB rules cannot define named functions — these strings are the canonical
 * expressions to paste into database.rules (shadow → later production phases).
 */

export const CID_A = '860869';
export const CID_B = '860870';

/** Canonical Option B member check ($companyId wildcard in rules path). */
export const RULE_IS_COMPANY_MEMBER =
  "auth != null && (root.child('drivers').child($companyId).child(auth.uid).exists() || root.child('adminAccess').child($companyId).child(auth.uid).exists())";

/** Admin / dispatcher / owner grant only. */
export const RULE_IS_COMPANY_ADMIN =
  "auth != null && root.child('adminAccess').child($companyId).child(auth.uid).exists()";

/** Canonicalize D-prefixed ids (D1 / d001 → D001). Bare numbers ignored. */
export function normalizeDriverId(id) {
  const s = String(id ?? '')
    .trim()
    .replace(/[\s\-_.]/g, '');
  const m = s.match(/^([dD])(\d+)$/);
  if (m) return 'D' + String(parseInt(m[2], 10)).padStart(3, '0');
  return '';
}

export function extractDriverIdFromRecord(fb) {
  if (!fb || typeof fb !== 'object') return '';
  return normalizeDriverId(
    String(fb.id ?? fb.driverId ?? fb.DriverId ?? fb.dispatcherId ?? ''),
  );
}

/**
 * Collect used D00N ids under a company drivers map ({ uid: profile }).
 * Also accepts an iterable of raw id strings.
 */
export function collectUsedDriverIds(driversOrIds) {
  const used = new Set();
  if (!driversOrIds) return used;
  if (driversOrIds instanceof Set) {
    for (const id of driversOrIds) {
      const n = normalizeDriverId(id);
      if (n) used.add(n);
    }
    return used;
  }
  if (Array.isArray(driversOrIds)) {
    for (const item of driversOrIds) {
      if (typeof item === 'string') {
        const n = normalizeDriverId(item);
        if (n) used.add(n);
      } else {
        const n = extractDriverIdFromRecord(item);
        if (n) used.add(n);
      }
    }
    return used;
  }
  if (typeof driversOrIds === 'object') {
    for (const prof of Object.values(driversOrIds)) {
      const n = extractDriverIdFromRecord(prof);
      if (n) used.add(n);
    }
  }
  return used;
}

/**
 * Next free per-company Driver ID (D001, D002, …).
 * Always walks from D001 upward — does not prefer the transferor's old id.
 */
export function allocateNextDriverId(usedIds, { startAt = 1 } = {}) {
  const used = collectUsedDriverIds(usedIds);
  let n = Math.max(1, Number(startAt) || 1);
  for (;;) {
    const candidate = 'D' + String(n).padStart(3, '0');
    if (!used.has(candidate)) return candidate;
    n += 1;
    if (n > 9999) throw new Error('No free driver ID slots under D9999');
  }
}

/**
 * Correct transfer under Option B: move nested leaf immediately + assign a
 * fresh destination Driver ID (next free D00N at receiving company).
 *
 * Historical trip/TM paths are NOT touched — only membership leaves move.
 *
 * Flat drivers/{uid}.companyId is optional legacy mirror — update if present,
 * but nested leaf is source of truth for rules.
 */
export function buildDriverTransferUpdate({
  uid,
  fromCompanyId,
  toCompanyId,
  profile,
  usedDestinationIds,
  updateFlatMirror = true,
}) {
  if (!uid || !fromCompanyId || !toCompanyId) {
    throw new Error('uid, fromCompanyId, and toCompanyId are required');
  }
  if (fromCompanyId === toCompanyId) {
    throw new Error('fromCompanyId and toCompanyId must differ');
  }
  if (usedDestinationIds == null) {
    throw new Error(
      'usedDestinationIds is required (Set/array/map of Driver IDs already used at toCompanyId)',
    );
  }

  const newId = allocateNextDriverId(usedDestinationIds);
  const base = profile && typeof profile === 'object' ? { ...profile } : {};
  const nextProfile = {
    ...base,
    companyId: toCompanyId,
    id: newId,
    driverId: newId,
    DriverId: newId,
  };

  /** @type {Record<string, unknown>} */
  const update = {
    [`drivers/${fromCompanyId}/${uid}`]: null,
    [`drivers/${toCompanyId}/${uid}`]: nextProfile,
  };

  if (updateFlatMirror) {
    update[`drivers/${uid}/companyId`] = toCompanyId;
    update[`drivers/${uid}/id`] = newId;
    update[`drivers/${uid}/driverId`] = newId;
  }

  return update;
}

/** Simulates today's SA approveTransfer (flat companyId only) — leaves nested stale. */
export function buildBrokenFlatOnlyTransferUpdate({ uid, toCompanyId }) {
  return {
    [`drivers/${uid}/companyId`]: toCompanyId,
  };
}

export function assertTransferMovesNestedLeaf(update, { uid, fromCompanyId, toCompanyId }) {
  if (update[`drivers/${fromCompanyId}/${uid}`] !== null) {
    throw new Error('expected delete of drivers/{from}/{uid}');
  }
  if (!update[`drivers/${toCompanyId}/${uid}`]) {
    throw new Error('expected write of drivers/{to}/{uid}');
  }
}
