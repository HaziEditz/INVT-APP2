import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ref, update } from 'firebase/database';
import { database } from './firebase';

export const BG_LOCATION_TASK = 'taxi360-background-location';
const CTX_STORAGE_KEY = 'taxi360.bgLocationCtx.v1';

type BgContext = {
  companyId: string;
  vehicleId: string;
  driverId: string;
};

// In-memory cache so the hot path (foreground task fires) doesn't hit
// AsyncStorage. AsyncStorage is the source of truth — it survives Android
// task wake-ups after the JS engine is torn down.
let memoryCtx: BgContext | null = null;

async function loadCtx(): Promise<BgContext | null> {
  if (memoryCtx) return memoryCtx;
  try {
    const raw = await AsyncStorage.getItem(CTX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BgContext;
    if (parsed?.companyId && parsed?.vehicleId) {
      memoryCtx = parsed;
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveCtx(ctx: BgContext | null): Promise<void> {
  memoryCtx = ctx;
  try {
    if (ctx) {
      await AsyncStorage.setItem(CTX_STORAGE_KEY, JSON.stringify(ctx));
    } else {
      await AsyncStorage.removeItem(CTX_STORAGE_KEY);
    }
  } catch {
    // best-effort
  }
}

if (!TaskManager.isTaskDefined(BG_LOCATION_TASK)) {
  TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[BgLocation] Task error:', error.message);
      return;
    }
    const payload = data as { locations?: Location.LocationObject[] } | undefined;
    const locations = payload?.locations ?? [];
    if (!locations.length) return;
    const ctx = await loadCtx();
    if (!ctx?.companyId || !ctx?.vehicleId) return;
    const last = locations[locations.length - 1];
    const lat = last?.coords?.latitude;
    const lng = last?.coords?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    try {
      await update(ref(database, `online/${ctx.companyId}/${ctx.vehicleId}/current`), {
        lat,
        lng,
        hasGps: true,
        time: new Date().toISOString(),
        lastSeen: Date.now(),
        online: true,
        bgUpdate: true,
      });
    } catch (e: any) {
      console.warn('[BgLocation] Firebase write failed:', e?.message ?? e);
    }
  });
}

export async function startBackgroundLocation(ctx: BgContext): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!ctx.companyId || !ctx.vehicleId) return false;
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      console.warn('[BgLocation] Foreground location permission denied');
      return false;
    }
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      console.warn('[BgLocation] Background location permission denied');
      return false;
    }
    await saveCtx(ctx);
    const already = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (already) {
      console.log('[BgLocation] Already running — context refreshed');
      return true;
    }
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      // Balanced accuracy for the dispatch heartbeat — drops CPU/battery
      // significantly vs High and avoids JS-thread contention that makes
      // foreground buttons feel sluggish. Meter distance still uses the
      // foreground High-accuracy watch so per-trip precision is unchanged.
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 25,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Taxi360 — On Shift',
        notificationBody: 'Tracking your location so the meter keeps running while the screen is off.',
        notificationColor: '#FFC107',
      },
    });
    console.log('[BgLocation] Started');
    return true;
  } catch (e: any) {
    console.warn('[BgLocation] startLocationUpdatesAsync failed:', e?.message ?? e);
    return false;
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => false);
    if (running) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
      console.log('[BgLocation] Stopped');
    }
  } catch (e: any) {
    console.warn('[BgLocation] stopLocationUpdatesAsync failed:', e?.message ?? e);
  } finally {
    await saveCtx(null);
  }
}

export async function isBackgroundLocationRunning(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    return false;
  }
}
