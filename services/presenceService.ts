import { onDisconnect, onValue, ref, remove, set, update, get } from 'firebase/database';
import { getDatabaseInstance, ensureAuthUserForRtdbWrite, requireDriverAuthForRtdbWrite } from '@/lib/firebase';
import { DriverProfile, PresenceDisplayStatus } from '@/types';
import { getCurrentCoords, getLastKnownCoords } from '@/services/locationService';
import {
  clearPresenceSessionEnded,
  isPresenceSessionEnded,
  markPresenceSessionEnded,
  assertOnlinePresenceWriteAllowed,
} from '@/lib/presenceGuards';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LASTSEEN_REPAIR_MS,
  PRESENCE_OFFER_HEARTBEAT_MS,
} from '@/lib/presenceHeartbeatPolicy';

export type FirebaseDriverStatus = 'Available' | 'Away' | 'Offline' | 'Busy' | 'Assigned' | 'Picking' | 'Arrived' | 'Active';

export {
  clearPresenceSessionEnded,
  isPresenceSessionEnded,
  markPresenceSessionEnded,
} from '@/lib/presenceGuards';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatCtx: {
  driver: DriverProfile;
  vehicleId: string;
  status: FirebaseDriverStatus;
} | null = null;
let offerPendingMode = false;
let offerPendingSinceMs = 0;
let lastPresenceWriteAt = 0;
let lastPresenceWriteError: string | null = null;

export function getPresenceWriteDiagnostics() {
  return {
    lastWriteAt: lastPresenceWriteAt || null,
    lastWriteError: lastPresenceWriteError,
    heartbeatActive: heartbeatTimer != null,
    heartbeatStatus: heartbeatCtx?.status ?? null,
    offerPendingMode,
    heartbeatIntervalMs: offerPendingMode ? PRESENCE_OFFER_HEARTBEAT_MS : PRESENCE_HEARTBEAT_MS,
  };
}

function normalizeLastSeenToMs(raw: unknown): number {
  const n = Number(raw || 0);
  if (!n || !Number.isFinite(n)) return 0;
  return n < 1e12 ? n * 1000 : n;
}

/** Freshest of parent lastSeen vs /current lastSeen (either can lag the other). */
function freshestNodeLastSeenMs(
  base: Record<string, unknown> | null,
  current: Record<string, unknown> | null,
): number {
  return Math.max(
    normalizeLastSeenToMs(base?.lastSeen),
    normalizeLastSeenToMs(current?.lastSeen),
  );
}

/** Firebase RTDB connection — distinct from device NetInfo (Wi‑Fi can be up while RTDB is disconnected). */
export function subscribeFirebaseRtdbConnected(onChange: (connected: boolean) => void): () => void {
  const connectedRef = ref(getDatabaseInstance(), '.info/connected');
  return onValue(connectedRef, (snap) => {
    onChange(snap.val() === true);
  });
}

export function stopPresenceHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatCtx = null;
  // Keep offerPendingMode — startPresenceHeartbeat re-arms using this flag.
  // Clearing it here dropped 5s stamps whenever the shift heartbeat effect
  // re-ran (vehicle/driver dep churn) while a live offer was still on screen.
}

function presenceHeartbeatIntervalMs(): number {
  return offerPendingMode ? PRESENCE_OFFER_HEARTBEAT_MS : PRESENCE_HEARTBEAT_MS;
}

function runPresenceHeartbeatTick() {
  const ctx = heartbeatCtx;
  if (!ctx) return;
  if (offerPendingMode) {
    // Always stamp — repair()'s 15s skip gate would defeat the 5s offer cadence.
    const since = offerPendingSinceMs ? Date.now() - offerPendingSinceMs : null;
    console.log(
      `[Presence] offer-pending stamp tick t+${since != null ? Math.round(since / 1000) + 's' : '?'} ` +
        `vehicleId=${ctx.vehicleId} status=${ctx.status}`,
    );
    void stampPresenceLastSeen(ctx.driver, ctx.vehicleId, ctx.status).catch((err) => {
      console.warn('[Presence] offer-pending lastSeen stamp failed:', err);
    });
    return;
  }
  void repairOnlinePresence(ctx.driver, ctx.vehicleId, ctx.status, 'heartbeat').catch((err) => {
    console.warn('[Presence] heartbeat repair failed:', err);
  });
}

function armPresenceHeartbeatTimer() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (!heartbeatCtx) return;
  void runPresenceHeartbeatTick();
  heartbeatTimer = setInterval(runPresenceHeartbeatTick, presenceHeartbeatIntervalMs());
}

/** Periodic presence refresh while on shift — heals silent write failures / empty nodes after Metro reload. */
export function startPresenceHeartbeat(
  driver: DriverProfile,
  vehicleId: string,
  status: FirebaseDriverStatus,
) {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatCtx = { driver, vehicleId, status };
  if (offerPendingMode) {
    console.log(
      `[Presence] startPresenceHeartbeat while offer-pending — arming ${PRESENCE_OFFER_HEARTBEAT_MS}ms ` +
        `vehicleId=${vehicleId}`,
    );
  }
  armPresenceHeartbeatTimer();
}

/**
 * Fast lastSeen stamps while a live offer is on screen. Reverts to the normal
 * 20s repair heartbeat when the offer is accepted, declined, or cleared.
 */
export function setPresenceOfferPending(pending: boolean) {
  const next = !!pending;
  if (offerPendingMode === next) {
    // Mode unchanged — still re-arm if ON and ctx exists but timer died.
    if (next && heartbeatCtx && !heartbeatTimer) {
      console.warn('[Presence] offer-pending ON but timer missing — re-arming');
      armPresenceHeartbeatTimer();
    }
    return;
  }
  offerPendingMode = next;
  offerPendingSinceMs = next ? Date.now() : 0;
  console.log(
    `[Presence] offer-pending heartbeat ${next ? 'ON' : 'OFF'} (${presenceHeartbeatIntervalMs()}ms)` +
      (next ? ` since=${new Date(offerPendingSinceMs).toISOString()}` : '') +
      ` ctx=${heartbeatCtx ? `vehicleId=${heartbeatCtx.vehicleId}` : 'null'}`,
  );
  if (!heartbeatCtx) {
    console.warn(
      '[Presence] offer-pending mode set but heartbeatCtx is null — stamps will NOT fire until startPresenceHeartbeat',
    );
    return;
  }
  armPresenceHeartbeatTimer();
}

export function updatePresenceHeartbeatStatus(status: FirebaseDriverStatus) {
  if (heartbeatCtx) heartbeatCtx.status = status;
}

/**
 * Re-create online/{cid}/{vid} when missing or stale. Uses full set on /current when node was absent.
 * Pass force=true (or a reason containing "reconnect") to always rewrite lastSeen — soft reconnect
 * must not wait for the repair threshold or dispatch assign will keep seeing a quiet driver.
 */
export async function repairOnlinePresence(
  driver: DriverProfile,
  vehicleId: string,
  status: FirebaseDriverStatus,
  reason = 'repair',
  opts?: { force?: boolean },
): Promise<boolean> {
  if (!driver.companyId || !vehicleId) return false;
  if (isPresenceSessionEnded(driver.companyId, vehicleId)) return false;
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  const db = getDatabaseInstance();
  const force = opts?.force === true || /reconnect/i.test(reason);
  try {
    const [baseSnap, curSnap] = await Promise.all([
      get(ref(db, onlinePath)),
      get(ref(db, `${onlinePath}/current`)),
    ]);
    const needsFull = !baseSnap.exists() || !curSnap.exists();
    const curStatus = curSnap.exists()
      ? String((curSnap.val() as Record<string, unknown>)?.vehiclestatus ?? '')
      : '';
    const localStale =
      curSnap.exists() &&
      lastPresenceWriteAt > 0 &&
      Date.now() - lastPresenceWriteAt > PRESENCE_HEARTBEAT_MS * 2;
    // The local write clock lies after a reconnect: a write buffered while
    // offline flushes with its old lastSeen but resolves "now". Trust the
    // server-side heartbeat instead so dispatch stops showing us stale.
    const serverLastSeen = freshestNodeLastSeenMs(
      baseSnap.exists() ? (baseSnap.val() as Record<string, unknown>) : null,
      curSnap.exists() ? (curSnap.val() as Record<string, unknown>) : null,
    );
    const serverStale =
      serverLastSeen > 0 && Date.now() - serverLastSeen > PRESENCE_LASTSEEN_REPAIR_MS;
    const stale = localStale || serverStale;
    if (!force && !needsFull && !stale && curStatus.toLowerCase() === status.toLowerCase()) {
      return true;
    }
    console.log(
      `[Presence] repair (${reason}) force=${force} needsFull=${needsFull} stale=${stale} status=${status}`,
    );
    // Reconnect: stamp lastSeen first so dispatch clears amber without waiting on GPS.
    if (force) {
      await stampPresenceLastSeen(driver, vehicleId, status);
      if (!needsFull) {
        void writeOnlinePresence(driver, vehicleId, status, false).catch((err) => {
          console.warn(`[Presence] repair (${reason}) GPS enrich failed:`, err);
        });
        return true;
      }
    }
    await writeOnlinePresence(driver, vehicleId, status, needsFull);
    return true;
  } catch (err) {
    lastPresenceWriteError = err instanceof Error ? err.message : String(err);
    console.warn(`[Presence] repair (${reason}) failed:`, err);
    return false;
  }
}

export function mapVehicleStatusToDisplay(raw: string | undefined | null): PresenceDisplayStatus {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'offline') return 'Offline';
  if (s.toLowerCase() === 'away') return 'Away';
  if (s.toLowerCase() === 'available') return 'Online';
  return 'Online';
}

export function isVehicleStatusAvailable(raw: string | undefined | null): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'available';
}

function parseDriverId(rawId: string) {
  const numeric = parseInt(rawId, 10);
  return Number.isNaN(numeric) ? rawId : numeric;
}

function parseVehicleId(rawVehicleId: string) {
  const numeric = parseInt(rawVehicleId, 10);
  return Number.isNaN(numeric) ? rawVehicleId : numeric;
}

async function getGps(): Promise<{ lat: number; lng: number }> {
  try {
    const coords = await getCurrentCoords();
    return { lat: coords.latitude, lng: coords.longitude };
  } catch {
    return { lat: 0, lng: 0 };
  }
}

/** Prefer cached coords so reconnect lastSeen never waits on a fresh GPS fix. */
async function getGpsCachedFirst(): Promise<{ lat: number; lng: number }> {
  try {
    const last = await getLastKnownCoords(120_000);
    if (last && (last.latitude || last.longitude)) {
      return { lat: last.latitude, lng: last.longitude };
    }
  } catch {
    // fall through
  }
  return getGps();
}

/**
 * Stamp lastSeen (+ status/GPS if known) immediately without awaiting a fresh
 * getCurrentPosition. Used on reconnect so dispatch clears the 30s amber badge
 * before a slow GPS fix completes.
 */
export async function stampPresenceLastSeen(
  driver: DriverProfile,
  vehicleId: string,
  status: FirebaseDriverStatus,
): Promise<void> {
  if (!driver.companyId || !vehicleId) return;
  if (isPresenceSessionEnded(driver.companyId, vehicleId)) return;
  try {
    assertOnlinePresenceWriteAllowed(driver.companyId, vehicleId, 'stampPresenceLastSeen');
  } catch {
    return;
  }

  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  await ensureAuthUserForRtdbWrite(`stampPresenceLastSeen → ${onlinePath}`);

  let lat = 0;
  let lng = 0;
  try {
    const last = await getLastKnownCoords(120_000);
    if (last) {
      lat = last.latitude || 0;
      lng = last.longitude || 0;
    }
  } catch {
    // non-fatal — lastSeen stamp still clears the console stale badge
  }

  const now = Date.now();
  const topStatus = status === 'Assigned' ? 'Picking' : status;
  await update(ref(getDatabaseInstance(), onlinePath), {
    vehiclestatus: topStatus,
    VehicleStatus: topStatus,
    driverid: parseDriverId(driver.id),
    driverId: driver.id,
    companyId: driver.companyId,
    CompanyId: driver.companyId,
    vehiclenumber: vehicleId,
    vehicleId,
    lastSeen: now,
    ...(lat || lng ? { lat, lng } : {}),
  });
  await update(ref(getDatabaseInstance(), `${onlinePath}/current`), {
    lastSeen: now,
    vehiclestatus: topStatus,
    VehicleStatus: topStatus,
    online: true,
    ...(lat || lng ? { lat, lng, Lat: lat, Lng: lng, hasGps: true } : {}),
  });
  lastPresenceWriteAt = now;
  lastPresenceWriteError = null;
  updatePresenceHeartbeatStatus(status);
  console.log('[Presence] stampPresenceLastSeen OK', { vehicleId, status, hasGps: !!(lat || lng) });
}

function buildPresenceRecord(
  driver: DriverProfile,
  vehicleId: string,
  status: FirebaseDriverStatus,
  lat: number,
  lng: number,
) {
  const driverName =
    driver.name && !driver.name.includes('@')
      ? driver.name
      : driver.name
        ? driver.name.split('@')[0]
        : `Driver ${vehicleId}`;

  const vehiclestatus =
    status === 'Assigned' ? 'Picking'
    : status === 'Active' ? 'Active'
    : status;

  return {
    driverid: parseDriverId(driver.id),
    drivername: driverName,
    vehiclenumber: vehicleId,
    VehicleId: parseVehicleId(vehicleId),
    PlayerId: driver.uid,
    online: status !== 'Offline' && status !== 'Away',
    lastSeen: Date.now(),
    vehiclestatus,
    VehicleStatus: vehiclestatus,
    lat: lat || 0,
    lng: lng || 0,
    Lat: lat || 0,
    Lng: lng || 0,
    time: new Date().toISOString(),
    CompanyId: driver.companyId,
    Email: driver.email ?? '',
    PhoneNo: driver.phone ?? '',
  };
}

/**
 * Bootstrap RTDB session for a new shift WITHOUT advertising Available.
 * Available + fresh lastSeen/GPS are written later by startShift after location
 * is ready and readyForJobs flips true — otherwise auto-dispatch can offer while
 * the popup gate is still closed and lastSeen goes stale during GPS wait.
 */
export async function startShiftOnline(driver: DriverProfile, vehicleId: string): Promise<void> {
  clearPresenceSessionEnded(driver.companyId, vehicleId);
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  const authUser = await ensureAuthUserForRtdbWrite(`startShiftOnline → ${onlinePath}`);
  console.log('[Presence] startShiftOnline auth uid:', authUser.uid, 'driver profile uid:', driver.uid);

  let vehicleType = '';
  let seatCapacity = 4;
  try {
    const vehSnap = await get(ref(getDatabaseInstance(), `vehicles/${driver.companyId}/${vehicleId}`));
    if (vehSnap.exists()) {
      const meta = vehSnap.val() as Record<string, unknown>;
      vehicleType = String(
        meta.vehicleType ?? meta.vehicleTypeCode ?? meta.bodyType ?? meta.VehicleType ?? '',
      ).trim();
      seatCapacity =
        parseInt(String(meta.seatCapacity ?? meta.seats ?? meta.capacity ?? '4'), 10) || 4;
    }
  } catch {
    // non-fatal — dispatch falls back to defaults
  }

  const startedAt = new Date();
  const baseRef = ref(getDatabaseInstance(), onlinePath);
  const currentRef = ref(getDatabaseInstance(), `${onlinePath}/current`);

  // Away = visible on console but NOT auto-dispatch eligible (Available is deferred).
  console.log('[Presence] startShiftOnline bootstrap Away (Available deferred) →', onlinePath, {
    companyId: driver.companyId,
    vehicleId,
  });
  await update(baseRef, {
    vehiclestatus: 'Away',
    VehicleStatus: 'Away',
    driverId: driver.id,
    driverid: parseDriverId(driver.id),
    companyId: driver.companyId,
    CompanyId: driver.companyId,
    shiftStarted: true,
    zonequeue: 0,
    lastSeen: Date.now(),
    ...(vehicleType ? { vehicletype: vehicleType, vehicleType } : {}),
    seatCapacity,
    seats: seatCapacity,
  });
  console.log('[Presence] startShiftOnline update base OK');

  await set(currentRef, {
    vehiclestatus: 'Away',
    VehicleStatus: 'Away',
    driverid: parseDriverId(driver.id),
    driverId: driver.id,
    companyId: driver.companyId,
    CompanyId: driver.companyId,
    shiftStarted: true,
    online: true,
    lastSeen: Date.now(),
    ...(vehicleType ? { vehicletype: vehicleType, vehicleType } : {}),
    seatCapacity,
    seats: seatCapacity,
  });
  console.log('[Presence] startShiftOnline set /current OK (Away bootstrap)');

  try {
    await onDisconnect(currentRef).update({ lastSeen: Date.now() });
  } catch (err) {
    console.warn('[Presence] onDisconnect failed (non-fatal):', err);
  }

  console.log('[Presence] startShiftOnline complete — waiting for startShift Available stamp', {
    onlinePath,
    startedAt: startedAt.toISOString(),
  });
}

/** Mirror GPS-detected zone onto online/{cid}/{vid} for dispatch Zone tab + queue. */
export async function syncZonePresenceFields(
  driver: DriverProfile,
  vehicleId: string,
  zone: { name: string; zoneId?: string; zoneNumber?: number; queuePosition?: number },
): Promise<void> {
  if (!driver.companyId || !vehicleId || !zone.name.trim()) return;
  if (isPresenceSessionEnded(driver.companyId, vehicleId)) return;
  try {
    assertOnlinePresenceWriteAllowed(driver.companyId, vehicleId, 'syncZonePresenceFields');
  } catch {
    return;
  }
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  const patch: Record<string, unknown> = {
    zonename: zone.name,
    zoneName: zone.name,
    zoneid: zone.zoneId ?? zone.zoneNumber ?? '',
  };
  if (zone.zoneNumber != null) patch.zoneNumber = zone.zoneNumber;
  if (zone.queuePosition != null && zone.queuePosition > 0) {
    patch.zonequeue = zone.queuePosition;
  }
  try {
    await ensureAuthUserForRtdbWrite(`syncZonePresenceFields → ${onlinePath}`);
    await update(ref(getDatabaseInstance(), onlinePath), patch);
    await update(ref(getDatabaseInstance(), `${onlinePath}/current`), {
      zonename: zone.name,
      zoneName: zone.name,
      ...(zone.queuePosition != null && zone.queuePosition > 0
        ? { zonequeue: zone.queuePosition }
        : {}),
    });
  } catch (err) {
    console.warn('[Presence] syncZonePresenceFields failed:', err);
  }
}

export async function writeOnlinePresence(
  driver: DriverProfile,
  vehicleId: string,
  status: FirebaseDriverStatus,
  resetZone = false,
) {
  if (!driver.companyId || !vehicleId) {
    console.warn('[Presence] skipped — missing companyId or vehicleId');
    return;
  }
  if (isPresenceSessionEnded(driver.companyId, vehicleId)) {
    console.warn('[Presence] skipped — session ended for', vehicleId);
    return;
  }
  try {
    assertOnlinePresenceWriteAllowed(driver.companyId, vehicleId, 'writeOnlinePresence');
  } catch {
    return;
  }

  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  try {
    const authUser = await ensureAuthUserForRtdbWrite(`writeOnlinePresence → ${onlinePath}`);
    console.log('[Presence] writeOnlinePresence auth uid:', authUser.uid, 'status:', status);

    const { lat, lng } = await getGpsCachedFirst();
    const record = buildPresenceRecord(driver, vehicleId, status, lat, lng);
    const presencePath = ref(getDatabaseInstance(), `${onlinePath}/current`);

    try {
      await onDisconnect(presencePath).update({ lastSeen: Date.now() });
    } catch (err) {
      console.warn('[Presence] onDisconnect failed (non-fatal):', err);
    }

    if (resetZone) {
      await set(presencePath, record);
    } else {
      await update(presencePath, record);
    }

    const topStatus = status === 'Assigned' ? 'Picking' : status;
    await update(ref(getDatabaseInstance(), onlinePath), {
      vehiclestatus: topStatus,
      VehicleStatus: topStatus,
      driverid: parseDriverId(driver.id),
      driverId: driver.id,
      companyId: driver.companyId,
      CompanyId: driver.companyId,
      vehiclenumber: vehicleId,
      vehicleId,
      lastSeen: Date.now(),
      lat: lat || 0,
      lng: lng || 0,
    });
    lastPresenceWriteAt = Date.now();
    lastPresenceWriteError = null;
    updatePresenceHeartbeatStatus(status);
  } catch (err) {
    lastPresenceWriteError = err instanceof Error ? err.message : String(err);
    console.warn('[Presence] writeOnlinePresence failed:', err);
    throw err;
  }
}

/** After missed offer — driver re-joins zone at end of queue. */
export async function moveDriverToEndOfQueue(driver: DriverProfile, vehicleId: string): Promise<void> {
  if (!driver.companyId || !vehicleId) return;
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  const endPos = 9999;
  try {
    await update(ref(getDatabaseInstance(), `${onlinePath}/current`), {
      zonequeue: endPos,
      zoneQueue: endPos,
    });
    await update(ref(getDatabaseInstance(), `${onlinePath}/zone`), {
      position: endPos,
      queue: endPos,
      zonequeue: endPos,
    });
  } catch (err) {
    console.warn('[Presence] moveDriverToEndOfQueue failed:', err);
  }
}

export async function clearOnlinePresence(driver: DriverProfile, vehicleId: string) {
  stopPresenceHeartbeat();
  if (!driver.companyId || !vehicleId) return;

  markPresenceSessionEnded(driver.companyId, vehicleId);
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  const baseRef = ref(getDatabaseInstance(), onlinePath);
  const presencePath = ref(getDatabaseInstance(), `${onlinePath}/current`);

  try {
    // End-shift / ownership clears must use the real driver session.
    // Anonymous fallback would break under Phase 1+ rules and already cannot
    // satisfy shiftLogs auth.uid === $uid.
    await requireDriverAuthForRtdbWrite(
      String(driver.uid || ''),
      `clearOnlinePresence → ${onlinePath}`,
    );
  } catch (err) {
    console.warn('[Presence] clearOnlinePresence auth failed:', err);
    throw err;
  }

  try {
    await onDisconnect(presencePath).cancel();
  } catch (err) {
    console.warn('[Presence] onDisconnect cancel failed (non-fatal):', err);
  }

  try {
    await remove(baseRef);
    console.log('[Presence] removed', onlinePath);
  } catch (err) {
    console.warn('[Presence] remove node failed:', err);
  }

  try {
    const snap = await get(baseRef);
    if (snap.exists()) {
      await remove(baseRef);
      console.log('[Presence] removed lingering', onlinePath);
    }
  } catch (err) {
    console.warn('[Presence] verify-remove failed:', err);
  }
}
