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

  return (
    <View style={styles.box}>
      <Text style={styles.time}>{formatClock(tripMs)}</Text>
      <Text style={styles.distance}>{meter.distanceKm.toFixed(2)} km</Text>
      <Text style={styles.fare}>${meter.fare.toFixed(2)}</Text>

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
    maxHeight: 110,
  },
  time: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
  },
  distance: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  fare: {
    color: Colors.success,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
    marginTop: 2,
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
