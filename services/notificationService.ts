import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('job-offers', {
      name: 'Job Offers',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1a73e8',
    });
    await Notifications.setNotificationChannelAsync('compliance', {
      name: 'NZTA & Break Reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}

export async function notifyJobOffer(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data: { type: 'job_offer' },
      ...(Platform.OS === 'android' ? { channelId: 'job-offers' } : {}),
    },
    trigger: null,
  });
}

export async function notifyBreakReminder(title: string, body: string, delayMinutes?: number) {
  const trigger =
    delayMinutes && delayMinutes > 0
      ? { seconds: Math.max(60, delayMinutes * 60), repeats: false as const }
      : null;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data: { type: 'break_reminder' },
      ...(Platform.OS === 'android' ? { channelId: 'compliance' } : {}),
    },
    trigger,
  });
}
