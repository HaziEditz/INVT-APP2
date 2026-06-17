import { onDisconnect, onValue, ref, remove, set, update, get } from 'firebase/database';
import { getDatabaseInstance, ensureAuthUserForRtdbWrite } from '@/lib/firebase';
import { DriverProfile, PresenceDisplayStatus } from '@/types';
import { getCurrentCoords } from '@/services/locationService';
import {
  clearPresenceSessionEnded,
  isPresenceSessionEnded,
  markPresenceSessionEnded,
  assertOnlinePresenceWriteAllowed,
} from '@/lib/presenceGuards';

export type FirebaseDriverStatus = 'Available' | 'Away' | 'Offline' | 'Busy' | 'Assigned' | 'Picking' | 'Arrived' | 'Active';

export {
  clearPresenceSessionEnded,
  isPresenceSessionEnded,
  markPresenceSessionEnded,
} from '@/lib/presenceGuards';

const PRESENCE_HEARTBEAT_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatCtx: {
  driver: DriverProfile;
  vehicleId: string;
  status: FirebaseDriverStatus;
} | null = null;
let lastPresenceWriteAt = 0;
let lastPresenceWriteError: string | null = null;

export function getPresenceWriteDiagnostics() {
  return {
    lastWriteAt: lastPresenceWriteAt || null,
    lastWriteError: lastPresenceWriteError,
    heartbeatActive: heartbeatTimer != null,
    heartbeatStatus: heartbeatCtx?.status ?? null,
  };
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
}

/** Periodic presence refresh while on shift — heals silent write failures / empty nodes after Metro reload. */
export function startPresenceHeartbeat(
  driver: DriverProfile,
  vehicleId: string,
  status: FirebaseDriverStatus,
) {
  stopPresenceHeartbeat();
  heartbeatCtx = { driver, vehicleId, status };
  const tick = () => {
    const ctx = heartbeatCtx;
    if (!ctx) return;
    void repairOnlinePresence(ctx.driver, ctx.vehicleId, ctx.status, 'heartbeat').catch((err) => {
      console.warn('[Presence] heartbeat repair failed:', err);
    });
  };
  void tick();
  heartbeatTimer = setInterval(tick, PRESENCE_HEARTBEAT_MS);
}

export function updatePresenceHeartbeatStatus(status: FirebaseDriverStatus) {
  if (heartbeatCtx) heartbeatCtx.status = status;
}

/**
 * Re-create online/{cid}/{vid} when missing or stale. Uses full set on /current when node was absent.
 */
export async function repairOnlinePresence(
  driver: DriverProfile,
  vehicleId: string,
  status: FirebaseDriverStatus,
  reason = 'repair',
): Promise<boolean> {
  if (!driver.companyId || !vehicleId) return false;
  if (isPresenceSessionEnded(driver.companyId, vehicleId)) return false;
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  const db = getDatabaseInstance();
  try {
    const [baseSnap, curSnap] = await Promise.all([
      get(ref(db, onlinePath)),
      get(ref(db, `${onlinePath}/current`)),
    ]);
    const needsFull = !baseSnap.exists() || !curSnap.exists();
    const curStatus = curSnap.exists()
      ? String((curSnap.val() as Record<string, unknown>)?.vehiclestatus ?? '')
      : '';
    const stale =
      curSnap.exists() &&
      lastPresenceWriteAt > 0 &&
      Date.now() - lastPresenceWriteAt > PRESENCE_HEARTBEAT_MS * 2;
    if (!needsFull && !stale && curStatus.toLowerCase() === status.toLowerCase()) {
      return true;
    }
    console.log(`[Presence] repair (${reason}) needsFull=${needsFull} stale=${stale} status=${status}`);
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

function fmtNzDate(d: Date): string {
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtNzTime(d: Date): string {
  return d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Enrich presence after minimal shift write — no onDisconnect (was clearing nodes too early). */
async function enrichShiftPresenceInBackground(
  driver: DriverProfile,
  vehicleId: string,
  startedAt: Date,
): Promise<void> {
  if (isPresenceSessionEnded(driver.companyId, vehicleId)) return;
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  await ensureAuthUserForRtdbWrite(`enrichShiftPresence → ${onlinePath}`);

  if (isPresenceSessionEnded(driver.companyId, vehicleId)) return;

  const { lat, lng } = await getGps();
  const record = buildPresenceRecord(driver, vehicleId, 'Available', lat, lng);
  const presencePath = ref(getDatabaseInstance(), `${onlinePath}/current`);
  const nowIso = startedAt.toISOString();

  console.log('[Presence] enrich update /current →', `${onlinePath}/current`, {
    companyId: driver.companyId,
    vehicleId,
  });
  await update(presencePath, {
    ...record,
    shiftStarted: true,
    shiftStartedAt: nowIso,
  });
  console.log('[Presence] enrich update /current OK');

  console.log('[Presence] enrich update base →', onlinePath, {
    companyId: driver.companyId,
    vehicleId,
  });
  await update(ref(getDatabaseInstance(), onlinePath), {
    VehicleStatus: 'Available',
    status: 'Available',
    online: true,
    shiftStartedAt: nowIso,
    logInDate: fmtNzDate(startedAt),
    logInTime: fmtNzTime(startedAt),
    vehiclenumber: vehicleId,
    vehicleId,
    updatedAt: nowIso,
    lat: lat || 0,
    lng: lng || 0,
  });
  console.log('[Presence] enrich update base OK');
}

/** Start shift: minimal RTDB write first, then enrich when base writes succeed. */
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

  console.log('[Presence] startShiftOnline update base →', onlinePath, {
    companyId: driver.companyId,
    vehicleId,
  });
  await update(baseRef, {
    vehiclestatus: 'Available',
    driverId: driver.id,
    driverid: parseDriverId(driver.id),
    companyId: driver.companyId,
    CompanyId: driver.companyId,
    shiftStarted: true,
    zonequeue: 0,
    ...(vehicleType ? { vehicletype: vehicleType, vehicleType } : {}),
    seatCapacity,
    seats: seatCapacity,
  });
  console.log('[Presence] startShiftOnline update base OK');

  console.log('[Presence] startShiftOnline set /current →', `${onlinePath}/current`, {
    companyId: driver.companyId,
    vehicleId,
  });
  await set(currentRef, {
    vehiclestatus: 'Available',
    VehicleStatus: 'Available',
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
  console.log('[Presence] startShiftOnline set /current OK');

  await enrichShiftPresenceInBackground(driver, vehicleId, startedAt);
  console.log('[Presence] startShiftOnline complete', { onlinePath });
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

    const { lat, lng } = await getGps();
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
    await ensureAuthUserForRtdbWrite(`clearOnlinePresence → ${onlinePath}`);
  } catch (err) {
    console.warn('[Presence] clearOnlinePresence auth failed:', err);
    return;
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
