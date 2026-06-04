import { Button } from '@/components/Button';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { STAGE_LABELS, JobStage } from '@/types';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

const STAGES: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];

function fmtTime(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function rideMinutes(meter: { startedAt: number; finishedAt?: number }) {
  const end = meter.finishedAt ?? Date.now();
  return Math.max(0, Math.floor((end - meter.startedAt) / 60000));
}

function MeterBreakdownView({ meter }: { meter: NonNullable<ReturnType<typeof useDriver>['meter']> }) {
  const b = meter.breakdown;
  const modeLabel = meter.paused ? 'PAUSED' : meter.mode === 'moving' ? 'MOVING' : 'WAITING';
  const modeStyle = meter.paused
    ? styles.modePaused
    : meter.mode === 'moving'
      ? styles.modeMoving
      : styles.modeWaiting;

  return (
    <View style={styles.meterBox}>
      <Text style={[styles.modeBadge, modeStyle]}>{modeLabel}</Text>
      <Text style={styles.meterFare}>${meter.fare.toFixed(2)}</Text>
      <Text style={styles.breakdown}>
        Flag ${b.flagFall.toFixed(2)} + Dist ${b.distanceCharge.toFixed(2)} + Wait $
        {b.waitingCharge.toFixed(2)} = ${b.total.toFixed(2)}
      </Text>
      <Text style={styles.meta}>
        {meter.distanceKm.toFixed(1)} km · wait {(meter.waitingMs / 60000).toFixed(0)} min · pause{' '}
        {(meter.pausedMs / 60000).toFixed(0)} min · trip {rideMinutes(meter)} min
      </Text>
    </View>
  );
}

export function CurrentTripPanel() {
  const {
    activeJob,
    hailActive,
    meter,
    advanceStage,
    completeJob,
    cancelActiveJob,
    noShowActiveJob,
    recallJob,
    pauseMeter,
    endHail,
  } = useDriver();

  if (hailActive && meter) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>Street hail</Text>
        <Text style={styles.meta}>Start {fmtTime(meter.startedAt)}</Text>
        {meter.finishedAt ? <Text style={styles.meta}>Finish {fmtTime(meter.finishedAt)}</Text> : null}
        <MeterBreakdownView meter={meter} />
        <View style={styles.actions}>
          <Button title={meter.paused ? 'Resume' : 'Pause'} variant="secondary" onPress={pauseMeter} />
          <Button title="End hail trip" variant="danger" onPress={endHail} />
        </View>
      </View>
    );
  }

  if (!activeJob) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No active trip.</Text>
        <Text style={styles.emptySub}>Use HAIL for street jobs or take an offer from the Offers tab.</Text>
      </View>
    );
  }

  const idx = STAGES.indexOf(activeJob.stage);
  const nextStage = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  const nextLabel = activeJob.stage === 'complete' ? 'Finish job' : STAGE_LABELS[nextStage];
  const runningMeter = activeJob.stage === 'onboard' && meter?.running;
  const st = activeJob.stepTimes;

  const onAdvance = async () => {
    if (activeJob.stage === 'complete') {
      await completeJob();
      return;
    }
    await advanceStage();
  };

  return (
    <ScrollView style={styles.panel} nestedScrollEnabled showsVerticalScrollIndicator={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageScroll}>
        {STAGES.map((s, i) => (
          <View key={s} style={styles.stageChip}>
            <View style={[styles.dot, i <= idx && styles.dotOn]} />
            <Text style={[styles.stageText, i <= idx && styles.stageOn]}>{STAGE_LABELS[s]}</Text>
          </View>
        ))}
      </ScrollView>

      <Text style={styles.times}>
        Accepted {fmtTime(st.acceptedAt)} · Arrived {fmtTime(st.arrivedAt)} · On board {fmtTime(st.onboardAt)}{' '}
        · Done {fmtTime(st.completeAt)}
      </Text>

      <JobTypeBadge type={activeJob.type} />
      <Text style={styles.addr} numberOfLines={2}>
        ↑ {activeJob.pickup}
      </Text>
      <Text style={styles.addr} numberOfLines={2}>
        ↓ {activeJob.dropoff}
      </Text>
      {activeJob.passengerName ? (
        <Text style={styles.meta}>
          {activeJob.passengerName} · {activeJob.passengerPhone ?? '—'}
        </Text>
      ) : null}
      <JobNotesSection job={activeJob} compact />
      {runningMeter && meter ? (
        <View style={styles.meterWrap}>
          <MeterBreakdownView meter={meter} />
          <Button title={meter.paused ? 'Resume' : 'Pause'} variant="secondary" onPress={pauseMeter} />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title={nextLabel} onPress={onAdvance} />
        {activeJob.stage === 'pickup' || activeJob.stage === 'arrived' ? (
          <>
            <Button title="No Show" variant="secondary" onPress={noShowActiveJob} />
            <Button
              title="Cancel"
              variant="danger"
              onPress={() => {
                Alert.alert('Cancel job?', 'Dispatch will be notified.', [
                  { text: 'Back', style: 'cancel' },
                  { text: 'Cancel job', style: 'destructive', onPress: cancelActiveJob },
                ]);
              }}
            />
          </>
        ) : null}
        {idx > 0 && idx < STAGES.length - 1 ? (
          <Button title="Recall" variant="secondary" onPress={recallJob} />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    padding: 12,
    maxHeight: 320,
  },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  meterBox: { marginTop: 6 },
  modeBadge: { fontSize: 12, fontWeight: '800', alignSelf: 'flex-start', marginBottom: 4 },
  modeMoving: { color: Colors.success },
  modeWaiting: { color: Colors.warning },
  modePaused: { color: Colors.textMuted },
  meterFare: { color: Colors.success, fontSize: 28, fontWeight: '800' },
  breakdown: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  empty: { padding: 20, alignItems: 'center' },
  emptyText: { color: Colors.textMuted, fontSize: 15, textAlign: 'center' },
  emptySub: { color: Colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' },
  stageScroll: { marginBottom: 8 },
  stageChip: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border, marginRight: 6 },
  dotOn: { backgroundColor: Colors.accent },
  stageText: { color: Colors.textMuted, fontSize: 13 },
  stageOn: { color: Colors.text, fontWeight: '700' },
  times: { color: Colors.textMuted, fontSize: 11, marginBottom: 8 },
  addr: { color: Colors.text, fontSize: 16, marginBottom: 6 },
  meta: { color: Colors.textMuted, fontSize: 12 },
  meterWrap: { marginTop: 6, gap: 8 },
  actions: { gap: 8, marginTop: 10 },
});
