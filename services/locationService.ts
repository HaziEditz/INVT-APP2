import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { withTimeout } from '@/lib/asyncTimeout';
import { syncDriverLocation } from '@/lib/dispatchApi';
import { isPresenceSessionEnded } from '@/lib/presenceGuards';

export const BACKGROUND_LOCATION_TASK = 'BW_BACKGROUND_LOCATION';
const CTX_KEY = 'bw.bgLocationCtx.v1';

type BgContext = {
  companyId: string;
  vehicleId: string;
  driverId: string;
  firebaseStatus?: string;
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
    if (isPresenceSessionEnded(ctx.companyId, ctx.vehicleId)) return;
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
        vehiclestatus: ctx.firebaseStatus ?? 'Available',
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

export type StartBackgroundTrackingOptions = {
  /**
   * Cap the initial getCurrentCoords wait (shift start). Prefer last-known on
   * timeout so Available / offer popup are not blocked by a slow satellite lock.
   */
  initialGpsTimeoutMs?: number;
};

/**
 * Starts GPS tracking when allowed. Returns false if the user denied/dismissed
 * permission — does NOT throw and does NOT change driver presence status.
 */
export async function startBackgroundTracking(
  driverId: string,
  companyId: string,
  vehicleId: string,
  firebaseStatus = 'Available',
  opts?: StartBackgroundTrackingOptions,
): Promise<boolean> {
  const perms = await requestLocationPermissions();
  if (!perms.foregroundGranted) {
    console.warn('[Location] Foreground permission not granted — presence unchanged');
    return false;
  }

  await saveCtx({ companyId, vehicleId, driverId, firebaseStatus });

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
          notificationTitle: 'BookaWaka — On shift',
          notificationBody: 'Listening for jobs · GPS active for dispatch',
        },
      });
    } catch (err) {
      console.warn('[Location] Background tracking unavailable (Expo Go / permissions):', err);
      return perms.foregroundGranted;
    }
  }

  try {
    const budgetMs = opts?.initialGpsTimeoutMs;
    let coords: Awaited<ReturnType<typeof getCurrentCoords>>;
    if (budgetMs != null && budgetMs > 0) {
      try {
        coords = await withTimeout(
          getCurrentCoords(),
          budgetMs,
          'startBackgroundTracking.initialGps',
        );
      } catch {
        const last = await getLastKnownCoords();
        if (!last) throw new Error('initial GPS timed out and no last-known');
        coords = last as Awaited<ReturnType<typeof getCurrentCoords>>;
      }
    } else {
      coords = await getCurrentCoords();
    }
    await syncDriverLocation({
      companyId,
      vehicleId,
      driverId,
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: 'accuracy' in coords ? (coords as { accuracy?: number }).accuracy : undefined,
      vehiclestatus: firebaseStatus,
    });
  } catch (e) {
    console.warn('[Location] Initial GPS sync skipped:', e);
  }

  return true;
}

export async function updateBackgroundLocationStatus(firebaseStatus: string) {
  const ctx = await loadCtx();
  if (!ctx) return;
  await saveCtx({ ...ctx, firebaseStatus });
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
  const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
  if (last) return last.coords;
  const { coords } = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return coords;
}

export async function getLastKnownCoords(maxAgeMs = 600_000) {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const last = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs });
  return last?.coords ?? null;
}

export type HailPickupLocation = {
  address: string;
  lat?: number;
  lng?: number;
};

export async function reverseGeocodeCoords(lat: number, lng: number): Promise<string> {
  const results = await Location.reverseGeocodeAsync({
    latitude: lat,
    longitude: lng,
  });
  const formatted = results[0] ? formatGeocodedAddress(results[0]) : '';
  return formatted || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Last-known coords first, then a fresh GPS fix — for hail pickup without blocking the meter. */
export async function refreshHailPickupLocation(
  onUpdate: (pickup: HailPickupLocation) => void,
): Promise<void> {
  const apply = (pickup: HailPickupLocation) => {
    try {
      onUpdate(pickup);
    } catch (e) {
      console.warn('[Location] hail pickup callback failed', e);
    }
  };

  const last = await getLastKnownCoords();
  if (last) {
    const address = await reverseGeocodeCoords(last.latitude, last.longitude).catch(
      () => `${last.latitude.toFixed(5)}, ${last.longitude.toFixed(5)}`,
    );
    apply({ address, lat: last.latitude, lng: last.longitude });
  }

  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      if (!last) apply({ address: 'Current location (address unavailable)' });
      return;
    }
    const fresh = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude } = fresh.coords;
    const address = await reverseGeocodeCoords(latitude, longitude);
    apply({ address, lat: latitude, lng: longitude });
  } catch {
    if (!last) apply({ address: 'Current location (address unavailable)' });
  }
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
  const address = await reverseGeocodeCoords(coords.latitude, coords.longitude);
  return { address, lat: coords.latitude, lng: coords.longitude };
}
