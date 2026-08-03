import * as Location from 'expo-location';
import { Tariff } from '@/types';
import {
  createInitialMeter,
  gpsAccuracyBlocksDistance,
  METER_TICK_MS,
  tickMeter,
  tickMeterWithGps,
  type MeterTickResult,
} from '@/lib/meterTick';

export {
  createInitialMeter,
  gpsAccuracyBlocksDistance,
  tickMeter,
  tickMeterWithGps,
  type MeterTickResult,
};

type GpsSample = {
  lat: number;
  lng: number;
  speedMs: number | null;
  accuracyM: number | null;
};

function runMeterTick(
  getMeter: () => import('@/types').MeterState | null,
  tariff: Tariff,
  gps: GpsSample | null,
  onUpdate: (result: MeterTickResult) => void,
) {
  const m = getMeter();
  if (!m?.running) return;
  if (gps) {
    onUpdate(tickMeterWithGps(m, tariff, gps.lat, gps.lng, gps.speedMs, gps.accuracyM));
  } else {
    onUpdate(tickMeter(m, tariff, 0));
  }
}

export async function watchMeter(
  getTariff: () => Tariff,
  getMeter: () => import('@/types').MeterState | null,
  onUpdate: (result: MeterTickResult) => void,
): Promise<() => void> {
  let sub: Location.LocationSubscription | null = null;
  let lastGps: GpsSample | null = null;

  runMeterTick(getMeter, getTariff(), lastGps, onUpdate);

  const intervalId = setInterval(() => {
    runMeterTick(getMeter, getTariff(), lastGps, onUpdate);
  }, METER_TICK_MS);

  void (async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const cached = await Location.getLastKnownPositionAsync({ maxAge: 600_000 });
      if (cached) {
        lastGps = {
          lat: cached.coords.latitude,
          lng: cached.coords.longitude,
          speedMs: cached.coords.speed ?? null,
          accuracyM: cached.coords.accuracy ?? null,
        };
        runMeterTick(getMeter, getTariff(), lastGps, onUpdate);
      }

      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 3,
          timeInterval: 1000,
        },
        (loc) => {
          lastGps = {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            speedMs: loc.coords.speed ?? null,
            accuracyM: loc.coords.accuracy ?? null,
          };
          runMeterTick(getMeter, getTariff(), lastGps, onUpdate);
        },
      );
    } catch (err) {
      console.warn('[Meter] GPS watch failed, using interval-only ticks:', err);
    }
  })();

  return () => {
    clearInterval(intervalId);
    sub?.remove();
  };
}
