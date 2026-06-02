import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Button } from '@/components/Button';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

export function JobOfferModal() {
  const { jobOffer, acceptOffer, declineOffer } = useDriver();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!jobOffer) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((jobOffer.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) declineOffer();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [jobOffer, declineOffer]);

  if (!jobOffer) return null;

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>New Job Offer</Text>
          <JobTypeBadge type={jobOffer.type} />
          <Text style={styles.timer}>{secondsLeft}s to respond</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Pickup</Text>
            <Text style={styles.value}>{jobOffer.pickup}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Dropoff</Text>
            <Text style={styles.value}>{jobOffer.dropoff}</Text>
          </View>
          {jobOffer.isAcc ? <Text style={styles.special}>ACC Job</Text> : null}
          {jobOffer.isTotalMobility ? <Text style={styles.special}>Total Mobility</Text> : null}
          {jobOffer.fixedFare != null ? (
            <Text style={styles.fare}>Fixed fare: ${jobOffer.fixedFare.toFixed(2)}</Text>
          ) : null}
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  title: { color: Colors.text, fontSize: 22, fontWeight: '700' },
  timer: { color: Colors.warning, fontWeight: '700' },
  row: { gap: 4 },
  label: { color: Colors.textMuted, fontSize: 12, textTransform: 'uppercase' },
  value: { color: Colors.text, fontSize: 16 },
  special: { color: Colors.acc, fontWeight: '700' },
  fare: { color: Colors.success, fontSize: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btn: { flex: 1 },
});
