import { Colors } from '@/constants/theme';
import { MeterState } from '@/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  meter: MeterState;
  onPause: () => void;
  onWait: () => void;
};

function formatWait(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MeterOverlay({ meter, onPause, onWait }: Props) {
  const statusLabel = meter.paused
    ? 'PAUSED'
    : meter.mode === 'moving'
      ? 'MOVING'
      : 'WAITING';

  return (
    <View style={styles.box}>
      <Text style={styles.fare}>${meter.fare.toFixed(2)}</Text>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.label}>Km</Text>
          <Text style={styles.statValue}>{meter.distanceKm.toFixed(2)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.label}>Waiting</Text>
          <Text style={styles.statValue}>{formatWait(meter.waitingMs)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable style={[styles.btn, meter.paused && styles.btnPaused]} onPress={onPause}>
          <Text style={styles.btnText}>{meter.paused ? 'RESUME' : 'PAUSE'}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.btn,
            meter.mode === 'waiting' && !meter.paused && styles.btnWaiting,
            meter.mode === 'moving' && !meter.paused && styles.btnMoving,
          ]}
          onPress={onWait}
        >
          <Text style={styles.btnText}>{statusLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: Colors.surface + 'F2',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  fare: {
    color: Colors.success,
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 8,
    gap: 12,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  label: {
    color: Colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  statValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    width: '100%',
  },
  btn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnPaused: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning + '33',
  },
  btnWaiting: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning + '22',
  },
  btnMoving: {
    borderColor: Colors.success,
    backgroundColor: Colors.success + '22',
  },
  btnText: {
    color: Colors.text,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
