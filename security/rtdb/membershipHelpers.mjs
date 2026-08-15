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

/**
 * Correct transfer under Option B: move nested leaf immediately.
 * Flat drivers/{uid}.companyId is optional legacy mirror — update if present,
 * but nested leaf is source of truth for rules.
 *
 * sharedWith alone is NOT membership. Multi-company requires a nested leaf
 * under each companyId the driver may access.
 */
export function buildDriverTransferUpdate({
  uid,
  fromCompanyId,
  toCompanyId,
  profile,
  updateFlatMirror = true,
}) {
  if (!uid || !fromCompanyId || !toCompanyId) {
    throw new Error('uid, fromCompanyId, and toCompanyId are required');
  }
  if (fromCompanyId === toCompanyId) {
    throw new Error('fromCompanyId and toCompanyId must differ');
  }

  const nextProfile = {
    ...(profile && typeof profile === 'object' ? profile : {}),
    companyId: toCompanyId,
  };

  /** @type {Record<string, unknown>} */
  const update = {
    [`drivers/${fromCompanyId}/${uid}`]: null,
    [`drivers/${toCompanyId}/${uid}`]: nextProfile,
  };

  if (updateFlatMirror) {
    update[`drivers/${uid}/companyId`] = toCompanyId;
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
