import { Colors } from '@/constants/theme';
import { formatFareAmount } from '@/lib/tariffs';
import { MeterState } from '@/types';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  meter: MeterState;
  onPause: () => void;
  /** overlay = full map modal; strip = legacy inline; trip = prominent bar during active trip */
  layout?: 'overlay' | 'strip' | 'trip';
};

function formatClock(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function MeterOverlay({ meter, onPause, layout = 'overlay' }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tripMs = Math.max(0, now - meter.startedAt - meter.pausedMs);
  const breakdown = meter.breakdown;
  const waitMin = breakdown.waitingMinutes;
  const modeLabel = meter.mode === 'moving' ? 'Moving' : 'Waiting';
  const trip = layout === 'trip';
  const strip = layout === 'strip';
  const fareText = formatFareAmount(meter.fare);
  const tariffLabel = meter.tariffName?.trim();

  if (trip) {
    return (
      <View style={styles.tripBox}>
        <View style={styles.tripTop}>
          <View style={styles.tripFareCol}>
            <Text style={styles.tripFare}>${fareText}</Text>
            {tariffLabel ? <Text style={styles.tripTariff}>{tariffLabel}</Text> : null}
            <Text style={[styles.tripMode, meter.mode === 'moving' ? styles.modeMoving : styles.modeWaiting]}>
              {modeLabel}
            </Text>
          </View>
          <Pressable
            style={[styles.tripPauseBtn, meter.paused && styles.pauseBtnActive]}
            onPress={onPause}
          >
            <Text style={styles.tripPauseText}>{meter.paused ? 'RESUME' : 'PAUSE'}</Text>
          </Pressable>
        </View>
        <View style={styles.tripStatsRow}>
          <Text style={styles.tripStat}>{meter.distanceKm.toFixed(2)} km</Text>
          <Text style={styles.tripSep}>·</Text>
          <Text style={styles.tripStat}>wait {waitMin.toFixed(1)}m</Text>
          <Text style={styles.tripSep}>·</Text>
          <Text style={styles.tripStat}>trip {formatClock(tripMs)}</Text>
        </View>
        <View style={styles.tripStatsRow}>
          <Text style={styles.tripBreakdown}>Flag ${formatFareAmount(breakdown.flagFall)}</Text>
          <Text style={styles.tripSep}>·</Text>
          <Text style={styles.tripBreakdown}>Dist ${formatFareAmount(breakdown.distanceCharge)}</Text>
          <Text style={styles.tripSep}>·</Text>
          <Text style={styles.tripBreakdown}>Wait ${formatFareAmount(breakdown.waitingCharge)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.box, strip && styles.boxStrip]}>
      <View style={[styles.mainRow, strip && styles.mainRowStrip]}>
        <View style={styles.fareBlock}>
          <Text style={[styles.fare, strip && styles.fareStrip]}>${fareText}</Text>
          {tariffLabel ? <Text style={styles.tariffName}>{tariffLabel}</Text> : null}
          <Text style={[styles.mode, meter.mode === 'moving' ? styles.modeMoving : styles.modeWaiting]}>
            {modeLabel}
          </Text>
        </View>

        <View style={[styles.statsCol, strip && styles.statsColStrip]}>
          <View style={[styles.statsRow, strip && styles.statsRowStrip]}>
            <Text style={styles.statText}>{meter.distanceKm.toFixed(2)} km</Text>
            <Text style={styles.statSep}>·</Text>
            <Text style={styles.statText}>wait {waitMin.toFixed(1)}m</Text>
            <Text style={styles.statSep}>·</Text>
            <Text style={styles.statText}>{formatClock(tripMs)}</Text>
          </View>
          <View style={[styles.statsRow, strip && styles.statsRowStrip]}>
            <Text style={styles.statText}>Flag ${breakdown.flagFall.toFixed(2)}</Text>
            <Text style={styles.statSep}>·</Text>
            <Text style={styles.statText}>Dist ${breakdown.distanceCharge.toFixed(2)}</Text>
            <Text style={styles.statSep}>·</Text>
            <Text style={styles.statText}>Wait ${breakdown.waitingCharge.toFixed(2)}</Text>
          </View>
        </View>

        <Pressable
          style={[styles.pauseBtn, strip && styles.pauseBtnStrip, meter.paused && styles.pauseBtnActive]}
          onPress={onPause}
        >
          <Text style={styles.pauseText}>{meter.paused ? 'RESUME' : 'PAUSE'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tripBox: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  tripTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  tripFareCol: {
    flex: 1,
    minWidth: 0,
  },
  tripFare: {
    color: Colors.success,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  tripTariff: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  tripMode: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tripPauseBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    flexShrink: 0,
  },
  tripPauseText: {
    color: Colors.text,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  tripStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  tripStat: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  tripBreakdown: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  tripSep: {
    color: Colors.border,
    fontSize: 12,
  },
  box: {
    backgroundColor: Colors.surface + 'F0',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  boxStrip: {
    marginHorizontal: 0,
    marginBottom: 0,
    borderRadius: 0,
    borderWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.surface,
    alignItems: 'stretch',
  },
  mainRow: {
    alignItems: 'center',
    width: '100%',
  },
  mainRowStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fareBlock: {
    alignItems: 'center',
  },
  fare: {
    color: Colors.success,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
  },
  fareStrip: {
    fontSize: 22,
    lineHeight: 26,
  },
  tariffName: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
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
  statsCol: {
    gap: 2,
  },
  statsColStrip: {
    flex: 1,
    minWidth: 0,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 2,
    gap: 4,
  },
  statsRowStrip: {
    justifyContent: 'flex-start',
    marginTop: 0,
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
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 6,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 100,
    alignItems: 'center',
  },
  pauseBtnStrip: {
    marginTop: 0,
    flexShrink: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 72,
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
