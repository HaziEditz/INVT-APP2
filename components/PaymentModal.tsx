import { Button } from '@/components/Button';
import { ScanCardModal } from '@/components/ScanCardModal';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import {
  DRIVER_PAYMENT_TYPES,
  PaymentExtras,
  PaymentRecord,
  TM_SUBSIDY_CAP,
  TM_SUBSIDY_RATE,
} from '@/types';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

const TM_PASSENGER_PAY_TYPES = ['Cash', 'Card', 'EFTPOS'] as const;

type DropdownProps = {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
};

function Dropdown({ label, value, options, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <Pressable style={styles.dropdownBtn} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.dropdownValue}>{value}</Text>
        <Text style={styles.dropdownCaret}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.dropdownList}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              style={[styles.dropdownItem, value === opt && styles.dropdownItemOn]}
              onPress={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              <Text style={[styles.dropdownItemText, value === opt && styles.dropdownItemTextOn]}>
                {opt}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType}
      />
    </View>
  );
}

export function PaymentModal() {
  const insets = useSafeAreaInsets();
  const { paymentJob, finalizePayment } = useDriver();
  const [paymentType, setPaymentType] = useState<string>('Cash');
  const [submitting, setSubmitting] = useState(false);
  const [scanTarget, setScanTarget] = useState<string | null>(null);

  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [eftposRef, setEftposRef] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accClaimNumber, setAccClaimNumber] = useState('');
  const [accPurchaseOrder, setAccPurchaseOrder] = useState('');
  const [giftCardNumber, setGiftCardNumber] = useState('');
  const [tmCardNumber, setTmCardNumber] = useState('');
  const [tmCardName, setTmCardName] = useState('');
  const [tmCardExpiry, setTmCardExpiry] = useState('');
  const [tmPassengerPayType, setTmPassengerPayType] = useState<string>('Cash');
  const [tmPassengerCardNumber, setTmPassengerCardNumber] = useState('');
  const [tmPassengerCardExpiry, setTmPassengerCardExpiry] = useState('');
  const [tmPassengerCardCvc, setTmPassengerCardCvc] = useState('');
  const [tmPassengerEftposRef, setTmPassengerEftposRef] = useState('');

  const meter = paymentJob?.meterSnapshot;
  const breakdown = meter?.breakdown;
  const flagFall = breakdown?.flagFall ?? 0;
  const distanceCharge = breakdown?.distanceCharge ?? 0;
  const waitingCharge = breakdown?.waitingCharge ?? 0;
  const tripFare =
    breakdown?.total ?? meter?.fare ?? paymentJob?.fare ?? paymentJob?.fixedFare ?? 0;

  const tmSplit = useMemo(() => {
    const councilPays = +Math.min(tripFare * TM_SUBSIDY_RATE, TM_SUBSIDY_CAP).toFixed(2);
    const passengerPays = +(tripFare - councilPays).toFixed(2);
    return { councilPays, passengerPays };
  }, [tripFare]);

  if (!paymentJob) return null;

  const buildPaymentRecord = (): PaymentRecord => {
    const base: PaymentRecord = { paymentType, amount: tripFare };
    switch (paymentType) {
      case 'Card':
        return { ...base, cardNumber, cardExpiry, cardCvc };
      case 'EFTPOS':
        return { ...base, eftposRef: eftposRef || undefined };
      case 'Account':
        return { ...base, accountNumber };
      case 'ACC':
        return { ...base, accClaimNumber, accPurchaseOrder };
      case 'Gift Card':
        return { ...base, giftCardNumber };
      case 'TM':
        return {
          ...base,
          tmCardNumber,
          tmCardName,
          tmCardExpiry,
          tmCouncilPays: tmSplit.councilPays,
          tmPassengerPays: tmSplit.passengerPays,
          tmPassengerPaymentType: tmPassengerPayType,
          tmPassengerCardNumber:
            tmPassengerPayType === 'Card' ? tmPassengerCardNumber : undefined,
          tmPassengerCardExpiry:
            tmPassengerPayType === 'Card' ? tmPassengerCardExpiry : undefined,
          tmPassengerCardCvc: tmPassengerPayType === 'Card' ? tmPassengerCardCvc : undefined,
          tmPassengerEftposRef:
            tmPassengerPayType === 'EFTPOS' ? tmPassengerEftposRef : undefined,
        };
      default:
        return base;
    }
  };

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      const record = buildPaymentRecord();
      await finalizePayment(paymentType, EMPTY_EXTRAS, tripFare, record);
    } finally {
      setSubmitting(false);
    }
  };

  const onScanned = (value: string) => {
    if (scanTarget === 'card') setCardNumber(value);
    else if (scanTarget === 'gift') setGiftCardNumber(value);
    else if (scanTarget === 'tm') setTmCardNumber(value);
    setScanTarget(null);
  };

  const renderPaymentForm = () => {
    switch (paymentType) {
      case 'Cash':
        return <Button title={submitting ? 'Saving…' : 'Cash Payment'} onPress={onConfirm} disabled={submitting} />;
      case 'Card':
        return (
          <View style={styles.formBlock}>
            <Field label="Card Number" value={cardNumber} onChangeText={setCardNumber} placeholder="1234 5678 9012 3456" keyboardType="number-pad" />
            <View style={styles.row2}>
              <View style={styles.rowField}>
                <Field label="Expiry" value={cardExpiry} onChangeText={setCardExpiry} placeholder="MM/YY" />
              </View>
              <View style={styles.rowField}>
                <Field label="CVC" value={cardCvc} onChangeText={setCardCvc} placeholder="123" keyboardType="number-pad" />
              </View>
            </View>
            <Pressable style={styles.scanBtn} onPress={() => setScanTarget('card')}>
              <Text style={styles.scanBtnText}>Scan Card</Text>
            </Pressable>
            <Button title={submitting ? 'Saving…' : 'Confirm Card Payment'} onPress={onConfirm} disabled={submitting} />
          </View>
        );
      case 'EFTPOS':
        return (
          <View style={styles.formBlock}>
            <Text style={styles.formTitle}>EFTPOS Transaction</Text>
            <Field label="Transaction Reference (optional)" value={eftposRef} onChangeText={setEftposRef} placeholder="Ref #" />
            <Button title={submitting ? 'Saving…' : 'Confirm EFTPOS Payment'} onPress={onConfirm} disabled={submitting} />
          </View>
        );
      case 'Account':
        return (
          <View style={styles.formBlock}>
            <Field label="Account Number" value={accountNumber} onChangeText={setAccountNumber} placeholder="Account #" keyboardType="number-pad" />
            <Button title={submitting ? 'Saving…' : 'Confirm Account Payment'} onPress={onConfirm} disabled={submitting} />
          </View>
        );
      case 'ACC':
        return (
          <View style={styles.formBlock}>
            <Field label="ACC Claim Number" value={accClaimNumber} onChangeText={setAccClaimNumber} placeholder="Claim #" />
            <Field label="Purchase Order Number" value={accPurchaseOrder} onChangeText={setAccPurchaseOrder} placeholder="PO #" />
            <Button title={submitting ? 'Saving…' : 'Confirm ACC Payment'} onPress={onConfirm} disabled={submitting} />
          </View>
        );
      case 'Gift Card':
        return (
          <View style={styles.formBlock}>
            <Field label="Gift Card Number" value={giftCardNumber} onChangeText={setGiftCardNumber} placeholder="Card #" keyboardType="number-pad" />
            <Pressable style={styles.scanBtn} onPress={() => setScanTarget('gift')}>
              <Text style={styles.scanBtnText}>Scan Gift Card</Text>
            </Pressable>
            <Button title={submitting ? 'Saving…' : 'Confirm Gift Card Payment'} onPress={onConfirm} disabled={submitting} />
          </View>
        );
      case 'TM':
        return (
          <View style={styles.formBlock}>
            <View style={styles.tmBox}>
              <Text style={styles.tmLine}>Council pays ${tmSplit.councilPays.toFixed(2)}</Text>
              <Text style={styles.tmLine}>Passenger pays remaining ${tmSplit.passengerPays.toFixed(2)}</Text>
            </View>
            <Text style={styles.formTitle}>TM Card</Text>
            <Pressable style={styles.scanBtn} onPress={() => setScanTarget('tm')}>
              <Text style={styles.scanBtnText}>Scan TM Card</Text>
            </Pressable>
            <Field label="Card Number" value={tmCardNumber} onChangeText={setTmCardNumber} placeholder="TM card #" keyboardType="number-pad" />
            <Field label="Name on Card" value={tmCardName} onChangeText={setTmCardName} placeholder="Full name" />
            <Field label="Expiry Date" value={tmCardExpiry} onChangeText={setTmCardExpiry} placeholder="MM/YY" />
            <Text style={[styles.formTitle, { marginTop: 12 }]}>Passenger pays ${tmSplit.passengerPays.toFixed(2)} via:</Text>
            <Dropdown label="" value={tmPassengerPayType} options={TM_PASSENGER_PAY_TYPES} onChange={setTmPassengerPayType} />
            {tmPassengerPayType === 'Card' ? (
              <>
                <Field label="Passenger Card Number" value={tmPassengerCardNumber} onChangeText={setTmPassengerCardNumber} keyboardType="number-pad" />
                <View style={styles.row2}>
                  <View style={styles.rowField}>
                    <Field label="Expiry" value={tmPassengerCardExpiry} onChangeText={setTmPassengerCardExpiry} placeholder="MM/YY" />
                  </View>
                  <View style={styles.rowField}>
                    <Field label="CVC" value={tmPassengerCardCvc} onChangeText={setTmPassengerCardCvc} keyboardType="number-pad" />
                  </View>
                </View>
              </>
            ) : null}
            {tmPassengerPayType === 'EFTPOS' ? (
              <Field label="EFTPOS Reference (optional)" value={tmPassengerEftposRef} onChangeText={setTmPassengerEftposRef} />
            ) : null}
            <Button title={submitting ? 'Saving…' : 'Confirm TM Payment'} onPress={onConfirm} disabled={submitting} />
          </View>
        );
      default:
        return <Button title={submitting ? 'Saving…' : 'Confirm Payment'} onPress={onConfirm} disabled={submitting} />;
    }
  };

  return (
    <Modal visible animationType="slide" statusBarTranslucent presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Collect Payment</Text>

          <View style={styles.fareBlock}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Base Charge</Text>
              <Text style={styles.fareVal}>${flagFall.toFixed(2)}</Text>
            </View>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Ride Cost</Text>
              <Text style={styles.fareVal}>${distanceCharge.toFixed(2)}</Text>
            </View>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Waiting Cost</Text>
              <Text style={styles.fareVal}>${waitingCharge.toFixed(2)}</Text>
            </View>
            <View style={styles.tripTotalRow}>
              <Text style={styles.tripTotalLabel}>TRIP TOTAL</Text>
              <Text style={styles.tripTotalVal}>${tripFare.toFixed(2)}</Text>
            </View>
          </View>

          <Dropdown
            label="Payment Type"
            value={paymentType}
            options={DRIVER_PAYMENT_TYPES}
            onChange={setPaymentType}
          />

          {renderPaymentForm()}
        </ScrollView>

        <ScanCardModal
          visible={scanTarget !== null}
          title={
            scanTarget === 'gift'
              ? 'Scan Gift Card'
              : scanTarget === 'tm'
                ? 'Scan TM Card'
                : 'Scan Card'
          }
          onClose={() => setScanTarget(null)}
          onScanned={onScanned}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },
  title: { color: Colors.text, fontSize: 26, fontWeight: '900', marginBottom: 20 },
  fareBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  fareLabel: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  fareVal: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  tripTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tripTotalLabel: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  tripTotalVal: { color: Colors.success, fontSize: 28, fontWeight: '900' },
  dropdownWrap: { marginBottom: 16, zIndex: 10 },
  dropdownLabel: { color: Colors.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  dropdownValue: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  dropdownCaret: { color: Colors.textMuted, fontSize: 14 },
  dropdownList: {
    marginTop: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  dropdownItem: { paddingVertical: 14, paddingHorizontal: 16 },
  dropdownItemOn: { backgroundColor: Colors.accent + '22' },
  dropdownItemText: { color: Colors.text, fontSize: 17 },
  dropdownItemTextOn: { color: Colors.accent, fontWeight: '700' },
  formBlock: { gap: 12, marginTop: 4 },
  formTitle: { color: Colors.text, fontSize: 16, fontWeight: '800' },
  field: { gap: 6 },
  fieldLabel: { color: Colors.textMuted, fontSize: 14, fontWeight: '600' },
  fieldInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
    color: Colors.text,
    fontSize: 16,
  },
  row2: { flexDirection: 'row', gap: 12 },
  rowField: { flex: 1 },
  scanBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  scanBtnText: { color: Colors.accent, fontWeight: '800', fontSize: 15 },
  tmBox: {
    backgroundColor: Colors.accent + '18',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.accent + '44',
    gap: 6,
  },
  tmLine: { color: Colors.text, fontSize: 16, fontWeight: '700' },
});
