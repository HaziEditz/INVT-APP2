import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Presence only — Available / Away (manual or after missed offer). */
export function HomeStatusBar() {
  const insets = useSafeAreaInsets();
  const { presenceStatus, shiftActive, togglePresence, zone, readyForJobs } = useDriver();

  const isAvailable = presenceStatus === 'Online' && shiftActive && readyForJobs;
  const isAway = presenceStatus === 'Away' && shiftActive;

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Pressable
        style={[styles.toggle, isAvailable ? styles.toggleOn : isAway ? styles.toggleAway : styles.toggleOff]}
        onPress={shiftActive ? togglePresence : undefined}
        disabled={!shiftActive}
      >
        <Text style={styles.toggleText}>
          {!shiftActive ? 'Off shift' : isAvailable ? 'Available' : isAway ? 'Away' : 'Available'}
        </Text>
        {shiftActive ? <Text style={styles.toggleHint}>tap</Text> : null}
      </Pressable>

      <View style={styles.zoneWrap}>
        <Text style={styles.zoneLabel}>Zone</Text>
        <Text style={styles.zoneValue} numberOfLines={1}>
          {shiftActive ? zone.name?.trim() || '—' : '—'}
        </Text>
        {shiftActive && zone.position > 0 ? (
          <Text style={styles.queueHint}>Queue #{zone.position}</Text>
        ) : null}
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
    gap: 12,
  },
  toggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 100,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: Colors.success },
  toggleAway: { backgroundColor: Colors.warning },
  toggleOff: { backgroundColor: Colors.textMuted },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  toggleHint: { color: 'rgba(255,255,255,0.8)', fontSize: 10 },
  zoneWrap: { flex: 1, minWidth: 0 },
  zoneLabel: { color: Colors.textMuted, fontSize: 10, textTransform: 'uppercase' },
  zoneValue: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  queueHint: { color: Colors.textMuted, fontSize: 12 },
});
