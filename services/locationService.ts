import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { syncDriverLocation } from '@/lib/dispatchApi';

export const BACKGROUND_LOCATION_TASK = 'BW_BACKGROUND_LOCATION';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[LocationTask]', error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  const latest = locations?.[locations.length - 1];
  if (!latest) return;
  try {
    await syncDriverLocation({
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      accuracy: latest.coords.accuracy,
      timestamp: latest.timestamp,
    });
  } catch (e) {
    console.warn('[LocationTask] sync failed', e);
  }
});

export async function requestLocationPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}

export async function startBackgroundTracking(driverId: string, companyId: string) {
  const granted = await requestLocationPermissions();
  if (!granted) throw new Error('Location permission denied');

  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (started) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15000,
    distanceInterval: 25,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'BookaWaka Driver',
      notificationBody: 'Tracking location for dispatch',
    },
  });

  await syncDriverLocation({ driverId, companyId, status: 'online' });
}

export async function stopBackgroundTracking(driverId: string, companyId: string) {
  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  await syncDriverLocation({ driverId, companyId, status: 'offline' });
}

export async function getCurrentCoords() {
  const { coords } = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return coords;
}
