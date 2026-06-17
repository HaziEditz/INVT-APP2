import { Button } from '@/components/Button';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { canOpenNavigation, showNavigationPicker } from '@/lib/navigation';
import { STAGE_LABELS, JobStage } from '@/types';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';

const STAGES: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];

function fmtTime(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function CurrentTripPanel() {
  const {
    shiftActive,
    activeJob,
    hailActive,
    hailPickupAddress,
    meter,
    advanceStage,
    cancelActiveJob,
    noShowActiveJob,
    recallJob,
    endTrip,
    startHail,
    completionBusy,
    completionError,
    clearCompletionError,
    nearPickup,
    tripOnTheWay,
  } = useDriver();

  const meterRunning = !!meter?.running;
  const showHailButton = shiftActive && !hailActive && !meterRunning && !activeJob;

  const onHailPress = () => {
    if (!shiftActive) {
      Alert.alert('Off shift', 'Start your shift from Profile or sign in again.');
      return;
    }
    Alert.alert('Start Hail Trip?', 'Begin a street hail trip with the meter running.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void startHail() },
    ]);
  };

  const confirmEndTrip = (onConfirm: () => void) => {
    Alert.alert(
      'Confirm End Trip?',
      'Are you sure you want to end this trip?',
      [{ text: 'Confirm', onPress: onConfirm }],
      { cancelable: false },
    );
  };

  if (hailActive) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>Street hail</Text>
        <Text style={styles.pickupFrom} numberOfLines={3}>
          Picked up from: {hailPickupAddress || 'Locating address…'}
        </Text>
        <Text style={styles.meta}>Started {fmtTime(meter?.startedAt)}</Text>
        {meterRunning ? (
          <Button
            title={completionBusy ? 'Ending…' : 'End Trip'}
            variant="danger"
            disabled={completionBusy}
            onPress={() => confirmEndTrip(() => void endTrip())}
          />
        ) : null}
        {completionError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{completionError}</Text>
            <Button title="Dismiss" variant="secondary" onPress={clearCompletionError} />
          </View>
        ) : null}
      </View>
    );
  }

  if (!activeJob) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No active trip.</Text>
        <Text style={styles.emptySub}>Use HAIL for street jobs or take an offer from the Offers tab.</Text>
        {showHailButton ? (
          <Pressable style={styles.hailBtn} onPress={onHailPress}>
            <Text style={styles.hailBtnText}>HAIL PASSENGER</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const idx = STAGES.indexOf(activeJob.stage);
  const nextStage = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  const nextLabel = STAGE_LABELS[nextStage];
  const st = activeJob.stepTimes;
  const preArrival =
    activeJob.stage === 'pickup' ||
    (!st.arrivedAt && !st.onboardAt && activeJob.stage !== 'onboard' && activeJob.stage !== 'complete');
  const postArrival =
    activeJob.stage === 'arrived' ||
    (!!st.arrivedAt && activeJob.stage !== 'onboard' && activeJob.stage !== 'complete');
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
  const navTitle = activeJob.stage === 'onboard' ? 'Navigate to drop-off' : 'Navigate to pickup';

  const onAdvance = async () => {
    if (nextStage === 'complete') {
      confirmEndTrip(() => void advanceStage());
      return;
    }
    await advanceStage();
  };

  const highlightArrived = activeJob.stage === 'pickup' && nearPickup;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!highlightArrived) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [highlightArrived, pulse]);

  const stageLabel = (s: JobStage) => {
    if (s === 'pickup') return tripOnTheWay ? 'On the way' : 'Accepted';
    return STAGE_LABELS[s];
  };

  return (
    <View style={styles.panelActive}>
      <ScrollView
        style={styles.detailsScroll}
        contentContainerStyle={styles.detailsContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageScroll}>
          {STAGES.map((s, i) => (
            <View key={s} style={styles.stageChip}>
              <View style={[styles.dot, i <= idx && styles.dotOn]} />
              <Text style={[styles.stageText, i <= idx && styles.stageOn]}>{stageLabel(s)}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.summaryRow}>
          <JobTypeBadge type={activeJob.type} />
          <Text style={styles.jobId}>Job #{activeJob.id}</Text>
        </View>
        <Text style={styles.addr} numberOfLines={2}>
          ↑ {activeJob.pickup}
        </Text>
        <Text style={styles.addr} numberOfLines={2}>
          ↓ {activeJob.dropoff}
        </Text>
        {activeJob.passengerName ? (
          <Text style={styles.meta} numberOfLines={1}>
            {activeJob.passengerName} · {activeJob.passengerPhone ?? '—'}
          </Text>
        ) : null}
        <JobNotesSection job={activeJob} compact />
      </ScrollView>

      <View style={styles.actionBar}>
        {meterRunning ? (
          <Button
            title={completionBusy ? 'Ending…' : 'End Trip'}
            variant="danger"
            disabled={completionBusy}
            compact
            onPress={() => confirmEndTrip(() => void endTrip())}
          />
        ) : (
          <Animated.View style={{ opacity: highlightArrived ? pulse : 1 }}>
            <Button
              title={completionBusy ? 'Please wait…' : nextLabel}
              onPress={onAdvance}
              disabled={completionBusy}
              compact
            />
          </Animated.View>
        )}

        <View style={styles.secondaryRow}>
          {canNavigate ? (
            <Button
              title="Navigate"
              variant="secondary"
              compact
              style={styles.secondaryBtn}
              onPress={() => showNavigationPicker(navTarget, navTitle)}
            />
          ) : null}
          {!meterRunning && preArrival ? (
            <Button
              title="Recall"
              variant="secondary"
              compact
              style={styles.secondaryBtn}
              onPress={() => {
                Alert.alert('Recall job?', 'Return this job to dispatch (before pickup arrival).', [
                  { text: 'Back', style: 'cancel' },
                  { text: 'Recall', onPress: recallJob },
                ]);
              }}
            />
          ) : null}
          {!meterRunning && postArrival ? (
            <>
              <Button
                title="No Show"
                variant="secondary"
                compact
                style={styles.secondaryBtn}
                onPress={noShowActiveJob}
              />
              <Button
                title="Cancel"
                variant="danger"
                compact
                style={styles.secondaryBtn}
                onPress={() => {
                  Alert.alert('Cancel job?', 'This permanently closes the job.', [
                    { text: 'Back', style: 'cancel' },
                    { text: 'Cancel job', style: 'destructive', onPress: cancelActiveJob },
                  ]);
                }}
              />
            </>
          ) : null}
        </View>

        {completionError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{completionError}</Text>
            <Button title="Dismiss" variant="secondary" compact onPress={clearCompletionError} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.surface,
    padding: 12,
  },
  panelActive: {
    flex: 1,
    backgroundColor: Colors.surface,
    minHeight: 0,
  },
  detailsScroll: {
    flex: 1,
    minHeight: 0,
  },
  detailsContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  actionBar: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  secondaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    minWidth: 96,
  },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  pickupFrom: { color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 8, lineHeight: 20 },
  empty: { padding: 20, alignItems: 'center', gap: 8 },
  emptyText: { color: Colors.textMuted, fontSize: 15, textAlign: 'center' },
  emptySub: { color: Colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' },
  hailBtn: {
    marginTop: 12,
    alignSelf: 'stretch',
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  hailBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  stageScroll: { marginBottom: 6, flexGrow: 0 },
  stageChip: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.border, marginRight: 5 },
  dotOn: { backgroundColor: Colors.accent },
  stageText: { color: Colors.textMuted, fontSize: 12 },
  stageOn: { color: Colors.text, fontWeight: '700' },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  jobId: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  addr: { color: Colors.text, fontSize: 14, lineHeight: 19, marginBottom: 2 },
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: 4 },
  errorBox: {
    backgroundColor: Colors.warning + '22',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.warning,
    gap: 8,
  },
  errorText: { color: Colors.warning, fontSize: 13, lineHeight: 18 },
});
