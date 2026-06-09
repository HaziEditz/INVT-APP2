import { onDisconnect, ref, remove, set, update } from 'firebase/database';
import { getDatabaseInstance, ensureAuthUserForRtdbWrite } from '@/lib/firebase';
import { DriverProfile, PresenceDisplayStatus } from '@/types';
import { getCurrentCoords } from '@/services/locationService';

export type FirebaseDriverStatus = 'Available' | 'Away' | 'Offline' | 'Busy' | 'Assigned';

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

  const vehiclestatus = status === 'Assigned' ? 'Picking' : status;

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
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  await ensureAuthUserForRtdbWrite(`enrichShiftPresence → ${onlinePath}`);

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
  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
  const authUser = await ensureAuthUserForRtdbWrite(`startShiftOnline → ${onlinePath}`);
  console.log('[Presence] startShiftOnline auth uid:', authUser.uid, 'driver profile uid:', driver.uid);

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

  const onlinePath = `online/${driver.companyId}/${vehicleId}`;
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
  });
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
  if (!driver.companyId || !vehicleId) return;

  const presencePath = ref(getDatabaseInstance(), `online/${driver.companyId}/${vehicleId}/current`);
  try {
    await onDisconnect(presencePath).cancel();
    await update(presencePath, { online: false, vehiclestatus: 'Offline', lastSeen: Date.now() });
    await update(ref(getDatabaseInstance(), `online/${driver.companyId}/${vehicleId}`), {
      vehiclestatus: 'Offline',
    });
  } catch (err) {
    console.warn('[Presence] clear partial write failed:', err);
  }

  try {
    await remove(ref(getDatabaseInstance(), `online/${driver.companyId}/${vehicleId}`));
  } catch (err) {
    console.warn('[Presence] remove node failed:', err);
  }
}
