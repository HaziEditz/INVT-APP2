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

type Props = {
  onOffersPress?: () => void;
};

export function HomeStatusBar({ onOffersPress }: Props) {
  const insets = useSafeAreaInsets();
  const {
    presenceStatus,
    shiftActive,
    zone,
    selectedVehicleId,
    vehicles,
    offersBadgeCount,
    togglePresence,
  } = useDriver();

  const vehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const vehicleLabel = vehicle?.number ?? selectedVehicleId ?? '—';
  const zoneName = zone.name?.trim() || (shiftActive ? 'Awaiting zone' : '—');
  const queueLabel =
    zone.position > 0
      ? `${zone.position}${zone.totalInQueue > 0 ? ` of ${zone.totalInQueue}` : ''}`
      : '—';

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
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Zone</Text>
          <Text style={styles.zone} numberOfLines={1}>{zoneName}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Vehicle</Text>
          <Text style={styles.metaValue}>{vehicleLabel}</Text>
          <Text style={styles.metaLabel}>Queue</Text>
          <Text style={styles.metaValue}>{queueLabel}</Text>
        </View>
      </View>

      {offersBadgeCount > 0 && onOffersPress ? (
        <Pressable style={styles.badge} onPress={onOffersPress}>
          <Text style={styles.badgeText}>{offersBadgeCount}</Text>
        </Pressable>
      ) : null}
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
  meta: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  metaLabel: { color: Colors.textMuted, fontSize: 10, textTransform: 'uppercase' },
  metaValue: { color: Colors.text, fontSize: 13, fontWeight: '600', marginRight: 8 },
  zone: { color: Colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  badge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
