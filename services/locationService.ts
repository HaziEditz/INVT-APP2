import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { syncDriverLocation } from '@/lib/dispatchApi';

export const BACKGROUND_LOCATION_TASK = 'BW_BACKGROUND_LOCATION';
const CTX_KEY = 'bw.bgLocationCtx.v1';

type BgContext = {
  companyId: string;
  vehicleId: string;
  driverId: string;
};

let memoryCtx: BgContext | null = null;

export type LocationPermissionResult = {
  foregroundGranted: boolean;
  backgroundGranted: boolean;
};

async function loadCtx(): Promise<BgContext | null> {
  if (memoryCtx) return memoryCtx;
  try {
    const raw = await AsyncStorage.getItem(CTX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BgContext;
    if (parsed?.companyId && parsed?.vehicleId) {
      memoryCtx = parsed;
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

async function saveCtx(ctx: BgContext | null) {
  memoryCtx = ctx;
  try {
    if (ctx) await AsyncStorage.setItem(CTX_KEY, JSON.stringify(ctx));
    else await AsyncStorage.removeItem(CTX_KEY);
  } catch {
    // ignore
  }
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[LocationTask]', error.message);
      return;
    }
    const ctx = await loadCtx();
    if (!ctx) return;
    const locations = (data as { locations?: Location.LocationObject[] })?.locations;
    const latest = locations?.[locations.length - 1];
    if (!latest) return;
    try {
      await syncDriverLocation({
        companyId: ctx.companyId,
        vehicleId: ctx.vehicleId,
        driverId: ctx.driverId,
        lat: latest.coords.latitude,
        lng: latest.coords.longitude,
        accuracy: latest.coords.accuracy,
        timestamp: latest.timestamp,
      });
    } catch (e) {
      console.warn('[LocationTask] Firebase sync failed', e);
    }
  });
}

export async function requestLocationPermissions(): Promise<LocationPermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { foregroundGranted: false, backgroundGranted: false };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  return {
    foregroundGranted: true,
    backgroundGranted: bg.status === 'granted',
  };
}

/**
 * Starts GPS tracking when allowed. Returns false if the user denied/dismissed
 * permission — does NOT throw and does NOT change driver presence status.
 */
export async function startBackgroundTracking(
  driverId: string,
  companyId: string,
  vehicleId: string,
): Promise<boolean> {
  const perms = await requestLocationPermissions();
  if (!perms.foregroundGranted) {
    console.warn('[Location] Foreground permission not granted — presence unchanged');
    return false;
  }

  await saveCtx({ companyId, vehicleId, driverId });

  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (!started) {
    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15000,
        distanceInterval: 25,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'BookaWaka Driver',
          notificationBody: 'Tracking location for dispatch',
        },
      });
    } catch (err) {
      console.warn('[Location] Background tracking unavailable (Expo Go / permissions):', err);
      return perms.foregroundGranted;
    }
  }

  try {
    const coords = await getCurrentCoords();
    await syncDriverLocation({
      companyId,
      vehicleId,
      driverId,
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
    });
  } catch (e) {
    console.warn('[Location] Initial GPS sync skipped:', e);
  }

  return true;
}

export async function stopBackgroundTracking() {
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  await saveCtx(null);
}

export async function getCurrentCoords() {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
    if (last) return last.coords;
    throw new Error('Location permission not granted');
  }
  const { coords } = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return coords;
}

export function formatGeocodedAddress(place: Location.LocationGeocodedAddress): string {
  const parts = [
    place.streetNumber,
    place.street,
    place.subregion || place.district,
    place.city || place.region,
  ].filter(Boolean);
  return parts.join(', ') || place.name || '';
}

export async function reverseGeocodeCurrentAddress(): Promise<{
  address: string;
  lat: number;
  lng: number;
}> {
  const coords = await getCurrentCoords();
  const results = await Location.reverseGeocodeAsync({
    latitude: coords.latitude,
    longitude: coords.longitude,
  });
  const formatted = results[0] ? formatGeocodedAddress(results[0]) : '';
  const address =
    formatted ||
    `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
  return { address, lat: coords.latitude, lng: coords.longitude };
}
