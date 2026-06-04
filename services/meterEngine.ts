import * as Location from 'expo-location';
import { calcMeterBreakdown } from '@/lib/tariffs';
import { MeterMode, MeterState, Tariff } from '@/types';

const SPEED_MOVING_MS = 5 / 3.6; // 5 km/h
const TICK_MS = 2000;
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

export function createInitialMeter(tariff: Tariff): MeterState {
  const breakdown = calcMeterBreakdown(tariff, 0, 0, 'waiting');
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
  };
}

function applyTariffToMeter(meter: MeterState, tariff: Tariff): MeterState {
  const waitMin = meter.waitingMs / 60000;
  const breakdown = calcMeterBreakdown(
    tariff,
    meter.distanceKm,
    waitMin,
    meter.paused ? 'waiting' : meter.mode,
  );
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
  const elapsed = now - (meter.pauseAccumulatedAt ?? meter.startedAt);
  let next: MeterState = {
    ...meter,
    pauseAccumulatedAt: now,
  };

  if (meter.paused) {
    next.pausedMs += TICK_MS;
    return { meter: applyTariffToMeter(next, tariff) };
  }

  const speed = speedMs ?? 0;
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

  const speed = speedMs ?? 0;
  const isMoving = speed > SPEED_MOVING_MS;
  if (next.lastLat != null && next.lastLng != null && isMoving && !next.paused) {
    const dM = haversineM(next.lastLat, next.lastLng, lat, lng);
    if (dM > 2 && dM < 500) {
      next.distanceKm += dM / 1000;
    }
  }
  next.lastLat = lat;
  next.lastLng = lng;

  const tick = tickMeter(next, tariff, speedMs);
  return { ...tick, autoUnpaused };
}

export async function watchMeter(
  tariff: Tariff,
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
        onUpdate(tickMeter(m, tariff, 0));
      }, TICK_MS);
      return () => clearInterval(id);
    }
    sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: TICK_MS },
      (loc) => {
        const m = getMeter();
        if (!m?.running) return;
        onUpdate(
          tickMeterWithGps(m, tariff, loc.coords.latitude, loc.coords.longitude, loc.coords.speed),
        );
      },
    );
    return () => sub?.remove();
  } catch {
    const id = setInterval(() => {
      const m = getMeter();
      if (!m?.running) return;
      onUpdate(tickMeter(m, tariff, 0));
    }, TICK_MS);
    return () => clearInterval(id);
  }
}
