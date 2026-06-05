import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { DRIVER_PAYMENT_TYPES, PaymentExtras } from '@/types';
import { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const EMPTY_EXTRAS: PaymentExtras = {
  bikeCarry: 0,
  airportFee: 0,
  eftposSurcharge: 0,
  tolls: 0,
  other: 0,
  otherNote: '',
};

export function PaymentModal() {
  const { paymentJob, finalizePayment } = useDriver();
  const [paymentType, setPaymentType] = useState<string>('Cash');
  const [extras, setExtras] = useState<PaymentExtras>(EMPTY_EXTRAS);
  const [submitting, setSubmitting] = useState(false);

  if (!paymentJob) return null;

  const meter = paymentJob.meterSnapshot;
  const breakdown = meter?.breakdown;
  const tripFare = breakdown?.total ?? meter?.fare ?? paymentJob.fare ?? paymentJob.fixedFare ?? 0;
  const extrasTotal =
    extras.bikeCarry + extras.airportFee + extras.eftposSurcharge + extras.tolls + extras.other;
  const total = +(tripFare + extrasTotal).toFixed(2);

  const setExtra = (key: keyof PaymentExtras, raw: string) => {
    const n = parseFloat(raw) || 0;
    setExtras((e) => ({ ...e, [key]: n }));
  };

  const onDone = async () => {
    setSubmitting(true);
    try {
      await finalizePayment(paymentType, extras, total);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Collect payment</Text>
          <Text style={styles.sub}>{paymentJob.pickup}</Text>
          {paymentJob.dropoff && paymentJob.dropoff !== paymentJob.pickup ? (
            <Text style={styles.sub}>→ {paymentJob.dropoff}</Text>
          ) : null}

          {breakdown ? (
            <View style={styles.breakdownBox}>
              <Text style={styles.breakdownTitle}>Fare breakdown</Text>
              <Text style={styles.breakdownLine}>Flag fall ${breakdown.flagFall.toFixed(2)}</Text>
              <Text style={styles.breakdownLine}>
                Distance {breakdown.distanceKm.toFixed(2)} km = ${breakdown.distanceCharge.toFixed(2)}
              </Text>
              <Text style={styles.breakdownLine}>
                Waiting {breakdown.waitingMinutes.toFixed(1)} min = ${breakdown.waitingCharge.toFixed(2)}
              </Text>
              <Text style={styles.breakdownEq}>
                ${breakdown.flagFall.toFixed(2)} + ${breakdown.distanceCharge.toFixed(2)} + $
                {breakdown.waitingCharge.toFixed(2)} = ${breakdown.total.toFixed(2)}
              </Text>
              {meter?.tariffName ? (
                <Text style={styles.meta}>Tariff: {meter.tariffName}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.fare}>Trip fare ${tripFare.toFixed(2)}</Text>
          )}

          {extrasTotal > 0 ? (
            <Text style={styles.extrasLine}>Extras +${extrasTotal.toFixed(2)}</Text>
          ) : null}
          <Text style={styles.totalDue}>Total due ${total.toFixed(2)}</Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>Payment type</Text>
            <View style={styles.chips}>
              {DRIVER_PAYMENT_TYPES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, paymentType === p && styles.chipOn]}
                  onPress={() => setPaymentType(p)}
                >
                  <Text style={[styles.chipText, paymentType === p && styles.chipTextOn]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.section}>Extra charges</Text>
            {(
              [
                ['bikeCarry', 'Bike carry fee'],
                ['airportFee', 'Airport fee'],
                ['eftposSurcharge', 'EFTPOS surcharge'],
                ['tolls', 'Tolls'],
                ['other', 'Other extras'],
              ] as const
            ).map(([key, label]) => (
              <View key={key} style={styles.extraRow}>
                <Text style={styles.extraLabel}>{label}</Text>
                <TextInput
                  style={styles.extraInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                  onChangeText={(v) => setExtra(key, v)}
                />
              </View>
            ))}
          </ScrollView>

          <Button
            title={submitting ? 'Saving…' : 'Confirm Payment'}
            onPress={onDone}
            disabled={submitting}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: Colors.textMuted, fontSize: 14, marginTop: 2 },
  breakdownBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  breakdownTitle: { color: Colors.text, fontWeight: '700', marginBottom: 6 },
  breakdownLine: { color: Colors.textMuted, fontSize: 13, marginBottom: 2 },
  breakdownEq: { color: Colors.success, fontSize: 16, fontWeight: '800', marginTop: 8 },
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 4 },
  fare: { color: Colors.success, fontSize: 18, fontWeight: '800', marginVertical: 10 },
  extrasLine: { color: Colors.textMuted, fontSize: 14, marginTop: 6 },
  totalDue: { color: Colors.success, fontSize: 22, fontWeight: '900', marginVertical: 10 },
  scroll: { maxHeight: 360, marginBottom: 12 },
  section: { color: Colors.text, fontWeight: '700', fontSize: 15, marginTop: 8, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceElevated,
  },
  chipOn: { borderColor: Colors.accent, backgroundColor: Colors.accent + '22' },
  chipText: { color: Colors.textMuted, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: Colors.accent },
  extraRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  extraLabel: { color: Colors.text, flex: 1, fontSize: 14 },
  extraInput: {
    width: 88,
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
