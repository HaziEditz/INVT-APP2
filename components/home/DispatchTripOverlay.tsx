import { Colors } from '@/constants/theme';
import { ActiveJob } from '@/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  job: ActiveJob;
  onExpand: () => void;
};

export function DispatchTripOverlay({ job, onExpand }: Props) {
  const elapsedMin = Math.max(0, Math.floor((Date.now() - job.startedAt) / 60000));

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.label}>Fare</Text>
          <Text style={styles.value}>${(job.fare ?? job.fixedFare ?? 0).toFixed(2)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.label}>Km</Text>
          <Text style={styles.value}>{(job.distanceKm ?? 0).toFixed(2)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.label}>Time</Text>
          <Text style={styles.value}>{elapsedMin}m</Text>
        </View>
        <Pressable style={styles.expand} onPress={onExpand} accessibilityLabel="Expand map">
          <Text style={styles.expandText}>⛶</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stat: { flex: 1 },
  label: { color: Colors.textMuted, fontSize: 10, textTransform: 'uppercase' },
  value: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  expand: { padding: 8 },
  expandText: { color: Colors.accent, fontSize: 22, fontWeight: '700' },
});
