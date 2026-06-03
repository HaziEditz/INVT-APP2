import { Colors } from '@/constants/theme';
import { MeterState } from '@/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  meter: MeterState;
  onPause: () => void;
  onWait: () => void;
  onExpand?: () => void;
  compact?: boolean;
};

function formatTime(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MeterOverlay({ meter, onPause, onWait, onExpand, compact }: Props) {
  const timeMs = meter.startedAt ? Math.max(0, Date.now() - meter.startedAt - meter.pausedMs) : 0;

  return (
    <View style={[styles.box, compact && styles.boxCompact]}>
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.label}>Fare</Text>
          <Text style={styles.value}>${meter.fare.toFixed(2)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.label}>Km</Text>
          <Text style={styles.value}>{meter.distanceKm.toFixed(2)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.label}>Time</Text>
          <Text style={styles.value}>{formatTime(Math.max(0, timeMs))}</Text>
        </View>
        {onExpand ? (
          <Pressable style={styles.expand} onPress={onExpand}>
            <Text style={styles.expandText}>⛶</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.controls}>
        <Pressable style={[styles.btn, meter.paused && styles.btnActive]} onPress={onPause}>
          <Text style={styles.btnText}>{meter.paused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
        <Pressable style={[styles.btn, meter.waiting && styles.btnWait]} onPress={onWait}>
          <Text style={styles.btnText}>{meter.waiting ? 'End Wait' : 'Wait'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: Colors.surface + 'EE',
    borderRadius: 12,
    padding: 10,
    margin: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  boxCompact: { margin: 8, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stat: { flex: 1 },
  label: { color: Colors.textMuted, fontSize: 10, textTransform: 'uppercase' },
  value: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  expand: { padding: 8 },
  expandText: { color: Colors.accent, fontSize: 22, fontWeight: '700' },
  controls: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnActive: { borderColor: Colors.warning, backgroundColor: Colors.warning + '33' },
  btnWait: { borderColor: Colors.accent },
  btnText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
});
