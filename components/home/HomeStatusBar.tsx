import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { formatQueueDisplay } from '@/lib/zoneQueue';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function formatZoneElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Top bar: Available/Away | ZQ | Zone | Time — single compact row */
export function HomeStatusBar() {
  const insets = useSafeAreaInsets();
  const { presenceStatus, shiftActive, togglePresence, zone, readyForJobs, hasTripInProgress } =
    useDriver();
  const [zoneEnteredAt, setZoneEnteredAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const lastZoneNameRef = useRef('');

  const isAvailable = presenceStatus === 'Online' && shiftActive && readyForJobs;
  const isAway = presenceStatus === 'Away' && shiftActive;

  useEffect(() => {
    const name = zone.name?.trim() || '';
    if (!shiftActive || !name) {
      lastZoneNameRef.current = '';
      setZoneEnteredAt(null);
      return;
    }
    if (name !== lastZoneNameRef.current) {
      lastZoneNameRef.current = name;
      setZoneEnteredAt(Date.now());
    }
  }, [zone.name, shiftActive]);

  useEffect(() => {
    if (!shiftActive || !zoneEnteredAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [shiftActive, zoneEnteredAt]);

  const zoneName = shiftActive ? zone.name?.trim() || '—' : '—';
  const queueLabel = formatQueueDisplay({
    shiftActive,
    hasTripInProgress,
    presenceStatus,
    readyForJobs,
    position: zone.position ?? 0,
  });
  const timeInZone =
    shiftActive && zoneEnteredAt ? formatZoneElapsed(Date.now() - zoneEnteredAt) : '—';

  const toggleLabel = !shiftActive ? 'Off' : isAvailable ? 'Avail' : isAway ? 'Away' : 'Avail';

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
      <Pressable
        style={[styles.toggle, isAvailable ? styles.toggleOn : isAway ? styles.toggleAway : styles.toggleOff]}
        onPress={
          shiftActive
            ? () => {
                if (hasTripInProgress) {
                  Alert.alert('Job in progress', 'Complete your current job first');
                  return;
                }
                void togglePresence();
              }
            : undefined
        }
        disabled={!shiftActive}
      >
        <Text style={styles.toggleText} numberOfLines={1}>
          {toggleLabel}
        </Text>
      </Pressable>

      <View style={styles.metaLine}>
        <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
          ZQ: <Text style={styles.metaVal}>{queueLabel}</Text>
          <Text style={styles.sep}> | </Text>
          Zone: <Text style={styles.metaVal}>{zoneName}</Text>
          <Text style={styles.sep}> | </Text>
          Time: <Text style={styles.metaVal}>{timeInZone}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 5,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 4,
  },
  toggle: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    minWidth: 52,
    maxWidth: 56,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: Colors.success },
  toggleAway: { backgroundColor: Colors.warning },
  toggleOff: { backgroundColor: Colors.textMuted },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 10 },
  metaLine: { flex: 1, minWidth: 0 },
  meta: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  metaVal: { color: Colors.text, fontWeight: '700', fontSize: 11 },
  sep: { color: Colors.border, fontSize: 11, fontWeight: '400' },
});
