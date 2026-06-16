import { AppState } from 'react-native';
import {
  ensureNotificationChannels,
  registerForPushNotifications,
} from '@/services/notificationService';
import { preloadOfferAlertSound, unloadOfferAlertSound } from '@/lib/notificationSound';

let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
let onForegroundResume: (() => void) | null = null;
let running = false;

/** Called when shift starts — audio, notification channels, AppState hooks. */
export async function startShiftRuntime(opts: { onForegroundResume: () => void }): Promise<void> {
  onForegroundResume = opts.onForegroundResume;
  if (running) {
    await ensureNotificationChannels();
    await preloadOfferAlertSound();
    return;
  }
  running = true;

  await ensureNotificationChannels();
  void registerForPushNotifications();
  await preloadOfferAlertSound();

  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      onForegroundResume?.();
    }
  });
}

/** Called when shift ends. */
export function stopShiftRuntime(): void {
  running = false;
  onForegroundResume = null;
  appStateSub?.remove();
  appStateSub = null;
  void unloadOfferAlertSound();
}

export function isShiftRuntimeActive(): boolean {
  return running;
}
