import { useDriver } from '@/context/DriverContext';
import { enableWakeLock, disableWakeLock } from '@/services/wakeLock';
import { useEffect } from 'react';

/** Keeps screen on while shift is active or on a trip. */
export function ShiftKeepAwake() {
  const { shiftActive, activeJob, hailActive } = useDriver();

  useEffect(() => {
    if (shiftActive || activeJob || hailActive) {
      enableWakeLock().catch(() => undefined);
      return () => disableWakeLock();
    }
    disableWakeLock();
  }, [shiftActive, activeJob, hailActive]);

  return null;
}
