import { Button } from '@/components/Button';
import { useDriver } from '@/context/DriverContext';
import { Colors, PAYMENT_TYPES } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { PaymentType } from '@/types';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function MeterScreen() {
  const { activeJob, setPaymentType, completeJob } = useDriver();
  const [fare, setFare] = useState(activeJob?.fare ?? 5.5);
  const [distanceKm, setDistanceKm] = useState(activeJob?.distanceKm ?? 0);
  const [durationMin, setDurationMin] = useState(activeJob?.durationMin ?? 0);
  const [selectedPayment, setSelectedPayment] = useState<PaymentType>(activeJob?.paymentType ?? 'Cash');

  useEffect(() => {
    const id = setInterval(() => {
      setDurationMin((m) => m + 1 / 60);
      setDistanceKm((d) => d + 0.01);
      setFare((f) => f + 0.08);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const onSelectPayment = (p: PaymentType) => {
    setSelectedPayment(p);
    setPaymentType(p);
  };

  const onComplete = async () => {
    await completeJob();
    router.replace('/(tabs)');
  };

  if (!activeJob) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={sharedStyles.cardText}>No active taxi job.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <View style={styles.meterCard}>
        <Text style={styles.fareLabel}>Running fare</Text>
        <Text style={styles.fare}>${fare.toFixed(2)}</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Distance</Text>
            <Text style={styles.statValue}>{distanceKm.toFixed(2)} km</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Time</Text>
            <Text style={styles.statValue}>{Math.floor(durationMin)}:{String(Math.floor((durationMin % 1) * 60)).padStart(2, '0')}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Payment type</Text>
      <View style={styles.paymentGrid}>
        {PAYMENT_TYPES.map((p) => (
          <Pressable
            key={p}
            onPress={() => onSelectPayment(p)}
            style={[styles.paymentChip, selectedPayment === p && styles.paymentSelected]}
          >
            <Text style={[styles.paymentText, selectedPayment === p && styles.paymentTextSelected]}>{p}</Text>
          </Pressable>
        ))}
      </View>

      {selectedPayment === 'ACC' ? (
        <Text style={styles.note}>ACC jobs are tracked separately from Total Mobility.</Text>
      ) : null}

      <Button title="Complete & Collect Payment" onPress={onComplete} style={{ marginTop: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  meterCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.accent,
    marginBottom: 20,
  },
  fareLabel: { color: Colors.textMuted, textAlign: 'center' },
  fare: { color: Colors.accent, fontSize: 48, fontWeight: '800', textAlign: 'center', marginVertical: 8 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
  stat: { alignItems: 'center' },
  statLabel: { color: Colors.textMuted, fontSize: 12 },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  paymentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paymentChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceElevated,
  },
  paymentSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent + '22' },
  paymentText: { color: Colors.textMuted, fontSize: 13 },
  paymentTextSelected: { color: Colors.accent, fontWeight: '700' },
  note: { color: Colors.acc, marginTop: 12, fontSize: 13 },
});
