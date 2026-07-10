import Constants from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;
let handlerConfigured = false;
let channelsReady = false;

const OFFER_SOUND = Platform.OS === 'android' ? 'alert' : 'alert.wav';

function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

function pushNotificationsSupported(): boolean {
  return !isExpoGo();
}

export function configureNotificationHandler(): void {
  if (handlerConfigured || !pushNotificationsSupported()) return;
  try {
    const mod = require('expo-notifications') as NotificationsModule;
    mod.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data as Record<string, unknown> | undefined;
        const inAppOnly = data?.inAppSoundOnly === true;
        return {
          shouldPlaySound: true,
          shouldSetBadge: !inAppOnly,
          shouldShowBanner: !inAppOnly,
          shouldShowList: !inAppOnly,
        };
      },
    });
    handlerConfigured = true;
    notificationsModule = mod;
  } catch {
    notificationsModule = null;
  }
}

export function loadNotifications(): NotificationsModule | null {
  if (!pushNotificationsSupported()) {
    return null;
  }
  configureNotificationHandler();
  if (notificationsModule !== undefined) {
    return notificationsModule;
  }
  return notificationsModule ?? null;
}

/** Idempotent — safe to call on app launch and shift start. */
export async function ensureNotificationChannels(): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications || Platform.OS !== 'android') {
    channelsReady = true;
    return;
  }
  if (channelsReady) return;

  await Notifications.setNotificationChannelAsync('job-offers', {
    name: 'Job Offers',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    lightColor: '#1a73e8',
    sound: OFFER_SOUND,
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync('in-app-alerts', {
    name: 'In-App Alerts',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#1a73e8',
    sound: OFFER_SOUND,
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync('compliance', {
    name: 'NZTA & Break Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
  channelsReady = true;
}

export async function registerForPushNotifications(): Promise<string | null> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return null;
  }

  try {
    await ensureNotificationChannels();

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}

export async function notifyJobOffer(title: string, body: string): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return;
  }

  try {
    await ensureNotificationChannels();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: OFFER_SOUND,
        priority: Notifications.AndroidNotificationPriority?.MAX,
        data: { type: 'job_offer' },
        ...(Platform.OS === 'android' ? { channelId: 'job-offers' } : {}),
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('[Notifications] notifyJobOffer failed:', err);
  }
}

export async function notifySosAlert(
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return;
  }

  try {
    await ensureNotificationChannels();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: OFFER_SOUND,
        priority: Notifications.AndroidNotificationPriority?.MAX,
        data: { ...data, type: 'driver_sos' },
        ...(Platform.OS === 'android' ? { channelId: 'in-app-alerts' } : {}),
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('[Notifications] notifySosAlert failed:', err);
  }
}

export async function notifyBreakReminder(
  title: string,
  body: string,
  delayMinutes?: number
): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return;
  }

  try {
    const trigger =
      delayMinutes && delayMinutes > 0
        ? ({
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: Math.max(60, delayMinutes * 60),
            repeats: false,
          } satisfies import('expo-notifications').TimeIntervalTriggerInput)
        : null;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: { type: 'break_reminder' },
        ...(Platform.OS === 'android' ? { channelId: 'compliance' } : {}),
      },
      trigger,
    });
  } catch {
    // Optional — ignore when notifications unavailable
  }
}

configureNotificationHandler();
