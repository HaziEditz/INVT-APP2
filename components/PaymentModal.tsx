import { Button } from '@/components/Button';
import { ScanCardModal } from '@/components/ScanCardModal';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { calcTmSplit, isWavVehicle } from '@/lib/tmConfig';
import {
  DRIVER_PAYMENT_TYPES,
  PaymentExtras,
  PaymentRecord,
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

const TM_PASSENGER_PAY_TYPES = ['Cash', 'Card', 'EFTPOS', 'Account', 'ACC'] as const;
const HOIST_COUNTS = ['1', '2', '3', '4'] as const;
const EXTRA_OPTIONS = [
  { key: 'eftpos', label: 'EFTPOS Fee' },
  { key: 'airport', label: 'Airport Fee' },
  { key: 'bike', label: 'Bike Fee' },
  { key: 'other', label: 'Other' },
] as const;

type ExtraKey = (typeof EXTRA_OPTIONS)[number]['key'];
type PaymentStep = 1 | 2 | 3;

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
      {label ? <Text style={styles.dropdownLabel}>{label}</Text> : null}
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

function StepIndicator({ step }: { step: PaymentStep }) {
  const steps = [
    { n: 1, label: 'Select Payment' },
    { n: 2, label: 'Enter Details' },
    { n: 3, label: 'Confirm' },
  ] as const;

  return (
    <View style={styles.stepRow}>
      {steps.map((s, i) => (
        <View key={s.n} style={styles.stepItem}>
          <View style={[styles.stepDot, step >= s.n && styles.stepDotOn]}>
            <Text style={[styles.stepDotText, step >= s.n && styles.stepDotTextOn]}>{s.n}</Text>
          </View>
          <Text style={[styles.stepLabel, step === s.n && styles.stepLabelOn]}>{s.label}</Text>
          {i < steps.length - 1 ? (
            <View style={[styles.stepLine, step > s.n && styles.stepLineOn]} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function PaymentModal() {
  const insets = useSafeAreaInsets();
  const { paymentJob, finalizePayment, tmConfig, activeVehicleBodyType } = useDriver();
  const [paymentStep, setPaymentStep] = useState<PaymentStep>(1);
  const [paymentType, setPaymentType] = useState<string>('Cash');
  const [submitting, setSubmitting] = useState(false);
  const [scanTarget, setScanTarget] = useState<string | null>(null);
  const [extrasSheetOpen, setExtrasSheetOpen] = useState(false);
  const [editingExtra, setEditingExtra] = useState<ExtraKey | null>(null);

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
  const [tmHoistCount, setTmHoistCount] = useState('1');
  const [tmPassengerPayType, setTmPassengerPayType] = useState<string>('Cash');
  const [tmPassengerCardNumber, setTmPassengerCardNumber] = useState('');
  const [tmPassengerCardExpiry, setTmPassengerCardExpiry] = useState('');
  const [tmPassengerCardCvc, setTmPassengerCardCvc] = useState('');
  const [tmPassengerEftposRef, setTmPassengerEftposRef] = useState('');
  const [tmPassengerAccountNumber, setTmPassengerAccountNumber] = useState('');
  const [tmPassengerAccClaimNumber, setTmPassengerAccClaimNumber] = useState('');
  const [tmPassengerAccPurchaseOrder, setTmPassengerAccPurchaseOrder] = useState('');

  const [extraEftposFee, setExtraEftposFee] = useState('');
  const [extraAirportFee, setExtraAirportFee] = useState('');
  const [extraBikeCarryFee, setExtraBikeCarryFee] = useState('');
  const [extraOtherAmount, setExtraOtherAmount] = useState('');
  const [extraOtherNote, setExtraOtherNote] = useState('');

  const meter = paymentJob?.meterSnapshot;
  const breakdown = meter?.breakdown;
  const flagFall = breakdown?.flagFall ?? 0;
  const distanceCharge = breakdown?.distanceCharge ?? 0;
  const waitingCharge = breakdown?.waitingCharge ?? 0;
  const tripFare =
    breakdown?.total ?? meter?.fare ?? paymentJob?.fare ?? paymentJob?.fixedFare ?? 0;

  const isWav = isWavVehicle(activeVehicleBodyType);

  const tmSplit = useMemo(() => {
    const fareSplit = calcTmSplit(tripFare, tmConfig);
    const hoistCount = isWav ? parseInt(tmHoistCount, 10) || 0 : 0;
    const hoistTotal = +(hoistCount * tmConfig.hoistCostPerUnit).toFixed(2);
    const councilTotalPays = +(fareSplit.councilFarePays + hoistTotal).toFixed(2);
    return {
      ...fareSplit,
      hoistCount,
      hoistTotal,
      councilTotalPays,
    };
  }, [tripFare, tmConfig, tmHoistCount, isWav]);

  const extras: PaymentExtras = useMemo(
    () => ({
      eftposSurcharge: parseFloat(extraEftposFee) || 0,
      airportFee: parseFloat(extraAirportFee) || 0,
      bikeCarry: parseFloat(extraBikeCarryFee) || 0,
      tolls: 0,
      other: parseFloat(extraOtherAmount) || 0,
      otherNote: extraOtherNote.trim() || undefined,
    }),
    [extraEftposFee, extraAirportFee, extraBikeCarryFee, extraOtherAmount, extraOtherNote],
  );

  const extrasTotal = useMemo(
    () =>
      +(
        extras.eftposSurcharge +
        extras.airportFee +
        extras.bikeCarry +
        extras.tolls +
        extras.other
      ).toFixed(2),
    [extras],
  );

  const totalDue = +(tripFare + extrasTotal).toFixed(2);

  const extrasSummaryParts = useMemo(() => {
    const parts: string[] = [];
    if (extras.eftposSurcharge > 0) parts.push(`EFTPOS $${extras.eftposSurcharge.toFixed(2)}`);
    if (extras.airportFee > 0) parts.push(`Airport $${extras.airportFee.toFixed(2)}`);
    if (extras.bikeCarry > 0) parts.push(`Bike $${extras.bikeCarry.toFixed(2)}`);
    if (extras.other > 0) {
      const note = extras.otherNote ? ` (${extras.otherNote})` : '';
      parts.push(`Other $${extras.other.toFixed(2)}${note}`);
    }
    return parts;
  }, [extras]);

  if (!paymentJob) return null;

  const goBack = () => {
    if (paymentStep === 3) setPaymentStep(2);
    else if (paymentStep === 2) setPaymentStep(1);
  };

  const buildPaymentRecord = (): PaymentRecord => {
    const base: PaymentRecord = { paymentType, amount: totalDue };
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
          tmCouncilSubsidyPercent: tmConfig.councilSubsidyPercent,
          tmCouncilCapAmount: tmConfig.councilCapAmount,
          tmCouncilFarePays: tmSplit.councilFarePays,
          tmCouncilPays: tmSplit.councilTotalPays,
          tmPassengerPays: tmSplit.passengerPays,
          tmHoistCount: tmSplit.hoistCount || undefined,
          tmHoistCostPerUnit: isWav ? tmConfig.hoistCostPerUnit : undefined,
          tmHoistTotal: tmSplit.hoistTotal || undefined,
          tmPassengerPaymentType: tmPassengerPayType,
          tmPassengerCardNumber:
            tmPassengerPayType === 'Card' ? tmPassengerCardNumber : undefined,
          tmPassengerCardExpiry:
            tmPassengerPayType === 'Card' ? tmPassengerCardExpiry : undefined,
          tmPassengerCardCvc: tmPassengerPayType === 'Card' ? tmPassengerCardCvc : undefined,
          tmPassengerEftposRef:
            tmPassengerPayType === 'EFTPOS' ? tmPassengerEftposRef : undefined,
          tmPassengerAccountNumber:
            tmPassengerPayType === 'Account' ? tmPassengerAccountNumber : undefined,
          tmPassengerAccClaimNumber:
            tmPassengerPayType === 'ACC' ? tmPassengerAccClaimNumber : undefined,
          tmPassengerAccPurchaseOrder:
            tmPassengerPayType === 'ACC' ? tmPassengerAccPurchaseOrder : undefined,
        };
      default:
        return base;
    }
  };

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      const record = buildPaymentRecord();
      await finalizePayment(paymentType, extras, totalDue, record);
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

  const closeExtrasSheet = () => {
    setExtrasSheetOpen(false);
    setEditingExtra(null);
  };

  const renderExtraEditor = () => {
    if (!editingExtra) return null;
    switch (editingExtra) {
      case 'eftpos':
        return (
          <Field
            label="EFTPOS Fee amount"
            value={extraEftposFee}
            onChangeText={setExtraEftposFee}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
        );
      case 'airport':
        return (
          <Field
            label="Airport Fee amount"
            value={extraAirportFee}
            onChangeText={setExtraAirportFee}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
        );
      case 'bike':
        return (
          <Field
            label="Bike Fee amount"
            value={extraBikeCarryFee}
            onChangeText={setExtraBikeCarryFee}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
        );
      case 'other':
        return (
          <>
            <Field
              label="Description (optional)"
              value={extraOtherNote}
              onChangeText={setExtraOtherNote}
              placeholder="e.g. Toll, luggage"
            />
            <Field
              label="Other amount"
              value={extraOtherAmount}
              onChangeText={setExtraOtherAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
          </>
        );
      default:
        return null;
    }
  };

  const renderPaymentDetails = () => {
    switch (paymentType) {
      case 'Cash':
        return <Text style={styles.stepHint}>No extra details needed for cash.</Text>;
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
          </View>
        );
      case 'EFTPOS':
        return (
          <View style={styles.formBlock}>
            <Text style={styles.formTitle}>EFTPOS Transaction</Text>
            <Field label="Transaction Reference (optional)" value={eftposRef} onChangeText={setEftposRef} placeholder="Ref #" />
          </View>
        );
      case 'Account':
        return (
          <View style={styles.formBlock}>
            <Field label="Account Number" value={accountNumber} onChangeText={setAccountNumber} placeholder="Account #" keyboardType="number-pad" />
          </View>
        );
      case 'ACC':
        return (
          <View style={styles.formBlock}>
            <Field label="ACC Claim Number" value={accClaimNumber} onChangeText={setAccClaimNumber} placeholder="Claim #" />
            <Field label="Purchase Order Number" value={accPurchaseOrder} onChangeText={setAccPurchaseOrder} placeholder="PO #" />
          </View>
        );
      case 'Gift Card':
        return (
          <View style={styles.formBlock}>
            <Field label="Gift Card Number" value={giftCardNumber} onChangeText={setGiftCardNumber} placeholder="Card #" keyboardType="number-pad" />
            <Pressable style={styles.scanBtn} onPress={() => setScanTarget('gift')}>
              <Text style={styles.scanBtnText}>Scan Gift Card</Text>
            </Pressable>
          </View>
        );
      case 'TM':
        return (
          <View style={styles.formBlock}>
            <View style={styles.tmBox}>
              <Text style={styles.tmLine}>
                Council pays ${tmSplit.councilFarePays.toFixed(2)} ({tmConfig.councilSubsidyPercent}% up to $
                {tmConfig.councilCapAmount.toFixed(2)})
              </Text>
              <Text style={styles.tmLine}>Passenger pays remaining ${tmSplit.passengerPays.toFixed(2)}</Text>
            </View>

            {isWav ? (
              <>
                <Text style={styles.formTitle}>Hoist Charges (WAV)</Text>
                <Dropdown label="Number of hoists" value={tmHoistCount} options={HOIST_COUNTS} onChange={setTmHoistCount} />
                <Text style={styles.hoistLine}>
                  Hoist charges: {tmSplit.hoistCount} hoist{tmSplit.hoistCount === 1 ? '' : 's'} × $
                  {tmConfig.hoistCostPerUnit.toFixed(2)} = ${tmSplit.hoistTotal.toFixed(2)} (council pays)
                </Text>
                <Text style={styles.tmSubLine}>
                  Council total (fare + hoist): ${tmSplit.councilTotalPays.toFixed(2)}
                </Text>
              </>
            ) : null}

            <Text style={styles.formTitle}>TM Card</Text>
            <Pressable style={styles.scanBtn} onPress={() => setScanTarget('tm')}>
              <Text style={styles.scanBtnText}>Scan TM Card</Text>
            </Pressable>
            <Field label="Card Number" value={tmCardNumber} onChangeText={setTmCardNumber} placeholder="TM card #" keyboardType="number-pad" />
            <Field label="Name on Card" value={tmCardName} onChangeText={setTmCardName} placeholder="Full name" />
            <Field label="Expiry Date" value={tmCardExpiry} onChangeText={setTmCardExpiry} placeholder="MM/YY" />

            <Text style={[styles.formTitle, { marginTop: 12 }]}>
              Passenger pays ${tmSplit.passengerPays.toFixed(2)} via:
            </Text>
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
            {tmPassengerPayType === 'Account' ? (
              <Field
                label="Passenger Account Number"
                value={tmPassengerAccountNumber}
                onChangeText={setTmPassengerAccountNumber}
                placeholder="Account #"
                keyboardType="number-pad"
              />
            ) : null}
            {tmPassengerPayType === 'ACC' ? (
              <>
                <Field
                  label="ACC Claim Number"
                  value={tmPassengerAccClaimNumber}
                  onChangeText={setTmPassengerAccClaimNumber}
                  placeholder="Claim #"
                />
                <Field
                  label="Purchase Order Number"
                  value={tmPassengerAccPurchaseOrder}
                  onChangeText={setTmPassengerAccPurchaseOrder}
                  placeholder="PO #"
                />
              </>
            ) : null}
          </View>
        );
      default:
        return null;
    }
  };

  const renderConfirmSummary = () => (
    <View style={styles.confirmBlock}>
      <View style={styles.fareRow}>
        <Text style={styles.fareLabel}>Trip fare</Text>
        <Text style={styles.fareVal}>${tripFare.toFixed(2)}</Text>
      </View>
      {extrasTotal > 0 ? (
        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>Extras</Text>
          <Text style={styles.fareVal}>+${extrasTotal.toFixed(2)}</Text>
        </View>
      ) : null}
      <View style={styles.tripTotalRow}>
        <Text style={styles.tripTotalLabel}>TOTAL DUE</Text>
        <Text style={styles.tripTotalVal}>${totalDue.toFixed(2)}</Text>
      </View>
      <Text style={styles.confirmPayType}>Payment: {paymentType}</Text>
      {extrasSummaryParts.length > 0 ? (
        <Text style={styles.confirmExtras}>Extras: {extrasSummaryParts.join(', ')}</Text>
      ) : null}
    </View>
  );

  return (
    <Modal visible animationType="slide" statusBarTranslucent presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          {paymentStep > 1 ? (
            <Pressable style={styles.backBtn} onPress={goBack}>
              <Text style={styles.backBtnText}>← Back</Text>
            </Pressable>
          ) : (
            <View style={styles.backPlaceholder} />
          )}
          <Text style={styles.headerTitle}>Collect Payment</Text>
          <View style={styles.backPlaceholder} />
        </View>

        <StepIndicator step={paymentStep} />

        {paymentStep > 1 ? (
          <View style={styles.payTypeBanner}>
            <Text style={styles.payTypeBannerLabel}>Payment type</Text>
            <Text style={styles.payTypeBannerValue}>{paymentType}</Text>
          </View>
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {paymentStep === 1 ? (
            <>
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

              <Pressable style={styles.extrasBtn} onPress={() => setExtrasSheetOpen(true)}>
                <Text style={styles.extrasBtnText}>Extra Charges</Text>
                <Text style={styles.extrasBtnCaret}>›</Text>
              </Pressable>
              {extrasSummaryParts.length > 0 ? (
                <Text style={styles.extrasSummary}>
                  {extrasSummaryParts.join(' · ')} (+${extrasTotal.toFixed(2)})
                </Text>
              ) : null}

              <View style={styles.totalDueBlock}>
                <Text style={styles.totalDueLabel}>Total Due</Text>
                <Text style={styles.totalDueVal}>${totalDue.toFixed(2)}</Text>
              </View>

              <Dropdown
                label="Payment Type"
                value={paymentType}
                options={DRIVER_PAYMENT_TYPES}
                onChange={setPaymentType}
              />

              <Button title="Continue to Details" onPress={() => setPaymentStep(2)} />
            </>
          ) : null}

          {paymentStep === 2 ? (
            <>
              <Text style={styles.stepSectionTitle}>Enter payment details</Text>
              {renderPaymentDetails()}
              <Button title="Continue to Confirm" onPress={() => setPaymentStep(3)} />
            </>
          ) : null}

          {paymentStep === 3 ? (
            <>
              <Text style={styles.stepSectionTitle}>Review and confirm</Text>
              {renderConfirmSummary()}
              <Button
                title={submitting ? 'Saving…' : `Confirm ${paymentType} Payment`}
                onPress={onConfirm}
                disabled={submitting}
              />
            </>
          ) : null}
        </ScrollView>

        <Modal visible={extrasSheetOpen} transparent animationType="slide">
          <Pressable style={styles.sheetBackdrop} onPress={closeExtrasSheet}>
            <Pressable style={styles.sheetPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.sheetTitle}>Extra Charges</Text>
              {!editingExtra ? (
                <View style={styles.sheetOptions}>
                  {EXTRA_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.key}
                      style={styles.sheetOption}
                      onPress={() => setEditingExtra(opt.key)}
                    >
                      <Text style={styles.sheetOptionText}>{opt.label}</Text>
                      <Text style={styles.sheetOptionCaret}>›</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={styles.sheetEditor}>
                  <Pressable style={styles.sheetBackLink} onPress={() => setEditingExtra(null)}>
                    <Text style={styles.sheetBackLinkText}>← All extras</Text>
                  </Pressable>
                  {renderExtraEditor()}
                </View>
              )}
              <Button title="Done" onPress={closeExtrasSheet} />
            </Pressable>
          </Pressable>
        </Modal>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: { minWidth: 72, paddingVertical: 8 },
  backBtnText: { color: Colors.accent, fontSize: 16, fontWeight: '800' },
  backPlaceholder: { minWidth: 72 },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 4,
  },
  stepItem: { flex: 1, alignItems: 'center', position: 'relative' },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotOn: { borderColor: Colors.accent, backgroundColor: Colors.accent + '22' },
  stepDotText: { color: Colors.textMuted, fontSize: 13, fontWeight: '800' },
  stepDotTextOn: { color: Colors.accent },
  stepLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  stepLabelOn: { color: Colors.text, fontWeight: '800' },
  stepLine: {
    position: 'absolute',
    top: 14,
    left: '55%',
    right: '-45%',
    height: 2,
    backgroundColor: Colors.border,
    zIndex: -1,
  },
  stepLineOn: { backgroundColor: Colors.accent },
  payTypeBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: Colors.accent + '18',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent + '44',
    alignItems: 'center',
  },
  payTypeBannerLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  payTypeBannerValue: { color: Colors.text, fontSize: 32, fontWeight: '900', marginTop: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 16 },
  fareBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
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
  extrasBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  extrasBtnText: { color: Colors.text, fontSize: 17, fontWeight: '800' },
  extrasBtnCaret: { color: Colors.textMuted, fontSize: 22, fontWeight: '300' },
  extrasSummary: { color: Colors.textMuted, fontSize: 14, fontWeight: '600', marginTop: -8 },
  dropdownWrap: { zIndex: 10 },
  dropdownLabel: { color: Colors.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 18,
    paddingHorizontal: 16,
    minHeight: 58,
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
  dropdownItem: { paddingVertical: 16, paddingHorizontal: 16 },
  dropdownItemOn: { backgroundColor: Colors.accent + '22' },
  dropdownItemText: { color: Colors.text, fontSize: 17 },
  dropdownItemTextOn: { color: Colors.accent, fontWeight: '700' },
  formBlock: { gap: 12 },
  formTitle: { color: Colors.text, fontSize: 16, fontWeight: '800' },
  stepSectionTitle: { color: Colors.text, fontSize: 20, fontWeight: '900' },
  stepHint: { color: Colors.textMuted, fontSize: 15, fontWeight: '600' },
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
  tmSubLine: { color: Colors.textMuted, fontSize: 14, fontWeight: '600' },
  hoistLine: { color: Colors.text, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  totalDueBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  totalDueLabel: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  totalDueVal: { color: Colors.success, fontSize: 30, fontWeight: '900' },
  confirmBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  confirmPayType: { color: Colors.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  confirmExtras: { color: Colors.textMuted, fontSize: 14, fontWeight: '600' },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetPanel: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 28,
    gap: 16,
  },
  sheetTitle: { color: Colors.text, fontSize: 20, fontWeight: '900' },
  sheetOptions: { gap: 8 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  sheetOptionText: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  sheetOptionCaret: { color: Colors.textMuted, fontSize: 20 },
  sheetEditor: { gap: 12 },
  sheetBackLink: { alignSelf: 'flex-start' },
  sheetBackLinkText: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
});
