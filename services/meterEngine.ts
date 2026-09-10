import * as Location from 'expo-location';
import { Tariff } from '@/types';
import {
  convertLiveMeterToTrackOnly,
  createInitialMeter,
  createTrackOnlyMeter,
  gpsAccuracyBlocksDistance,
  METER_TICK_MS,
  tickMeter,
  tickMeterWithGps,
  type MeterTickResult,
} from '@/lib/meterTick';

export {
  convertLiveMeterToTrackOnly,
  createInitialMeter,
  createTrackOnlyMeter,
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
  hints: { samePositionRepeat: boolean; movingHoldTicks: number },
) {
  const m = getMeter();
  if (!m?.running) return;
  if (gps) {
    onUpdate(
      tickMeterWithGps(m, tariff, gps.lat, gps.lng, gps.speedMs, gps.accuracyM, hints),
    );
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
  let lastTickedGps: GpsSample | null = null;
  let movingHoldTicks = 0;

  const pulse = () => {
    const samePositionRepeat = !!(
      lastGps &&
      lastTickedGps &&
      lastGps.lat === lastTickedGps.lat &&
      lastGps.lng === lastTickedGps.lng
    );
    const before = getMeter();
    runMeterTick(getMeter, getTariff(), lastGps, onUpdate, {
      samePositionRepeat,
      movingHoldTicks,
    });
    const after = getMeter();
    if (before?.mode === 'moving' && after?.mode === 'moving' && samePositionRepeat) {
      movingHoldTicks += 1;
    } else if (after?.mode === 'moving') {
      movingHoldTicks = 0;
    } else {
      movingHoldTicks = 0;
    }
    lastTickedGps = lastGps;
  };

  pulse();

  const intervalId = setInterval(pulse, METER_TICK_MS);

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
          // GPS only refreshes the sample. The 2s interval is the sole clock so
          // a 1s GPS callback cannot flip Waiting/Moving and double-count time.
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
