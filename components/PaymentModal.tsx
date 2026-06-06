import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { DRIVER_PAYMENT_TYPES, PaymentExtras } from '@/types';
import { useState } from 'react';
import {
  Modal,
  Pressable,
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

const EXTRA_OPTIONS = ['None', 'Bike Fee', 'Airport Fee', 'Other'] as const;
type ExtraOption = (typeof EXTRA_OPTIONS)[number];

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatChangedAt(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-NZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

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

export function PaymentModal() {
  const insets = useSafeAreaInsets();
  const { paymentJob, finalizePayment } = useDriver();
  const [paymentType, setPaymentType] = useState<string>('Cash');
  const [extraOption, setExtraOption] = useState<ExtraOption>('None');
  const [extraAmount, setExtraAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!paymentJob) return null;

  const meter = paymentJob.meterSnapshot;
  const breakdown = meter?.breakdown;
  const flagFall = breakdown?.flagFall ?? 0;
  const distanceKm = breakdown?.distanceKm ?? meter?.distanceKm ?? paymentJob.distanceKm ?? 0;
  const waitingMinutes = breakdown?.waitingMinutes ?? (meter?.waitingMs ?? 0) / 60000;
  const distanceCharge = breakdown?.distanceCharge ?? 0;
  const waitingCharge = breakdown?.waitingCharge ?? 0;
  const tripFare = breakdown?.total ?? meter?.fare ?? paymentJob.fare ?? paymentJob.fixedFare ?? 0;
  const segments = breakdown?.segments ?? [];

  const tripMs = meter?.startedAt
    ? (meter.finishedAt ?? Date.now()) - meter.startedAt - (meter.pausedMs ?? 0)
    : 0;
  const waitingMs = meter?.waitingMs ?? waitingMinutes * 60000;

  const parsedExtra = extraOption === 'None' ? 0 : parseFloat(extraAmount) || 0;
  const extras: PaymentExtras = { ...EMPTY_EXTRAS };
  if (extraOption === 'Bike Fee') extras.bikeCarry = parsedExtra;
  else if (extraOption === 'Airport Fee') extras.airportFee = parsedExtra;
  else if (extraOption === 'Other') extras.other = parsedExtra;

  const extrasTotal =
    extras.bikeCarry + extras.airportFee + extras.eftposSurcharge + extras.tolls + extras.other;
  const total = +(tripFare + extrasTotal).toFixed(2);

  const ratePerKm =
    segments.length === 1
      ? segments[0].ratePerKm
      : distanceKm > 0
        ? distanceCharge / distanceKm
        : meter?.startTariff?.ratePerKm ?? 0;
  const waitRate =
    segments.length === 1
      ? segments[0].waitingPerMin
      : waitingMinutes > 0
        ? waitingCharge / waitingMinutes
        : meter?.startTariff?.waitingPerMin ?? 0;

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
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.body}>
            <Text style={styles.title}>Collect Payment</Text>

            <View style={styles.tripStats}>
              <Text style={styles.tripStatText}>Trip Time: {formatClock(tripMs)}</Text>
              <Text style={styles.tripStatText}>Distance: {distanceKm.toFixed(1)} km</Text>
              <Text style={styles.tripStatText}>Waiting: {formatClock(waitingMs)}</Text>
            </View>

            <View style={styles.fareBlock}>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Base Charge:</Text>
                <Text style={styles.fareVal}>${flagFall.toFixed(2)}</Text>
              </View>

              {segments.length > 1 ? (
                segments.map((seg, i) => (
                  <View key={`${seg.tariffName}-${i}`}>
                    {i > 0 && seg.changedAt ? (
                      <Text style={styles.tariffChanged}>
                        Tariff changed to {seg.tariffName} at {formatChangedAt(seg.changedAt)}
                      </Text>
                    ) : null}
                    {seg.distanceKm > 0 ? (
                      <View style={styles.fareRow}>
                        <Text style={styles.fareLabel}>
                          Ride ({seg.tariffName}): ${seg.distanceCharge.toFixed(2)} ({seg.distanceKm.toFixed(1)}km ×
                          ${seg.ratePerKm.toFixed(2)}/km)
                        </Text>
                      </View>
                    ) : null}
                    {seg.waitingMinutes > 0 ? (
                      <View style={styles.fareRow}>
                        <Text style={styles.fareLabel}>
                          Waiting ({seg.tariffName}): ${seg.waitingCharge.toFixed(2)} (
                          {seg.waitingMinutes.toFixed(1)}min × ${seg.waitingPerMin.toFixed(2)}/min)
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))
              ) : (
                <>
                  <View style={styles.fareRow}>
                    <Text style={styles.fareLabel}>
                      Ride: ${distanceCharge.toFixed(2)} ({distanceKm.toFixed(1)}km × $
                      {ratePerKm.toFixed(2)}/km)
                    </Text>
                  </View>
                  {waitingMinutes > 0 ? (
                    <View style={styles.fareRow}>
                      <Text style={styles.fareLabel}>
                        Waiting: ${waitingCharge.toFixed(2)} ({waitingMinutes.toFixed(1)}min × $
                        {waitRate.toFixed(2)}/min)
                      </Text>
                    </View>
                  ) : null}
                </>
              )}

              <View style={styles.tripTotalRow}>
                <Text style={styles.tripTotalLabel}>TRIP TOTAL:</Text>
                <Text style={styles.tripTotalVal}>${tripFare.toFixed(2)}</Text>
              </View>
            </View>

            <Dropdown
              label="Payment Type"
              value={paymentType}
              options={DRIVER_PAYMENT_TYPES}
              onChange={setPaymentType}
            />

            <Dropdown
              label="Extra Charges"
              value={extraOption}
              options={EXTRA_OPTIONS}
              onChange={(v) => {
                setExtraOption(v as ExtraOption);
                if (v === 'None') setExtraAmount('');
              }}
            />

            {extraOption !== 'None' ? (
              <View style={styles.extraAmountRow}>
                <Text style={styles.extraAmountLabel}>{extraOption} amount</Text>
                <TextInput
                  style={styles.extraAmountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                  value={extraAmount}
                  onChangeText={setExtraAmount}
                />
              </View>
            ) : null}
          </View>

          <View style={styles.footer}>
            <Text style={styles.totalDue}>Total Due: ${total.toFixed(2)}</Text>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '96%',
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
  },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  tripStats: { gap: 2, marginBottom: 10 },
  tripStatText: { color: Colors.textMuted, fontSize: 12, fontWeight: '500' },
  fareBlock: { marginBottom: 10 },
  fareRow: { paddingVertical: 2 },
  fareLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  fareVal: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  tariffChanged: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 2,
  },
  tripTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tripTotalLabel: { color: Colors.text, fontSize: 16, fontWeight: '800' },
  tripTotalVal: { color: Colors.success, fontSize: 22, fontWeight: '900' },
  dropdownWrap: { marginBottom: 8, zIndex: 1 },
  dropdownLabel: { color: Colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dropdownValue: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  dropdownCaret: { color: Colors.textMuted, fontSize: 11 },
  dropdownList: {
    marginTop: 4,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  dropdownItem: { paddingVertical: 10, paddingHorizontal: 12 },
  dropdownItemOn: { backgroundColor: Colors.accent + '22' },
  dropdownItemText: { color: Colors.text, fontSize: 14 },
  dropdownItemTextOn: { color: Colors.accent, fontWeight: '700' },
  extraAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  extraAmountLabel: { color: Colors.textMuted, fontSize: 13, flex: 1 },
  extraAmountInput: {
    width: 88,
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 8,
    color: Colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlign: 'right',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 4,
  },
  totalDue: { color: Colors.success, fontSize: 26, fontWeight: '900', marginBottom: 8 },
});
