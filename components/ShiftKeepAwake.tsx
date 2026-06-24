import { useKeepAwake } from 'expo-keep-awake';
import { useDriver } from '@/context/DriverContext';

const KEEP_AWAKE_TAG = 'bookawaka-driver-shift';

/** Inner component so useKeepAwake only runs while shift / pending offer is active. */
function KeepAwakeGate() {
  useKeepAwake(KEEP_AWAKE_TAG, { suppressDeactivateWarnings: true });
  return null;
}

/**
 * Prevents screen sleep for the whole shift (and while a job offer is pending).
 * Uses the hook API — more reliable on Android than imperative activate/deactivate alone.
 */
export function ShiftKeepAwake() {
  const { shiftActive, jobOffer } = useDriver();
  if (!shiftActive && !jobOffer) return null;
  return <KeepAwakeGate />;
}
