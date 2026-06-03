import { onDisconnect, ref, remove, set, update } from 'firebase/database';
import { database } from '@/lib/firebase';
import { DriverProfile, PresenceDisplayStatus } from '@/types';
import { getCurrentCoords } from '@/services/locationService';

export type FirebaseDriverStatus = 'Available' | 'Away' | 'Offline' | 'Busy' | 'Assigned';

export function mapVehicleStatusToDisplay(raw: string | undefined | null): PresenceDisplayStatus {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'offline') return 'Offline';
  if (s.toLowerCase() === 'away') return 'Away';
  return 'Online';
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

  const { lat, lng } = await getGps();
  const record = buildPresenceRecord(driver, vehicleId, status, lat, lng);
  const presencePath = ref(database, `online/${driver.companyId}/${vehicleId}/current`);

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
  await update(ref(database, `online/${driver.companyId}/${vehicleId}`), {
    vehiclestatus: topStatus,
  });
}

export async function clearOnlinePresence(driver: DriverProfile, vehicleId: string) {
  if (!driver.companyId || !vehicleId) return;

  const presencePath = ref(database, `online/${driver.companyId}/${vehicleId}/current`);
  try {
    await onDisconnect(presencePath).cancel();
    await update(presencePath, { online: false, vehiclestatus: 'Offline', lastSeen: Date.now() });
    await update(ref(database, `online/${driver.companyId}/${vehicleId}`), {
      vehiclestatus: 'Offline',
    });
  } catch (err) {
    console.warn('[Presence] clear partial write failed:', err);
  }

  try {
    await remove(ref(database, `online/${driver.companyId}/${vehicleId}`));
  } catch (err) {
    console.warn('[Presence] remove node failed:', err);
  }
}
