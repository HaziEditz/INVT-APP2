import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { calcTmSplit, loadTmConfig, TmConfig } from '@/lib/tmConfig';
import {
  DRIVER_PAYMENT_TYPES,
  DriverPaymentType,
  PaymentExtras,
  TM_PASSENGER_PAYMENT_TYPES,
  TmPaymentDetails,
} from '@/types';
import { useEffect, useMemo, useState } from 'react';
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

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.sectionTitle}>{label}</Text>
      <Pressable style={styles.dropdownBtn} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.dropdownValue}>{value}</Text>
        <Text style={styles.dropdownCaret}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.dropdownList}>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[styles.dropdownItem, opt === value && styles.dropdownItemOn]}
              onPress={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              <Text style={[styles.dropdownItemText, opt === value && styles.dropdownItemTextOn]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function PaymentModal() {
  const insets = useSafeAreaInsets();
  const { driver } = useAuth();
  const { paymentJob, finalizePayment, activeVehicle, selectedTariff } = useDriver();

  const [paymentType, setPaymentType] = useState<DriverPaymentType>('Cash');
  const [tmPassengerPaymentType, setTmPassengerPaymentType] =
    useState<(typeof TM_PASSENGER_PAYMENT_TYPES)[number]>('Cash');
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extraEnabled, setExtraEnabled] = useState<Record<ExtraKey, boolean>>({
    eftposSurcharge: false,
    airportFee: false,
    bikeCarry: false,
    tolls: false,
    other: false,
  });
  const [extraAmounts, setExtraAmounts] = useState<Record<ExtraKey, string>>({
    eftposSurcharge: '',
    airportFee: '',
    bikeCarry: '',
    tolls: '',
    other: '',
  });
  const [otherNote, setOtherNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tmConfig, setTmConfig] = useState<TmConfig | null>(null);

  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [eftposRef, setEftposRef] = useState('');
  const [eftposSurchargeOn, setEftposSurchargeOn] = useState(false);
  const [eftposSurchargeAmt, setEftposSurchargeAmt] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accClaimNo, setAccClaimNo] = useState('');
  const [accPoNo, setAccPoNo] = useState('');
  const [tmCardNumber, setTmCardNumber] = useState('');
  const [tmCardExpiry, setTmCardExpiry] = useState('');
  const [hoistCount, setHoistCount] = useState('0');

  const isTmPayment = paymentType === 'TM';
  const isWav = !!activeVehicle?.isWav;

  useEffect(() => {
    if (!paymentJob) return;
    setPaymentType('Cash');
    setTmPassengerPaymentType('Cash');
    setExtrasOpen(false);
    setExtraEnabled({
      eftposSurcharge: false,
      airportFee: false,
      bikeCarry: false,
      tolls: false,
      other: false,
    });
    setExtraAmounts({
      eftposSurcharge: '',
      airportFee: '',
      bikeCarry: '',
      tolls: '',
      other: '',
    });
    setOtherNote('');
    setCardNumber('');
    setCardExpiry('');
    setCardCvc('');
    setEftposRef('');
    setEftposSurchargeOn(false);
    setEftposSurchargeAmt('');
    setAccountNumber('');
    setAccClaimNo('');
    setAccPoNo('');
    setTmCardNumber('');
    setTmCardExpiry('');
    setHoistCount('0');
  }, [paymentJob?.id]);

  useEffect(() => {
    if (!isTmPayment || !driver?.companyId) {
      setTmConfig(null);
      return;
    }
    void loadTmConfig(driver.companyId).then(setTmConfig);
  }, [isTmPayment, driver?.companyId]);

  const fare = useMemo(() => {
    if (!paymentJob) {
      return {
        tripMs: 0,
        distanceKm: 0,
        waitingMin: 0,
        flagFall: 0,
        distanceCharge: 0,
        waitingCharge: 0,
        ratePerKm: 0,
        waitingPerMin: 0,
        tripTotal: 0,
      };
    }

    const meter = paymentJob.meterSnapshot;
    const breakdown = meter?.breakdown;
    const flagFall = breakdown?.flagFall ?? selectedTariff.flagFall ?? 0;
    const distanceKm = breakdown?.distanceKm ?? meter?.distanceKm ?? paymentJob.distanceKm ?? 0;
    const waitingMin =
      breakdown?.waitingMinutes ?? (meter?.waitingMs != null ? meter.waitingMs / 60000 : 0);
    const distanceCharge = breakdown?.distanceCharge ?? distanceKm * selectedTariff.ratePerKm;
    const waitingCharge = breakdown?.waitingCharge ?? waitingMin * selectedTariff.waitingPerMin;
    const tripTotal =
      breakdown?.total ?? meter?.fare ?? paymentJob.fare ?? paymentJob.fixedFare ?? flagFall + distanceCharge + waitingCharge;

    const started = meter?.startedAt ?? paymentJob.startedAt;
    const finished = meter?.finishedAt ?? Date.now();
    const tripMs = started ? Math.max(0, finished - started) : paymentJob.durationMin * 60000;

    return {
      tripMs,
      distanceKm,
      waitingMin,
      flagFall,
      distanceCharge,
      waitingCharge,
      ratePerKm: selectedTariff.ratePerKm,
      waitingPerMin: selectedTariff.waitingPerMin,
      tripTotal,
    };
  }, [paymentJob, selectedTariff]);

  if (!paymentJob) return null;

  const parseExtra = (key: ExtraKey) =>
    extraEnabled[key] ? parseFloat(extraAmounts[key]) || 0 : 0;

  let extrasTotal =
    parseExtra('airportFee') +
    parseExtra('bikeCarry') +
    parseExtra('tolls') +
    parseExtra('other');

  if (extraEnabled.eftposSurcharge) {
    extrasTotal += parseExtra('eftposSurcharge');
  } else if (paymentType === 'EFTPOS' && eftposSurchargeOn) {
    extrasTotal += parseFloat(eftposSurchargeAmt) || 0;
  }

  const hoistUnits = isTmPayment && isWav ? Math.max(0, parseInt(hoistCount, 10) || 0) : 0;
  const hoistCostPerUnit = tmConfig?.hoistCostPerUnit ?? 0;
  const hoistTotal = +(hoistUnits * hoistCostPerUnit).toFixed(2);

  const subtotal = +(fare.tripTotal + extrasTotal + hoistTotal).toFixed(2);
  const tmSplit =
    isTmPayment && tmConfig
      ? calcTmSplit(subtotal, tmConfig)
      : { councilPays: 0, passengerPays: subtotal };
  const totalDue = isTmPayment ? tmSplit.passengerPays : subtotal;

  const builtExtras: PaymentExtras = {
    bikeCarry: parseExtra('bikeCarry'),
    airportFee: parseExtra('airportFee'),
    eftposSurcharge:
      parseExtra('eftposSurcharge') ||
      (paymentType === 'EFTPOS' && eftposSurchargeOn ? parseFloat(eftposSurchargeAmt) || 0 : 0),
    tolls: parseExtra('tolls'),
    other: parseExtra('other'),
    otherNote: extraEnabled.other ? otherNote.trim() || undefined : undefined,
    hoistCount: hoistUnits > 0 ? hoistUnits : undefined,
    hoistCost: hoistTotal > 0 ? hoistTotal : undefined,
  };

  const onScanCard = () => {
    Alert.alert('Scan card', 'Camera card scan is not available in this build. Enter card details manually.');
  };

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      let tmDetails: TmPaymentDetails | undefined;
      if (isTmPayment) {
        tmDetails = {
          councilPays: tmSplit.councilPays,
          passengerPays: tmSplit.passengerPays,
          tmCardNumber: tmCardNumber.trim() || undefined,
          tmCardExpiry: tmCardExpiry.trim() || undefined,
          totalFare: subtotal,
        };
      }

      const finalPaymentType = isTmPayment ? tmPassengerPaymentType : paymentType;
      await finalizePayment(finalPaymentType, builtExtras, subtotal, tmDetails);
    } finally {
      setSubmitting(false);
    }
  };

  const renderPaymentDetails = () => {
    switch (paymentType) {
      case 'Cash':
        return (
          <Text style={styles.hint}>Collect cash from the passenger and confirm below.</Text>
        );
      case 'Card':
        return (
          <View style={styles.detailsBlock}>
            <TextInput
              style={styles.field}
              placeholder="Card number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              value={cardNumber}
              onChangeText={setCardNumber}
            />
            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.field, styles.fieldHalf]}
                placeholder="Expiry MM/YY"
                placeholderTextColor={Colors.textMuted}
                value={cardExpiry}
                onChangeText={setCardExpiry}
              />
              <TextInput
                style={[styles.field, styles.fieldHalf]}
                placeholder="CVC"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                secureTextEntry
                value={cardCvc}
                onChangeText={setCardCvc}
              />
            </View>
            <TouchableOpacity style={styles.scanBtn} onPress={onScanCard}>
              <Text style={styles.scanBtnText}>Scan Card</Text>
            </TouchableOpacity>
          </View>
        );
      case 'EFTPOS':
        return (
          <View style={styles.detailsBlock}>
            <TextInput
              style={styles.field}
              placeholder="Transaction reference (optional)"
              placeholderTextColor={Colors.textMuted}
              value={eftposRef}
              onChangeText={setEftposRef}
            />
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setEftposSurchargeOn((v) => !v)}
            >
              <View style={[styles.checkbox, eftposSurchargeOn && styles.checkboxOn]}>
                {eftposSurchargeOn ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              <Text style={styles.checkboxLabel}>Add EFTPOS surcharge</Text>
            </TouchableOpacity>
            {eftposSurchargeOn ? (
              <TextInput
                style={styles.field}
                placeholder="Surcharge amount"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                value={eftposSurchargeAmt}
                onChangeText={setEftposSurchargeAmt}
              />
            ) : null}
          </View>
        );
      case 'Account':
        return (
          <View style={styles.detailsBlock}>
            <TextInput
              style={styles.field}
              placeholder="Account number"
              placeholderTextColor={Colors.textMuted}
              value={accountNumber}
              onChangeText={setAccountNumber}
            />
          </View>
        );
      case 'ACC':
        return (
          <View style={styles.detailsBlock}>
            <TextInput
              style={styles.field}
              placeholder="Claim number"
              placeholderTextColor={Colors.textMuted}
              value={accClaimNo}
              onChangeText={setAccClaimNo}
            />
            <TextInput
              style={styles.field}
              placeholder="Purchase order number"
              placeholderTextColor={Colors.textMuted}
              value={accPoNo}
              onChangeText={setAccPoNo}
            />
          </View>
        );
      case 'TM':
        return (
          <View style={styles.detailsBlock}>
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Council pays</Text>
              <Text style={styles.tmValue}>{fmtMoney(tmSplit.councilPays)}</Text>
            </View>
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Passenger pays</Text>
              <Text style={[styles.tmValue, styles.tmPassenger]}>{fmtMoney(tmSplit.passengerPays)}</Text>
            </View>
            <TextInput
              style={styles.field}
              placeholder="TM card number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              value={tmCardNumber}
              onChangeText={setTmCardNumber}
            />
            <TextInput
              style={styles.field}
              placeholder="TM card expiry MM/YY"
              placeholderTextColor={Colors.textMuted}
              value={tmCardExpiry}
              onChangeText={setTmCardExpiry}
            />
            {isWav ? (
              <View style={styles.hoistBlock}>
                <Text style={styles.subSection}>Hoist (WAV)</Text>
                <View style={styles.fieldRow}>
                  <TextInput
                    style={[styles.field, styles.fieldHalf]}
                    placeholder="Quantity"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    value={hoistCount}
                    onChangeText={setHoistCount}
                  />
                  <Text style={styles.hoistRate}>
                    {fmtMoney(hoistCostPerUnit)} / unit
                  </Text>
                </View>
                {hoistTotal > 0 ? (
                  <Text style={styles.hint}>Hoist total: {fmtMoney(hoistTotal)}</Text>
                ) : null}
              </View>
            ) : null}
            <Dropdown
              label="Passenger pays remaining via"
              value={tmPassengerPaymentType}
              options={TM_PASSENGER_PAYMENT_TYPES}
              onChange={setTmPassengerPaymentType}
            />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={styles.screen}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 12, paddingBottom: 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.pageTitle}>Collect Payment</Text>
          <Text style={styles.pickup} numberOfLines={2}>
            {paymentJob.pickup}
          </Text>

          <View style={styles.card}>
            <Text style={styles.stepLabel}>Fare summary</Text>
            <Text style={styles.metaLine}>
              Trip {fmtDuration(fare.tripMs)} · {fare.distanceKm.toFixed(2)} km · Waiting{' '}
              {fare.waitingMin.toFixed(1)} min
            </Text>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>Base Charge</Text>
              <Text style={styles.lineVal}>{fmtMoney(fare.flagFall)}</Text>
            </View>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>
                Ride ({fare.distanceKm.toFixed(2)} km × {fmtMoney(fare.ratePerKm)}/km)
              </Text>
              <Text style={styles.lineVal}>{fmtMoney(fare.distanceCharge)}</Text>
            </View>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>
                Waiting ({fare.waitingMin.toFixed(1)} min × {fmtMoney(fare.waitingPerMin)}/min)
              </Text>
              <Text style={styles.lineVal}>{fmtMoney(fare.waitingCharge)}</Text>
            </View>
            <View style={styles.tripTotalRow}>
              <Text style={styles.tripTotalLabel}>TRIP TOTAL</Text>
              <Text style={styles.tripTotalVal}>{fmtMoney(fare.tripTotal)}</Text>
            </View>
          </View>

          <Dropdown
            label="Payment type"
            value={paymentType}
            options={DRIVER_PAYMENT_TYPES}
            onChange={setPaymentType}
          />

          <View style={styles.card}>
            <Text style={styles.stepLabel}>Payment details</Text>
            {renderPaymentDetails()}
          </View>

          <Pressable style={styles.collapseHeader} onPress={() => setExtrasOpen((o) => !o)}>
            <Text style={styles.sectionTitle}>Extra charges</Text>
            <Text style={styles.collapseIcon}>{extrasOpen ? '▼' : '▶'}</Text>
          </Pressable>
          {extrasOpen ? (
            <View style={styles.card}>
              {EXTRA_ITEMS.map(({ key, label }) => (
                <View key={key} style={styles.extraItem}>
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setExtraEnabled((prev) => ({ ...prev, [key]: !prev[key] }))}
                  >
                    <View style={[styles.checkbox, extraEnabled[key] && styles.checkboxOn]}>
                      {extraEnabled[key] ? <Text style={styles.checkMark}>✓</Text> : null}
                    </View>
                    <Text style={styles.checkboxLabel}>{label}</Text>
                  </TouchableOpacity>
                  {extraEnabled[key] ? (
                    key === 'other' ? (
                      <>
                        <TextInput
                          style={styles.field}
                          placeholder="Description"
                          placeholderTextColor={Colors.textMuted}
                          value={otherNote}
                          onChangeText={setOtherNote}
                        />
                        <TextInput
                          style={styles.field}
                          placeholder="Amount"
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="decimal-pad"
                          value={extraAmounts.other}
                          onChangeText={(v) => setExtraAmounts((a) => ({ ...a, other: v }))}
                        />
                      </>
                    ) : (
                      <TextInput
                        style={styles.field}
                        placeholder="Amount"
                        placeholderTextColor={Colors.textMuted}
                        keyboardType="decimal-pad"
                        value={extraAmounts[key]}
                        onChangeText={(v) => setExtraAmounts((a) => ({ ...a, [key]: v }))}
                      />
                    )
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {isTmPayment ? (
            <Text style={styles.footerNote}>
              Council {fmtMoney(tmSplit.councilPays)} · Collect from passenger{' '}
              {fmtMoney(tmSplit.passengerPays)}
            </Text>
          ) : extrasTotal > 0 || hoistTotal > 0 ? (
            <Text style={styles.footerNote}>
              Extras {fmtMoney(extrasTotal)}
              {hoistTotal > 0 ? ` · Hoist ${fmtMoney(hoistTotal)}` : ''}
            </Text>
          ) : null}
          <Text style={styles.totalDue}>Total Due: {fmtMoney(totalDue)}</Text>
          <Button
            title={submitting ? 'Saving…' : 'Confirm Payment'}
            onPress={onConfirm}
            disabled={submitting}
            style={styles.confirmBtn}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  pageTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
  },
  pickup: {
    color: Colors.textMuted,
    fontSize: 14,
    marginBottom: 16,
  },
  stepLabel: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  subSection: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  metaLine: {
    color: Colors.textMuted,
    fontSize: 12,
    marginBottom: 12,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 5,
    gap: 8,
  },
  lineLabel: {
    color: Colors.textMuted,
    fontSize: 14,
    flex: 1,
  },
  lineVal: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  tripTotalRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripTotalLabel: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  tripTotalVal: {
    color: Colors.success,
    fontSize: 22,
    fontWeight: '900',
  },
  dropdownWrap: {
    marginBottom: 16,
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  dropdownValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  dropdownCaret: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  dropdownList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.background,
  },
  dropdownItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dropdownItemOn: {
    backgroundColor: Colors.accent + '22',
  },
  dropdownItemText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  dropdownItemTextOn: {
    color: Colors.accent,
    fontWeight: '800',
  },
  detailsBlock: {
    gap: 10,
  },
  field: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.text,
    fontSize: 16,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  fieldHalf: {
    flex: 1,
  },
  scanBtn: {
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  scanBtnText: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: 15,
  },
  hint: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  tmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  tmLabel: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  tmValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  tmPassenger: {
    color: Colors.success,
    fontSize: 18,
    fontWeight: '800',
  },
  hoistBlock: {
    marginTop: 4,
    gap: 8,
  },
  hoistRate: {
    color: Colors.textMuted,
    fontSize: 13,
    flex: 1,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingVertical: 4,
  },
  collapseIcon: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  extraItem: {
    marginBottom: 12,
    gap: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '33',
  },
  checkMark: {
    color: Colors.accent,
    fontWeight: '800',
    fontSize: 14,
  },
  checkboxLabel: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  footerNote: {
    color: Colors.textMuted,
    fontSize: 13,
    marginBottom: 6,
  },
  totalDue: {
    color: Colors.success,
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 12,
  },
  confirmBtn: {
    backgroundColor: Colors.success,
  },
});
