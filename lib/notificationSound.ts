import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { loadNotifications } from '@/services/notificationService';

export type InAppSoundKind = 'offer' | 'update' | 'cancel' | 'alert' | 'general';

let audioModeReady = false;
let toneSound: Audio.Sound | null = null;

const ALERT_TITLES: Record<InAppSoundKind, string> = {
  offer: 'New job offer',
  update: 'Job updated',
  cancel: 'Job cancelled',
  alert: 'Dispatch alert',
  general: 'Notification',
};

async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
  audioModeReady = true;
}

async function playToneBurst(): Promise<void> {
  await ensureAudioMode();
  if (toneSound) {
    try {
      await toneSound.setPositionAsync(0);
      await toneSound.playAsync();
      return;
    } catch {
      try {
        await toneSound.unloadAsync();
      } catch {
        /* ignore */
      }
      toneSound = null;
    }
  }

  const created = await Audio.Sound.createAsync(require('@/assets/sounds/alert.wav'), {
    shouldPlay: true,
    volume: 1.0,
  });
  toneSound = created.sound;
}

async function playNotificationChannelSound(kind: InAppSoundKind): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  const channelId =
    kind === 'offer'
      ? 'job-offers'
      : kind === 'cancel' || kind === 'alert'
        ? 'compliance'
        : 'in-app-alerts';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: ALERT_TITLES[kind],
      body: ' ',
      sound: 'default',
      data: { inAppSoundOnly: true, kind },
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    trigger: null,
  });
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

  try {
    await playToneBurst();
  } catch {
    try {
      await playNotificationChannelSound(kind);
    } catch {
      /* sound unavailable */
    }
  }
}
