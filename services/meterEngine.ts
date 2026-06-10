import * as Location from 'expo-location';
import { calcMeterBreakdown } from '@/lib/tariffs';
import { MeterMode, MeterState, Tariff } from '@/types';

const SPEED_MOVING_MS = 5 / 3.6; // 5 km/h
const TICK_MS = 2000;
const UNPAUSE_DISTANCE_M = 50;
const MIN_DISTANCE_M = 2;
const MAX_DISTANCE_M = 500;

type GpsSample = {
  lat: number;
  lng: number;
  speedMs: number | null;
};

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Expo Go often returns null, undefined, -1, or 0 when stationary — treat as not moving. */
function normalizeSpeed(speedMs?: number | null): number {
  if (speedMs == null || !Number.isFinite(speedMs) || speedMs <= 0) return 0;
  return speedMs;
}

function appendRoutePoint(meter: MeterState, lat: number, lng: number): MeterState {
  const routePoints = [...(meter.routePoints ?? [])];
  const last = routePoints[routePoints.length - 1];
  if (!last || haversineM(last.lat, last.lng, lat, lng) > 5) {
    routePoints.push({ lat, lng, at: Date.now() });
  }
  return { ...meter, routePoints };
}

export function createInitialMeter(tariff: Tariff): MeterState {
  const breakdown = calcMeterBreakdown(tariff, 0, 0);
  return {
    running: true,
    paused: false,
    mode: 'waiting',
    startedAt: Date.now(),
    pausedMs: 0,
    movingMs: 0,
    waitingMs: 0,
    distanceKm: 0,
    tariffId: tariff.id,
    tariffName: tariff.name,
    tariffChanges: [],
    breakdown,
    fare: breakdown.total,
    routePoints: [],
  };
}

function applyTariffToMeter(meter: MeterState, tariff: Tariff): MeterState {
  const waitMin = meter.waitingMs / 60000;
  const breakdown = calcMeterBreakdown(tariff, meter.distanceKm, waitMin);
  return {
    ...meter,
    tariffId: tariff.id,
    tariffName: tariff.name,
    breakdown,
    fare: breakdown.total,
  };
}

export type MeterTickResult = {
  meter: MeterState;
  autoUnpaused?: boolean;
};

export function tickMeter(meter: MeterState, tariff: Tariff, speedMs?: number | null): MeterTickResult {
  const now = Date.now();
  let next: MeterState = {
    ...meter,
    pauseAccumulatedAt: now,
  };

  if (meter.paused) {
    next.pausedMs += TICK_MS;
    const result = applyTariffToMeter(next, tariff);
    return { meter: result };
  }

  const speed = normalizeSpeed(speedMs);
  const isMoving = speed > SPEED_MOVING_MS;
  next.mode = isMoving ? 'moving' : 'waiting';
  if (isMoving) {
    next.movingMs += TICK_MS;
  } else {
    next.waitingMs += TICK_MS;
  }

  const result = applyTariffToMeter(next, tariff);
  return { meter: result };
}

export function tickMeterWithGps(
  meter: MeterState,
  tariff: Tariff,
  lat: number,
  lng: number,
  speedMs?: number | null,
): MeterTickResult {
  let autoUnpaused = false;
  let next = { ...meter };

  if (meter.paused && meter.pauseAnchorLat != null && meter.pauseAnchorLng != null) {
    const moved = haversineM(meter.pauseAnchorLat, meter.pauseAnchorLng, lat, lng);
    if (moved > UNPAUSE_DISTANCE_M) {
      next.paused = false;
      next.pauseAnchorLat = undefined;
      next.pauseAnchorLng = undefined;
      autoUnpaused = true;
    }
  }

  let distanceDeltaM = 0;
  if (next.lastLat != null && next.lastLng != null) {
    distanceDeltaM = haversineM(next.lastLat, next.lastLng, lat, lng);
  }
  next.lastLat = lat;
  next.lastLng = lng;
  next = appendRoutePoint(next, lat, lng);

  const speed = normalizeSpeed(speedMs);
  const speedSaysMoving = speed > SPEED_MOVING_MS;

  // Distance from GPS positions — do not require speed (many devices report speed=0 while moving).
  if (!next.paused && distanceDeltaM > MIN_DISTANCE_M && distanceDeltaM < MAX_DISTANCE_M) {
    next.distanceKm += distanceDeltaM / 1000;
  }

  const tick = tickMeter(next, tariff, speedSaysMoving ? speed : 0);
  return { ...tick, autoUnpaused };
}

function runMeterTick(
  getMeter: () => MeterState | null,
  tariff: Tariff,
  gps: GpsSample | null,
  onUpdate: (result: MeterTickResult) => void,
) {
  const m = getMeter();
  if (!m?.running) return;
  if (gps) {
    onUpdate(tickMeterWithGps(m, tariff, gps.lat, gps.lng, gps.speedMs));
  } else {
    onUpdate(tickMeter(m, tariff, 0));
  }
}

export async function watchMeter(
  tariff: Tariff,
  getMeter: () => MeterState | null,
  onUpdate: (result: MeterTickResult) => void,
): Promise<() => void> {
  let sub: Location.LocationSubscription | null = null;
  let lastGps: GpsSample | null = null;

  runMeterTick(getMeter, tariff, null, onUpdate);

  const intervalId = setInterval(() => {
    runMeterTick(getMeter, tariff, lastGps, onUpdate);
  }, TICK_MS);

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
        };
        runMeterTick(getMeter, tariff, lastGps, onUpdate);
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
          };
          runMeterTick(getMeter, tariff, lastGps, onUpdate);
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
