import { Button } from '@/components/Button';
import { JobDispatchMetaSection } from '@/components/JobDispatchMetaSection';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function JobOfferModal() {
  const {
    jobOffer,
    acceptOffer,
    declineOffer,
    hailActive,
    activeJob,
    paymentJob,
    isOffline,
    syncingBanner,
    pendingTripSync,
    acceptingOfferId,
  } = useDriver();
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timedOutRef = useRef(false);
  /** Offer clock ran out while Syncing/trip hold — purge without miss→Away. */
  const expiredWhileHeldRef = useRef(false);

  useSafeEffect(() => {
    if (!jobOffer) {
      timedOutRef.current = false;
      expiredWhileHeldRef.current = false;
      return;
    }
    const tick = () => {
      try {
        const left = Math.max(0, Math.ceil((jobOffer.expiresAt - Date.now()) / 1000));
        setSecondsLeft(left);
        // Suppress miss→Away while on a trip OR while Syncing / pending journal work.
        if (hailActive || activeJob || paymentJob || pendingTripSync || !!syncingBanner) {
          if (left <= 0) expiredWhileHeldRef.current = true;
          console.log('[away-debug] JobOfferModal timer suppressed', {
            jobId: jobOffer.id,
            hailActive: !!hailActive,
            activeJob: !!activeJob,
            paymentJob: !!paymentJob,
            pendingTripSync: !!pendingTripSync,
            syncingBanner: !!syncingBanner,
            secondsLeft: left,
            expiredWhileHeld: expiredWhileHeldRef.current,
          });
          return;
        }
        if (left <= 0 && !timedOutRef.current) {
          timedOutRef.current = true;
          if (expiredWhileHeldRef.current) {
            console.log('[away-debug] JobOfferModal purge expired-while-held (no Away)', {
              jobId: jobOffer.id,
            });
            declineOffer().catch((err) => console.error('[JobOfferModal] decline', err));
            return;
          }
          console.log('[away-debug] JobOfferModal timer → declineOffer timedOut', {
            jobId: jobOffer.id,
            fromQueue: !!jobOffer.fromQueue,
            expiresAt: jobOffer.expiresAt,
          });
          declineOffer({ timedOut: true }).catch((err) => console.error('[JobOfferModal] decline', err));
        }
      } catch (err) {
        console.error('[JobOfferModal] tick', err);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [jobOffer, declineOffer, hailActive, activeJob, paymentJob, pendingTripSync, syncingBanner], 'JobOfferModal-timer');

  // Hide while offline (accept is a live claim) but keep the timer effect above so a
  // missed exclusive offer still times out → Away even during a brief disconnect.
  // Also hide while syncing/pending trip work so a deferred expired offer cannot flash.
  if (
    !jobOffer ||
    hailActive ||
    !!activeJob ||
    !!paymentJob ||
    isOffline ||
    pendingTripSync ||
    !!syncingBanner
  ) {
    return null;
  }

  const estFare = jobOffer.fixedFare ?? jobOffer.estimatedFare;
  const accepting = !!acceptingOfferId;
  const acceptDisabled = accepting || isOffline;

  const onAccept = () => {
    if (acceptDisabled) return;
    void acceptOffer().catch((err) => console.error('[JobOfferModal] accept', err));
  };

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Job offer</Text>
          <Text style={styles.timer}>{secondsLeft}s to respond</Text>
          <JobTypeBadge type={jobOffer.type} />

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            <Text style={styles.jobId}>Job #{jobOffer.id}</Text>

            <View style={styles.row}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.value}>{jobOffer.pickup || '—'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Dropoff</Text>
              <Text style={styles.value}>{jobOffer.dropoff || '—'}</Text>
            </View>

            {estFare != null ? (
              jobOffer.isPrePaid ||
              String(jobOffer.paymentStatus || '').toLowerCase() === 'paid' ? (
                <Text style={styles.fare}>
                  Paid{jobOffer.isFixedPrice || jobOffer.fixedFare != null ? ' + fixed fare' : ''} $
                  {estFare.toFixed(2)}
                </Text>
              ) : (
                <Text style={styles.fare}>Est. fare ${estFare.toFixed(2)}</Text>
              )
            ) : null}
            {jobOffer.estimatedDistanceKm != null ? (
              <Text style={styles.meta}>Est. distance {jobOffer.estimatedDistanceKm.toFixed(1)} km</Text>
            ) : null}
            {jobOffer.paymentType ? (
              <Text style={styles.meta}>
                Payment: {jobOffer.paymentType}
                {jobOffer.isPrePaid ||
                String(jobOffer.paymentStatus || '').toLowerCase() === 'paid'
                  ? ' (paid)'
                  : ''}
              </Text>
            ) : null}

            <JobDispatchMetaSection job={jobOffer} compact />

            <Text style={styles.section}>Job details</Text>
            <Text style={styles.detail}>Service type: {jobOffer.serviceTypeRaw ?? jobOffer.type}</Text>
            {jobOffer.vehicleTypeRequired ? (
              <Text style={styles.detail}>Vehicle required: {jobOffer.vehicleTypeRequired}</Text>
            ) : null}
            {jobOffer.passengers != null ? (
              <Text style={styles.detail}>Passengers: {jobOffer.passengers}</Text>
            ) : null}
            {jobOffer.passengerName ? (
              <Text style={styles.detail}>Passenger: {jobOffer.passengerName}</Text>
            ) : null}
            {jobOffer.passengerPhone ? (
              <Text style={styles.detail}>Phone: {jobOffer.passengerPhone}</Text>
            ) : null}
            {jobOffer.passengerEmail ? (
              <Text style={styles.detail}>Email: {jobOffer.passengerEmail}</Text>
            ) : null}
            {jobOffer.dispatcherName ? (
              <Text style={styles.detail}>Assigned by: {jobOffer.dispatcherName}</Text>
            ) : null}
            <JobNotesSection job={jobOffer} />
            {jobOffer.isAcc ? <Text style={styles.special}>ACC Job — special requirements apply</Text> : null}
            {jobOffer.isTotalMobility ? (
              <Text style={styles.special}>Total Mobility — special requirements apply</Text>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Button title="Reject" variant="secondary" onPress={() => declineOffer()} style={styles.btn} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Accept job offer"
              disabled={acceptDisabled}
              onPress={onAccept}
              hitSlop={8}
              style={({ pressed }) => [
                styles.acceptBtn,
                acceptDisabled && styles.acceptBtnDisabled,
                pressed && !acceptDisabled && styles.acceptBtnPressed,
              ]}
            >
              <Text style={styles.acceptBtnText}>
                {isOffline ? 'Reconnect to accept' : accepting ? 'Accepting…' : 'Accept'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '85%',
  },
  title: { color: Colors.text, fontSize: 24, fontWeight: '800' },
  timer: { color: Colors.warning, fontWeight: '800', fontSize: 16, marginVertical: 6 },
  jobId: { color: Colors.textMuted, fontSize: 12, marginBottom: 8, fontWeight: '700' },
  scroll: { maxHeight: 340, marginVertical: 8 },
  row: { gap: 4, marginBottom: 12 },
  label: { color: Colors.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { color: Colors.text, fontSize: 17 },
  fare: { color: Colors.success, fontSize: 20, fontWeight: '800' },
  meta: { color: Colors.textMuted, fontSize: 14, marginTop: 4 },
  section: { color: Colors.text, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  detail: { color: Colors.textMuted, fontSize: 14, marginBottom: 4 },
  special: { color: Colors.acc, fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  btn: { flex: 1 },
  acceptBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    minHeight: 52,
  },
  acceptBtnDisabled: { opacity: 0.55 },
  acceptBtnPressed: { opacity: 0.85 },
  acceptBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
