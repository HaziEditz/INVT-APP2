/**
 * Integration-style tests for Profile → End Shift → endShiftAndSignOut remote half.
 * These exercise runEndShiftRemoteFlow (the real button orchestration), not just
 * buildPendingShiftEnd helpers — the gap that let offline End Shift slip through.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withTimeout } from '../lib/asyncTimeout.ts';
import {
  END_SHIFT_RTDB_TIMEOUT_MS,
  runEndShiftRemoteFlow,
} from '../lib/endShiftRemoteFlow.ts';

function neverResolves() {
  return new Promise(() => {});
}

function makeDeps(overrides = {}) {
  const journalCalls = [];
  const calls = {
    writeShiftEndLog: 0,
    clearOnlinePresence: 0,
    clearVehicleCurrentDriver: 0,
    persistLocal: 0,
    endShiftLocal: 0,
    navigateLogin: 0,
    signOut: 0,
  };

  const deps = {
    stopBackgroundTracking: async () => {},
    captureEndShiftSummary: async () => ({
      workedMinutes: 45,
      weeklyWorkedMinutes: 45,
      breakMinutes: 0,
      shiftElapsedMinutes: 45,
    }),
    persistLocalNztaEnd: async () => {
      calls.persistLocal += 1;
      return {
        shiftEndAt: 1_700_000_000_000,
        shiftStartAt: 1_700_000_000_000 - 45 * 60_000,
        sessionStartedAt: 1_700_000_000_000 - 40 * 60_000,
        workedMinutes: 45,
        weeklyWorkedMinutes: 45,
      };
    },
    writeShiftEndLog: async (args) => {
      calls.writeShiftEndLog += 1;
      calls.lastWrite = args;
    },
    clearOnlinePresence: async () => {
      calls.clearOnlinePresence += 1;
    },
    clearVehicleCurrentDriver: async () => {
      calls.clearVehicleCurrentDriver += 1;
    },
    journalDeferredShiftEnd: async (args) => {
      journalCalls.push(args);
    },
    stopShiftRuntime: () => {},
    markPresenceSessionEnded: () => {},
    ...overrides,
  };

  return { deps, journalCalls, calls };
}

/**
 * Mirrors Profile.tsx → endShiftAndSignOut ordering:
 * remote flow → local clear → signOut (timeout) → login.
 */
async function profileEndShiftButtonPath(opts) {
  const { hasTripInProgress, likelyOffline, deps, signOut, endShiftLocal, navigateLogin } = opts;
  if (hasTripInProgress) return { status: 'blocked' };

  const summary = await runEndShiftRemoteFlow(
    {
      companyId: '860869',
      uid: 'u1',
      driverId: 'D001',
      vehicleId: '201',
      reason: 'manual',
      likelyOffline,
      timeoutMs: opts.timeoutMs ?? 200,
    },
    deps,
  );
  endShiftLocal();
  await withTimeout(signOut(), 200, 'signOut').catch(() => undefined);
  navigateLogin();
  return { status: 'done', summary };
}

test('Profile End Shift offline: never awaits hanging RTDB; journals and reaches login', async () => {
  const { deps, journalCalls, calls } = makeDeps({
    writeShiftEndLog: async () => {
      calls.writeShiftEndLog += 1;
      return neverResolves();
    },
    clearOnlinePresence: async () => {
      calls.clearOnlinePresence += 1;
      return neverResolves();
    },
    clearVehicleCurrentDriver: async () => {
      calls.clearVehicleCurrentDriver += 1;
      return neverResolves();
    },
  });
  let localCleared = false;
  let atLogin = false;

  const started = Date.now();
  const result = await profileEndShiftButtonPath({
    hasTripInProgress: false,
    likelyOffline: true,
    deps,
    timeoutMs: 200,
    signOut: neverResolves,
    endShiftLocal: () => {
      localCleared = true;
    },
    navigateLogin: () => {
      atLogin = true;
    },
  });
  const elapsed = Date.now() - started;

  assert.equal(result.status, 'done');
  assert.equal(localCleared, true);
  assert.equal(atLogin, true);
  assert.equal(calls.persistLocal, 1);
  assert.equal(calls.writeShiftEndLog, 0, 'offline must not call writeShiftEndLog');
  assert.equal(calls.clearOnlinePresence, 0, 'offline must not await presence clear');
  assert.equal(journalCalls.length, 1);
  assert.equal(journalCalls[0].needsShiftLog, true);
  assert.equal(journalCalls[0].needsPresenceClear, true);
  assert.ok(elapsed < 1500, `offline path must finish quickly, took ${elapsed}ms`);
});

test('Profile End Shift online: hanging RTDB times out, journals, still clears local', async () => {
  const { deps, journalCalls, calls } = makeDeps({
    writeShiftEndLog: async () => {
      calls.writeShiftEndLog += 1;
      return neverResolves();
    },
    clearOnlinePresence: async () => {
      calls.clearOnlinePresence += 1;
      return neverResolves();
    },
    clearVehicleCurrentDriver: async () => {
      calls.clearVehicleCurrentDriver += 1;
      return neverResolves();
    },
  });
  let localCleared = false;

  const started = Date.now();
  const result = await profileEndShiftButtonPath({
    hasTripInProgress: false,
    likelyOffline: false,
    deps,
    timeoutMs: 150,
    signOut: async () => {},
    endShiftLocal: () => {
      localCleared = true;
    },
    navigateLogin: () => {},
  });
  const elapsed = Date.now() - started;

  assert.equal(result.status, 'done');
  assert.equal(localCleared, true);
  assert.equal(calls.writeShiftEndLog, 1);
  assert.equal(calls.clearOnlinePresence, 1);
  assert.ok(journalCalls.length >= 1);
  assert.equal(journalCalls[0].needsShiftLog, true);
  assert.equal(journalCalls[0].needsPresenceClear, true);
  assert.ok(
    elapsed < 150 + 150 + 150 + 800,
    `timed path should finish near 3×timeout, took ${elapsed}ms`,
  );
});

test('Profile End Shift online success: no journal when remotes ok', async () => {
  const { deps, journalCalls, calls } = makeDeps();
  await profileEndShiftButtonPath({
    hasTripInProgress: false,
    likelyOffline: false,
    deps,
    timeoutMs: 200,
    signOut: async () => {},
    endShiftLocal: () => {},
    navigateLogin: () => {},
  });
  assert.equal(calls.writeShiftEndLog, 1);
  assert.equal(calls.clearOnlinePresence, 1);
  assert.equal(calls.clearVehicleCurrentDriver, 1);
  assert.equal(journalCalls.length, 0);
  assert.equal(calls.lastWrite.sessionStartedAt, 1_700_000_000_000 - 40 * 60_000);
  assert.equal(calls.lastWrite.shiftStartAt, 1_700_000_000_000 - 45 * 60_000);
});

test('Profile End Shift offline journals sessionStartedAt for deferred write', async () => {
  const { deps, journalCalls } = makeDeps();
  await profileEndShiftButtonPath({
    hasTripInProgress: false,
    likelyOffline: true,
    deps,
    timeoutMs: 200,
    signOut: async () => {},
    endShiftLocal: () => {},
    navigateLogin: () => {},
  });
  assert.equal(journalCalls.length, 1);
  assert.equal(journalCalls[0].sessionStartedAt, 1_700_000_000_000 - 40 * 60_000);
  assert.equal(journalCalls[0].shiftStartAt, 1_700_000_000_000 - 45 * 60_000);
});

test('Profile End Shift blocked when trip in progress', async () => {
  const { deps } = makeDeps();
  const result = await profileEndShiftButtonPath({
    hasTripInProgress: true,
    likelyOffline: true,
    deps,
    signOut: async () => {},
    endShiftLocal: () => {
      assert.fail('must not clear local when trip blocks');
    },
    navigateLogin: () => {
      assert.fail('must not navigate when trip blocks');
    },
  });
  assert.equal(result.status, 'blocked');
});

test('END_SHIFT_RTDB_TIMEOUT_MS is a short hard ceiling', () => {
  assert.ok(END_SHIFT_RTDB_TIMEOUT_MS <= 5_000);
  assert.ok(END_SHIFT_RTDB_TIMEOUT_MS >= 1_000);
});
