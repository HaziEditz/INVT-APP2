import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { calcTmSplit, loadTmConfig, TmConfig } from '@/lib/tmConfig';
import {
  DRIVER_PAYMENT_TYPES,
  PaymentExtras,
  TM_PASSENGER_PAYMENT_TYPES,
  TmPaymentDetails,
} from '@/types';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ExtraKey = 'eftposSurcharge' | 'airportFee' | 'bikeCarry' | 'tolls' | 'other';

const EXTRA_ITEMS: { key: ExtraKey; label: string }[] = [
  { key: 'eftposSurcharge', label: 'EFTPOS surcharge' },
  { key: 'airportFee', label: 'Airport fee' },
  { key: 'bikeCarry', label: 'Bike carry fee' },
  { key: 'tolls', label: 'Tolls' },
  { key: 'other', label: 'Other' },
];

const EMPTY_ENABLED: Record<ExtraKey, boolean> = {
  eftposSurcharge: false,
  airportFee: false,
  bikeCarry: false,
  tolls: false,
  other: false,
};

const EMPTY_AMOUNTS: Record<ExtraKey, string> = {
  eftposSurcharge: '',
  airportFee: '',
  bikeCarry: '',
  tolls: '',
  other: '',
};

export function PaymentModal() {
  const insets = useSafeAreaInsets();
  const { driver } = useAuth();
  const { paymentJob, finalizePayment, activeVehicle } = useDriver();
  const [paymentType, setPaymentType] = useState<string>('Cash');
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extraEnabled, setExtraEnabled] = useState(EMPTY_ENABLED);
  const [extraAmounts, setExtraAmounts] = useState(EMPTY_AMOUNTS);
  const [otherNote, setOtherNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tmConfig, setTmConfig] = useState<TmConfig | null>(null);
  const [hoistCount, setHoistCount] = useState('0');
  const [tmCardNumber, setTmCardNumber] = useState('');
  const [tmCardName, setTmCardName] = useState('');
  const [tmCardExpiry, setTmCardExpiry] = useState('');

  const isTm = !!paymentJob?.isTotalMobility;
  const isWav = !!activeVehicle?.isWav;

  useEffect(() => {
    if (!isTm || !driver?.companyId) {
      setTmConfig(null);
      return;
    }
    void loadTmConfig(driver.companyId).then(setTmConfig);
  }, [isTm, driver?.companyId]);

  if (!paymentJob) return null;

  const meter = paymentJob.meterSnapshot;
  const breakdown = meter?.breakdown;
  const flagFall = breakdown?.flagFall ?? 0;
  const distanceCharge = breakdown?.distanceCharge ?? 0;
  const waitingCharge = breakdown?.waitingCharge ?? 0;
  const tripFare = breakdown?.total ?? meter?.fare ?? paymentJob.fare ?? paymentJob.fixedFare ?? 0;

  const parseExtra = (key: ExtraKey) =>
    extraEnabled[key] ? parseFloat(extraAmounts[key]) || 0 : 0;
  const builtExtras: PaymentExtras = {
    bikeCarry: parseExtra('bikeCarry'),
    airportFee: parseExtra('airportFee'),
    eftposSurcharge: parseExtra('eftposSurcharge'),
    tolls: parseExtra('tolls'),
    other: parseExtra('other'),
    otherNote: extraEnabled.other ? otherNote.trim() : undefined,
  };

  const extrasTotal =
    builtExtras.bikeCarry +
    builtExtras.airportFee +
    builtExtras.eftposSurcharge +
    builtExtras.tolls +
    builtExtras.other;

  const hoistUnits = isTm && isWav ? Math.max(0, parseInt(hoistCount, 10) || 0) : 0;
  const hoistCostPerUnit = tmConfig?.hoistCostPerUnit ?? 0;
  const hoistTotal = +(hoistUnits * hoistCostPerUnit).toFixed(2);

  const subtotal = +(tripFare + extrasTotal + hoistTotal).toFixed(2);
  const tmSplit =
    isTm && tmConfig ? calcTmSplit(subtotal, tmConfig) : { councilPays: 0, passengerPays: subtotal };
  const totalDue = isTm ? tmSplit.passengerPays : subtotal;

  const paymentOptions = isTm ? TM_PASSENGER_PAYMENT_TYPES : DRIVER_PAYMENT_TYPES;

  const toggleExtra = (key: ExtraKey) => {
    setExtraEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const onScanTmCard = () => {
    Alert.alert(
      'Scan TM card',
      'Camera scan is not available on this build. Enter the TM card details manually below.',
    );
  };

  const onDone = async () => {
    setSubmitting(true);
    try {
      const extras: PaymentExtras = {
        ...builtExtras,
        hoistCount: hoistUnits > 0 ? hoistUnits : undefined,
        hoistCost: hoistTotal > 0 ? hoistTotal : undefined,
      };

      let tmDetails: TmPaymentDetails | undefined;
      if (isTm) {
        tmDetails = {
          councilPays: tmSplit.councilPays,
          passengerPays: tmSplit.passengerPays,
          tmCardNumber: tmCardNumber.trim() || undefined,
          tmCardName: tmCardName.trim() || undefined,
          tmCardExpiry: tmCardExpiry.trim() || undefined,
          totalFare: subtotal,
        };
      }

      await finalizePayment(paymentType, extras, subtotal, tmDetails);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={styles.fullScreen}>
        <View
          style={[
            styles.sheet,
            { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
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
          {isTm ? <Text style={styles.tmBadge}>Total Mobility trip</Text> : null}

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
            {hoistTotal > 0 ? (
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>
                  Hoist ({hoistUnits} × ${hoistCostPerUnit.toFixed(2)})
                </Text>
                <Text style={styles.breakdownVal}>${hoistTotal.toFixed(2)}</Text>
              </View>
            ) : null}
            {extrasTotal > 0 ? (
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Extra charges</Text>
                <Text style={styles.breakdownVal}>${extrasTotal.toFixed(2)}</Text>
              </View>
            ) : null}
            <View style={styles.breakdownTotalRow}>
              <Text style={styles.breakdownTotalLabel}>Trip total</Text>
              <Text style={styles.breakdownTotalVal}>${subtotal.toFixed(2)}</Text>
            </View>
            {isTm ? (
              <>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Council pays</Text>
                  <Text style={styles.breakdownVal}>${tmSplit.councilPays.toFixed(2)}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Passenger pays</Text>
                  <Text style={[styles.breakdownVal, styles.passengerDue]}>
                    ${tmSplit.passengerPays.toFixed(2)}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {isTm ? (
            <>
              {isWav ? (
                <View style={styles.block}>
                  <Text style={styles.section}>Hoist (WAV)</Text>
                  <View style={styles.extraRow}>
                    <Text style={styles.extraLabel}>Number of hoists</Text>
                    <TextInput
                      style={styles.extraInput}
                      keyboardType="number-pad"
                      value={hoistCount}
                      onChangeText={setHoistCount}
                      placeholder="0"
                      placeholderTextColor={Colors.textMuted}
                    />
                  </View>
                  <Text style={styles.hint}>
                    ${hoistCostPerUnit.toFixed(2)} per hoist from company TM settings
                  </Text>
                </View>
              ) : null}

              <View style={styles.block}>
                <Text style={styles.section}>TM card</Text>
                <TouchableOpacity style={styles.scanBtn} onPress={onScanTmCard}>
                  <Text style={styles.scanBtnText}>Scan card with camera</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="Card number"
                  placeholderTextColor={Colors.textMuted}
                  value={tmCardNumber}
                  onChangeText={setTmCardNumber}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={styles.fieldInput}
                  placeholder="Name on card"
                  placeholderTextColor={Colors.textMuted}
                  value={tmCardName}
                  onChangeText={setTmCardName}
                />
                <TextInput
                  style={styles.fieldInput}
                  placeholder="Expiry (MM/YY)"
                  placeholderTextColor={Colors.textMuted}
                  value={tmCardExpiry}
                  onChangeText={setTmCardExpiry}
                />
              </View>
            </>
          ) : null}

          <Pressable style={styles.collapseHeader} onPress={() => setExtrasOpen((o) => !o)}>
            <Text style={styles.section}>Extra charges</Text>
            <Text style={styles.collapseIcon}>{extrasOpen ? '▼' : '▶'}</Text>
          </Pressable>
          {extrasOpen ? (
            <View style={styles.extrasPanel}>
              {EXTRA_ITEMS.map(({ key, label }) => (
                <View key={key} style={styles.extraItem}>
                  <TouchableOpacity style={styles.checkboxRow} onPress={() => toggleExtra(key)}>
                    <View style={[styles.checkbox, extraEnabled[key] && styles.checkboxOn]}>
                      {extraEnabled[key] ? <Text style={styles.checkMark}>✓</Text> : null}
                    </View>
                    <Text style={styles.extraLabel}>{label}</Text>
                  </TouchableOpacity>
                  {extraEnabled[key] ? (
                    key === 'other' ? (
                      <>
                        <TextInput
                          style={styles.fieldInput}
                          placeholder="Description"
                          placeholderTextColor={Colors.textMuted}
                          value={otherNote}
                          onChangeText={setOtherNote}
                        />
                        <TextInput
                          style={styles.extraInputWide}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={Colors.textMuted}
                          value={extraAmounts.other}
                          onChangeText={(v) => setExtraAmounts((a) => ({ ...a, other: v }))}
                        />
                      </>
                    ) : (
                      <TextInput
                        style={styles.extraInputWide}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={Colors.textMuted}
                        value={extraAmounts[key]}
                        onChangeText={(v) => setExtraAmounts((a) => ({ ...a, [key]: v }))}
                      />
                    )
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.section}>{isTm ? 'Passenger payment type' : 'Payment type'}</Text>
          <View style={styles.payGrid}>
            {paymentOptions.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.payBtn, paymentType === p && styles.payBtnOn]}
                onPress={() => setPaymentType(p)}
              >
                <Text style={[styles.payBtnText, paymentType === p && styles.payBtnTextOn]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {isTm ? (
            <Text style={styles.extrasNote}>
              Council ${tmSplit.councilPays.toFixed(2)} · Passenger ${tmSplit.passengerPays.toFixed(2)}
            </Text>
          ) : extrasTotal > 0 ? (
            <Text style={styles.extrasNote}>Extras +${extrasTotal.toFixed(2)}</Text>
          ) : null}
          <Text style={styles.totalDue}>Total due ${totalDue.toFixed(2)}</Text>
          <Button
            title={submitting ? 'Saving…' : 'Confirm Payment'}
            onPress={onDone}
            disabled={submitting}
          />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: Colors.surface,
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    height: '100%',
    width: '100%',
    backgroundColor: Colors.surface,
    flex: 1,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 8, flexGrow: 1 },
  title: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: Colors.textMuted, fontSize: 14, marginTop: 4, marginBottom: 4 },
  tmBadge: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 12,
  },
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
  passengerDue: { color: Colors.success },
  breakdownTotalRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  breakdownTotalLabel: { color: Colors.text, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  breakdownTotalVal: { color: Colors.success, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  block: { marginBottom: 12 },
  section: {
    color: Colors.text,
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 10,
    marginTop: 4,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  collapseIcon: { color: Colors.textMuted, fontSize: 12, marginLeft: 8 },
  extrasPanel: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    gap: 8,
  },
  extraItem: { gap: 6 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: Colors.accent, backgroundColor: Colors.accent + '33' },
  checkMark: { color: Colors.accent, fontWeight: '800', fontSize: 14 },
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
  extraRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
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
  extraInputWide: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlign: 'right',
  },
  fieldInput: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 12,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
  },
  scanBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.accent,
    alignItems: 'center',
    marginBottom: 10,
  },
  scanBtnText: { color: Colors.accent, fontWeight: '700', fontSize: 15 },
  hint: { color: Colors.textMuted, fontSize: 12, marginTop: 4 },
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
