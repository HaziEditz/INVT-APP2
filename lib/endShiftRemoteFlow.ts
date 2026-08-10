/**
 * Profile → End Shift remote half (before local clear + sign-out).
 *
 * Offline / hanging RTDB must never block the button path — journal and return.
 * DriverContext and integration tests share this orchestration.
 */

import { attemptWithTimeout, END_SHIFT_RTDB_TIMEOUT_MS } from './asyncTimeout.ts';
import type { PendingShiftEndReason } from './shiftEndPolicy.ts';

export { END_SHIFT_RTDB_TIMEOUT_MS };

export type EndShiftSummaryLike = {
  workedMinutes: number;
  weeklyWorkedMinutes: number;
  breakMinutes: number;
  shiftElapsedMinutes: number;
};

export type EndShiftRemoteFlowInput = {
  companyId: string;
  uid: string;
  driverId: string;
  vehicleId: string | null;
  reason: PendingShiftEndReason;
  /** True when NetInfo or RTDB reports disconnected. */
  likelyOffline: boolean;
  timeoutMs?: number;
};

export type EndShiftRemoteFlowDeps = {
  stopBackgroundTracking: () => Promise<void>;
  captureEndShiftSummary: (companyId: string, uid: string) => Promise<EndShiftSummaryLike | null>;
  /** Persist NZTA hours locally only (no RTDB). */
  persistLocalNztaEnd: (args: {
    companyId: string;
    uid: string;
    driverId: string;
    reason: PendingShiftEndReason;
  }) => Promise<{
    shiftEndAt: number;
    shiftStartAt?: number;
    sessionStartedAt?: number;
    workedMinutes: number;
    weeklyWorkedMinutes?: number;
  }>;
  writeShiftEndLog: (args: {
    companyId: string;
    uid: string;
    driverId: string;
    vehicleId?: string | null;
    shiftEndAt: number;
    shiftStartAt?: number;
    sessionStartedAt?: number;
    workedMinutes: number;
    weeklyWorkedMinutes?: number;
  }) => Promise<void>;
  clearOnlinePresence: (vehicleId: string) => Promise<void>;
  clearVehicleCurrentDriver: (companyId: string, vehicleId: string) => Promise<void>;
  journalDeferredShiftEnd: (args: {
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
  }) => Promise<void>;
  stopShiftRuntime: () => void | Promise<void>;
  markPresenceSessionEnded?: (companyId: string, vehicleId: string) => void;
};

/**
 * Run the remote end-shift work that Profile → endShiftAndSignOut awaits.
 * Always returns (or rejects only on local NZTA persist failure).
 */
export async function runEndShiftRemoteFlow(
  input: EndShiftRemoteFlowInput,
  deps: EndShiftRemoteFlowDeps,
): Promise<EndShiftSummaryLike | null> {
  const timeoutMs = input.timeoutMs ?? END_SHIFT_RTDB_TIMEOUT_MS;

  try {
    await deps.stopBackgroundTracking();
  } catch (err) {
    console.warn('[endShiftRemoteFlow] stopBackgroundTracking failed:', err);
  }

  let summary: EndShiftSummaryLike | null = null;
  if (input.companyId && input.uid) {
    try {
      summary = await deps.captureEndShiftSummary(input.companyId, input.uid);
    } catch (err) {
      console.warn('[endShiftRemoteFlow] captureEndShiftSummary failed:', err);
    }
  }

  let shiftEndAt = Date.now();
  let shiftStartAt: number | undefined;
  let sessionStartedAt: number | undefined;
  let workedMinutes = 0;
  let weeklyWorkedMinutes: number | undefined;

  if (input.companyId && input.uid) {
    const local = await deps.persistLocalNztaEnd({
      companyId: input.companyId,
      uid: input.uid,
      driverId: input.driverId,
      reason: input.reason,
    });
    shiftEndAt = local.shiftEndAt;
    shiftStartAt = local.shiftStartAt;
    sessionStartedAt = local.sessionStartedAt;
    workedMinutes = local.workedMinutes;
    weeklyWorkedMinutes = local.weeklyWorkedMinutes;
  }

  const needsPresence = !!(input.vehicleId && input.companyId && input.uid);

  // Offline: never await RTDB — journal both remotes and return immediately.
  if (input.likelyOffline) {
    if (input.companyId && input.uid) {
      await deps.journalDeferredShiftEnd({
        companyId: input.companyId,
        uid: input.uid,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        reason: input.reason,
        shiftEndAt,
        shiftStartAt,
        sessionStartedAt,
        workedMinutes,
        weeklyWorkedMinutes,
        needsShiftLog: true,
        needsPresenceClear: needsPresence,
      });
    }
    if (input.companyId && input.vehicleId) {
      deps.markPresenceSessionEnded?.(input.companyId, input.vehicleId);
    }
    try {
      await deps.stopShiftRuntime();
    } catch (err) {
      console.warn('[endShiftRemoteFlow] stopShiftRuntime failed:', err);
    }
    return summary;
  }

  // Online: attempt remotes with hard timeouts; journal anything that fails/hangs.
  let shiftLogOk = false;
  if (input.companyId && input.uid) {
    shiftLogOk = await attemptWithTimeout(
      deps.writeShiftEndLog({
        companyId: input.companyId,
        uid: input.uid,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        shiftEndAt,
        shiftStartAt,
        sessionStartedAt,
        workedMinutes,
        weeklyWorkedMinutes,
      }),
      timeoutMs,
      'writeShiftEndLog',
    );
  }

  let presenceOk = !needsPresence;
  if (needsPresence && input.vehicleId) {
    const cleared = await attemptWithTimeout(
      deps.clearOnlinePresence(input.vehicleId),
      timeoutMs,
      'clearOnlinePresence',
    );
    const vehicleCleared = await attemptWithTimeout(
      deps.clearVehicleCurrentDriver(input.companyId, input.vehicleId),
      timeoutMs,
      'clearVehicleCurrentDriver',
    );
    presenceOk = cleared && vehicleCleared;
    if (!presenceOk) {
      deps.markPresenceSessionEnded?.(input.companyId, input.vehicleId);
    }
  }

  if ((!shiftLogOk || !presenceOk) && input.companyId && input.uid) {
    await deps.journalDeferredShiftEnd({
      companyId: input.companyId,
      uid: input.uid,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      reason: input.reason,
      shiftEndAt,
      shiftStartAt,
      sessionStartedAt,
      workedMinutes,
      weeklyWorkedMinutes,
      needsShiftLog: !shiftLogOk,
      needsPresenceClear: needsPresence && !presenceOk,
    });
  }

  try {
    await deps.stopShiftRuntime();
  } catch (err) {
    console.warn('[endShiftRemoteFlow] stopShiftRuntime failed:', err);
  }

  return summary;
}
