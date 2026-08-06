import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import {
  cachedAccountToSearchHit,
  rememberBusinessAccount,
  searchCachedAccounts,
} from '@/lib/accountCache';
import { searchBusinessAccounts, type DriverAccountSearchHit } from '@/lib/dispatchApi';
import { normalizeDriverPaymentType } from '@/lib/driverPayment';
import {
  buildTmHoistEntries,
  calcTmPaymentBreakdown,
  loadTmConfig,
  resolvePrimaryTmCard,
  TmConfig,
} from '@/lib/tmConfig';
import { computePaymentFareSummary, completionErrorMessage } from '@/lib/tripCompletionHelpers';
import {
  DRIVER_PAYMENT_TYPES,
  DriverPaymentType,
  PaymentExtras,
  TM_PASSENGER_PAYMENT_TYPES,
  TmPaymentDetails,
} from '@/types';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  const { paymentJob, finalizePayment, activeVehicle, selectedTariff, dismissPayment } = useDriver();

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
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountHits, setAccountHits] = useState<DriverAccountSearchHit[]>([]);
  const [accountSearching, setAccountSearching] = useState(false);
  const [accountSearchError, setAccountSearchError] = useState('');
  const [accountFromCache, setAccountFromCache] = useState(false);
  const [accountAllowFreeText, setAccountAllowFreeText] = useState(false);
  const accountSearchSeq = useRef(0);
  const [accClaimNo, setAccClaimNo] = useState('');
  const [accPoNo, setAccPoNo] = useState('');
  const [tmCardNumber, setTmCardNumber] = useState('');
  const [tmCardExpiry, setTmCardExpiry] = useState('');
  /** WAV: one row per hoist use / wheelchair passenger (1× rate each). */
  const [hoistRows, setHoistRows] = useState<{ key: string; cardNumber: string; cardExpiry: string }[]>(
    [],
  );

  const isTmPayment = paymentType === 'TM';
  const isWav = !!activeVehicle?.isWav;
  const accountLockedFromDispatch = !!String(paymentJob?.accountId || '').trim();

  useEffect(() => {
    if (!paymentJob) return;
    const seeded =
      normalizeDriverPaymentType(paymentJob.paymentType) ?? ('Cash' as DriverPaymentType);
    setPaymentType(seeded);
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
    setAccountId(String(paymentJob.accountId || '').trim());
    setAccountName(String(paymentJob.accountName || '').trim());
    setAccountSearch('');
    setAccountHits([]);
    setAccountSearchError('');
    setAccountFromCache(false);
    setAccountAllowFreeText(false);
    setAccClaimNo('');
    setAccPoNo('');
    setTmCardNumber('');
    setTmCardExpiry('');
    setHoistRows([]);
  }, [paymentJob?.id]);

  useEffect(() => {
    const accountUiActive =
      paymentType === 'Account' ||
      (paymentType === 'TM' && tmPassengerPaymentType === 'Account');
    if (!accountUiActive || accountLockedFromDispatch || accountId) {
      setAccountHits([]);
      setAccountSearching(false);
      setAccountSearchError('');
      setAccountFromCache(false);
      return;
    }
    const q = accountSearch.trim();
    if (q.length < 2) {
      setAccountHits([]);
      setAccountSearchError('');
      setAccountFromCache(false);
      setAccountAllowFreeText(false);
      return;
    }
    const seq = ++accountSearchSeq.current;
    setAccountSearching(true);
    setAccountSearchError('');
    setAccountAllowFreeText(false);
    const companyId = String(driver?.companyId || '').trim();

    const applyCacheHits = async (errMsg?: string) => {
      if (!companyId) {
        setAccountHits([]);
        setAccountFromCache(false);
        setAccountAllowFreeText(true);
        setAccountSearchError(
          errMsg || 'Offline — type the account name/number to continue; we will match it on reconnect.',
        );
        return;
      }
      const cached = await searchCachedAccounts(companyId, q);
      if (seq !== accountSearchSeq.current) return;
      const hits = cached.map(cachedAccountToSearchHit);
      setAccountHits(hits);
      setAccountFromCache(hits.length > 0);
      setAccountAllowFreeText(true);
      if (hits.length === 0) {
        setAccountSearchError(
          errMsg ||
            'No cached accounts match. You can confirm with the typed name — we will resolve it when online.',
        );
      } else {
        setAccountSearchError(errMsg ? `${errMsg} Showing recent/cached accounts.` : '');
      }
    };

    const t = setTimeout(() => {
      void (async () => {
        const net = await NetInfo.fetch().catch(() => null);
        const offline = net?.isConnected === false;
        if (offline) {
          await applyCacheHits('You appear offline.');
          if (seq === accountSearchSeq.current) setAccountSearching(false);
          return;
        }
        try {
          const hits = await searchBusinessAccounts(q);
          if (seq !== accountSearchSeq.current) return;
          setAccountHits(hits);
          setAccountFromCache(false);
          setAccountAllowFreeText(false);
          setAccountSearchError(
            hits.length === 0 ? 'No matching business accounts found.' : '',
          );
          if (companyId && hits.length > 0) {
            for (const hit of hits.slice(0, 8)) {
              const id = String(hit.Id ?? '').trim();
              if (!id) continue;
              void rememberBusinessAccount(companyId, {
                id,
                name: String(hit.Name || '').trim() || id,
                accountCode: String(hit.AccountCode || '').trim() || undefined,
              }).catch(() => {});
            }
          }
        } catch (err) {
          if (seq !== accountSearchSeq.current) return;
          const msg =
            err instanceof Error && err.message
              ? err.message
              : 'Account search failed. Check connection and try again.';
          await applyCacheHits(msg);
        } finally {
          if (seq === accountSearchSeq.current) setAccountSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [
    paymentType,
    accountSearch,
    accountLockedFromDispatch,
    accountId,
    paymentJob?.id,
    driver?.companyId,
    tmPassengerPaymentType,
  ]);

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
    try {
      return computePaymentFareSummary(paymentJob, selectedTariff);
    } catch (err) {
      console.error('[PaymentModal] fare summary failed:', err);
      return computePaymentFareSummary(paymentJob, null);
    }
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

  const hoistCostPerUnit = tmConfig?.hoistCostPerUnit ?? 0;
  const tmHoistEntries =
    isTmPayment && isWav ? buildTmHoistEntries(hoistRows, hoistCostPerUnit) : [];
  /** Count = number of hoist rows with a card (1× rate each). */
  const hoistUnits = tmHoistEntries.length;
  /** Meter + extras only — hoist must NOT enter the %/cap split (NZ TM / Phase 2A.1). */
  const meterSubtotal = +(fare.tripTotal + extrasTotal).toFixed(2);
  const tmBreakdown =
    isTmPayment && tmConfig
      ? calcTmPaymentBreakdown(meterSubtotal, hoistUnits, tmConfig)
      : null;
  const hoistTotal = tmBreakdown?.hoistTotal ?? +(hoistUnits * hoistCostPerUnit).toFixed(2);
  const subtotal = tmBreakdown
    ? tmBreakdown.totalFare
    : +(meterSubtotal + hoistTotal).toFixed(2);
  const tmSplit = tmBreakdown
    ? {
        councilPays: tmBreakdown.councilPays,
        passengerPays: tmBreakdown.passengerPays,
        councilPaysMeter: tmBreakdown.councilPaysMeter,
        passengerPaysMeter: tmBreakdown.passengerPaysMeter,
        councilPaysHoist: tmBreakdown.councilPaysHoist,
        meterFare: tmBreakdown.meterFare,
      }
    : {
        councilPays: 0,
        passengerPays: subtotal,
        councilPaysMeter: 0,
        passengerPaysMeter: subtotal,
        councilPaysHoist: 0,
        meterFare: meterSubtotal,
      };
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
    ...(paymentType === 'EFTPOS' || (isTmPayment && tmPassengerPaymentType === 'EFTPOS')
      ? eftposRef.trim()
        ? { eftposRef: eftposRef.trim() }
        : {}
      : {}),
    ...(paymentType === 'ACC' || (isTmPayment && tmPassengerPaymentType === 'ACC')
      ? {
          ...(accClaimNo.trim() ? { accClaimNo: accClaimNo.trim() } : {}),
          ...(accPoNo.trim() ? { accPoNo: accPoNo.trim() } : {}),
        }
      : {}),
  };

  const onScanCard = () => {
    Alert.alert('Scan card', 'Camera card scan is not available in this build. Enter card details manually.');
  };

  const onConfirm = async () => {
    const needsAccount =
      paymentType === 'Account' || (isTmPayment && tmPassengerPaymentType === 'Account');
    const typedAccount = String(accountName || accountSearch || '').trim();
    const selectedAccountId = String(accountId || '').trim();
    if (needsAccount && !selectedAccountId) {
      if (typedAccount.length < 2) {
        Alert.alert(
          'Select account',
          accountAllowFreeText
            ? 'Type at least 2 characters for the account name/number, or select a cached account.'
            : 'Search and select a business account before confirming.',
        );
        return;
      }
      if (!accountAllowFreeText) {
        Alert.alert('Select account', 'Search and select a business account before confirming.');
        return;
      }
    }
    setSubmitting(true);
    try {
      let tmDetails: TmPaymentDetails | undefined;
      if (isTmPayment) {
        if (isWav && hoistRows.some((r) => !String(r.cardNumber || '').trim())) {
          Alert.alert(
            'Hoist card required',
            'Each hoist entry needs its own TM card number (one wheelchair passenger per row).',
          );
          setSubmitting(false);
          return;
        }
        const primary = resolvePrimaryTmCard(tmCardNumber, tmCardExpiry, tmHoistEntries);
        tmDetails = {
          councilPays: tmSplit.councilPays,
          passengerPays: tmSplit.passengerPays,
          meterFare: tmSplit.meterFare,
          tmSubsidyFare: tmSplit.councilPaysMeter,
          hoistTotal: hoistTotal > 0 ? hoistTotal : undefined,
          tmSubsidyHoist: hoistTotal > 0 ? hoistTotal : undefined,
          hoistCount: hoistUnits > 0 ? hoistUnits : undefined,
          tmHoists: tmHoistEntries.length ? tmHoistEntries : undefined,
          tmCardNumber: primary.tmCardNumber,
          tmCardExpiry: primary.tmCardExpiry,
          totalFare: subtotal,
        };
      }

      const finalPaymentType = isTmPayment ? tmPassengerPaymentType : paymentType;
      const accountDetails =
        finalPaymentType === 'Account' || paymentType === 'Account'
          ? selectedAccountId
            ? {
                accountId: selectedAccountId,
                accountName: String(accountName || '').trim() || undefined,
              }
            : {
                accountName: typedAccount,
                accountRef: typedAccount,
                accountPending: true,
              }
          : undefined;
      await finalizePayment(finalPaymentType, builtExtras, subtotal, tmDetails, accountDetails);
    } catch (err) {
      console.error('[PaymentModal] finalizePayment failed:', err);
      const msg = completionErrorMessage(err);
      Alert.alert(
        'Could not complete job',
        msg,
        [
          { text: 'Back to payment', style: 'cancel' },
          { text: 'Retry', onPress: () => void onConfirm() },
        ],
      );
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
            {accountId ? (
              <View style={styles.accountSelected}>
                <Text style={styles.accountSelectedLabel}>Business account</Text>
                <Text style={styles.accountSelectedName}>
                  {accountName || 'Account selected'}
                </Text>
                {!accountLockedFromDispatch ? (
                  <TouchableOpacity
                    onPress={() => {
                      setAccountId('');
                      setAccountName('');
                      setAccountSearch('');
                      setAccountAllowFreeText(false);
                    }}
                  >
                    <Text style={styles.accountChange}>Change</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <>
                <Text style={styles.accountHint}>
                  {accountAllowFreeText
                    ? 'Search cached accounts, or type the account name/number to confirm offline'
                    : 'Search and select a business account'}
                </Text>
                <TextInput
                  style={styles.field}
                  placeholder="Search business name or account number…"
                  placeholderTextColor={Colors.textMuted}
                  value={accountSearch}
                  onChangeText={(t) => {
                    setAccountSearch(t);
                    setAccountId('');
                    setAccountName('');
                  }}
                  autoCorrect={false}
                />
                {accountSearching ? (
                  <ActivityIndicator color={Colors.accent} style={{ marginVertical: 8 }} />
                ) : null}
                {accountFromCache ? (
                  <Text style={styles.hint}>Showing recent/cached accounts</Text>
                ) : null}
                {accountSearchError ? (
                  <Text style={styles.accountSearchError}>{accountSearchError}</Text>
                ) : null}
                {accountHits.map((hit) => {
                  const id = String(hit.Id ?? '');
                  const name = String(hit.Name || '').trim() || id;
                  return (
                    <TouchableOpacity
                      key={id || name}
                      style={styles.accountHit}
                      onPress={() => {
                        setAccountId(id);
                        setAccountName(name);
                        setAccountSearch(name);
                        setAccountHits([]);
                        setAccountAllowFreeText(false);
                        const cid = String(driver?.companyId || '').trim();
                        if (cid && id) {
                          void rememberBusinessAccount(cid, {
                            id,
                            name,
                            accountCode: String(hit.AccountCode || '').trim() || undefined,
                          }).catch(() => {});
                        }
                      }}
                    >
                      <Text style={styles.accountHitName}>{name}</Text>
                      {hit.AccountCode ? (
                        <Text style={styles.accountHitMeta}>{String(hit.AccountCode)}</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
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
            <Text style={styles.subSection}>Meter fare (subsidy applies)</Text>
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Meter + extras</Text>
              <Text style={styles.tmValue}>{fmtMoney(tmSplit.meterFare)}</Text>
            </View>
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Council (meter subsidy)</Text>
              <Text style={styles.tmValue}>{fmtMoney(tmSplit.councilPaysMeter)}</Text>
            </View>
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Passenger (meter share)</Text>
              <Text style={[styles.tmValue, styles.tmPassenger]}>
                {fmtMoney(tmSplit.passengerPaysMeter)}
              </Text>
            </View>
            <Text style={[styles.subSection, { marginTop: 10 }]}>Primary TM card (optional)</Text>
            <Text style={styles.hint}>
              Leave blank if every passenger is on a hoist row — the first hoist card is used as
              primary. Does not reduce hoist fees.
            </Text>
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
                <Text style={styles.subSection}>
                  Hoist passengers (100% council · {fmtMoney(hoistCostPerUnit)} / use)
                </Text>
                <Text style={styles.hint}>
                  Add one row per wheelchair passenger. Each gets a full hoist fee on their own
                  card.
                </Text>
                {hoistRows.map((row, idx) => (
                  <View key={row.key} style={styles.hoistRow}>
                    <Text style={styles.hoistRowLabel}>Hoist {idx + 1}</Text>
                    <TextInput
                      style={styles.field}
                      placeholder="TM card number *"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="number-pad"
                      value={row.cardNumber}
                      onChangeText={(v) =>
                        setHoistRows((prev) =>
                          prev.map((r) => (r.key === row.key ? { ...r, cardNumber: v } : r)),
                        )
                      }
                    />
                    <TextInput
                      style={styles.field}
                      placeholder="Expiry MM/YY (optional)"
                      placeholderTextColor={Colors.textMuted}
                      value={row.cardExpiry}
                      onChangeText={(v) =>
                        setHoistRows((prev) =>
                          prev.map((r) => (r.key === row.key ? { ...r, cardExpiry: v } : r)),
                        )
                      }
                    />
                    <View style={styles.hoistRowFooter}>
                      <Text style={styles.hoistRate}>{fmtMoney(hoistCostPerUnit)} council</Text>
                      <TouchableOpacity
                        onPress={() =>
                          setHoistRows((prev) => prev.filter((r) => r.key !== row.key))
                        }
                      >
                        <Text style={styles.hoistRemove}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.hoistAddBtn}
                  onPress={() =>
                    setHoistRows((prev) => [
                      ...prev,
                      {
                        key: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        cardNumber: '',
                        cardExpiry: '',
                      },
                    ])
                  }
                >
                  <Text style={styles.hoistAddText}>+ Add hoist passenger</Text>
                </TouchableOpacity>
                <View style={styles.tmRow}>
                  <Text style={styles.tmLabel}>
                    Hoist fee ({hoistUnits} × {fmtMoney(hoistCostPerUnit)})
                  </Text>
                  <Text style={styles.tmValue}>{fmtMoney(hoistTotal)}</Text>
                </View>
                <Text style={styles.hint}>Passenger pays $0 toward hoist.</Text>
              </View>
            ) : null}
            <View style={[styles.tmRow, { marginTop: 8 }]}>
              <Text style={[styles.tmLabel, { fontWeight: '700' }]}>Total council</Text>
              <Text style={[styles.tmValue, { fontWeight: '700' }]}>
                {fmtMoney(tmSplit.councilPays)}
              </Text>
            </View>
            <View style={styles.tmRow}>
              <Text style={[styles.tmLabel, { fontWeight: '700' }]}>Collect from passenger</Text>
              <Text style={[styles.tmValue, styles.tmPassenger, { fontWeight: '700' }]}>
                {fmtMoney(tmSplit.passengerPays)}
              </Text>
            </View>
            <Dropdown
              label="Passenger pays remaining via"
              value={tmPassengerPaymentType}
              options={TM_PASSENGER_PAYMENT_TYPES}
              onChange={setTmPassengerPaymentType}
            />
            {tmPassengerPaymentType === 'Account' ? (
              <View style={{ marginTop: 12 }}>
                {accountId ? (
                  <View style={styles.accountSelected}>
                    <Text style={styles.accountSelectedLabel}>Business account</Text>
                    <Text style={styles.accountSelectedName}>
                      {accountName || 'Account selected'}
                    </Text>
                    {!accountLockedFromDispatch ? (
                      <TouchableOpacity
                        onPress={() => {
                          setAccountId('');
                          setAccountName('');
                          setAccountSearch('');
                          setAccountAllowFreeText(false);
                        }}
                      >
                        <Text style={styles.accountChange}>Change</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <>
                    <Text style={styles.accountHint}>
                      {accountAllowFreeText
                        ? 'Search cached accounts, or type the account name/number offline'
                        : 'Search and select a business account'}
                    </Text>
                    <TextInput
                      style={styles.field}
                      placeholder="Search business name or account number…"
                      placeholderTextColor={Colors.textMuted}
                      value={accountSearch}
                      onChangeText={(t) => {
                        setAccountSearch(t);
                        setAccountId('');
                        setAccountName('');
                      }}
                      autoCorrect={false}
                    />
                    {accountSearching ? (
                      <ActivityIndicator color={Colors.accent} style={{ marginVertical: 8 }} />
                    ) : null}
                    {accountFromCache ? (
                      <Text style={styles.hint}>Showing recent/cached accounts</Text>
                    ) : null}
                    {accountSearchError ? (
                      <Text style={styles.accountSearchError}>{accountSearchError}</Text>
                    ) : null}
                    {accountHits.map((hit) => {
                      const id = String(hit.Id ?? '');
                      const name = String(hit.Name || '').trim() || id;
                      return (
                        <TouchableOpacity
                          key={id || name}
                          style={styles.accountHit}
                          onPress={() => {
                            setAccountId(id);
                            setAccountName(name);
                            setAccountSearch(name);
                            setAccountHits([]);
                            setAccountAllowFreeText(false);
                            const cid = String(driver?.companyId || '').trim();
                            if (cid && id) {
                              void rememberBusinessAccount(cid, {
                                id,
                                name,
                                accountCode: String(hit.AccountCode || '').trim() || undefined,
                              }).catch(() => {});
                            }
                          }}
                        >
                          <Text style={styles.accountHitName}>{name}</Text>
                          {hit.AccountCode ? (
                            <Text style={styles.accountHitMeta}>{String(hit.AccountCode)}</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </View>
            ) : null}
            {tmPassengerPaymentType === 'ACC' ? (
              <View style={{ marginTop: 12 }}>
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
            ) : null}
            {tmPassengerPaymentType === 'EFTPOS' ? (
              <View style={{ marginTop: 12 }}>
                <TextInput
                  style={styles.field}
                  placeholder="Transaction reference (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={eftposRef}
                  onChangeText={setEftposRef}
                />
              </View>
            ) : null}
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
          <Pressable onPress={dismissPayment} style={styles.backLink}>
            <Text style={styles.backLinkText}>← Back to trip</Text>
          </Pressable>

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
              Meter subsidy {fmtMoney(tmSplit.councilPaysMeter)}
              {hoistTotal > 0 ? ` · Hoist ${fmtMoney(hoistTotal)} (council)` : ''}
              {' · '}Collect {fmtMoney(tmSplit.passengerPays)}
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
    marginBottom: 8,
  },
  backLink: { marginBottom: 12 },
  backLinkText: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
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
  hoistRow: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  hoistRowLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  hoistRowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hoistRemove: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  hoistAddBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.tm,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  hoistAddText: {
    color: Colors.tm,
    fontSize: 14,
    fontWeight: '700',
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
  accountSelected: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 4,
  },
  accountSelectedLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  accountSelectedName: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  accountChange: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  accountHint: {
    color: Colors.textMuted,
    fontSize: 13,
    marginBottom: 4,
  },
  accountSearchError: {
    color: Colors.warning,
    fontSize: 13,
    fontWeight: '600',
    marginVertical: 4,
  },
  accountHit: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.background,
  },
  accountHitName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  accountHitMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
});
