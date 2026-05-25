import { Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';

export const ImpactFeedbackStyle = {
  Light: 'light' as ExpoHaptics.ImpactFeedbackStyle,
  Medium: 'medium' as ExpoHaptics.ImpactFeedbackStyle,
  Heavy: 'heavy' as ExpoHaptics.ImpactFeedbackStyle,
};

export const NotificationFeedbackType = {
  Success: 'success' as ExpoHaptics.NotificationFeedbackType,
  Warning: 'warning' as ExpoHaptics.NotificationFeedbackType,
  Error: 'error' as ExpoHaptics.NotificationFeedbackType,
};

export function impactAsync(style: ExpoHaptics.ImpactFeedbackStyle = ImpactFeedbackStyle.Medium) {
  if (Platform.OS === 'web') return;
  ExpoHaptics.impactAsync(style).catch(() => {});
}

export function selectionAsync() {
  if (Platform.OS === 'web') return;
  ExpoHaptics.selectionAsync().catch(() => {});
}

export function notificationAsync(type: ExpoHaptics.NotificationFeedbackType = NotificationFeedbackType.Success) {
  if (Platform.OS === 'web') return;
  ExpoHaptics.notificationAsync(type).catch(() => {});
}
