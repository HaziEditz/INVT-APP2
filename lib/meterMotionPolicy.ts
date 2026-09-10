/**
 * Meter waiting vs moving clock. GPS speed is often 0 on Android while the
 * car is moving; interval ticks of the same sample are not a stop.
 */

export const SPEED_MOVING_KMH = 3;
export const SPEED_MOVING_MS = SPEED_MOVING_KMH / 3.6;
/** Stay moving through this many zero-delta ticks (~4s) before charging wait. */
export const MOVING_HOLD_TICKS = 2;

export type MeterMotionInput = {
  prevMode: 'moving' | 'waiting';
  speedMs: number;
  distanceDeltaM: number;
  dtMs: number;
  accuracyBlocked: boolean;
  samePositionRepeat: boolean;
  movingHoldTicks: number;
};

export function derivedSpeedMs(distanceDeltaM: number, dtMs: number): number {
  if (!(distanceDeltaM > 0) || !(dtMs > 0)) return 0;
  return distanceDeltaM / (dtMs / 1000);
}

/**
 * True when this tick should accrue moving time (not waiting).
 * Poor accuracy / repeated GPS samples must not flip a live trip to Waiting.
 */
export function shouldAccrueMeterMoving(input: MeterMotionInput): boolean {
  const speed = Number.isFinite(input.speedMs) && input.speedMs > 0 ? input.speedMs : 0;
  const derived = derivedSpeedMs(input.distanceDeltaM, input.dtMs);
  const effective = Math.max(speed, derived);
  const rawMoving = effective > SPEED_MOVING_MS || input.distanceDeltaM >= 4;

  if (input.accuracyBlocked) {
    if (speed > SPEED_MOVING_MS) return true;
    return input.prevMode === 'moving';
  }

  if (rawMoving) return true;

  if (
    input.prevMode === 'moving' &&
    (input.samePositionRepeat || input.distanceDeltaM < 1) &&
    input.movingHoldTicks < MOVING_HOLD_TICKS
  ) {
    return true;
  }

  return false;
}
