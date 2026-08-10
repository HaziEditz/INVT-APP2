/**
 * Offline end-shift policy — local NZTA/session clear must never wait on RTDB.
 */

export type PendingShiftEndReason = 'manual' | 'shift14h' | 'weekly70h';

export type PendingShiftEndRecord = {
  id: string;
  companyId: string;
  uid: string;
  driverId: string;
  vehicleId?: string;
  reason: PendingShiftEndReason;
  shiftEndAt: number;
  shiftStartAt?: number;
  sessionStartedAt?: number;
  workedMinutes: number;
  weeklyWorkedMinutes?: number;
  /** Retry Firebase shiftLogs write. */
  needsShiftLog: boolean;
  /** Retry online/{cid}/{vid} remove + vehicle currentDriverId clear. */
  needsPresenceClear: boolean;
  createdAt: number;
};

export function buildPendingShiftEndId(shiftEndAt: number, driverId: string): string {
  return `shift-end:${shiftEndAt}:${String(driverId || '').trim()}`;
}

export function buildPendingShiftEnd(args: {
  companyId: string;
  uid: string;
  driverId: string;
  vehicleId?: string | null;
  reason: PendingShiftEndReason;
  shiftEndAt: number;
  shiftStartAt?: number;
  sessionStartedAt?: number;
  workedMinutes: number;
  weeklyWorkedMinutes?: number;
  needsShiftLog: boolean;
  needsPresenceClear: boolean;
}): PendingShiftEndRecord {
  return {
    id: buildPendingShiftEndId(args.shiftEndAt, args.driverId),
    companyId: String(args.companyId || '').trim(),
    uid: String(args.uid || '').trim(),
    driverId: String(args.driverId || '').trim(),
    vehicleId: args.vehicleId ? String(args.vehicleId).trim() : undefined,
    reason: args.reason,
    shiftEndAt: args.shiftEndAt,
    shiftStartAt: args.shiftStartAt,
    sessionStartedAt: args.sessionStartedAt,
    workedMinutes: args.workedMinutes,
    weeklyWorkedMinutes: args.weeklyWorkedMinutes,
    needsShiftLog: !!args.needsShiftLog,
    needsPresenceClear: !!args.needsPresenceClear,
    createdAt: Date.now(),
  };
}

/** After a successful remote write, drop that pending flag. */
export function markPendingShiftEndSynced(
  row: PendingShiftEndRecord,
  synced: { shiftLog?: boolean; presence?: boolean },
): PendingShiftEndRecord | null {
  const next: PendingShiftEndRecord = {
    ...row,
    needsShiftLog: synced.shiftLog ? false : row.needsShiftLog,
    needsPresenceClear: synced.presence ? false : row.needsPresenceClear,
  };
  if (!next.needsShiftLog && !next.needsPresenceClear) return null;
  return next;
}

export function pendingShiftEndStillOpen(row: PendingShiftEndRecord): boolean {
  return !!(row.needsShiftLog || row.needsPresenceClear);
}
