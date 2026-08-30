import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

/**
 * Force-check / fetch / reload OTA so preview+production updates actually land.
 * Expo's default ON_LOAD fetch with fallbackToCacheTimeout:0 can leave the app
 * on the previous update across many close/reopen cycles if reload never runs.
 */
export async function applyPendingOtaUpdate(): Promise<void> {
  if (__DEV__) return;
  try {
    if (!Updates.isEnabled) {
      console.log('[OTA] updates disabled on this build');
      return;
    }
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      console.log(
        '[OTA] no update',
        Platform.OS,
        'channel=',
        Updates.channel,
        'runtime=',
        Updates.runtimeVersion,
        'updateId=',
        Updates.updateId,
      );
      return;
    }
    console.log('[OTA] fetching update…', Updates.channel, Updates.runtimeVersion);
    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isNew) {
      console.log('[OTA] reloading into new update');
      await Updates.reloadAsync();
    }
  } catch (err) {
    console.warn('[OTA] check/fetch failed:', err);
  }
}

/** Channel + short update id for build label (proves which OTA is actually running). */
export function getOtaDebugSuffix(): string {
  if (__DEV__) return 'dev';
  try {
    const ch = String(Updates.channel || 'unknown');
    const id = String(Updates.updateId || '').replace(/-/g, '').slice(0, 8);
    return id ? `${ch}:${id}` : ch;
  } catch {
    return 'n/a';
  }
}
