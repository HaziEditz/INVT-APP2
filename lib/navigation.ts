import { Alert, Linking, Platform } from 'react-native';

type NavTarget = {
  lat?: number;
  lng?: number;
  label?: string;
};

function buildAddressQuery(target: NavTarget): string {
  if (target.label?.trim()) return encodeURIComponent(target.label.trim());
  if (target.lat != null && target.lng != null) {
    return encodeURIComponent(`${target.lat},${target.lng}`);
  }
  return '';
}

export function openGoogleMapsNavigation(target: NavTarget) {
  const q = buildAddressQuery(target);
  if (!q) return;
  const url =
    target.lat != null && target.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
  void Linking.openURL(url);
}

export function openWazeNavigation(target: NavTarget) {
  if (target.lat == null || target.lng == null) {
    Alert.alert('Waze', 'GPS coordinates are required for Waze navigation.');
    return;
  }
  const url = `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`;
  void Linking.openURL(url);
}

export function showNavigationPicker(target: NavTarget, title = 'Navigate') {
  const q = buildAddressQuery(target);
  if (!q) {
    Alert.alert('Navigate', 'No destination available for this job.');
    return;
  }
  Alert.alert(title, 'Open turn-by-turn directions in:', [
    { text: 'Google Maps', onPress: () => openGoogleMapsNavigation(target) },
    { text: 'Waze', onPress: () => openWazeNavigation(target) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

export function canOpenNavigation(target: NavTarget): boolean {
  return !!(target.label?.trim() || (target.lat != null && target.lng != null));
}
