import Constants from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;
let handlerConfigured = false;

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
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
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

export async function registerForPushNotifications(): Promise<string | null> {
  const Notifications = loadNotifications();
  if (!Notifications) {
    return null;
  }

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('job-offers', {
        name: 'Job Offers',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1a73e8',
        sound: 'default',
      });
      await Notifications.setNotificationChannelAsync('in-app-alerts', {
        name: 'In-App Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#1a73e8',
        sound: 'default',
      });
      await Notifications.setNotificationChannelAsync('compliance', {
        name: 'NZTA & Break Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }

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
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: { type: 'job_offer' },
        ...(Platform.OS === 'android' ? { channelId: 'job-offers' } : {}),
      },
      trigger: null,
    });
  } catch {
    // Optional — ignore when notifications unavailable
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
