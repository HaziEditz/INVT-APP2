import { Button } from '@/components/Button';
import { JobNotesSection } from '@/components/JobNotesSection';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

export function JobOfferModal() {
  const { jobOffer, acceptOffer, declineOffer } = useDriver();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useSafeEffect(() => {
    if (!jobOffer) return;
    const tick = () => {
      try {
        const left = Math.max(0, Math.ceil((jobOffer.expiresAt - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left <= 0) declineOffer().catch((err) => console.error('[JobOfferModal] decline', err));
      } catch (err) {
        console.error('[JobOfferModal] tick', err);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [jobOffer, declineOffer], 'JobOfferModal-timer');

  if (!jobOffer) return null;

  const estFare = jobOffer.fixedFare ?? jobOffer.estimatedFare;

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent presentationStyle="overFullScreen">
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>Job offer</Text>
          <Text style={styles.timer}>{secondsLeft}s to respond</Text>
          <JobTypeBadge type={jobOffer.type} />

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.row}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.value}>{jobOffer.pickup}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Dropoff</Text>
              <Text style={styles.value}>{jobOffer.dropoff}</Text>
            </View>

            {estFare != null ? (
              <Text style={styles.fare}>Est. fare ${estFare.toFixed(2)}</Text>
            ) : null}
            {jobOffer.estimatedDistanceKm != null ? (
              <Text style={styles.meta}>Est. distance {jobOffer.estimatedDistanceKm.toFixed(1)} km</Text>
            ) : null}
            {jobOffer.paymentType ? (
              <Text style={styles.meta}>Payment: {jobOffer.paymentType}</Text>
            ) : null}

            <Text style={styles.section}>Job details</Text>
            {jobOffer.source ? <Text style={styles.detail}>Source: {jobOffer.source}</Text> : null}
            <Text style={styles.detail}>Type: {jobOffer.type}</Text>
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
              <Text style={styles.detail}>Dispatcher: {jobOffer.dispatcherName}</Text>
            ) : null}
            <JobNotesSection job={jobOffer} />
            {jobOffer.isAcc ? <Text style={styles.special}>ACC Job</Text> : null}
            {jobOffer.isTotalMobility ? <Text style={styles.special}>Total Mobility</Text> : null}
          </ScrollView>

          <View style={styles.actions}>
            <Button title="Decline" variant="secondary" onPress={declineOffer} style={styles.btn} />
            <Button title="Accept" onPress={acceptOffer} style={styles.btn} />
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
  scroll: { maxHeight: 340, marginVertical: 8 },
  row: { gap: 4, marginBottom: 12 },
  label: { color: Colors.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { color: Colors.text, fontSize: 17 },
  fare: { color: Colors.success, fontSize: 20, fontWeight: '800' },
  meta: { color: Colors.textMuted, fontSize: 14, marginTop: 4 },
  section: { color: Colors.text, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  detail: { color: Colors.textMuted, fontSize: 14, marginBottom: 4 },
  notes: { color: Colors.warning, fontSize: 14, marginTop: 4 },
  special: { color: Colors.acc, fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  btn: { flex: 1 },
});
