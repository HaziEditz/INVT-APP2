import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function formatZoneElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Top bar: Available/Away | Zone | Queue | Time in zone */
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
  const inZone = Boolean(shiftActive && readyForJobs && zone.name?.trim());
  const queueLabel = inZone ? `#${zone.position > 0 ? zone.position : 1}` : '—';
  const timeInZone =
    shiftActive && zoneEnteredAt ? formatZoneElapsed(Date.now() - zoneEnteredAt) : '—';

  const toggleLabel = !shiftActive ? 'Off shift' : isAvailable ? 'Available' : isAway ? 'Away' : 'Available';

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
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
        <Text style={styles.toggleText}>{toggleLabel}</Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.metaScroll}
        contentContainerStyle={styles.metaRow}
      >
        <Text style={styles.meta}>
          Zone: <Text style={styles.metaVal}>{zoneName}</Text>
        </Text>
        <Text style={styles.sep}>|</Text>
        <Text style={styles.meta}>
          Queue: <Text style={styles.metaVal}>{queueLabel}</Text>
        </Text>
        <Text style={styles.sep}>|</Text>
        <Text style={styles.meta}>
          Time in zone: <Text style={styles.metaVal}>{timeInZone}</Text>
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  toggle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 88,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: Colors.success },
  toggleAway: { backgroundColor: Colors.warning },
  toggleOff: { backgroundColor: Colors.textMuted },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  metaScroll: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8 },
  meta: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  metaVal: { color: Colors.text, fontWeight: '700' },
  sep: { color: Colors.border, fontSize: 12, fontWeight: '300' },
});
