import { Button } from '@/components/Button';
import { JobDispatchMetaSection } from '@/components/JobDispatchMetaSection';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { canOpenNavigation, showNavigationPicker } from '@/lib/navigation';
import { formatFareAmount, parseFiniteFare } from '@/lib/tariffs';
import { STAGE_LABELS, JobStage } from '@/types';
import { Alert, Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';

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
    completionBusy,
    completionError,
    clearCompletionError,
    nearPickup,
    tripOnTheWay,
  } = useDriver();

  const meterRunning = !!meter?.running;
  const highlightArrived = activeJob?.stage === 'pickup' && nearPickup;
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

  const confirmEndTrip = (onConfirm: () => void) => {
    Alert.alert(
      'Confirm End Trip?',
      'Are you sure you want to end this trip?',
      [{ text: 'Confirm', onPress: onConfirm }],
      { cancelable: false },
    );
  };

  /** Hail is registering with dispatch — no activeJob yet. */
  if (hailActive && !activeJob) {
    return (
      <View style={styles.panelActive}>
        <ScrollView
          style={styles.detailsScroll}
          contentContainerStyle={styles.detailsContent}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          <Text style={styles.title}>Street hail</Text>
          <Text style={styles.metaLine}>Setting up trip on dispatch…</Text>
          <Text style={styles.pickupFrom} numberOfLines={3}>
            Picked up from: {hailPickupAddress || 'Locating address…'}
          </Text>
        </ScrollView>
        {meterRunning ? (
          <View style={styles.actionBar}>
            <Button
              title={completionBusy ? 'Ending…' : 'End Trip'}
              variant="danger"
              disabled={completionBusy}
              compact
              onPress={() => confirmEndTrip(() => void endTrip())}
            />
            {completionError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText} selectable>
                  {completionError}
                </Text>
                <Button title="Dismiss" variant="secondary" compact onPress={clearCompletionError} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  if (!activeJob) {
    // Idle Current UI is IdleCurrentSection in index.tsx — not rendered here when !hasCurrent.
    return null;
  }

  const isHailTrip = hailActive || activeJob.source === 'hail';
  const idx = STAGES.indexOf(activeJob.stage);
  const nextStage = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  const nextLabel = STAGE_LABELS[nextStage];
  const st = activeJob.stepTimes;
  const showEndTrip =
    isHailTrip ||
    meterRunning ||
    activeJob.stage === 'onboard' ||
    !!st.onboardAt ||
    !!st.hailStartedAt;
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
  const estFare =
    parseFiniteFare(activeJob.fixedFare) ??
    parseFiniteFare(activeJob.estimatedFare) ??
    (activeJob.fare > 0 ? parseFiniteFare(activeJob.fare) : undefined);
  const showDropoff = !!activeJob.dropoff?.trim() && activeJob.dropoff.trim() !== activeJob.pickup?.trim();

  const onAdvance = async () => {
    if (nextStage === 'complete') {
      confirmEndTrip(() => void advanceStage());
      return;
    }
    await advanceStage();
  };

  const stageLabel = (s: JobStage) => {
    if (s === 'pickup') return tripOnTheWay ? 'On the way' : 'Accepted';
    return STAGE_LABELS[s];
  };

  return (
    <View style={styles.panelActive}>
      <ScrollView
        style={styles.detailsScroll}
        contentContainerStyle={styles.detailsContent}
        showsVerticalScrollIndicator
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

        {isHailTrip ? (
          <>
            <Text style={styles.hailTitle}>Street hail</Text>
            <Text style={styles.pickupFrom} numberOfLines={3}>
              Picked up from: {hailPickupAddress || activeJob.pickup || 'Current location'}
            </Text>
            {meter?.startedAt ? (
              <Text style={styles.metaLine}>Started {fmtTime(meter.startedAt)}</Text>
            ) : null}
          </>
        ) : null}

        {estFare != null ? (
          <Text style={styles.fareEst}>Est. fare ${formatFareAmount(estFare)}</Text>
        ) : null}
        {activeJob.estimatedDistanceKm != null ? (
          <Text style={styles.metaLine}>Est. distance {activeJob.estimatedDistanceKm.toFixed(1)} km</Text>
        ) : null}
        {activeJob.isTotalMobility ? (
          <Text style={styles.metaLine}>
            Total Mobility
            {activeJob.tmCardNumber ? ` · card ${activeJob.tmCardNumber}` : ""}
            {activeJob.paymentType ? ` · remainder ${activeJob.paymentType}` : ""}
          </Text>
        ) : activeJob.paymentType ? (
          <Text style={styles.metaLine}>
            Payment: {activeJob.paymentType}
            {activeJob.isPrePaid ||
            String(activeJob.paymentStatus || "").toLowerCase() === "paid"
              ? " (paid)"
              : ""}
          </Text>
        ) : null}

        <JobDispatchMetaSection job={activeJob} compact />

        <View style={styles.addrBlock}>
          <Text style={styles.addrLabel}>Pickup</Text>
          <Text style={styles.addr} numberOfLines={3}>
            {activeJob.pickup}
          </Text>
        </View>
        {showDropoff ? (
          <View style={styles.addrBlock}>
            <Text style={styles.addrLabel}>Dropoff</Text>
            <Text style={styles.addr} numberOfLines={3}>
              {activeJob.dropoff}
            </Text>
          </View>
        ) : null}

        {activeJob.passengerName ? (
          <Text style={styles.metaLine} numberOfLines={2}>
            Passenger: {activeJob.passengerName}
            {activeJob.passengerPhone ? ` · ${activeJob.passengerPhone}` : ''}
          </Text>
        ) : null}
        {activeJob.passengerEmail ? (
          <Text style={styles.metaLine} numberOfLines={1}>
            Email: {activeJob.passengerEmail}
          </Text>
        ) : null}
        {activeJob.passengers != null ? (
          <Text style={styles.metaLine}>Passengers: {activeJob.passengers}</Text>
        ) : null}
        {activeJob.dispatcherName ? (
          <Text style={styles.metaLine}>Assigned by: {activeJob.dispatcherName}</Text>
        ) : null}

        <JobNotesSection job={activeJob} compact />
      </ScrollView>

      <View style={styles.actionBar}>
        {showEndTrip ? (
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
          {!showEndTrip && !isHailTrip && preArrival ? (
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
          {!showEndTrip && !isHailTrip && postArrival ? (
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
            <Text style={styles.errorText} selectable>
              {completionError}
            </Text>
            <Button title="Dismiss" variant="secondary" compact onPress={clearCompletionError} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
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
    backgroundColor: Colors.surface,
  },
  detailsContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 4,
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
  hailTitle: { color: Colors.accent, fontSize: 16, fontWeight: '800', marginTop: 4 },
  pickupFrom: { color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 8, lineHeight: 20 },
  stageScroll: { marginBottom: 8, flexGrow: 0 },
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
  fareEst: {
    color: Colors.success,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  metaLine: { color: Colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 2 },
  addrBlock: { marginTop: 6, marginBottom: 2 },
  addrLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  addr: { color: Colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' },
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
