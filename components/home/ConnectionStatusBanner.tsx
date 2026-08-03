import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import {
  CONNECTION_BANNER_ALERT_ROLE,
  CONNECTION_BANNER_SYNCING_ROLE,
} from '@/lib/connectionBannerA11y';
import { StyleSheet, Text, View } from 'react-native';

export function ConnectionStatusBanner() {
  const { connectionNotice, syncingBanner } = useDriver();

  // Syncing banner persists after optimistic cancel/no-show/stage until flush.
  // Prefer connection notices while they are active; otherwise show Syncing….
  if (connectionNotice) {
    const offline = connectionNotice === 'offline';
    return (
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole={CONNECTION_BANNER_ALERT_ROLE}
        style={[styles.banner, offline ? styles.offline : styles.online]}
      >
        <View style={[styles.dot, offline ? styles.offlineDot : styles.onlineDot]} />
        <Text style={styles.text}>
          {offline ? 'No connection to dispatch' : 'Back online'}
        </Text>
      </View>
    );
  }

  if (!syncingBanner) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={CONNECTION_BANNER_SYNCING_ROLE}
      style={[styles.banner, styles.syncing]}
    >
      <View style={[styles.dot, styles.syncingDot]} />
      <Text style={styles.text}>{syncingBanner}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  offline: {
    backgroundColor: '#3A1217',
    borderBottomColor: Colors.danger,
  },
  online: {
    backgroundColor: '#0F2F20',
    borderBottomColor: Colors.success,
  },
  syncing: {
    backgroundColor: '#1A2433',
    borderBottomColor: Colors.accent,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  offlineDot: { backgroundColor: Colors.danger },
  onlineDot: { backgroundColor: Colors.success },
  syncingDot: { backgroundColor: Colors.accent },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
