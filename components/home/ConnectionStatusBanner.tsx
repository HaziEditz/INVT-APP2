import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { StyleSheet, Text, View } from 'react-native';

export function ConnectionStatusBanner() {
  const { connectionNotice } = useDriver();
  if (!connectionNotice) return null;

  const offline = connectionNotice === 'offline';
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.banner, offline ? styles.offline : styles.online]}
    >
      <View style={[styles.dot, offline ? styles.offlineDot : styles.onlineDot]} />
      <Text style={styles.text}>
        {offline ? 'No connection to dispatch' : 'Back online'}
      </Text>
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  offlineDot: { backgroundColor: Colors.danger },
  onlineDot: { backgroundColor: Colors.success },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
