import { Button } from '@/components/Button';
import { JobDispatchMetaSection } from '@/components/JobDispatchMetaSection';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { canOpenNavigation, showNavigationPicker } from '@/lib/navigation';
import { formatFareAmount, parseFiniteFare } from '@/lib/tariffs';
import { STAGE_LABELS, JobStage } from '@/types';
import { Alert, Animated, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';

const STAGES: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];

function fmtTime(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function useCountdown(deadlineIso?: string) {
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    if (!deadlineIso) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const d = Date.parse(deadlineIso);
      setRemainingMs(Number.isFinite(d) ? Math.max(0, d - Date.now()) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineIso]);
  return remainingMs;
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
    verifyPickupForActiveJob,
    recallWrongPassenger,
    forkWalkUpHailFromWrongPassenger,
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
  const [nameOk, setNameOk] = useState(false);
  const [pinOk, setPinOk] = useState(false);
  const deadlineIso = useMemo(() => {
    if (!activeJob) return undefined;
    if (activeJob.noShowDeadlineAt) return activeJob.noShowDeadlineAt;
    const arrivedMs = activeJob.stepTimes?.arrivedAt;
    if (!arrivedMs) return undefined;
    const base = arrivedMs + 5 * 60 * 1000;
    const ext = activeJob.imComingAt ? 5 * 60 * 1000 : 0;
    return new Date(base + ext).toISOString();
  }, [activeJob?.noShowDeadlineAt, activeJob?.imComingAt, activeJob?.stepTimes?.arrivedAt, activeJob?.id]);
  const postArrivalForCountdown =
    !!activeJob &&
    (activeJob.stage === 'arrived' ||
      (!!activeJob.stepTimes?.arrivedAt &&
        activeJob.stage !== 'onboard' &&
        activeJob.stage !== 'complete'));
  const remainingMs = useCountdown(postArrivalForCountdown ? deadlineIso : undefined);

  useEffect(() => {
    setNameOk(false);
    setPinOk(false);
  }, [activeJob?.id, activeJob?.stage]);

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
  const needsPickupVerify =
    !isHailTrip &&
    postArrival &&
    (!!activeJob.pickupPin ||
      /passenger/i.test(String(activeJob.bookingSource || activeJob.source || '')));
  const pickupVerified = !!activeJob.pickupVerifiedAt;
  const canNoShow = postArrival && remainingMs <= 0;

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
    if (nextStage === 'onboard' && needsPickupVerify && !pickupVerified) {
      Alert.alert(
        'Verify passenger first',
        'Confirm PIN match, then name match, then lock — the verify box is above the action buttons.',
      );
      return;
    }
    await advanceStage();
  };

  const onConfirmVerify = async () => {
    if (!nameOk || !pinOk) {
      Alert.alert(
        'Both checks required',
        'Confirm PIN match first, then name match. Both must be ticked before locking.',
      );
      return;
    }
    const ok = await verifyPickupForActiveJob();
    if (ok) {
      Alert.alert('Verified', 'You can mark On Board now.');
    }
  };

  const callPassenger = () => {
    const phone = String(activeJob.passengerPhone || '').trim();
    if (!phone) {
      Alert.alert('No phone number', 'This booking has no passenger phone on file.');
      return;
    }
    const digits = phone.replace(/[^\d+]/g, '');
    void Linking.openURL(`tel:${digits}`);
  };

  const stageLabel = (s: JobStage) => {
    if (s === 'pickup') return tripOnTheWay ? 'On the way' : 'Accepted';
    return STAGE_LABELS[s];
  };

  const remainLabel =
    remainingMs > 0
      ? `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
      : 'Ready';

  const compactOnboard =
    activeJob.stage === 'onboard' ||
    (!!st.onboardAt && activeJob.stage !== 'complete');
  const showVerifySticky = needsPickupVerify && !pickupVerified;

  return (
    <View style={styles.panelActive}>
      <ScrollView
        style={styles.detailsScroll}
        contentContainerStyle={styles.detailsContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        {!compactOnboard ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageScroll}>
            {STAGES.map((s, i) => (
              <View key={s} style={styles.stageChip}>
                <View style={[styles.dot, i <= idx && styles.dotOn]} />
                <Text style={[styles.stageText, i <= idx && styles.stageOn]}>{stageLabel(s)}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.metaLine}>On board · Job #{activeJob.id}</Text>
        )}

        {!compactOnboard ? (
          <View style={styles.summaryRow}>
            <JobTypeBadge type={activeJob.type} />
            <Text style={styles.jobId}>Job #{activeJob.id}</Text>
          </View>
        ) : null}

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
        {!compactOnboard && activeJob.estimatedDistanceKm != null ? (
          <Text style={styles.metaLine}>Est. distance {activeJob.estimatedDistanceKm.toFixed(1)} km</Text>
        ) : null}

        {!compactOnboard && activeJob.isTotalMobility ? (
          <Text style={styles.metaLine}>
            Total Mobility
            {activeJob.tmCardNumber ? ` · card ${activeJob.tmCardNumber}` : ''}
            {activeJob.paymentType ? ` · remainder ${activeJob.paymentType}` : ''}
          </Text>
        ) : !compactOnboard && activeJob.paymentType ? (
          <Text style={styles.metaLine}>
            Payment: {activeJob.paymentType}
            {activeJob.isPrePaid ||
            String(activeJob.paymentStatus || '').toLowerCase() === 'paid'
              ? ' (paid)'
              : ''}
          </Text>
        ) : null}

        {!compactOnboard ? <JobDispatchMetaSection job={activeJob} compact /> : null}

        {compactOnboard ? (
          <View style={styles.addrBlock}>
            <Text style={styles.addr} numberOfLines={2}>
              {activeJob.pickup?.split(',')[0] || 'Pickup'} →{' '}
              {showDropoff ? activeJob.dropoff?.split(',')[0] || 'Dropoff' : '—'}
            </Text>
          </View>
        ) : (
          <>
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
          </>
        )}

        {activeJob.passengerName ? (
          <Text style={styles.metaLine} numberOfLines={2}>
            Passenger: {activeJob.passengerName}
          </Text>
        ) : null}
        {activeJob.passengerPhone ? (
          <View style={styles.phoneRow}>
            <Text style={styles.metaLine} numberOfLines={1}>
              {activeJob.passengerPhone}
            </Text>
            <Button title="Call" variant="secondary" compact onPress={callPassenger} />
          </View>
        ) : null}
        {!compactOnboard && activeJob.passengerEmail ? (
          <Text style={styles.metaLine} numberOfLines={1}>
            Email: {activeJob.passengerEmail}
          </Text>
        ) : null}
        {!compactOnboard && activeJob.passengers != null ? (
          <Text style={styles.metaLine}>Passengers: {activeJob.passengers}</Text>
        ) : null}
        {!compactOnboard && activeJob.dispatcherName ? (
          <Text style={styles.metaLine}>Assigned by: {activeJob.dispatcherName}</Text>
        ) : null}

        {needsPickupVerify && pickupVerified ? (
          <Text style={styles.verified}>Verified — On Board unlocked</Text>
        ) : null}

        {postArrival && !isHailTrip ? (
          <Text style={styles.metaLine}>
            No-show countdown: {remainLabel}
            {activeJob.imComingAt ? ' (passenger said I’m coming)' : ''}
          </Text>
        ) : null}

        {!compactOnboard ? <JobNotesSection job={activeJob} compact /> : null}
      </ScrollView>

      {showVerifySticky ? (
        <View style={styles.verifySticky}>
          <Text style={styles.verifyTitle}>Pickup verification</Text>
          <Text style={styles.verifyHint}>
            Step 1: confirm PIN · Step 2: confirm name · then lock. Both must match the passenger verbally.
          </Text>
          <Text style={styles.verifyPin}>PIN: {activeJob.pickupPin || '—'}</Text>
          <Text style={styles.verifyName}>Name: {activeJob.passengerName || '—'}</Text>
          {!pinOk ? (
            <Button
              title="Step 1 — Confirm: PIN matches"
              compact
              onPress={() => setPinOk(true)}
            />
          ) : !nameOk ? (
            <Button
              title="Step 2 — Confirm: name matches"
              compact
              onPress={() => setNameOk(true)}
            />
          ) : (
            <Button
              title={completionBusy ? 'Saving…' : 'Lock in — unlock On Board'}
              disabled={completionBusy}
              compact
              onPress={() => void onConfirmVerify()}
            />
          )}
          {pinOk && nameOk ? null : (
            <Text style={styles.verifyHint}>
              {pinOk ? 'PIN confirmed · now confirm name' : 'Confirm PIN first'}
            </Text>
          )}
        </View>
      ) : null}

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
              title={
                completionBusy
                  ? 'Please wait…'
                  : nextStage === 'onboard' && needsPickupVerify && !pickupVerified
                    ? 'Verify passenger first'
                    : nextLabel
              }
              onPress={onAdvance}
              disabled={
                completionBusy ||
                (nextStage === 'onboard' && needsPickupVerify && !pickupVerified)
              }
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
                title="Wrong passenger"
                variant="secondary"
                compact
                style={styles.secondaryBtn}
                onPress={() => {
                  Alert.alert(
                    'Wrong / uninvited passenger?',
                    'Return the booked job to the pool so the real passenger gets another driver.',
                    [
                      { text: 'Back', style: 'cancel' },
                      { text: 'Return to pool', onPress: () => void recallWrongPassenger() },
                    ],
                  );
                }}
              />
              <Button
                title="Walk-up hail"
                variant="secondary"
                compact
                style={styles.secondaryBtn}
                onPress={() => {
                  Alert.alert(
                    'Start walk-up fare?',
                    'Returns the booked job to the pool, then starts a new hail for the person in the cab.',
                    [
                      { text: 'Back', style: 'cancel' },
                      {
                        text: 'Start hail',
                        onPress: () => void forkWalkUpHailFromWrongPassenger(),
                      },
                    ],
                  );
                }}
              />
              <Button
                title={canNoShow ? 'No Show' : `No Show (${remainLabel})`}
                variant="secondary"
                compact
                disabled={!canNoShow || completionBusy}
                style={styles.secondaryBtn}
                onPress={() => {
                  Alert.alert(
                    'Mark No Show?',
                    'Closes this booking. Waiting time is charged at the waiting rate.',
                    [
                      { text: 'Back', style: 'cancel' },
                      { text: 'No Show', style: 'destructive', onPress: () => void noShowActiveJob() },
                    ],
                  );
                }}
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
  },
  detailsContent: {
    padding: 12,
    paddingBottom: 8,
    gap: 8,
  },
  stageScroll: { marginBottom: 4 },
  stageChip: { flexDirection: 'row', alignItems: 'center', marginRight: 12, gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotOn: { backgroundColor: Colors.primary },
  stageText: { fontSize: 12, color: Colors.textMuted },
  stageOn: { color: Colors.text, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobId: { fontSize: 14, fontWeight: '600', color: Colors.text },
  hailTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  pickupFrom: { fontSize: 14, color: Colors.text },
  fareEst: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  metaLine: { fontSize: 13, color: Colors.textMuted },
  addrBlock: { gap: 2 },
  addrLabel: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase' },
  addr: { fontSize: 15, color: Colors.text },
  verifyBox: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    padding: 10,
    gap: 8,
    backgroundColor: Colors.surface,
  },
  verifySticky: {
    borderTopWidth: 2,
    borderTopColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: Colors.surface,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  verifyTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  verifyHint: { fontSize: 12, color: Colors.textMuted },
  verifyName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  verifyPin: { fontSize: 20, fontWeight: '800', letterSpacing: 3, color: Colors.primary },
  verified: { fontSize: 13, fontWeight: '600', color: Colors.success || '#16a34a' },
  actionBar: { padding: 10, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8 },
  secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secondaryBtn: { flexGrow: 1, minWidth: '40%' },
  errorBox: { gap: 6 },
  errorText: { fontSize: 12, color: Colors.danger || '#b91c1c' },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
});
