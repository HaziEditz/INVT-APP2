import { Platform } from 'react-native';
import Constants from 'expo-constants';

// expo-notifications remote push was removed from Expo Go in SDK 53.
// Detect Expo Go and skip all notification setup to avoid the red-box crash.
const isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  (Constants as any).appOwnership === 'expo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notif: any = null;

if (!isExpoGo && Platform.OS !== 'web') {
  try {
    Notif = require('expo-notifications');
    Notif.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (e) {
    console.warn('[Push] expo-notifications unavailable:', e);
    Notif = null;
  }
}

// Resolve the EAS project ID — prefer the value baked in by EAS Build,
// fall back gracefully so registration fails loudly instead of silently.
function resolveProjectId(): string | null {
  const fromEas = Constants.expoConfig?.extra?.eas?.projectId;
  if (fromEas && typeof fromEas === 'string') return fromEas;
  // Some older SDK setups expose it here
  const fromManifest = (Constants as any).manifest2?.extra?.expoClient?.extra?.eas?.projectId;
  if (fromManifest && typeof fromManifest === 'string') return fromManifest;
  console.warn(
    '[Push] No EAS projectId found in app config. ' +
    'Add { "extra": { "eas": { "projectId": "<uuid>" } } } to app.json ' +
    'or run `eas init` to configure push notifications.'
  );
  return null;
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web' || !Notif || isExpoGo) return null;

  let Device: any = null;
  try { Device = require('expo-device'); } catch { return null; }
  if (!Device?.isDevice) {
    console.log('[Push] Skipping — not a physical device (simulator/emulator)');
    return null;
  }

  try {
    // Set up the high-priority "jobs" channel on Android before requesting permissions
    if (Platform.OS === 'android') {
      await Notif.setNotificationChannelAsync('jobs', {
        name: 'New Jobs',
        description: 'Incoming job offers from dispatch',
        importance: Notif.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#f59e0b',
        sound: 'default',
        enableLights: true,
        enableVibrate: true,
        showBadge: true,
        bypassDnd: false,
      });
    }

    const { status: existing } = await Notif.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notif.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('[Push] Permission denied — driver will not receive push notifications');
      return null;
    }

    const projectId = resolveProjectId();
    if (!projectId) {
      console.warn('[Push] Cannot get push token — no EAS projectId configured');
      return null;
    }

    const tokenData = await Notif.getExpoPushTokenAsync({ projectId });
    const token: string = tokenData.data;
    console.log('[Push] Expo push token registered:', token.slice(0, 30) + '…');
    return token;
  } catch (err) {
    console.warn('[Push] Could not register:', err);
    return null;
  }
}

export async function scheduleJobNotification(opts: {
  pickup: string;
  jobId: string;
}): Promise<void> {
  if (Platform.OS === 'web' || !Notif || isExpoGo) return;
  try {
    await Notif.scheduleNotificationAsync({
      content: {
        title: '🚖 New Job Offer',
        body: opts.pickup ? `Pickup: ${opts.pickup}` : 'A new job has been offered to you.',
        data: { jobId: opts.jobId, screen: 'jobs' },
        sound: 'default',
        priority: Notif.AndroidNotificationPriority?.MAX,
      },
      trigger: null,
      // Ensure Android uses the high-priority "jobs" channel
      ...(Platform.OS === 'android' ? { channelId: 'jobs' } : {}),
    });
  } catch (err) {
    console.warn('[Push] scheduleJobNotification failed:', err);
  }
}

export async function cancelJobNotifications(): Promise<void> {
  if (Platform.OS === 'web' || !Notif || isExpoGo) return;
  try {
    await Notif.dismissAllNotificationsAsync();
  } catch { /* ignore */ }
}
