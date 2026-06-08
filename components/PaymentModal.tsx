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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const EMPTY_EXTRAS: PaymentExtras = {
  bikeCarry: 0,
  airportFee: 0,
  eftposSurcharge: 0,
  tolls: 0,
  other: 0,
  otherNote: '',
};

export function PaymentModal() {
  const insets = useSafeAreaInsets();
  const { paymentJob, finalizePayment } = useDriver();
  const [paymentType, setPaymentType] = useState<string>('Cash');
  const [extras, setExtras] = useState<PaymentExtras>(EMPTY_EXTRAS);
  const [submitting, setSubmitting] = useState(false);

  if (!paymentJob) return null;

  const meter = paymentJob.meterSnapshot;
  const breakdown = meter?.breakdown;
  const flagFall = breakdown?.flagFall ?? 0;
  const distanceCharge = breakdown?.distanceCharge ?? 0;
  const waitingCharge = breakdown?.waitingCharge ?? 0;
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
    <Modal visible animationType="slide" presentationStyle="fullScreen" statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
            <Text style={styles.title}>Collect Payment</Text>
            <Text style={styles.sub} numberOfLines={2}>
              {paymentJob.pickup}
            </Text>

            <View style={styles.breakdownCard}>
              <Text style={styles.breakdownTitle}>Fare breakdown</Text>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Flag fall</Text>
                <Text style={styles.breakdownVal}>${flagFall.toFixed(2)}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>
                  Distance ({(breakdown?.distanceKm ?? meter?.distanceKm ?? 0).toFixed(2)} km)
                </Text>
                <Text style={styles.breakdownVal}>${distanceCharge.toFixed(2)}</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>
                  Waiting ({(breakdown?.waitingMinutes ?? (meter?.waitingMs ?? 0) / 60000).toFixed(1)} min)
                </Text>
                <Text style={styles.breakdownVal}>${waitingCharge.toFixed(2)}</Text>
              </View>
              <View style={styles.breakdownTotalRow}>
                <Text style={styles.breakdownTotalLabel}>Trip total</Text>
                <Text style={styles.breakdownTotalVal}>
                  ${flagFall.toFixed(2)} + ${distanceCharge.toFixed(2)} + ${waitingCharge.toFixed(2)} = $
                  {tripFare.toFixed(2)}
                </Text>
              </View>
            </View>

            <Text style={styles.section}>Payment type</Text>
            <View style={styles.payGrid}>
              {DRIVER_PAYMENT_TYPES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.payBtn, paymentType === p && styles.payBtnOn]}
                  onPress={() => setPaymentType(p)}
                >
                  <Text style={[styles.payBtnText, paymentType === p && styles.payBtnTextOn]}>{p}</Text>
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

          <View style={styles.footer}>
            {extrasTotal > 0 ? (
              <Text style={styles.extrasNote}>Extras +${extrasTotal.toFixed(2)}</Text>
            ) : null}
            <Text style={styles.totalDue}>Total due ${total.toFixed(2)}</Text>
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
  root: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8, flexGrow: 1 },
  title: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: Colors.textMuted, fontSize: 14, marginTop: 4, marginBottom: 12 },
  breakdownCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  breakdownTitle: { color: Colors.text, fontWeight: '800', fontSize: 15, marginBottom: 10 },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  breakdownLabel: { color: Colors.textMuted, fontSize: 14, flex: 1, paddingRight: 8 },
  breakdownVal: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  breakdownTotalRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  breakdownTotalLabel: { color: Colors.text, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  breakdownTotalVal: { color: Colors.success, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  section: {
    color: Colors.text,
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 10,
    marginTop: 4,
  },
  payGrid: { gap: 8, marginBottom: 16 },
  payBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
  },
  payBtnOn: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '22',
  },
  payBtnText: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  payBtnTextOn: { color: Colors.accent },
  extraRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  extraLabel: { color: Colors.text, flex: 1, fontSize: 14 },
  extraInput: {
    width: 96,
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlign: 'right',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  extrasNote: { color: Colors.textMuted, fontSize: 13, marginBottom: 4 },
  totalDue: { color: Colors.success, fontSize: 24, fontWeight: '900', marginBottom: 10 },
});
