import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Use Google provider on Android only when an API key is configured (blank maps otherwise). */
export function shouldUseGoogleMapsProvider(): boolean {
  if (Platform.OS !== 'android') return false;
  const key =
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey ??
    (Constants.expoConfig?.extra as { googleMapsApiKey?: string } | undefined)?.googleMapsApiKey;
  return typeof key === 'string' && key.length > 8 && !key.includes('YOUR_');
}
