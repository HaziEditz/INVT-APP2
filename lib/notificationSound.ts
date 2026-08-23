import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { AppState, Platform } from 'react-native';
import { loadNotifications } from '@/services/notificationService';
import { notifyJobOffer } from '@/services/notificationService';
import type { JobOffer } from '@/types';

export type InAppSoundKind = 'offer' | 'update' | 'cancel' | 'alert' | 'general';

let audioModeReady = false;
let toneSound: Audio.Sound | null = null;
let preloadPromise: Promise<void> | null = null;

const ALERT_TITLES: Record<InAppSoundKind, string> = {
  offer: 'New job offer',
  update: 'Job updated',
  cancel: 'Job cancelled',
  alert: 'Dispatch alert',
  general: 'Notification',
};

export async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
  });
  audioModeReady = true;
}

export async function preloadOfferAlertSound(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    try {
      await ensureAudioMode();
      if (toneSound) return;
      const created = await Audio.Sound.createAsync(require('@/assets/sounds/alert.wav'), {
        shouldPlay: false,
        volume: 1.0,
        isLooping: false,
      });
      toneSound = created.sound;
    } catch (err) {
      console.warn('[NotificationSound] preload failed:', err);
    }
  })();
  return preloadPromise;
}

export async function unloadOfferAlertSound(): Promise<void> {
  preloadPromise = null;
  if (!toneSound) return;
  try {
    await toneSound.unloadAsync();
  } catch {
    /* ignore */
  }
  toneSound = null;
}

async function playToneBurst(opts?: { longerBeep?: boolean }): Promise<void> {
  await preloadOfferAlertSound();
  if (!toneSound) {
    const created = await Audio.Sound.createAsync(require('@/assets/sounds/alert.wav'), {
      shouldPlay: true,
      volume: 1.0,
      isLooping: !!opts?.longerBeep,
    });
    toneSound = created.sound;
    if (opts?.longerBeep) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await toneSound.stopAsync();
        await toneSound.setIsLoopingAsync(false);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    // Restarting playAsync every 420ms does not produce 3 audible beeps on device —
    // playAsync resolves on start, so bursts overlap/cancel. Loop for ~5s instead.
    if (opts?.longerBeep) {
      await toneSound.setIsLoopingAsync(true);
      await toneSound.setPositionAsync(0);
      await toneSound.playAsync();
      await new Promise((r) => setTimeout(r, 5000));
      await toneSound.stopAsync();
      await toneSound.setIsLoopingAsync(false);
      return;
    }
    await toneSound.setIsLoopingAsync(false);
    await toneSound.setPositionAsync(0);
    await toneSound.playAsync();
  } catch {
    await unloadOfferAlertSound();
    await playToneBurst({ longerBeep: !!opts?.longerBeep });
  }
}

async function playNotificationChannelSound(kind: InAppSoundKind, title: string, body: string): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  const channelId =
    kind === 'offer'
      ? 'job-offers'
      : kind === 'cancel' || kind === 'alert'
        ? 'compliance'
        : 'in-app-alerts';

  const soundName = Platform.OS === 'android' ? 'alert' : 'alert.wav';

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: soundName,
      priority: Notifications.AndroidNotificationPriority?.MAX,
      data: { inAppSoundOnly: true, kind },
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    trigger: null,
  });
}

async function playHaptic(kind: InAppSoundKind): Promise<void> {
  try {
    await Haptics.notificationAsync(
      kind === 'cancel' || kind === 'alert'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success,
    );
  } catch {
    /* haptics unavailable */
  }
}

/** Job offer — local wav + OS notification (notification carries sound when backgrounded/locked). */
export async function alertDriverToOffer(offer: JobOffer): Promise<void> {
  const title = 'New job offer';
  const body = `#${offer.id} · ${offer.pickup || 'Tap to respond'} · 30s`;
  const inBackground = AppState.currentState !== 'active';

  await playHaptic('offer');

  const tasks: Promise<unknown>[] = [
    playToneBurst().catch((err) => console.warn('[NotificationSound] tone failed:', err)),
  ];

  if (inBackground) {
    tasks.push(notifyJobOffer(title, body).catch((err) => console.warn('[NotificationSound] notify failed:', err)));
  } else {
    tasks.push(
      playNotificationChannelSound('offer', title, body).catch((err) =>
        console.warn('[NotificationSound] channel sound failed:', err),
      ),
    );
  }

  await Promise.allSettled(tasks);
}

/** Play a short alert sound when an in-app notification popup appears. */
export async function playInAppNotificationSound(
  kind: InAppSoundKind = 'general',
  opts?: { longerBeep?: boolean },
): Promise<void> {
  const title = ALERT_TITLES[kind];
  await playHaptic(kind);

  const tasks: Promise<unknown>[] = [
    playToneBurst({ longerBeep: !!opts?.longerBeep }).catch(() =>
      playNotificationChannelSound(kind, title, ' ').catch(() => undefined),
    ),
  ];

  if (kind !== 'offer') {
    tasks.push(
      playNotificationChannelSound(kind, title, ' ').catch(() => undefined),
    );
  }

  await Promise.allSettled(tasks);
}
