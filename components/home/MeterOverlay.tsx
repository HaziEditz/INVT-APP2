import { Colors } from '@/constants/theme';
import { MeterState } from '@/types';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  meter: MeterState;
  onPause: () => void;
};

function formatClock(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function MeterOverlay({ meter, onPause }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tripMs = Math.max(0, now - meter.startedAt - meter.pausedMs);
  const breakdown = meter.breakdown;
  const waitMin = breakdown.waitingMinutes;
  const modeLabel = meter.mode === 'moving' ? 'Moving' : 'Waiting';

  return (
    <View style={styles.box}>
      <Text style={styles.fare}>${meter.fare.toFixed(2)}</Text>
      <Text style={[styles.mode, meter.mode === 'moving' ? styles.modeMoving : styles.modeWaiting]}>
        {modeLabel}
      </Text>

      <View style={styles.statsRow}>
        <Text style={styles.statText}>{meter.distanceKm.toFixed(2)} km</Text>
        <Text style={styles.statSep}>·</Text>
        <Text style={styles.statText}>wait {waitMin.toFixed(1)}m</Text>
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.statText}>Flag ${breakdown.flagFall.toFixed(2)}</Text>
        <Text style={styles.statSep}>·</Text>
        <Text style={styles.statText}>Dist ${breakdown.distanceCharge.toFixed(2)}</Text>
        <Text style={styles.statSep}>·</Text>
        <Text style={styles.statText}>Wait ${breakdown.waitingCharge.toFixed(2)}</Text>
      </View>

      <Text style={styles.subStat}>Trip {formatClock(tripMs)}</Text>

      <Pressable style={[styles.pauseBtn, meter.paused && styles.pauseBtnActive]} onPress={onPause}>
        <Text style={styles.pauseText}>{meter.paused ? 'RESUME' : 'PAUSE'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: Colors.surface + 'F0',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginHorizontal: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    maxHeight: 150,
  },
  fare: {
    color: Colors.success,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
  },
  mode: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  modeMoving: { color: Colors.success },
  modeWaiting: { color: Colors.warning },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 2,
    gap: 4,
  },
  subStat: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  statText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  statSep: {
    color: Colors.border,
    fontSize: 11,
  },
  pauseBtn: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 6,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 100,
    alignItems: 'center',
  },
  pauseBtnActive: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning + '33',
  },
  pauseText: {
    color: Colors.text,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
