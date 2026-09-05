import { calcMeterBreakdown } from './tariffs.ts';
import type { MeterMode, MeterState, Tariff } from '../types/index.ts';

const SPEED_MOVING_KMH = 3;
const SPEED_MOVING_MS = SPEED_MOVING_KMH / 3.6;
/** Soft gate: still record points / distance up to this accuracy. */
const MAX_GPS_ACCURACY_M = 100;
const MAX_JUMP_M = 500;
export const METER_TICK_MS = 2000;
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
  if (speedMs == null || !Number.isFinite(speedMs) || speedMs <= 0) return 0;
  return speedMs;
}

function speedKmh(speedMs: number): number {
  return speedMs * 3.6;
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

/** GPS distance/route only — fare locked (fixed-price / already-paid card). */
export function createTrackOnlyMeter(tariff: Tariff, lockedFare: number): MeterState {
  const fare = Number.isFinite(lockedFare) && lockedFare >= 0 ? lockedFare : 0;
  const ref = calcMeterBreakdown(tariff, 0, 0);
  return {
    running: true,
    paused: false,
    mode: 'waiting',
    startedAt: Date.now(),
    pausedMs: 0,
    movingMs: 0,
    waitingMs: 0,
    distanceKm: 0,
    tariffId: '-1',
    tariffName: 'Fixed',
    tariffChanges: [],
    breakdown: { ...ref, total: fare },
    fare,
    routePoints: [],
    trackOnly: true,
    lockedFare: fare,
  };
}

/**
 * Convert a live (climbing) meter to track-only when booking turns out fixed/prepaid.
 * Preserves GPS distance / wait / route; locks charged fare (#8692609048).
 */
export function convertLiveMeterToTrackOnly(
  meter: MeterState,
  tariff: Tariff,
  lockedFare: number,
): MeterState {
  const fare =
    Number.isFinite(lockedFare) && lockedFare >= 0
      ? lockedFare
      : Number.isFinite(meter.lockedFare)
        ? (meter.lockedFare as number)
        : meter.fare;
  const waitMin = meter.waitingMs / 60000;
  const ref = calcMeterBreakdown(tariff, meter.distanceKm, waitMin);
  return {
    ...meter,
    running: true,
    tariffId: '-1',
    tariffName: 'Fixed',
    trackOnly: true,
    lockedFare: fare,
    fare,
    breakdown: { ...ref, total: fare },
  };
}

function applyTariffToMeter(meter: MeterState, tariff: Tariff): MeterState {
  const waitMin = meter.waitingMs / 60000;
  if (meter.trackOnly) {
    // Reference flag/distance/wait from company tariff; charged total stays locked.
    const ref = calcMeterBreakdown(tariff, meter.distanceKm, waitMin);
    const fare = meter.lockedFare ?? meter.fare;
    return {
      ...meter,
      breakdown: { ...ref, total: fare },
      fare,
    };
  }
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
    next.pausedMs += METER_TICK_MS;
    return { meter: applyTariffToMeter(next, tariff) };
  }

  const speed = normalizeSpeed(speedMs);
  const isMoving = speed > SPEED_MOVING_MS;
  next.mode = isMoving ? 'moving' : 'waiting';
  if (isMoving) {
    next.movingMs += METER_TICK_MS;
  } else {
    next.waitingMs += METER_TICK_MS;
  }

  return { meter: applyTariffToMeter(next, tariff) };
}

/**
 * Poor horizontal accuracy must not freeze wait/moving time.
 * Distance and route points still require a trustworthy fix.
 */
export function gpsAccuracyBlocksDistance(accuracyM?: number | null): boolean {
  return accuracyM != null && accuracyM > MAX_GPS_ACCURACY_M;
}

export function tickMeterWithGps(
  meter: MeterState,
  tariff: Tariff,
  lat: number,
  lng: number,
  speedMs?: number | null,
  accuracyM?: number | null,
): MeterTickResult {
  let autoUnpaused = false;
  let next = { ...meter };

  // Very poor accuracy: still accrue waiting, but keep last known fix for continuity.
  if (gpsAccuracyBlocksDistance(accuracyM)) {
    const tick = tickMeter(next, tariff, 0);
    return { ...tick, autoUnpaused: false };
  }

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
    if (distanceDeltaM > MAX_JUMP_M) {
      next.lastLat = lat;
      next.lastLng = lng;
      next = appendRoutePoint(next, lat, lng);
      // Reject jump distance, but keep the 2s clock (wait) advancing.
      const tick = tickMeter(next, tariff, 0);
      return { ...tick, autoUnpaused };
    }
  } else {
    // First trustworthy fix — seed anchor so the next tick can measure distance.
    next.lastLat = lat;
    next.lastLng = lng;
    next = appendRoutePoint(next, lat, lng);
    const tick = tickMeter(next, tariff, normalizeSpeed(speedMs));
    return { ...tick, autoUnpaused };
  }
  next.lastLat = lat;
  next.lastLng = lng;
  next = appendRoutePoint(next, lat, lng);

  const speed = normalizeSpeed(speedMs);
  const derivedSpeedMs =
    distanceDeltaM > 0 && METER_TICK_MS > 0 ? distanceDeltaM / (METER_TICK_MS / 1000) : 0;
  const effectiveSpeedMs = Math.max(speed, derivedSpeedMs);
  const isMoving = effectiveSpeedMs > SPEED_MOVING_MS || speedKmh(effectiveSpeedMs) > SPEED_MOVING_KMH;

  // Always credit haversine when the fix moved — don't require speed>threshold alone
  // (GPS speed is often null / 0 on Android while position still advances).
  if (!next.paused && distanceDeltaM > 0) {
    next.distanceKm += distanceDeltaM / 1000;
  }

  next.mode = (isMoving ? 'moving' : 'waiting') as MeterMode;
  // Clock: moving when we credited distance, else waiting.
  const tick = tickMeter(next, tariff, distanceDeltaM > 0 ? Math.max(effectiveSpeedMs, SPEED_MOVING_MS + 0.01) : 0);
  return { ...tick, autoUnpaused };
}
