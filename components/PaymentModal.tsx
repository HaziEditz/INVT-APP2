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
import type { CardScanFields } from '@/lib/cardOcrParse';
import {
  buildTmHoistEntries,
  calcTmPaymentBreakdown,
  isTmConfigReadyForConfirm,
  loadCachedTmConfig,
  loadTmConfig,
  resolvePrimaryTmCard,
  tmConfigConfirmBlockReason,
  TmConfig,
} from '@/lib/tmConfig';
import { formatTmCardExpiryInput, isCompleteCardholderName } from '@/lib/tmPaymentPersist';
import { computePaymentFareSummary, completionErrorMessage } from '@/lib/tripCompletionHelpers';
import {
  DRIVER_PAYMENT_TYPES,
  DriverPaymentType,
  PaymentExtras,
  TM_PASSENGER_PAYMENT_TYPES,
  TmPaymentDetails,
} from '@/types';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { shouldBumpNetworkResume } from '@/lib/networkResume';
import {
  ActivityIndicator,
  Alert,
  findNodeHandle,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Deferred so Vision Camera / OCR / Terminal stay off PaymentModal's static import graph. */
function loadCardScanModal(): ComponentType<{
  visible: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (fields: CardScanFields) => void;
}> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./CardScanModal').CardScanModal;
  } catch (err) {
    console.warn('[PaymentModal] CardScanModal unavailable:', err);
    return null;
  }
}

function loadTapToPaySheet(): ComponentType<{
  visible: boolean;
  amountCents: number;
  bookingId?: string | null;
  onCancel: () => void;
  onPaid: (info: { paymentIntentId: string; amountCents: number }) => void;
}> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./TapToPaySheet').TapToPaySheet;
  } catch (err) {
    console.warn('[PaymentModal] TapToPaySheet unavailable:', err);
    return null;
  }
}

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
  placeholder,
}: {
  label: string;
  value: T | '';
  options: readonly T[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const display = value || placeholder || 'Select…';

  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.sectionTitle}>{label}</Text>
      <Pressable style={styles.dropdownBtn} onPress={() => setOpen((o) => !o)}>
        <Text style={[styles.dropdownValue, !value && styles.dropdownPlaceholder]}>{display}</Text>
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
  /** main → tm details → tmConfirm (explicit confirm before submit). */
  const [paymentStep, setPaymentStep] = useState<'main' | 'tm' | 'tmConfirm'>('main');
  const [tmPassengerPaymentType, setTmPassengerPaymentType] = useState<
    (typeof TM_PASSENGER_PAYMENT_TYPES)[number] | ''
  >('');
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
  /** True while loadTmConfig is in flight — never confirm TM on null/stale zero-subsidy fallback. */
  const [tmConfigLoading, setTmConfigLoading] = useState(false);

  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardScanOpen, setCardScanOpen] = useState(false);
  const [cardScanTarget, setCardScanTarget] = useState<'bank' | 'tmPrimary'>('bank');
  const [tapToPayOpen, setTapToPayOpen] = useState(false);
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
  /**
   * Bumps only on offline→online so TM config + Account search re-run without
   * leaving PaymentModal (drivers shouldn't need to back out after a signal drop).
   */
  const [networkResumeEpoch, setNetworkResumeEpoch] = useState(0);
  const wasOfflineRef = useRef<boolean | null>(null);
  const tmConfigRef = useRef<TmConfig | null>(null);
  const accountSearchSeq = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);

  tmConfigRef.current = tmConfig;

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = state.isConnected === false;
      if (shouldBumpNetworkResume(wasOfflineRef.current, offline)) {
        setNetworkResumeEpoch((n) => n + 1);
      }
      wasOfflineRef.current = offline;
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, (e) => {
      setKeyboardInset(e.endCoordinates?.height || 0);
    });
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardInset(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const scrollAccountFieldIntoView = (
    e?: NativeSyntheticEvent<TextInputFocusEventData>,
  ) => {
    // Keep the account search field above the sticky footer + on-screen keyboard.
    // Capture target handles synchronously — React reuses/nullifies synthetic events
    // before requestAnimationFrame / setTimeout callbacks run.
    const nativeTarget = e?.nativeEvent?.target;
    const reactTarget = e?.target;
    const run = () => {
      const target =
        typeof nativeTarget === 'number'
          ? nativeTarget
          : findNodeHandle(reactTarget as unknown as never);
      const responder = (
        scrollRef.current as ScrollView & {
          getScrollResponder?: () => {
            scrollResponderScrollNativeHandleToKeyboard?: (
              node: number,
              offset: number,
              animated: boolean,
            ) => void;
          };
        }
      )?.getScrollResponder?.();
      if (target && responder?.scrollResponderScrollNativeHandleToKeyboard) {
        responder.scrollResponderScrollNativeHandleToKeyboard(target, 160, true);
        return;
      }
      scrollRef.current?.scrollTo({ y: 420, animated: true });
    };
    requestAnimationFrame(() => {
      run();
      setTimeout(run, Platform.OS === 'ios' ? 60 : 140);
    });
  };
  const [accClaimNo, setAccClaimNo] = useState('');
  const [accPoNo, setAccPoNo] = useState('');
  const [tmCardNumber, setTmCardNumber] = useState('');
  const [tmCardExpiry, setTmCardExpiry] = useState('');
  const [tmCardName, setTmCardName] = useState('');
  /** WAV: one row per hoist use / wheelchair passenger (1× rate each). */
  const [hoistRows, setHoistRows] = useState<
    { key: string; cardNumber: string; cardExpiry: string; cardName: string }[]
  >([]);
  /** WAV only: null until driver taps Yes/No. Yes auto-adds first hoist from primary (silent). */
  const [hoistUsedAnswer, setHoistUsedAnswer] = useState<null | 'yes' | 'no'>(null);

  const isTmPayment = paymentType === 'TM';
  const isWav = !!activeVehicle?.isWav;
  const accountLockedFromDispatch = !!String(paymentJob?.accountId || '').trim();

  useEffect(() => {
    if (!paymentJob) return;
    const seeded =
      normalizeDriverPaymentType(paymentJob.paymentType) ?? ('Cash' as DriverPaymentType);
    setPaymentType(seeded);
    setPaymentStep('main');
    setTmPassengerPaymentType('');
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
    setTmCardName('');
    setHoistRows([]);
    setHoistUsedAnswer(null);
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
    networkResumeEpoch,
  ]);

  useEffect(() => {
    if (!isTmPayment || !driver?.companyId) {
      setTmConfig(null);
      setTmConfigLoading(false);
      return;
    }
    let cancelled = false;
    const companyId = driver.companyId;
    // Cache-first: unblock Confirm immediately when a valid cached config exists.
    // Never clear a ready config while a background refresh is in flight.
    // On networkResumeEpoch: re-fetch so a first-open-offline DEFAULT (0%) can
    // become ready once Firebase answers — without greying Review if already ready.
    const alreadyReady = isTmConfigReadyForConfirm(tmConfigRef.current);
    if (!alreadyReady) setTmConfigLoading(true);
    void (async () => {
      try {
        const cached = await loadCachedTmConfig(companyId).catch(() => null);
        if (cancelled) return;
        if (cached && isTmConfigReadyForConfirm(cached)) {
          setTmConfig(cached);
          setTmConfigLoading(false);
        }
        const cfg = await loadTmConfig(companyId);
        if (cancelled) return;
        setTmConfig(cfg);
      } catch (err) {
        console.warn('[PaymentModal] loadTmConfig failed:', err);
      } finally {
        if (!cancelled) setTmConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTmPayment, driver?.companyId, networkResumeEpoch]);

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

  const onConfirm = async () => {
    if (isTmPayment) {
      const block = tmConfigConfirmBlockReason(tmConfig, { loading: tmConfigLoading });
      if (block) {
        Alert.alert('TM settings not ready', block);
        setPaymentStep('tm');
        return;
      }
    }
    if (isTmPayment && !tmPassengerPaymentType) {
      Alert.alert(
        'Remaining payment required',
        'Select how the passenger pays the remaining fare before confirming.',
      );
      setPaymentStep('tm');
      return;
    }
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
          setPaymentStep('tm');
          return;
        }
        if (
          isWav &&
          hoistRows.some(
            (r) =>
              String(r.cardNumber || '').trim() && !isCompleteCardholderName(r.cardName),
          )
        ) {
          Alert.alert(
            'Passenger name required',
            'Enter the full passenger / cardholder name (first and last) on each hoist row.',
          );
          setSubmitting(false);
          setPaymentStep('tm');
          return;
        }
        const primary = resolvePrimaryTmCard(
          tmCardNumber,
          tmCardExpiry,
          tmHoistEntries,
          tmCardName,
        );
        if (primary.tmCardNumber && !isCompleteCardholderName(primary.tmCardName)) {
          Alert.alert(
            'Passenger name required',
            'Enter the full passenger / cardholder name (first and last) for the TM card.',
          );
          setSubmitting(false);
          setPaymentStep('tm');
          return;
        }
        const councilId = String(tmConfig?.sourceCouncilId || '').trim() || undefined;
        tmDetails = {
          councilPays: tmSplit.councilPays,
          passengerPays: tmSplit.passengerPays,
          meterFare: tmSplit.meterFare,
          tmSubsidyFare: tmSplit.councilPaysMeter,
          hoistTotal: hoistTotal > 0 ? hoistTotal : undefined,
          tmSubsidyHoist: hoistTotal > 0 ? hoistTotal : undefined,
          hoistCount: hoistUnits > 0 ? hoistUnits : undefined,
          tmHoists: tmHoistEntries.length ? tmHoistEntries : undefined,
          hoistUsedConfirmed: isWav && hoistUsedAnswer === 'yes' ? true : undefined,
          tmCardNumber: primary.tmCardNumber,
          tmCardExpiry: primary.tmCardExpiry,
          tmCardName: primary.tmCardName,
          totalFare: subtotal,
          councilId,
        };
      }

      const finalPaymentType = isTmPayment
        ? (tmPassengerPaymentType as DriverPaymentType)
        : paymentType;
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
            <TouchableOpacity
              style={styles.scanBtn}
              onPress={() => {
                if (!loadCardScanModal()) {
                  Alert.alert(
                    'Scan unavailable',
                    'Card scan needs a rebuilt app with camera/OCR. You can still type the card details.',
                  );
                  return;
                }
                setCardScanTarget('bank');
                setCardScanOpen(true);
              }}
            >
              <Text style={styles.scanBtnText}>Scan card</Text>
            </TouchableOpacity>
            {Platform.OS === 'android' ? (
              <TouchableOpacity
                style={[styles.scanBtn, { marginTop: 8 }]}
                onPress={() => {
                  if (!loadTapToPaySheet()) {
                    Alert.alert(
                      'Tap to Pay unavailable',
                      'NFC Tap to Pay needs a rebuilt app with Stripe Terminal.',
                    );
                    return;
                  }
                  setTapToPayOpen(true);
                }}
              >
                <Text style={styles.scanBtnText}>Tap to Pay (NFC)</Text>
              </TouchableOpacity>
            ) : null}
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
                  onFocus={scrollAccountFieldIntoView}
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
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Collect from passenger</Text>
              <Text style={[styles.tmValue, styles.tmPassenger, { fontWeight: '700' }]}>
                {fmtMoney(tmSplit.passengerPays)}
              </Text>
            </View>
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Council total</Text>
              <Text style={styles.tmValue}>{fmtMoney(tmSplit.councilPays)}</Text>
            </View>
            <View style={styles.tmRow}>
              <Text style={styles.tmLabel}>Passenger pays via</Text>
              <Text style={styles.tmValue}>{tmPassengerPaymentType || 'Not selected'}</Text>
            </View>
            {isWav && hoistUnits > 0 ? (
              <View style={styles.tmRow}>
                <Text style={styles.tmLabel}>Hoist passengers</Text>
                <Text style={styles.tmValue}>
                  {hoistUnits} × {fmtMoney(hoistCostPerUnit)}
                </Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.tmOpenBtn}
              onPress={() => {
                setPaymentStep('tm');
                requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
              }}
            >
              <Text style={styles.tmOpenBtnText}>Open TM details →</Text>
            </TouchableOpacity>
          </View>
        );
      default:
        return null;
    }
  };

  const openTmScreen = () => {
    setPaymentType('TM');
    setPaymentStep('tm');
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  const closeTmScreen = () => {
    setPaymentStep('main');
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  /** Leave TM flow entirely and pick Cash/Card/etc. from the main payment screen. */
  const abandonTmForOtherPayment = () => {
    setPaymentType('Cash');
    setTmPassengerPaymentType('');
    setPaymentStep('main');
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  const primaryCardReady =
    !!String(tmCardNumber || '').trim() && isCompleteCardholderName(tmCardName);
  const hoistQuestionDone = !isWav || hoistUsedAnswer != null;
  const tmRemainderReady = !!tmPassengerPaymentType;
  const tmConfigBlockReason = isTmPayment
    ? tmConfigConfirmBlockReason(tmConfig, { loading: tmConfigLoading })
    : null;
  const tmConfigReady = !tmConfigBlockReason;
  const tmCanReview = (() => {
    if (!tmConfigReady) return false;
    if (!primaryCardReady) return false;
    if (!hoistQuestionDone) return false;
    if (!tmRemainderReady) return false;
    if (isWav && hoistUsedAnswer === 'yes') {
      if (hoistRows.length < 1) return false;
      if (hoistRows.some((r) => !String(r.cardNumber || '').trim())) return false;
      if (hoistRows.some((r) => !isCompleteCardholderName(r.cardName))) return false;
    }
    const primary = resolvePrimaryTmCard(tmCardNumber, tmCardExpiry, tmHoistEntries, tmCardName);
    if (!primary.tmCardNumber || !isCompleteCardholderName(primary.tmCardName)) return false;
    return true;
  })();

  const newHoistRowKey = () => `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  /** Single-tap Yes: record first hoist from primary with no extra form. */
  const onHoistYes = () => {
    const card = String(tmCardNumber || '').trim();
    const name = String(tmCardName || '').trim();
    if (!card || !isCompleteCardholderName(name)) {
      Alert.alert(
        'Primary card required',
        'Enter the TM card number and full passenger name (first and last) first.',
      );
      return;
    }
    setHoistUsedAnswer('yes');
    setHoistRows([
      {
        key: newHoistRowKey(),
        cardNumber: card,
        cardExpiry: tmCardExpiry,
        cardName: name,
      },
    ]);
  };

  const onHoistNo = () => {
    setHoistUsedAnswer('no');
    setHoistRows([]);
  };

  /** Extra wheelchair passengers only — needs its own card + name. */
  const addMoreHoist = () => {
    setHoistRows((prev) => [
      ...prev,
      {
        key: newHoistRowKey(),
        cardNumber: '',
        cardExpiry: '',
        cardName: '',
      },
    ]);
  };

  const goTmReview = () => {
    if (!tmCanReview) {
      Alert.alert(
        'Complete TM details',
        tmConfigBlockReason
          ? tmConfigBlockReason
          : !primaryCardReady
            ? 'Enter the primary TM card number and full passenger name (first and last).'
            : !hoistQuestionDone
              ? 'Choose whether a hoist was used.'
              : !tmRemainderReady
                ? 'Select how the passenger pays the remaining fare.'
                : 'Complete any additional hoist passenger card details (full name required).',
      );
      return;
    }
    setPaymentStep('tmConfirm');
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  const onPaymentTypeChange = (v: DriverPaymentType) => {
    setPaymentType(v);
    if (v === 'TM') {
      openTmScreen();
    } else {
      setPaymentStep('main');
    }
  };

  return (
    <>
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        {paymentStep === 'tm' ? (
          <>
            <ScrollView
              ref={scrollRef}
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingTop: insets.top + 12, paddingBottom: 120 + keyboardInset },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.pageTitle}>Total Mobility</Text>
              <Text style={styles.pickup} numberOfLines={2}>
                {paymentJob.pickup}
              </Text>
              <Pressable onPress={closeTmScreen} style={styles.backLink}>
                <Text style={styles.backLinkText}>← Back to payment</Text>
              </Pressable>
              <Pressable onPress={abandonTmForOtherPayment} style={styles.backLink}>
                <Text style={styles.backLinkText}>← Choose a different payment method</Text>
              </Pressable>

              {tmConfigBlockReason ? (
                <View style={styles.tmConfigBanner}>
                  <Text style={styles.tmConfigBannerTitle}>
                    {tmConfigLoading ? 'Loading TM settings…' : 'TM settings blocked'}
                  </Text>
                  <Text style={styles.tmConfigBannerBody}>{tmConfigBlockReason}</Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.stepLabel}>1. Primary TM card *</Text>
                <Text style={styles.hint}>Card number and passenger name for this trip.</Text>
                <TextInput
                  style={styles.field}
                  placeholder="TM card number *"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  value={tmCardNumber}
                  onChangeText={setTmCardNumber}
                />
                <TextInput
                  style={styles.field}
                  placeholder="Full passenger name (first & last) *"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="words"
                  value={tmCardName}
                  onChangeText={setTmCardName}
                />
                <TextInput
                  style={styles.field}
                  placeholder="TM card expiry MM/YY (optional)"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={5}
                  value={tmCardExpiry}
                  onChangeText={(v) => setTmCardExpiry(formatTmCardExpiryInput(v))}
                />
                <TouchableOpacity
                  style={styles.scanBtn}
                  onPress={() => {
                    if (!loadCardScanModal()) {
                      Alert.alert(
                        'Scan unavailable',
                        'Card scan needs a rebuilt app with camera/OCR. You can still type the TM card details.',
                      );
                      return;
                    }
                    setCardScanTarget('tmPrimary');
                    setCardScanOpen(true);
                  }}
                >
                  <Text style={styles.scanBtnText}>Scan TM card</Text>
                </TouchableOpacity>
              </View>

              {isWav ? (
                <View style={styles.card}>
                  <Text style={styles.stepLabel}>
                    2. Hoist used? (100% council · {fmtMoney(hoistCostPerUnit)} / use)
                  </Text>
                  {hoistUsedAnswer == null ? (
                    <>
                      <Text style={styles.hint}>
                        Tap Yes to record one hoist for this passenger — uses the card and name above.
                        No extra typing.
                      </Text>
                      <View style={styles.hoistYesNoRow}>
                        <TouchableOpacity
                          style={[styles.hoistChoiceBtn, styles.hoistChoiceYes]}
                          onPress={onHoistYes}
                          disabled={!primaryCardReady}
                        >
                          <Text style={styles.hoistChoiceYesText}>Yes</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.hoistChoiceBtn, styles.hoistChoiceNo]}
                          onPress={onHoistNo}
                          disabled={!primaryCardReady}
                        >
                          <Text style={styles.hoistChoiceNoText}>No</Text>
                        </TouchableOpacity>
                      </View>
                      {!primaryCardReady ? (
                        <Text style={styles.hint}>Enter primary card and name first.</Text>
                      ) : null}
                    </>
                  ) : hoistUsedAnswer === 'yes' ? (
                    <>
                      <View style={styles.hoistSilentBanner}>
                        <Text style={styles.hoistSilentTitle}>Hoist recorded</Text>
                        <Text style={styles.hoistSilentMeta}>
                          Same card · {fmtMoney(hoistCostPerUnit)} council · passenger pays $0
                        </Text>
                        <TouchableOpacity onPress={onHoistNo} style={{ marginTop: 8 }}>
                          <Text style={styles.hoistUsePrimary}>Change to No hoist</Text>
                        </TouchableOpacity>
                      </View>
                      {hoistRows.slice(1).map((row, idx) => (
                        <View key={row.key} style={styles.hoistRow}>
                          <Text style={styles.hoistRowLabel}>Extra hoist {idx + 2}</Text>
                          <Text style={styles.hint}>
                            Additional wheelchair passenger — enter their TM card and name.
                          </Text>
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
                            placeholder="Full passenger name (first & last) *"
                            placeholderTextColor={Colors.textMuted}
                            autoCapitalize="words"
                            value={row.cardName}
                            onChangeText={(v) =>
                              setHoistRows((prev) =>
                                prev.map((r) => (r.key === row.key ? { ...r, cardName: v } : r)),
                              )
                            }
                          />
                          <TextInput
                            style={styles.field}
                            placeholder="Expiry MM/YY (optional)"
                            placeholderTextColor={Colors.textMuted}
                            keyboardType="number-pad"
                            maxLength={5}
                            value={row.cardExpiry}
                            onChangeText={(v) =>
                              setHoistRows((prev) =>
                                prev.map((r) =>
                                  r.key === row.key
                                    ? { ...r, cardExpiry: formatTmCardExpiryInput(v) }
                                    : r,
                                ),
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
                      <TouchableOpacity style={styles.hoistAddBtn} onPress={addMoreHoist}>
                        <Text style={styles.hoistAddText}>+ Add more hoist</Text>
                      </TouchableOpacity>
                      {hoistUnits > 0 ? (
                        <View style={styles.tmRow}>
                          <Text style={styles.tmLabel}>
                            Hoist fee ({hoistUnits} × {fmtMoney(hoistCostPerUnit)})
                          </Text>
                          <Text style={styles.tmValue}>{fmtMoney(hoistTotal)}</Text>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={styles.hint}>No hoist on this trip.</Text>
                      <TouchableOpacity onPress={onHoistYes} disabled={!primaryCardReady}>
                        <Text style={styles.hoistUsePrimary}>Change to Yes — record hoist</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : null}

              {primaryCardReady && hoistQuestionDone ? (
                <View style={[styles.card, styles.tmRemainderCard]}>
                  <Text style={styles.stepLabel}>
                    {isWav ? '3' : '2'}. Remaining payment method *
                  </Text>
                  <Text style={styles.hint}>
                    Collects the passenger meter share ({fmtMoney(tmSplit.passengerPays)}).
                  </Text>
                  <Dropdown
                    label="Passenger pays remaining via"
                    value={tmPassengerPaymentType}
                    options={TM_PASSENGER_PAYMENT_TYPES}
                    placeholder="Select payment method…"
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
                            onFocus={scrollAccountFieldIntoView}
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
              ) : null}

              <View style={styles.card}>
                <Text style={styles.stepLabel}>Meter fare (subsidy applies)</Text>
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
                {hoistUnits > 0 ? (
                  <View style={styles.tmRow}>
                    <Text style={styles.tmLabel}>
                      Hoist fee ({hoistUnits} × {fmtMoney(hoistCostPerUnit)})
                    </Text>
                    <Text style={styles.tmValue}>{fmtMoney(hoistTotal)} council</Text>
                  </View>
                ) : null}
                <View style={styles.tmRow}>
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
              </View>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Text style={styles.footerNote}>
                {tmConfigBlockReason
                  ? tmConfigLoading
                    ? 'Waiting for TM subsidy settings…'
                    : tmConfigBlockReason
                  : !primaryCardReady
                    ? 'Enter primary TM card and full passenger name (first & last)'
                    : !hoistQuestionDone
                      ? 'Choose Yes or No for hoist'
                      : !tmRemainderReady
                        ? 'Select remaining payment method to continue'
                        : `Meter subsidy ${fmtMoney(tmSplit.councilPaysMeter)}${
                            hoistTotal > 0 ? ` · Hoist ${fmtMoney(hoistTotal)} (council)` : ''
                          } · Collect ${fmtMoney(tmSplit.passengerPays)} via ${tmPassengerPaymentType}`}
              </Text>
              <Button
                title="Review payment →"
                onPress={goTmReview}
                disabled={!tmCanReview}
                style={styles.confirmBtn}
              />
            </View>
          </>
        ) : paymentStep === 'tmConfirm' ? (
          <>
            <ScrollView
              ref={scrollRef}
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingTop: insets.top + 12, paddingBottom: 120 },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.pageTitle}>Confirm TM payment</Text>
              <Text style={styles.pickup} numberOfLines={2}>
                {paymentJob.pickup}
              </Text>
              <Pressable
                onPress={() => {
                  setPaymentStep('tm');
                  requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
                }}
                style={styles.backLink}
              >
                <Text style={styles.backLinkText}>← Edit TM details</Text>
              </Pressable>
              <Pressable onPress={abandonTmForOtherPayment} style={styles.backLink}>
                <Text style={styles.backLinkText}>← Choose a different payment method</Text>
              </Pressable>

              {tmConfigBlockReason ? (
                <View style={styles.tmConfigBanner}>
                  <Text style={styles.tmConfigBannerTitle}>
                    {tmConfigLoading ? 'Loading TM settings…' : 'TM settings blocked'}
                  </Text>
                  <Text style={styles.tmConfigBannerBody}>{tmConfigBlockReason}</Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.stepLabel}>Payment breakdown</Text>
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
                {hoistTotal > 0 ? (
                  <View style={styles.tmRow}>
                    <Text style={styles.tmLabel}>
                      Hoist fee ({hoistUnits} × {fmtMoney(hoistCostPerUnit)})
                    </Text>
                    <Text style={styles.tmValue}>{fmtMoney(hoistTotal)} council</Text>
                  </View>
                ) : null}
                <View style={styles.tmRow}>
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
                <View style={styles.tmRow}>
                  <Text style={styles.tmLabel}>Remaining payment</Text>
                  <Text style={styles.tmValue}>{tmPassengerPaymentType}</Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.stepLabel}>TM card / passenger</Text>
                {(() => {
                  const primary = resolvePrimaryTmCard(
                    tmCardNumber,
                    tmCardExpiry,
                    tmHoistEntries,
                    tmCardName,
                  );
                  return (
                    <>
                      <View style={styles.tmRow}>
                        <Text style={styles.tmLabel}>Primary card</Text>
                        <Text style={styles.tmValue}>{primary.tmCardNumber || '—'}</Text>
                      </View>
                      <View style={styles.tmRow}>
                        <Text style={styles.tmLabel}>Passenger name</Text>
                        <Text style={styles.tmValue}>{primary.tmCardName || '—'}</Text>
                      </View>
                    </>
                  );
                })()}
                {tmHoistEntries.map((h, i) => (
                  <View key={`${h.cardNumber}-${i}`} style={{ marginTop: 8 }}>
                    <Text style={styles.hoistRowLabel}>Hoist {i + 1}</Text>
                    <Text style={styles.hint}>
                      {h.cardName || '—'} · card {h.cardNumber}
                      {h.cardExpiry ? ` · ${h.cardExpiry}` : ''} · {fmtMoney(h.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Text style={styles.footerNote}>
                {tmConfigBlockReason
                  ? tmConfigLoading
                    ? 'Waiting for TM subsidy settings…'
                    : tmConfigBlockReason
                  : `Collect ${fmtMoney(tmSplit.passengerPays)} via ${tmPassengerPaymentType}${
                      hoistTotal > 0 ? ` · Hoist ${fmtMoney(hoistTotal)} (council)` : ''
                    }`}
              </Text>
              <Button
                title={
                  submitting
                    ? 'Saving…'
                    : tmConfigLoading
                      ? 'Waiting for TM settings…'
                      : tmConfigBlockReason
                        ? 'TM settings required'
                        : 'Confirm Payment'
                }
                onPress={onConfirm}
                disabled={submitting || !tmConfigReady}
                style={styles.confirmBtn}
              />
            </View>
          </>
        ) : (
          <>
            <ScrollView
              ref={scrollRef}
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingTop: insets.top + 12, paddingBottom: 120 + keyboardInset },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
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
                onChange={onPaymentTypeChange}
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
                        onPress={() =>
                          setExtraEnabled((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
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
                title={submitting ? 'Saving…' : isTmPayment ? 'Review TM payment →' : 'Confirm Payment'}
                onPress={() => {
                  if (isTmPayment) {
                    if (!tmCanReview) {
                      openTmScreen();
                      return;
                    }
                    setPaymentStep('tmConfirm');
                    requestAnimationFrame(() =>
                      scrollRef.current?.scrollTo({ y: 0, animated: false }),
                    );
                    return;
                  }
                  void onConfirm();
                }}
                disabled={submitting}
                style={styles.confirmBtn}
              />
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
    {cardScanOpen
      ? (() => {
          const CardScanModal = loadCardScanModal();
          if (!CardScanModal) return null;
          return (
            <CardScanModal
              visible={cardScanOpen}
              title={cardScanTarget === 'tmPrimary' ? 'Scan TM card' : 'Scan bank card'}
              onCancel={() => setCardScanOpen(false)}
              onConfirm={(fields: CardScanFields) => {
                if (cardScanTarget === 'tmPrimary') {
                  if (fields.cardNumber) setTmCardNumber(fields.cardNumber);
                  if (fields.cardName) setTmCardName(fields.cardName);
                  if (fields.cardExpiry) setTmCardExpiry(formatTmCardExpiryInput(fields.cardExpiry));
                } else {
                  if (fields.cardNumber) setCardNumber(fields.cardNumber);
                  if (fields.cardExpiry) setCardExpiry(fields.cardExpiry);
                }
                setCardScanOpen(false);
              }}
            />
          );
        })()
      : null}
    {tapToPayOpen
      ? (() => {
          const TapToPaySheet = loadTapToPaySheet();
          if (!TapToPaySheet) return null;
          return (
            <TapToPaySheet
              visible={tapToPayOpen}
              amountCents={Math.max(1, Math.round(Number(totalDue || 0) * 100))}
              bookingId={paymentJob?.id || null}
              onCancel={() => setTapToPayOpen(false)}
              onPaid={(info) => {
                setTapToPayOpen(false);
                setPaymentType('Card');
                void (async () => {
                  setSubmitting(true);
                  try {
                    await finalizePayment('Card', builtExtras, subtotal, undefined, undefined, {
                      stripePaymentIntentId: info.paymentIntentId,
                    });
                  } catch (err) {
                    console.error('[PaymentModal] Tap finalizePayment failed:', err);
                    Alert.alert(
                      'Card charged — trip not closed',
                      `${completionErrorMessage(err)}\n\nPaymentIntent ${info.paymentIntentId}. Retry Confirm payment, or contact support.`,
                      [
                        { text: 'Back', style: 'cancel' },
                        { text: 'Retry complete', onPress: () => void onConfirm() },
                      ],
                    );
                  } finally {
                    setSubmitting(false);
                  }
                })();
              }}
            />
          );
        })()
      : null}
    </>
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
  dropdownPlaceholder: {
    color: Colors.textMuted,
    fontWeight: '600',
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
  tmOpenBtn: {
    marginTop: 14,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  tmOpenBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
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
    gap: 8,
  },
  hoistRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  hoistYesNoRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  hoistChoiceBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
  },
  hoistChoiceYes: {
    backgroundColor: Colors.tm,
    borderColor: Colors.tm,
  },
  hoistChoiceNo: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
  },
  hoistChoiceYesText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  hoistChoiceNoText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  hoistSilentBanner: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.tm,
    gap: 2,
  },
  hoistSilentTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  hoistSilentMeta: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  hoistUsePrimary: {
    color: Colors.tm,
    fontSize: 13,
    fontWeight: '700',
  },
  hoistRemove: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  tmRemainderCard: {
    borderWidth: 2,
    borderColor: Colors.tm,
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
  tmConfigBanner: {
    backgroundColor: '#FFF4E5',
    borderWidth: 1,
    borderColor: '#E6A23C',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  tmConfigBannerTitle: {
    color: '#8A5A00',
    fontSize: 14,
    fontWeight: '800',
  },
  tmConfigBannerBody: {
    color: '#8A5A00',
    fontSize: 13,
    lineHeight: 18,
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
