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

/** Top bar: lifecycle status (color) | ZQ | Zone | Time */
export function HomeStatusBar() {
  const insets = useSafeAreaInsets();
  const {
    shiftActive,
    togglePresence,
    zone,
    readyForJobs,
    presenceStatus,
    hasTripInProgress,
    tripDisplayLabel,
    tripDisplayColor,
    tripDisplayPhase,
  } = useDriver();
  const [zoneEnteredAt, setZoneEnteredAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const lastZoneNameRef = useRef('');

  const canTogglePresence =
    shiftActive &&
    !hasTripInProgress &&
    (tripDisplayPhase === 'available' || tripDisplayPhase === 'away');

  const prevBusyRef = useRef(false);

  useEffect(() => {
    const isBusy = hasTripInProgress || presenceStatus === 'Busy';
    if (prevBusyRef.current && !isBusy && shiftActive && zone.name?.trim()) {
      setZoneEnteredAt(Date.now());
    }
    prevBusyRef.current = isBusy;
  }, [hasTripInProgress, presenceStatus, shiftActive, zone.name]);

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

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
      <Pressable
        style={[styles.lifecyclePill, { backgroundColor: tripDisplayColor }]}
        onPress={
          canTogglePresence
            ? () => {
                void togglePresence();
              }
            : shiftActive && hasTripInProgress
              ? () => {
                  Alert.alert('Job in progress', 'Complete your current job first');
                }
              : undefined
        }
        disabled={!shiftActive}
      >
        <Text style={styles.lifecycleText} numberOfLines={1}>
          {tripDisplayLabel}
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
    gap: 6,
  },
  lifecyclePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    minWidth: 68,
    maxWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lifecycleText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  metaLine: { flex: 1, minWidth: 0 },
  meta: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  metaVal: { color: Colors.text, fontWeight: '700', fontSize: 11 },
  sep: { color: Colors.border, fontSize: 11, fontWeight: '400' },
});
