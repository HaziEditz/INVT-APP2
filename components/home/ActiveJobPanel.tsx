import { Button } from '@/components/Button';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { STAGE_LABELS, JobStage } from '@/types';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

const STAGES: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];

export function ActiveJobPanel() {
  const {
    activeJob,
    meter,
    hailActive,
    advanceStage,
    completeJob,
    cancelActiveJob,
    noShowActiveJob,
    recallJob,
  } = useDriver();

  if (!activeJob) return null;

  const idx = STAGES.indexOf(activeJob.stage);
  const nextStage = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  const nextLabel = activeJob.stage === 'complete' ? 'Finish job' : STAGE_LABELS[nextStage];

  const onAdvance = async () => {
    if (activeJob.stage === 'complete') {
      await completeJob();
      return;
    }
    await advanceStage();
  };

  const runningMeter = !hailActive && activeJob.stage === 'onboard' && meter?.running;

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

      <JobTypeBadge type={activeJob.type} />
      <Text style={styles.addr} numberOfLines={2}>↑ {activeJob.pickup}</Text>
      <Text style={styles.addr} numberOfLines={2}>↓ {activeJob.dropoff}</Text>

      {activeJob.passengerName ? (
        <Text style={styles.detail}>{activeJob.passengerName} · {activeJob.passengerPhone ?? '—'}</Text>
      ) : null}
      {activeJob.paymentType ? <Text style={styles.detail}>Pay: {activeJob.paymentType}</Text> : null}
      {runningMeter && meter ? (
        <Text style={styles.meter}>Meter ${meter.fare.toFixed(2)} · {meter.distanceKm.toFixed(1)} km</Text>
      ) : null}
      {activeJob.notes ? <Text style={styles.notes}>{activeJob.notes}</Text> : null}
      {activeJob.dispatcherName ? <Text style={styles.detail}>Dispatch: {activeJob.dispatcherName}</Text> : null}

      <View style={styles.actions}>
        <Button title={nextLabel} onPress={onAdvance} />
        {activeJob.stage === 'pickup' || activeJob.stage === 'arrived' ? (
          <>
            <Button title="No Show" variant="secondary" onPress={noShowActiveJob} />
            <Button title="Cancel" variant="danger" onPress={() => {
              Alert.alert('Cancel job?', 'Dispatch will be notified.', [
                { text: 'Back', style: 'cancel' },
                { text: 'Cancel job', style: 'destructive', onPress: cancelActiveJob },
              ]);
            }} />
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
    maxHeight: 280,
  },
  stageScroll: { marginBottom: 8 },
  stageChip: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border, marginRight: 6 },
  dotOn: { backgroundColor: Colors.accent },
  stageText: { color: Colors.textMuted, fontSize: 13 },
  stageOn: { color: Colors.text, fontWeight: '700' },
  addr: { color: Colors.text, fontSize: 16, marginBottom: 6 },
  meter: { color: Colors.success, fontSize: 16, fontWeight: '700', marginTop: 4 },
  detail: { color: Colors.textMuted, fontSize: 12 },
  notes: { color: Colors.warning, fontSize: 12, marginTop: 4 },
  actions: { gap: 8, marginTop: 10 },
});
