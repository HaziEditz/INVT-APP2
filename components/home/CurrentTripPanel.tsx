import { Button } from '@/components/Button';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { canOpenNavigation, showNavigationPicker } from '@/lib/navigation';
import { STAGE_LABELS, JobStage } from '@/types';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

const STAGES: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];

function fmtTime(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function CurrentTripPanel() {
  const {
    activeJob,
    hailActive,
    hailPickupAddress,
    meter,
    advanceStage,
    cancelActiveJob,
    noShowActiveJob,
    recallJob,
    endTrip,
  } = useDriver();

  const meterRunning = !!meter?.running;

  if (hailActive) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>Street hail</Text>
        <Text style={styles.pickupFrom} numberOfLines={3}>
          Picked up from: {hailPickupAddress || 'Locating address…'}
        </Text>
        <Text style={styles.meta}>Started {fmtTime(meter?.startedAt)}</Text>
        {meterRunning ? (
          <Button title="End Trip" variant="danger" onPress={() => void endTrip()} />
        ) : null}
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
  const nextLabel = STAGE_LABELS[nextStage];
  const st = activeJob.stepTimes;
  const navTarget =
    activeJob.stage === 'onboard' || activeJob.stage === 'complete'
      ? {
          lat: activeJob.dropoffLat,
          lng: activeJob.dropoffLng,
          label: activeJob.dropoff,
        }
      : {
          lat: activeJob.pickupLat,
          lng: activeJob.pickupLng,
          label: activeJob.pickup,
        };
  const canNavigate = canOpenNavigation(navTarget);

  const onAdvance = async () => {
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
        Accepted {fmtTime(st.acceptedAt)} · Arrived {fmtTime(st.arrivedAt)} · On board {fmtTime(st.onboardAt)} · Done{' '}
        {fmtTime(st.completeAt)}
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

      <View style={styles.actions}>
        {canNavigate ? (
          <Button
            title="Navigate"
            variant="secondary"
            onPress={() =>
              showNavigationPicker(
                navTarget,
                activeJob.stage === 'onboard' ? 'Navigate to drop-off' : 'Navigate to pickup',
              )
            }
          />
        ) : null}
        {meterRunning ? (
          <Button title="End Trip" variant="danger" onPress={() => void endTrip()} />
        ) : (
          <Button title={nextLabel} onPress={onAdvance} />
        )}
        {!meterRunning && (activeJob.stage === 'pickup' || activeJob.stage === 'arrived') ? (
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
        {!meterRunning && idx > 0 && idx < STAGES.length - 1 ? (
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
  pickupFrom: { color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 8, lineHeight: 20 },
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
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 4 },
  actions: { gap: 8, marginTop: 10 },
});
