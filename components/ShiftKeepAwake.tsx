import { useKeepAwake } from 'expo-keep-awake';
import { useDriver } from '@/context/DriverContext';

const KEEP_AWAKE_TAG = 'bookawaka-driver-shift';

/** Inner component so useKeepAwake only runs while shift / trip / offer is active. */
function KeepAwakeGate() {
  useKeepAwake(KEEP_AWAKE_TAG, { suppressDeactivateWarnings: true });
  return null;
}

/**
 * Prevents screen sleep during shift, active trips, hail, running meter, and pending offers.
 * Uses the hook API — imperative activateKeepAwakeAsync is also called on trip start as backup.
 */
export function ShiftKeepAwake() {
  const { shiftActive, jobOffer, activeJob, hailActive, meter } = useDriver();
  const keepAwake =
    shiftActive ||
    !!jobOffer ||
    !!activeJob ||
    hailActive ||
    !!meter?.running;

  if (!keepAwake) return null;
  return <KeepAwakeGate />;
}
