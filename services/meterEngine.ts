import * as Location from 'expo-location';
import { calcSegmentedMeterBreakdown, tariffToSnapshot } from '@/lib/tariffs';
import { MeterMode, MeterState, Tariff } from '@/types';

const SPEED_MOVING_MS = 5 / 3.6; // 5 km/h — at or below this accrues waiting time
const TICK_MS = 1000; // 1-second ticks: each stopped second accrues waitingRatePerMinute / 60
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

function normalizeSpeed(speedMs?: number | null): number {
  if (speedMs == null || !Number.isFinite(speedMs) || speedMs < 0) return 0;
  return speedMs;
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
    next.pausedMs += TICK_MS;
    return { meter: applyTariffToMeter(next, tariff) };
  }

  const speed = normalizeSpeed(speedMs);
  const isMoving = speed > SPEED_MOVING_MS;
  next.mode = isMoving ? 'moving' : 'waiting';
  if (isMoving) {
    next.movingMs += TICK_MS;
  } else {
    next.waitingMs += TICK_MS;
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

  const speed = normalizeSpeed(speedMs);
  const speedSaysMoving = speed > SPEED_MOVING_MS;
  const movedEnough = distanceDeltaM > 1.5;

  // Every metre driven adds (pricePerKm / 1000) via distanceKm accumulation.
  if (speedSaysMoving && movedEnough && !next.paused && distanceDeltaM > 1 && distanceDeltaM < 500) {
    next.distanceKm += distanceDeltaM / 1000;
  }

  const tick = tickMeter(next, tariff, speedSaysMoving ? speed : 0);
  return { ...tick, autoUnpaused };
}

export async function watchMeter(
  getTariff: () => Tariff,
  getMeter: () => MeterState | null,
  onUpdate: (result: MeterTickResult) => void,
): Promise<() => void> {
  let sub: Location.LocationSubscription | null = null;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const id = setInterval(() => {
        const m = getMeter();
        if (!m?.running) return;
        onUpdate(tickMeter(m, getTariff(), 0));
      }, TICK_MS);
      return () => clearInterval(id);
    }
    sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 0,
        timeInterval: TICK_MS,
      },
      (loc) => {
        const m = getMeter();
        if (!m?.running) return;
        onUpdate(
          tickMeterWithGps(
            m,
            getTariff(),
            loc.coords.latitude,
            loc.coords.longitude,
            loc.coords.speed,
          ),
        );
      },
    );
    return () => sub?.remove();
  } catch {
    const id = setInterval(() => {
      const m = getMeter();
      if (!m?.running) return;
      onUpdate(tickMeter(m, getTariff(), 0));
    }, TICK_MS);
    return () => clearInterval(id);
  }
}
