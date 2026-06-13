import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

export type InAppSoundKind = 'offer' | 'update' | 'cancel' | 'alert' | 'general';

let notificationsModule: NotificationsModule | null | undefined;

function loadNotifications(): NotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;
  try {
    notificationsModule = require('expo-notifications') as NotificationsModule;
    return notificationsModule;
  } catch {
    notificationsModule = null;
    return null;
  }
}

/** Play a short alert sound when an in-app notification popup appears. */
export async function playInAppNotificationSound(kind: InAppSoundKind = 'general'): Promise<void> {
  try {
    await Haptics.notificationAsync(
      kind === 'cancel' || kind === 'alert'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success,
    );
  } catch {
    /* haptics unavailable */
  }

  const Notifications = loadNotifications();
  if (!Notifications) return;

  try {
    const channelId =
      kind === 'offer' ? 'job-offers' : kind === 'cancel' || kind === 'alert' ? 'compliance' : undefined;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '\u200b',
        body: '\u200b',
        sound: 'default',
        data: { inAppSoundOnly: true, kind },
        ...(Platform.OS === 'android' && channelId ? { channelId } : {}),
      },
      trigger: null,
    });
  } catch {
    /* sound unavailable */
  }
}
