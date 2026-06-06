import * as Location from 'expo-location';
import { calcSegmentedMeterBreakdown, tariffToSnapshot } from '@/lib/tariffs';
import { MeterMode, MeterState, Tariff } from '@/types';

const SPEED_MOVING_MS = 5 / 3.6; // 5 km/h — only above this with valid GPS counts as moving
export const METER_TICK_MS = 1000;
const UNPAUSE_DISTANCE_M = 50;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Moving only when GPS reports a positive speed above 5 km/h. */
export function isConfirmedMoving(speedMs?: number | null): boolean {
  if (speedMs == null || !Number.isFinite(speedMs) || speedMs <= 0) return false;
  return speedMs > SPEED_MOVING_MS;
}

export function createInitialMeter(tariff: Tariff): MeterState {
  const startTariff = tariffToSnapshot(tariff);
  const breakdown = calcSegmentedMeterBreakdown(
    { startTariff, tariffChanges: [], distanceKm: 0, waitingMs: 0 },
    tariff,
  );
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
    startTariff,
    tariffChanges: [],
    breakdown,
    fare: breakdown.total,
  };
}

function applyTariffToMeter(meter: MeterState, tariff: Tariff): MeterState {
  const breakdown = calcSegmentedMeterBreakdown(meter, tariff);
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
    next.pausedMs += METER_TICK_MS;
    return { meter: applyTariffToMeter(next, tariff) };
  }

  const isMoving = isConfirmedMoving(speedMs);
  next.mode = isMoving ? 'moving' : 'waiting';
  if (isMoving) {
    next.movingMs += METER_TICK_MS;
  } else {
    next.waitingMs += METER_TICK_MS;
  }

  return { meter: applyTariffToMeter(next, tariff) };
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

  const speedSaysMoving = isConfirmedMoving(speedMs);
  const movedEnough = distanceDeltaM > 1.5;

  if (speedSaysMoving && movedEnough && !next.paused && distanceDeltaM > 1 && distanceDeltaM < 500) {
    next.distanceKm += distanceDeltaM / 1000;
  }

  const tick = tickMeter(next, tariff, speedSaysMoving ? speedMs : null);
  return { ...tick, autoUnpaused };
}

export async function watchMeter(
  getTariff: () => Tariff,
  getMeter: () => MeterState | null,
  onUpdate: (result: MeterTickResult) => void,
): Promise<() => void> {
  let latestLat: number | undefined;
  let latestLng: number | undefined;
  let latestSpeed: number | null | undefined = null;
  let hasGpsFix = false;
  let sub: Location.LocationSubscription | null = null;

  const runTick = () => {
    const m = getMeter();
    if (!m?.running) return;
    const tariff = getTariff();

    if (hasGpsFix && latestLat != null && latestLng != null) {
      onUpdate(tickMeterWithGps(m, tariff, latestLat, latestLng, latestSpeed));
      return;
    }

    // Expo Go / no GPS fix: default to waiting mode so fare accrues while stopped.
    onUpdate(tickMeter(m, tariff, null));
  };

  const intervalId = setInterval(runTick, METER_TICK_MS);
  runTick();

  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 0,
          timeInterval: METER_TICK_MS,
        },
        (loc) => {
          latestLat = loc.coords.latitude;
          latestLng = loc.coords.longitude;
          latestSpeed = loc.coords.speed;
          hasGpsFix = true;
        },
      );
    }
  } catch {
    // Interval-only mode for Expo Go testing.
  }

  return () => {
    clearInterval(intervalId);
    sub?.remove();
  };
}
