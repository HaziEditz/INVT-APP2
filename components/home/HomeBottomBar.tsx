import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { StyleSheet, Text, View } from 'react-native';

export function HomeBottomBar() {
  const { shiftActive, presenceStatus, zone, readyForJobs } = useDriver();

  const online = shiftActive && presenceStatus === 'Online' && readyForJobs;
  const zoneName = zone.name?.trim() || (shiftActive ? 'No zone assigned' : '—');
  const queue =
    zone.position > 0
      ? `#${zone.position}${zone.totalInQueue > 0 ? ` of ${zone.totalInQueue}` : ''}`
      : shiftActive
        ? 'Waiting'
        : '—';

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.status}>{online ? 'Online' : shiftActive ? presenceStatus : 'Off shift'}</Text>
        <Text style={styles.sep}>·</Text>
        <Text style={styles.zone} numberOfLines={1}>{zoneName}</Text>
      </View>
      <Text style={styles.queue}>Queue {queue}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: Colors.success },
  dotOff: { backgroundColor: Colors.textMuted },
  status: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  sep: { color: Colors.textMuted },
  zone: { color: Colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  queue: { color: Colors.textMuted, fontSize: 14 },
});
