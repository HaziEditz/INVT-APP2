let active = false;

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export async function enableWakeLock(): Promise<void> {
  if (active) return;
  try {
    await activateKeepAwakeAsync('bookawaka-driver-shift');
    active = true;
  } catch (err) {
    console.warn('[WakeLock] enable failed:', err);
  }
}

export function disableWakeLock(): void {
  if (!active) return;
  try {
    deactivateKeepAwake('bookawaka-driver-shift');
  } catch {
    // non-fatal
  }
  active = false;
}
