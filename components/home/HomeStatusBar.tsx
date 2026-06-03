import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { PresenceDisplayStatus } from '@/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function toggleLabel(status: PresenceDisplayStatus, shiftActive: boolean) {
  if (!shiftActive) return 'Offline';
  if (status === 'Online') return 'Online';
  if (status === 'Away') return 'Away';
  return 'Online';
}

export function HomeStatusBar() {
  const insets = useSafeAreaInsets();
  const {
    presenceStatus,
    shiftActive,
    readyForJobs,
    zone,
    selectedVehicleId,
    vehicles,
    offersBadgeCount,
    togglePresence,
  } = useDriver();

  const vehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const vehicleLabel = vehicle?.number ?? selectedVehicleId ?? '—';
  const zoneName = zone.name?.trim() || (shiftActive ? 'No zone' : '—');
  const queue =
    zone.position > 0
      ? `#${zone.position}${zone.totalInQueue > 0 ? ` / ${zone.totalInQueue}` : ''}`
      : shiftActive
        ? '—'
        : '';

  const isOnline = presenceStatus === 'Online' && shiftActive;
  const isAway = presenceStatus === 'Away' && shiftActive;

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Pressable
        style={[styles.toggle, isOnline ? styles.toggleOn : isAway ? styles.toggleAway : styles.toggleOff]}
        onPress={shiftActive ? togglePresence : undefined}
        disabled={!shiftActive}
      >
        <Text style={styles.toggleText}>{shiftActive ? toggleLabel(presenceStatus, shiftActive) : 'Offline'}</Text>
        {shiftActive ? <Text style={styles.toggleHint}>tap</Text> : null}
      </Pressable>

      <View style={styles.meta}>
        <Text style={styles.zone} numberOfLines={1}>{zoneName}</Text>
        <Text style={styles.sub}>
          {vehicleLabel}
          {queue ? ` · Queue ${queue}` : ''}
          {offersBadgeCount > 0 ? ` · ${offersBadgeCount} offer(s)` : ''}
        </Text>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  toggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 88,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: Colors.success },
  toggleAway: { backgroundColor: Colors.warning },
  toggleOff: { backgroundColor: Colors.textMuted },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  toggleHint: { color: 'rgba(255,255,255,0.8)', fontSize: 10 },
  meta: { flex: 1 },
  zone: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  sub: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
});
