import { useDriver } from '@/context/DriverContext';
import { enableWakeLock, disableWakeLock } from '@/services/wakeLock';
import { useSafeEffect } from '@/hooks/useSafeEffect';

/** Keeps screen on while shift is active or on a trip. */
export function ShiftKeepAwake() {
  const { shiftActive, activeJob, hailActive } = useDriver();

  useSafeEffect(() => {
    if (shiftActive || activeJob || hailActive) {
      enableWakeLock().catch((err) => console.error('[ShiftKeepAwake]', err));
      return () => disableWakeLock();
    }
    disableWakeLock();
  }, [shiftActive, activeJob, hailActive], 'ShiftKeepAwake');

  return null;
}
