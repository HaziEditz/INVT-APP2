import { Button } from '@/components/Button';
import { JobDispatchMetaSection } from '@/components/JobDispatchMetaSection';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { canOpenNavigation, showNavigationPicker } from '@/lib/navigation';
import { formatFareAmount, parseFiniteFare } from '@/lib/tariffs';
import { STAGE_LABELS, JobStage } from '@/types';
import {
  Alert,
  Animated,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
  // Default minimized so Expand never buries the action bar under a full-screen overlay.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  /** Prepaid Arrived sheet: false = bottom sheet over map; true = full screen. */
  const [prepaidSheetExpanded, setPrepaidSheetExpanded] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
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
    !activeJob.pickupVerifiedAt &&
    (activeJob.stage === 'arrived' ||
      (!!activeJob.stepTimes?.arrivedAt &&
        activeJob.stage !== 'onboard' &&
        activeJob.stage !== 'complete'));
  const remainingMs = useCountdown(postArrivalForCountdown ? deadlineIso : undefined);

  useEffect(() => {
    setNameOk(false);
    setPinOk(false);
  }, [activeJob?.id, activeJob?.stage]);

  // Collapse details only for prepaid Arrived (same gate as the verify sticky).
  // Do not require pickupPin — Website jobs often receive PIN a beat late.
  // Dispatch Console desk bookings never enter the PIN / wrong-pax / no-show group.
  const payRawEarly = String(activeJob?.paymentType || '').toLowerCase();
  const srcRawEarly = String(activeJob?.bookingSource || activeJob?.source || '').toLowerCase();
  const isDispatchCreatedEarly =
    /dispatch|desk/.test(srcRawEarly) && !/passenger|website/.test(srcRawEarly);
  const isPrepaidEarly = !!(
    activeJob &&
    (activeJob.isPrePaid ||
      String(activeJob.paymentStatus || '').toLowerCase() === 'paid' ||
      activeJob.isAcc ||
      /card|stripe|account|acc\b|tm/.test(payRawEarly) ||
      !!activeJob.isTotalMobility)
  );
  const needsPickupVerifyEarly =
    !!activeJob &&
    isPrepaidEarly &&
    !isDispatchCreatedEarly &&
    !activeJob.pickupVerifiedAt &&
    (activeJob.stage === 'arrived' ||
      (!!activeJob.stepTimes?.arrivedAt &&
        activeJob.stage !== 'onboard' &&
        activeJob.stage !== 'complete'));
  const showVerifyStickyEarly = !!needsPickupVerifyEarly;

  useEffect(() => {
    if (showVerifyStickyEarly) {
      setDetailsExpanded(false);
      setPrepaidSheetExpanded(false);
    }
  }, [showVerifyStickyEarly, activeJob?.id]);

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
  // Track-only GPS (fixed/prepaid) sets meter.running before On Board — that must
  // NOT flip this to End Trip or the prepaid Arrived group (PIN/wrong/walk-up/
  // call/no-show) is gated off while only the verify sticky remains visible.
  const trackOnlyPreOnboard =
    !!meter?.trackOnly &&
    activeJob.stage !== 'onboard' &&
    !st.onboardAt;
  const showEndTrip =
    isHailTrip ||
    (!!meterRunning && !trackOnlyPreOnboard) ||
    activeJob.stage === 'onboard' ||
    !!st.onboardAt ||
    !!st.hailStartedAt;
  const preArrival =
    activeJob.stage === 'pickup' ||
    (!st.arrivedAt && !st.onboardAt && activeJob.stage !== 'onboard' && activeJob.stage !== 'complete');
  const postArrival =
    activeJob.stage === 'arrived' ||
    (!!st.arrivedAt && activeJob.stage !== 'onboard' && activeJob.stage !== 'complete');
  // Prepaid Arrived group (PIN / wrong-passenger / no-show / walk-up) — Card,
  // Account, ACC, TM remainder — Website + Passenger App only. Dispatch Console
  // desk bookings are excluded (passenger cannot see a PIN on a phone booking).
  const payRaw = String(activeJob.paymentType || '').toLowerCase();
  const srcRaw = String(activeJob.bookingSource || activeJob.source || '').toLowerCase();
  const isDispatchCreatedBooking =
    /dispatch|desk/.test(srcRaw) && !/passenger|website/.test(srcRaw);
  const isPrepaidUpfront = !!(
    activeJob.isPrePaid ||
    String(activeJob.paymentStatus || '').toLowerCase() === 'paid' ||
    activeJob.isAcc ||
    /card|stripe|account|acc\b|tm/.test(payRaw) ||
    !!activeJob.isTotalMobility
  );
  const needsPickupVerify =
    !isHailTrip && postArrival && isPrepaidUpfront && !isDispatchCreatedBooking;
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
        'Confirm PIN and name with the passenger using the verify box above the action buttons.',
      );
      return;
    }
    await advanceStage();
  };

  const onConfirmVerify = async () => {
    setPinOk(true);
    setNameOk(true);
    const ok = await verifyPickupForActiveJob();
    if (ok) {
      Alert.alert('Verified', 'You can mark On Board now.');
    }
  };

  /** Native dial/SMS only — does not navigate the app away from this trip screen. */
  const openNativeContact = async (scheme: 'tel' | 'sms') => {
    const phone = String(activeJob.passengerPhone || '').trim();
    if (!phone) {
      Alert.alert('No phone number', 'This booking has no passenger phone on file.');
      return;
    }
    const digits = phone.replace(/[^\d+]/g, '');
    if (!digits) {
      Alert.alert('No phone number', 'This booking has no usable passenger phone on file.');
      return;
    }
    const url = `${scheme}:${digits}`;
    try {
      // iOS canOpenURL needs Info.plist queries; Android often returns false for tel/sms.
      // Prefer attempting the native handoff — app stays on this trip screen when returning.
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        scheme === 'tel' ? 'Cannot place call' : 'Cannot open messages',
        'Try again from the phone dialer or messages app.',
      );
    }
  };
  const callPassenger = () => {
    void openNativeContact('tel');
  };
  const textPassenger = () => {
    void openNativeContact('sms');
  };

  const stageLabel = (s: JobStage) => {
    if (s === 'pickup') return tripOnTheWay ? 'On the way' : 'Accepted';
    return STAGE_LABELS[s];
  };

  const remainLabel =
    remainingMs > 0
      ? `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
      : 'Ready';

  const isOnBoard =
    activeJob.stage === 'onboard' ||
    (!!st.onboardAt && activeJob.stage !== 'complete');
  // Prepaid Arrived group: ALL FIVE live in one bottom sheet over the map
  // (PIN+name, call/text, wrong-passenger, walk-up hail, no-show). Expand → full
  // screen; Minimize → smaller sheet. PIN confirm hides the whole sheet.
  // Dispatch Console desk bookings are excluded (no passenger-visible PIN).
  const showPrepaidArrivedGroup =
    !isHailTrip &&
    postArrival &&
    !pickupVerified &&
    isPrepaidUpfront &&
    !isDispatchCreatedBooking;
  const showVerifySticky = showPrepaidArrivedGroup;
  const showWrongPassengerActions = showPrepaidArrivedGroup;
  const showCallText =
    activeJob.stage !== 'complete' &&
    activeJob.stage !== 'onboard' &&
    !st.onboardAt &&
    !(isPrepaidUpfront && !isDispatchCreatedBooking && postArrival && pickupVerified);

  const routeOneLiner = [
    (activeJob.pickup || 'Pickup').split(',')[0],
    ...((activeJob.stops ?? []).map((s) => s.address.split(',')[0])),
    showDropoff ? (activeJob.dropoff || 'Dropoff').split(',')[0] : isOnBoard ? '—' : null,
  ]
    .filter(Boolean)
    .join(' → ');

  const prepaidSheetBody = (
    <>
      <Text style={styles.verifyHint}>
        Confirm PIN and name with the passenger. Call/text, wrong-passenger, walk-up
        hail, and no-show stay here until you confirm — then this whole group hides.
      </Text>
      <Text style={styles.verifyPin}>
        PIN:{' '}
        {activeJob.pickupPin && String(activeJob.pickupPin).trim()
          ? String(activeJob.pickupPin).trim()
          : '…'}
      </Text>
      <Text style={styles.verifyName}>Name: {activeJob.passengerName || '—'}</Text>

      {showCallText ? (
        <View style={styles.phoneRow}>
          <Button title="Call passenger" compact style={styles.secondaryBtn} onPress={callPassenger} />
          <Button
            title="Text"
            variant="secondary"
            compact
            style={styles.secondaryBtn}
            onPress={textPassenger}
          />
        </View>
      ) : null}

      <Text style={styles.metaLine}>
        No-show countdown: {remainLabel}
        {activeJob.imComingAt ? ' (passenger said I’m coming)' : ''}
      </Text>

      {showWrongPassengerActions ? (
        <View style={styles.secondaryRow}>
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
                  {
                    text: 'No Show',
                    style: 'destructive',
                    onPress: () => void noShowActiveJob(),
                  },
                ],
              );
            }}
          />
        </View>
      ) : null}

      <Button
        title={completionBusy ? 'Saving…' : 'Confirm PIN & name — unlock On Board'}
        disabled={completionBusy || !(activeJob.pickupPin && String(activeJob.pickupPin).trim())}
        onPress={() => void onConfirmVerify()}
      />
    </>
  );

  const expandedDetailsBody = (
    <View style={styles.expandedInline}>
      <View style={styles.summaryRow}>
        <JobTypeBadge type={activeJob.type} />
        <Text style={styles.jobId}>Job #{activeJob.id}</Text>
        <Text style={styles.stageChipInline} numberOfLines={1}>
          {isOnBoard ? 'On board' : stageLabel(activeJob.stage)}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageScroll}>
        {STAGES.map((s, i) => (
          <View key={s} style={styles.stageChip}>
            <View style={[styles.dot, i <= idx && styles.dotOn]} />
            <Text style={[styles.stageText, i <= idx && styles.stageOn]}>{stageLabel(s)}</Text>
          </View>
        ))}
      </ScrollView>
      <JobDispatchMetaSection job={activeJob} compact showPassengerContact />
      <Text style={styles.routeLine}>{routeOneLiner}</Text>
      {estFare != null ? (
        <Text style={styles.fareEst}>Est. fare ${formatFareAmount(estFare)}</Text>
      ) : null}
      {activeJob.estimatedDistanceKm != null ? (
        <Text style={styles.metaLine}>
          Est. distance {activeJob.estimatedDistanceKm.toFixed(1)} km
        </Text>
      ) : null}
      {activeJob.serviceTypeRaw ? (
        <Text style={styles.metaLine}>Service: {activeJob.serviceTypeRaw}</Text>
      ) : null}
      {activeJob.vehicleTypeRequired || activeJob.vehicleType ? (
        <Text style={styles.metaLine}>
          Vehicle: {activeJob.vehicleTypeRequired || activeJob.vehicleType}
        </Text>
      ) : null}
      {activeJob.isTotalMobility ? (
        <Text style={styles.metaLine}>
          Total Mobility
          {activeJob.tmCardNumber ? ` · card ${activeJob.tmCardNumber}` : ''}
          {activeJob.paymentType ? ` · remainder ${activeJob.paymentType}` : ''}
        </Text>
      ) : activeJob.paymentType ? (
        <Text style={styles.metaLine}>
          Payment: {activeJob.paymentType}
          {activeJob.isPrePaid ||
          String(activeJob.paymentStatus || '').toLowerCase() === 'paid'
            ? ' (paid)'
            : ''}
        </Text>
      ) : null}
      {activeJob.accountName || activeJob.accountId ? (
        <Text style={styles.metaLine}>
          Account: {activeJob.accountName || activeJob.accountId}
        </Text>
      ) : null}
      {activeJob.pickupPin ? (
        <Text style={styles.metaLine}>Pickup PIN: {String(activeJob.pickupPin)}</Text>
      ) : null}
      <View style={styles.addrBlock}>
        <Text style={styles.addrLabel}>Pickup</Text>
        <Text style={styles.addr}>{activeJob.pickup}</Text>
      </View>
      {(activeJob.stops?.length ?? 0) > 0
        ? activeJob.stops!.map((stop, i) => (
            <View key={`stop-${i}-${stop.address}`} style={styles.addrBlock}>
              <Text style={styles.addrLabel}>
                {(activeJob.stops?.length ?? 0) === 1 ? 'Stop' : `Stop ${i + 1}`}
              </Text>
              <Text style={styles.addr}>{stop.address}</Text>
            </View>
          ))
        : null}
      {showDropoff ? (
        <View style={styles.addrBlock}>
          <Text style={styles.addrLabel}>Dropoff</Text>
          <Text style={styles.addr}>{activeJob.dropoff}</Text>
        </View>
      ) : null}
      {activeJob.passengerName ? (
        <Text style={styles.metaLine}>Passenger: {activeJob.passengerName}</Text>
      ) : null}
      {activeJob.passengerPhone ? (
        <Text style={styles.metaLine} selectable>
          Phone: {activeJob.passengerPhone}
        </Text>
      ) : null}
      {activeJob.passengerEmail ? (
        <Text style={styles.metaLine}>Email: {activeJob.passengerEmail}</Text>
      ) : null}
      {activeJob.passengers != null ? (
        <Text style={styles.metaLine}>Passengers: {activeJob.passengers}</Text>
      ) : null}
      {activeJob.dispatcherName ? (
        <Text style={styles.metaLine}>Assigned by: {activeJob.dispatcherName}</Text>
      ) : null}
      {isHailTrip ? (
        <Text style={styles.metaLine}>
          Picked up from: {hailPickupAddress || activeJob.pickup || 'Current location'}
          {meter?.startedAt ? ` · Started ${fmtTime(meter.startedAt)}` : ''}
        </Text>
      ) : null}
      <JobNotesSection job={activeJob} compact title="Notes & pickup instructions" />
      {!activeJob.notes && !(activeJob.allNotes && activeJob.allNotes.length) ? (
        <Text style={styles.metaLine}>No notes on this booking.</Text>
      ) : null}
    </View>
  );

  const primaryAdvanceTitle = completionBusy
    ? 'Please wait…'
    : nextStage === 'onboard' && needsPickupVerify && !pickupVerified
      ? 'Verify first'
      : nextLabel;

  return (
    <View style={styles.panelActive}>
      {/* flexShrink:0 — never crushed by meter/map; always visible without scrolling */}
      <View style={styles.pinnedBand} accessibilityLabel="Trip details summary">
        <View style={[styles.detailsHeader, styles.detailsHeaderRaised]}>
          <Text style={styles.detailsHeaderTitle}>Trip details</Text>
          <Button
            title={detailsExpanded ? 'Minimize' : 'Expand'}
            variant="secondary"
            compact
            onPress={() => setDetailsExpanded((v) => !v)}
          />
        </View>
        <View style={styles.pinnedBody}>
          <View style={styles.summaryRow}>
            <JobTypeBadge type={activeJob.type} />
            <Text style={styles.jobId}>Job #{activeJob.id}</Text>
            <Text style={styles.stageChipInline} numberOfLines={1}>
              {isOnBoard ? 'On board' : stageLabel(activeJob.stage)}
            </Text>
          </View>
          {isHailTrip ? <Text style={styles.hailTitle}>Street hail</Text> : null}
          {estFare != null ? (
            <Text style={styles.fareEst}>Est. fare ${formatFareAmount(estFare)}</Text>
          ) : null}
          <Text style={styles.routeLine} numberOfLines={2}>
            {routeOneLiner}
          </Text>
          <JobDispatchMetaSection job={activeJob} compact showPassengerContact />
          {showCallText && !showPrepaidArrivedGroup ? (
            <View style={styles.contactRow}>
              <Button
                title="Call"
                compact
                style={styles.contactBtn}
                onPress={callPassenger}
              />
              <Button
                title="Text"
                variant="secondary"
                compact
                style={styles.contactBtn}
                onPress={textPassenger}
              />
            </View>
          ) : null}
          {needsPickupVerify && pickupVerified ? (
            <Text style={styles.verified}>Verified — On Board unlocked</Text>
          ) : null}
        </View>
      </View>

      {/* Expand = real sheet with FULL job details; End Trip / actions stay underneath */}
      {detailsExpanded ? (
        <Modal visible transparent animationType="slide" statusBarTranslucent>
          <View style={styles.detailsExpandRoot} pointerEvents="box-none">
            <Pressable
              style={styles.detailsExpandBackdrop}
              accessibilityLabel="Close trip details"
              onPress={() => setDetailsExpanded(false)}
            />
            <View
              style={[
                styles.detailsExpandSheet,
                { maxHeight: Math.round(windowHeight * 0.72), minHeight: Math.round(windowHeight * 0.4) },
              ]}
            >
              <View style={[styles.detailsHeader, styles.detailsHeaderRaised, styles.prepaidSheetHeader]}>
                <Text style={styles.detailsHeaderTitle}>Full trip details</Text>
                <Button
                  title="Minimize"
                  variant="secondary"
                  compact
                  onPress={() => setDetailsExpanded(false)}
                />
              </View>
              <ScrollView
                style={styles.detailsExpandScroll}
                contentContainerStyle={styles.detailsExpandContent}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {expandedDetailsBody}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}

      {showVerifySticky ? (
        <Modal visible transparent animationType="slide" statusBarTranslucent>
          <View style={styles.prepaidSheetRoot} pointerEvents="box-none">
            <Pressable style={styles.prepaidSheetBackdrop} accessibilityLabel="Pickup verification open" />
            <View
              style={[
                styles.prepaidSheet,
                prepaidSheetExpanded
                  ? styles.prepaidSheetFull
                  : { maxHeight: Math.round(windowHeight * 0.52) },
              ]}
            >
              <View style={[styles.detailsHeader, styles.detailsHeaderRaised, styles.prepaidSheetHeader]}>
                <Text style={styles.verifyTitle}>Pickup verification</Text>
                <Button
                  title={prepaidSheetExpanded ? 'Minimize' : 'Expand'}
                  variant="secondary"
                  compact
                  onPress={() => setPrepaidSheetExpanded((v) => !v)}
                />
              </View>
              <ScrollView
                style={styles.prepaidSheetScroll}
                contentContainerStyle={styles.verifySticky}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {prepaidSheetBody}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}

      <View style={styles.actionBar}>
        <View style={styles.actionRow}>
          {showEndTrip ? (
            <Button
              title={completionBusy ? 'Ending…' : 'End Trip'}
              variant="danger"
              disabled={completionBusy}
              compact
              style={styles.actionTab}
              onPress={() => confirmEndTrip(() => void endTrip())}
            />
          ) : (
            <Animated.View style={[styles.actionTabGrow, { opacity: highlightArrived ? pulse : 1 }]}>
              <Button
                title={primaryAdvanceTitle}
                onPress={onAdvance}
                disabled={
                  completionBusy ||
                  (nextStage === 'onboard' && needsPickupVerify && !pickupVerified)
                }
                compact
                style={styles.actionTab}
              />
            </Animated.View>
          )}

          {/* Navigate: pickup pre-onboard; dropoff when On Board (navTarget switches). */}
          {canNavigate ? (
            <Button
              title={isOnBoard ? 'Dropoff' : 'Navigate'}
              variant="secondary"
              compact
              style={styles.actionTab}
              onPress={() => showNavigationPicker(navTarget, navTitle)}
            />
          ) : null}

          {!showEndTrip && !isHailTrip && preArrival ? (
            <Button
              title="Recall"
              variant="secondary"
              compact
              style={styles.actionTab}
              onPress={() => {
                Alert.alert('Recall job?', 'Return this job to dispatch (before pickup arrival).', [
                  { text: 'Back', style: 'cancel' },
                  { text: 'Recall', onPress: recallJob },
                ]);
              }}
            />
          ) : null}
          {!showEndTrip && !isHailTrip && postArrival && !pickupVerified ? (
            <Button
              title="Cancel"
              variant="danger"
              compact
              style={styles.actionTab}
              onPress={() => {
                Alert.alert('Cancel job?', 'This permanently closes the job.', [
                  { text: 'Back', style: 'cancel' },
                  { text: 'Cancel job', style: 'destructive', onPress: cancelActiveJob },
                ]);
              }}
            />
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
  /** Never flex-shrink — always-visible band above crushed scroll / meter. */
  pinnedBand: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    zIndex: 50,
  },
  pinnedBody: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 4,
  },
  routeLine: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    lineHeight: 18,
  },
  stageChipInline: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: '800',
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  contactBtn: {
    flexGrow: 0,
    minWidth: 64,
    paddingHorizontal: 10,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  detailsHeaderRaised: {
    zIndex: 60,
    elevation: 8,
    backgroundColor: Colors.surface,
  },
  detailsHeaderTitle: { fontSize: 13, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase' },
  expandedInline: {
    gap: 8,
    paddingTop: 4,
  },
  detailsExpandRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  detailsExpandBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  detailsExpandSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 2,
    borderTopColor: Colors.border,
    width: '100%',
    zIndex: 70,
    elevation: 14,
  },
  detailsExpandScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  detailsExpandContent: {
    paddingHorizontal: 12,
    paddingBottom: 20,
    gap: 8,
  },
  waitChip: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    alignSelf: 'center',
    paddingHorizontal: 8,
    minWidth: '40%',
    textAlign: 'center',
  },
  callBlock: {
    gap: 8,
    marginTop: 4,
  },
  stageScroll: { marginBottom: 4 },
  stageChip: { flexDirection: 'row', alignItems: 'center', marginRight: 12, gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotOn: { backgroundColor: Colors.primary },
  stageText: { fontSize: 12, color: Colors.textMuted },
  stageOn: { color: Colors.text, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobId: { fontSize: 14, fontWeight: '600', color: Colors.text },
  hailTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  pickupFrom: { fontSize: 14, color: Colors.text },
  fareEst: { fontSize: 15, fontWeight: '700', color: Colors.primary },
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
  /** Caps height so map+tabs leave room; group itself scrolls — never clips off-screen. */
  verifyStickyScroll: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: '52%',
    borderTopWidth: 2,
    borderTopColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  prepaidSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  prepaidSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  prepaidSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 2,
    borderTopColor: Colors.primary,
    width: '100%',
    minHeight: 280,
    zIndex: 80,
    elevation: 16,
  },
  prepaidSheetFull: {
    flex: 1,
    maxHeight: '100%',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    minHeight: '100%',
  },
  prepaidSheetHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  prepaidSheetScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  verifySticky: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    paddingBottom: 24,
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
  actionBar: {
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 6,
    zIndex: 40,
    flexShrink: 0,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 6,
  },
  actionTab: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  actionTabGrow: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secondaryBtn: { flexGrow: 1, minWidth: '40%' },
  errorBox: { gap: 6 },
  errorText: { fontSize: 12, color: Colors.danger || '#b91c1c' },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
});
