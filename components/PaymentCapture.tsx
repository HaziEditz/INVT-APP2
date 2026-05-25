import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  StyleSheet, Alert, ActivityIndicator, Image, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { get, ref as dbRef } from 'firebase/database';
import { database } from '@/lib/firebase';
import { useColors } from '@/hooks/useColors';
import { PaymentData, PaymentType } from '@/context/DriverContext';
import * as Haptics from '@/lib/haptics';
import {
  chargeCard, getPaymentConfig, ocrCard, luhnCheck, detectCardBrand, formatCardNumber, cardMaxLength,
  CardBrand,
} from '@/lib/stripeCharge';

let CameraView: any = null;
let useCameraPermissions: any = null;
try {
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
} catch {}

const PAYMENT_OPTIONS: { key: PaymentType; label: string; icon: string }[] = [
  { key: 'cash',           label: 'Cash',      icon: 'cash-outline' },
  { key: 'eftpos',         label: 'EFTPOS',    icon: 'card-outline' },
  { key: 'card',           label: 'Card',      icon: 'wallet-outline' },
  { key: 'account',        label: 'Account',   icon: 'briefcase-outline' },
  { key: 'acc',            label: 'ACC',       icon: 'shield-checkmark-outline' },
  { key: 'total_mobility', label: 'TM',        icon: 'accessibility-outline' },
  { key: 'gift_card',      label: 'Gift Card', icon: 'gift-outline' },
  { key: 'split',          label: 'Split',     icon: 'git-branch-outline' }, // v22bo
];

// v22bo: split-payment supports any of these methods. ACC/TM stay out by default
// to keep the UI simple — driver can still pick them on a row though.
const SPLIT_METHOD_OPTIONS: { key: Exclude<PaymentType, 'split'>; label: string; icon: string }[] = [
  { key: 'cash',           label: 'Cash',      icon: 'cash-outline' },
  { key: 'eftpos',         label: 'EFTPOS',    icon: 'card-outline' },
  { key: 'card',           label: 'Card',      icon: 'wallet-outline' },
  { key: 'account',        label: 'Account',   icon: 'briefcase-outline' },
  { key: 'total_mobility', label: 'TM',        icon: 'accessibility-outline' },
  { key: 'acc',            label: 'ACC',       icon: 'shield-checkmark-outline' },
  { key: 'gift_card',      label: 'Gift Card', icon: 'gift-outline' },
];

const TRIP_CATEGORIES = [
  { key: 'medical',    label: 'Medical',    icon: 'medkit-outline' },
  { key: 'social',     label: 'Social',     icon: 'people-outline' },
  { key: 'employment', label: 'Employment', icon: 'briefcase-outline' },
  { key: 'other',      label: 'Other',      icon: 'ellipsis-horizontal-outline' },
];

type CardStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'suspended' | 'unknown';
type ChargeStatus = 'idle' | 'charging' | 'charged' | 'failed';

interface CouncilConfig {
  subsidyRate: number;
  capPerTrip: number;
  councilName?: string;
}

interface Props {
  value: PaymentData;
  onChange: (data: PaymentData) => void;
  fare?: number;
  companyId?: string;
}

const BRAND_COLORS: Record<CardBrand, string> = {
  visa:       '#1a1f71',
  mastercard: '#eb001b',
  amex:       '#007bc1',
  discover:   '#f76f20',
  eftpos:     '#00a651',
  unknown:    '#64748b',
};

const BRAND_LABELS: Record<CardBrand, string> = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex',
  discover: 'Discover', eftpos: 'EFTPOS', unknown: 'Card',
};

export function PaymentCapture({ value, onChange, fare, companyId }: Props) {
  const colors = useColors();
  const scannedRef = useRef(false);

  // TM card validation state
  const [cardStatus, setCardStatus]         = useState<CardStatus>('idle');
  const [cardInfo, setCardInfo]             = useState<{ name?: string; council?: string } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [councilConfig, setCouncilConfig]   = useState<CouncilConfig | null>(null);
  const [capApplied, setCapApplied]         = useState(false);

  // ACC client lookup state
  type AccLookupStatus = 'idle' | 'searching' | 'found' | 'not_found';
  const [accLookupStatus, setAccLookupStatus] = useState<AccLookupStatus>('idle');
  const [accLookupName, setAccLookupName]     = useState<string>('');

  // Credit/debit card state
  const [rawCardNum, setRawCardNum]         = useState('');
  const [brand, setBrand]                   = useState<CardBrand>('unknown');
  const [cardValid, setCardValid]           = useState<boolean | null>(null);
  const [cvc, setCvc]                       = useState('');
  const [chargeStatus, setChargeStatus]     = useState<ChargeStatus>('idle');
  const [chargeError, setChargeError]       = useState('');
  // R11: payment config — whether this company has Stripe configured
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);

  // Scanner
  const [scannerVisible, setScannerVisible]   = useState(false);
  const [scannerMode, setScannerMode]         = useState<'tm' | 'card'>('tm');
  const [ocrLoading, setOcrLoading]           = useState(false);
  const [ocrError, setOcrError]               = useState('');
  const cameraRef = useRef<any>(null);

  const permHook = useCameraPermissions ? useCameraPermissions() : [null, null];
  const cameraPermission        = permHook[0];
  const requestCameraPermission = permHook[1];

  const update = (patch: Partial<PaymentData>) => onChange({ ...value, ...patch });

  // ── Init card fields from existing value ──────────────────────────────────
  useEffect(() => {
    if (value.type === 'card' && value.cardLastFour && !rawCardNum) {
      // Restore masked display — user will re-enter for charge
    }
    if (value.type !== 'card') {
      setRawCardNum('');
      setCardValid(null);
      setChargeStatus('idle');
      setChargeError('');
      setCvc('');
    }
  }, [value.type]);

  // R11 FIX: Fetch company Stripe config when card payment is selected.
  // Shows a warning if Stripe is not configured for this company.
  useEffect(() => {
    if (value.type !== 'card' || !companyId) { setStripeConfigured(null); return; }
    setStripeConfigured(null); // null = checking
    getPaymentConfig(companyId)
      .then(cfg => setStripeConfigured(cfg.configured))
      .catch(() => setStripeConfigured(false));
  }, [value.type, companyId]);

  // ── ACC client reference lookup ──────────────────────────────────────────
  const lookupAccClient = async (clientRef: string) => {
    if (!companyId || !clientRef.trim()) { setAccLookupStatus('idle'); return; }
    setAccLookupStatus('searching');
    setAccLookupName('');
    try {
      const snap = await get(dbRef(database, `accClients/${companyId}`));
      if (!snap.exists()) { setAccLookupStatus('not_found'); return; }
      const clients = snap.val() as Record<string, any>;
      const ref_upper = clientRef.trim().toUpperCase();
      const entry = Object.entries(clients).find(([, v]) =>
        (v?.clientRef ?? v?.ClientRef ?? v?.accountRef ?? v?.AccountRef ?? '')
          .toString().toUpperCase() === ref_upper
      );
      if (!entry) { setAccLookupStatus('not_found'); update({ accClientId: undefined, accResolvedName: undefined, accPercentPaid: undefined }); return; }
      const [pushKey, clientData] = entry;
      const name = clientData?.name ?? clientData?.Name ?? clientData?.clientName ?? clientData?.ClientName ?? '';
      // v22bo: read `percentPaid` (0-100) from the account-client record so the
      // split-payment UI can pre-fill rows automatically — e.g. 70 % account
      // + 30 % cash for a 70 %-funded client. Missing or 100 → no split needed.
      const rawPct = clientData?.percentPaid ?? clientData?.PercentPaid
                  ?? clientData?.percentPay   ?? clientData?.PercentPay ?? null;
      const pctNum = rawPct == null ? undefined : Math.max(0, Math.min(100, Number(rawPct)));
      setAccLookupStatus('found');
      setAccLookupName(name);
      update({ accClientId: pushKey, accResolvedName: name, accPercentPaid: pctNum });
    } catch { setAccLookupStatus('idle'); }
  };

  // v22bo: convert current Account selection into a Split with the account
  // portion pre-filled from `accPercentPaid` and the remainder defaulted to
  // cash. The driver can change the remainder method per row.
  const applyAccountAutoSplit = (remainderMethod: Exclude<PaymentType, 'split' | 'account'> = 'cash') => {
    const pct = value.accPercentPaid ?? 0;
    if (!fare || !pct || pct >= 100) return;
    const accAmount   = parseFloat(((fare * pct) / 100).toFixed(2));
    const remainder   = parseFloat((fare - accAmount).toFixed(2));
    const parts = [
      { method: 'account' as const, amount: accAmount },
      { method: remainderMethod, amount: remainder },
    ];
    Haptics.selectionAsync();
    onChange({ ...value, type: 'split', splitParts: parts });
  };

  // v22bo: split-payment helpers ────────────────────────────────────────────
  const splitParts = value.splitParts ?? [];
  const splitSum   = parseFloat(splitParts.reduce((a, p) => a + (Number(p.amount) || 0), 0).toFixed(2));
  const splitRemaining = fare != null ? parseFloat((fare - splitSum).toFixed(2)) : 0;
  const splitValid = fare != null && Math.abs(splitRemaining) < 0.01 && splitParts.length >= 2;

  const setSplitPart = (idx: number, patch: Partial<{ method: Exclude<PaymentType, 'split'>; amount: number }>) => {
    const next = splitParts.map((p, i) => i === idx ? { ...p, ...patch } : p);
    update({ splitParts: next });
  };
  const addSplitPart = () => {
    // New row defaults to the leftover amount on cash so the driver can just
    // tap Add → done, even if they don't want to fiddle with numbers.
    const remainder = fare != null ? parseFloat(Math.max(0, fare - splitSum).toFixed(2)) : 0;
    update({ splitParts: [...splitParts, { method: 'cash', amount: remainder }] });
  };
  const removeSplitPart = (idx: number) => {
    update({ splitParts: splitParts.filter((_, i) => i !== idx) });
  };

  // Initialise with 2 default rows when the driver first picks Split.
  useEffect(() => {
    if (value.type !== 'split') return;
    if ((value.splitParts ?? []).length > 0) return;
    const half = fare != null ? parseFloat((fare / 2).toFixed(2)) : 0;
    const rest = fare != null ? parseFloat((fare - half).toFixed(2)) : 0;
    update({ splitParts: [
      { method: 'cash', amount: half },
      { method: 'card', amount: rest },
    ]});
  }, [value.type]);

  // ── TM council config ─────────────────────────────────────────────────────
  useEffect(() => {
    if (value.type !== 'total_mobility' || !companyId) return;
    get(dbRef(database, `tmCouncilConfig/${companyId}`))
      .then(snap => {
        if (!snap.exists()) return;
        const c = snap.val();
        setCouncilConfig({
          subsidyRate: c.subsidyRate ?? c.SubsidyRate ?? 0.5,
          capPerTrip:  c.capPerTrip  ?? c.CapPerTrip  ?? 35,
          councilName: c.councilName ?? c.CouncilName,
        });
      }).catch(() => {});
  }, [value.type, companyId]);

  useEffect(() => {
    if (!fare || !councilConfig || value.tmPassengerPays != null) return;
    const subsidy       = Math.min(fare * councilConfig.subsidyRate, councilConfig.capPerTrip);
    const passengerPays = parseFloat(Math.max(0, fare - subsidy).toFixed(2));
    setCapApplied(true);
    update({ tmPassengerPays: passengerPays });
  }, [fare, councilConfig]);

  // ── TM card validation ────────────────────────────────────────────────────
  const validateTmCard = useCallback(async (cardNum: string) => {
    if (!companyId || !cardNum.trim()) { setCardStatus('idle'); return; }
    setCardStatus('checking');
    setCardInfo(null);
    setDuplicateWarning(false);
    try {
      // v22s: TM card lookup robustness. Cards can be stored under several keys
      // depending on how the Owner Portal saved them (raw, uppercased, with
      // hyphens stripped). Try each variant so a legitimate card isn't reported
      // as "not found" because of cosmetic differences.
      const raw      = cardNum.trim();
      const upper    = raw.toUpperCase();
      const lower    = raw.toLowerCase();
      const noDash   = raw.replace(/[^A-Za-z0-9]/g, '');
      const noDashUp = noDash.toUpperCase();
      const noDashLo = noDash.toLowerCase();
      const tried = Array.from(new Set([upper, raw, lower, noDashUp, noDash, noDashLo]));
      let snap: any = null;
      for (const key of tried) {
        const s = await get(dbRef(database, `tmCards/${companyId}/${key}`));
        if (s.exists()) { snap = s; break; }
      }
      if (!snap) { setCardStatus('invalid'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); return; }
      const card = snap.val();
      const isActive = card.active !== false && card.status !== 'suspended' && card.status !== 'inactive';
      if (!isActive) { setCardStatus('suspended'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
      setCardStatus('valid');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const holderName = card.holderName ?? card.name ?? card.Name ?? '';
      const council    = card.council ?? card.councilName ?? card.CouncilName ?? '';
      setCardInfo({ name: holderName, council });
      if (holderName && !value.tmPassengerName) {
        update({ tmVoucherNo: cardNum.trim().toUpperCase(), tmPassengerName: holderName });
      }
      // Duplicate detection
      try {
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const tripsSnap = await get(dbRef(database, `trips/${companyId}`));
        if (tripsSnap.exists()) {
          const trips = tripsSnap.val() as Record<string, any>;
          const recent = Object.values(trips).some((t: any) =>
            t.cardNumber === cardNum.trim().toUpperCase() && t.dateTime && t.dateTime >= oneHourAgo
          );
          if (recent) setDuplicateWarning(true);
        }
      } catch {}
    } catch { setCardStatus('unknown'); }
  }, [companyId, value.tmPassengerName]);

  // ── Credit/debit card number handling ────────────────────────────────────
  const handleCardNumberChange = (text: string) => {
    const digits = text.replace(/\D/g, '');
    const detected = detectCardBrand(digits);
    setBrand(detected);
    const max = cardMaxLength(detected);
    const trimmed = digits.slice(0, max);
    setRawCardNum(trimmed);
    setCardValid(trimmed.length >= 13 ? luhnCheck(trimmed) : null);
    setChargeStatus('idle');
    setChargeError('');
    update({
      cardLastFour: trimmed.slice(-4) || undefined,
      cardBrand:    detected,
      stripeCharged: false,
      stripePaymentIntentId: undefined,
    });
  };

  const handleExpiry = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    const formatted = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
    update({ cardExpiry: formatted });
  };

  // ── Stripe charge ─────────────────────────────────────────────────────────
  const handleCharge = async () => {
    if (!fare || fare <= 0) { Alert.alert('No fare set', 'A fare amount is required to charge the card.'); return; }
    if (!rawCardNum || rawCardNum.length < 13) { Alert.alert('Card number', 'Please enter the full card number.'); return; }
    if (!cardValid) { Alert.alert('Invalid card', 'The card number appears to be invalid. Please check and re-enter.'); return; }
    const expParts = (value.cardExpiry ?? '').split('/');
    if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 2) {
      Alert.alert('Expiry date', 'Please enter expiry as MM/YY.'); return;
    }

    const expMonth = parseInt(expParts[0], 10);
    const expYear  = 2000 + parseInt(expParts[1], 10);

    Alert.alert(
      'Charge card?',
      `Charge $${fare.toFixed(2)} to ${BRAND_LABELS[brand]} ···· ${rawCardNum.slice(-4)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Charge $${fare.toFixed(2)}`,
          style: 'default',
          onPress: async () => {
            setChargeStatus('charging');
            setChargeError('');
            Haptics.selectionAsync();
            const result = await chargeCard({
              amountCents: Math.round(fare * 100),
              currency: 'nzd',
              cardNumber: rawCardNum,
              expMonth,
              expYear,
              cvc: cvc || undefined,
              description: `Taxi fare${companyId ? ' · ' + companyId : ''}`,
              companyId: companyId ?? undefined,
            });
            if (result.success) {
              setChargeStatus('charged');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              update({
                stripeCharged: true,
                stripePaymentIntentId: result.paymentIntentId,
                cardLastFour: rawCardNum.slice(-4),
                cardBrand: brand,
              });
            } else {
              setChargeStatus('failed');
              const msg = result.declineCode
                ? `Card declined (${result.declineCode})`
                : result.error ?? 'Payment failed';
              setChargeError(msg);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            }
          },
        },
      ]
    );
  };

  // ── Camera scanner ────────────────────────────────────────────────────────
  const openScanner = async (mode: 'tm' | 'card') => {
    // v22u: defensive wrapper + clearer error messages. User reported scan
    // button "does nothing" — likely the permission alert was rendering behind
    // the parent payment modal, so the driver saw a silent no-op. We now defer
    // the alert via setTimeout so it lands on top of the current modal stack,
    // and catch any unexpected throw so the tap is never silently swallowed.
    try {
      if (!CameraView || !useCameraPermissions) {
        setTimeout(() => Alert.alert(
          'Camera not available',
          'This build does not have camera support. Please type the card number manually.'
        ), 50);
        return;
      }
      if (!cameraPermission?.granted) {
        const result = await requestCameraPermission?.();
        if (!result?.granted) {
          // v22w ROOT-CAUSE FIX: if Android already denied permission with
          // "Don't ask again", requestCameraPermission returns instantly with
          // canAskAgain=false and NO system dialog appears — so the driver
          // saw "tap does nothing". Detect this and offer to deep-link to
          // the app's settings page where they can flip the toggle.
          const canAskAgain = result?.canAskAgain !== false;
          setTimeout(() => Alert.alert(
            'Camera permission needed',
            canAskAgain
              ? 'Please grant camera access to scan, or type the card number manually.'
              : 'Camera access was previously blocked. Open settings to enable it, or type the card number manually.',
            canAskAgain
              ? [{ text: 'OK' }]
              : [
                  { text: 'Type Manually', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
                ],
          ), 50);
          return;
        }
      }
      scannedRef.current = false;
      setScannerMode(mode);
      setScannerVisible(true);
    } catch (e) {
      console.error('[openScanner] crash', e);
      setTimeout(() => Alert.alert(
        'Scanner failed to open',
        'Please type the card number manually. (' + String((e as any)?.message ?? e) + ')'
      ), 50);
    }
  };

  const handleBarcode = (result: any) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScannerVisible(false);
    const raw = result.data?.trim() ?? '';
    if (scannerMode === 'tm') {
      const num = raw.toUpperCase();
      update({ tmVoucherNo: num });
      if (num) validateTmCard(num);
    } else {
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19) {
        handleCardNumberChange(digits);
      } else {
        Alert.alert('Scan failed', 'Could not read a card number from this barcode. Please enter it manually.');
      }
    }
  };

  // ── Card photo OCR ────────────────────────────────────────────────────────
  const handleCardPhotoCapture = async () => {
    if (!cameraRef.current) return;
    try {
      setOcrLoading(true);
      setOcrError('');
      const photo = await cameraRef.current.takePicture({ base64: true, quality: 0.7, skipProcessing: true });
      const b64 = photo?.base64;
      if (!b64) throw new Error('No image captured');
      const result = await ocrCard(b64);
      if (result.success && result.cardNumber) {
        handleCardNumberChange(result.cardNumber);
        if (result.expiry) update({ cardExpiry: result.expiry });
        if (result.name) update({ cardHolder: result.name });
        setScannerVisible(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setOcrError(result.message ?? 'Could not read card. Enter details manually.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch {
      setOcrError('Capture failed. Please enter card details manually.');
    } finally {
      setOcrLoading(false);
    }
  };

  // ── Computed values ───────────────────────────────────────────────────────
  const tmPassengerPays = value.tmPassengerPays ?? 0;
  const tmSubsidy = fare != null ? parseFloat(Math.max(0, fare - tmPassengerPays).toFixed(2)) : null;

  const tmStatusColor = { idle: colors.mutedForeground, checking: colors.primary, valid: '#22c55e', invalid: '#ef4444', suspended: '#f59e0b', unknown: colors.mutedForeground }[cardStatus];
  const tmStatusIcon  = { idle: 'barcode-outline', checking: 'sync-outline', valid: 'checkmark-circle', invalid: 'close-circle', suspended: 'warning', unknown: 'help-circle-outline' }[cardStatus] as any;
  const tmStatusLabel = { idle: '', checking: 'Checking…', valid: 'Card valid', invalid: 'Card not found — proceed with caution', suspended: 'Card suspended — do not process', unknown: 'Could not verify (offline?)' }[cardStatus];

  const formattedCard = formatCardNumber(rawCardNum, brand);
  const brandColor    = BRAND_COLORS[brand];

  return (
    <View>
      {/* ── Payment type pills ── */}
      <View style={pm.typeRow}>
        {PAYMENT_OPTIONS.map(opt => {
          const active = value.type === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[pm.typeBtn, {
                backgroundColor: active ? colors.primary + '22' : colors.surface,
                borderColor: active ? colors.primary : colors.border,
              }]}
              onPress={() => { Haptics.selectionAsync(); update({ type: opt.key }); }}
              activeOpacity={0.75}
            >
              <Ionicons name={opt.icon as any} size={15} color={active ? colors.primary : colors.mutedForeground} />
              <Text style={[pm.typeLbl, { color: active ? colors.primary : colors.mutedForeground }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Corporate Account extras ── */}
      {value.type === 'account' && (
        <View style={[pm.extrasBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[pm.tmBadge, { backgroundColor: '#0369a122', borderColor: '#0369a144' }]}>
            <Ionicons name="briefcase" size={14} color="#0369a1" />
            <Text style={[pm.tmBadgeText, { color: '#0369a1' }]}>Corporate Account</Text>
          </View>

          {/* Client reference — driver types human-readable ref, app resolves to Firebase key */}
          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>CLIENT REFERENCE</Text>
          <View style={[pm.inputRow, {
            backgroundColor: colors.background,
            borderColor: accLookupStatus === 'found'
              ? '#22c55e55'
              : accLookupStatus === 'not_found'
                ? '#ef444455'
                : value.accClientRef ? '#0369a155' : colors.border,
          }]}>
            <Ionicons
              name="person-circle-outline"
              size={18}
              color={accLookupStatus === 'found' ? '#22c55e' : accLookupStatus === 'not_found' ? '#ef4444' : colors.mutedForeground}
            />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="e.g. ACC-00142"
              placeholderTextColor={colors.mutedForeground}
              value={value.accClientRef ?? ''}
              onChangeText={t => {
                update({ accClientRef: t.trim() ? t.toUpperCase() : undefined, accClientId: undefined, accResolvedName: undefined });
                setAccLookupStatus('idle');
                setAccLookupName('');
              }}
              autoCapitalize="characters"
              returnKeyType="search"
              onBlur={() => { if (value.accClientRef) lookupAccClient(value.accClientRef); }}
              onSubmitEditing={() => { if (value.accClientRef) lookupAccClient(value.accClientRef); }}
            />
            {accLookupStatus === 'searching' && <ActivityIndicator size="small" color="#0369a1" />}
            {accLookupStatus === 'found'     && <Ionicons name="checkmark-circle" size={16} color="#22c55e" />}
            {accLookupStatus === 'not_found' && <Ionicons name="close-circle"     size={16} color="#ef4444" />}
          </View>

          {/* Lookup feedback */}
          {accLookupStatus === 'found' && accLookupName ? (
            <Text style={[pm.cardHolderHint, { color: '#22c55e' }]}>
              Client: {accLookupName}
            </Text>
          ) : null}
          {accLookupStatus === 'not_found' ? (
            <View style={[pm.warnBanner, { backgroundColor: '#ef444418', borderColor: '#ef444455' }]}>
              <Ionicons name="warning" size={15} color="#ef4444" />
              <Text style={[pm.warnText, { color: '#ef4444' }]}>
                Client reference not found — check the number and try again.
              </Text>
            </View>
          ) : null}

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>CLAIM NUMBER</Text>
          <View style={[pm.inputRow, {
            backgroundColor: colors.background,
            borderColor: value.accClaimNo ? '#0369a155' : colors.border,
          }]}>
            <Ionicons name="document-text-outline" size={18} color={value.accClaimNo ? '#0369a1' : colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="e.g. CLM-9876"
              placeholderTextColor={colors.mutedForeground}
              value={value.accClaimNo ?? ''}
              onChangeText={t => update({ accClaimNo: t.trim() ? t.toUpperCase() : undefined })}
              autoCapitalize="characters"
              returnKeyType="next"
            />
            {!!value.accClaimNo && <Ionicons name="checkmark-circle" size={16} color="#0369a1" />}
          </View>

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>
            PURCHASE ORDER NUMBER{' '}
            <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>(optional)</Text>
          </Text>
          <View style={[pm.inputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name="receipt-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="e.g. PO-001"
              placeholderTextColor={colors.mutedForeground}
              value={value.accPoNumber ?? ''}
              onChangeText={t => update({ accPoNumber: t.trim() ? t.toUpperCase() : undefined })}
              autoCapitalize="characters"
              returnKeyType="done"
            />
          </View>

          <View style={[pm.infoBox, { backgroundColor: '#e0f2fe', borderColor: '#bae6fd', marginTop: 4 }]}>
            <Ionicons name="information-circle-outline" size={15} color="#0369a1" />
            <Text style={[pm.infoBody, { color: '#0369a1', flex: 1 }]}>
              Trip will be logged to the client's account. PO trips-used counter updates on completion.
            </Text>
          </View>

          {/* v22bo: account-percent auto-split prompt — appears only when the
              resolved client has a `percentPaid` < 100 % on file. One tap and
              we switch to the Split tab with the rows pre-filled. */}
          {accLookupStatus === 'found' && (value.accPercentPaid ?? 0) > 0 && (value.accPercentPaid ?? 0) < 100 && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => applyAccountAutoSplit('cash')}
              style={[pm.warnBanner, { backgroundColor: '#fef3c722', borderColor: '#f59e0b66', marginTop: 6 }]}
            >
              <Ionicons name="git-branch" size={16} color="#b45309" />
              <View style={{ flex: 1 }}>
                <Text style={[pm.warnText, { color: '#b45309', fontFamily: 'Inter_700Bold' }]}>
                  Auto-split: {value.accPercentPaid}% account, {100 - (value.accPercentPaid ?? 0)}% remainder
                </Text>
                <Text style={[pm.warnText, { color: '#b45309', marginTop: 2 }]}>
                  Tap to set up a split — passenger pays the leftover in cash, EFTPOS, or card.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#b45309" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── v22bo: Split payment ───────────────────────────────────────────
          Driver enters one row per payment method (cash + card + account +
          TM + ACC + gift card in any combination). Amounts must sum to the
          fare. The "Confirm" footer is only enabled when the validator
          accepts the totals. */}
      {value.type === 'split' && (
        <View style={[pm.extrasBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[pm.tmBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
            <Ionicons name="git-branch" size={14} color={colors.primary} />
            <Text style={[pm.tmBadgeText, { color: colors.primary }]}>Split Payment</Text>
          </View>

          {splitParts.map((part, idx) => (
            <View key={idx} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={[pm.extraLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>PART {idx + 1}</Text>
                {splitParts.length > 2 && (
                  <TouchableOpacity onPress={() => removeSplitPart(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {SPLIT_METHOD_OPTIONS.map(opt => {
                  const active = part.method === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => { Haptics.selectionAsync(); setSplitPart(idx, { method: opt.key }); }}
                      activeOpacity={0.75}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
                        backgroundColor: active ? colors.primary + '22' : colors.background,
                        borderColor:     active ? colors.primary : colors.border,
                      }}
                    >
                      <Ionicons name={opt.icon as any} size={12} color={active ? colors.primary : colors.mutedForeground} />
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.3, color: active ? colors.primary : colors.mutedForeground }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={[pm.inputRow, { backgroundColor: colors.background, borderColor: colors.border, marginBottom: 0 }]}>
                <Text style={[pm.currencySign, { color: colors.mutedForeground }]}>$</Text>
                <TextInput
                  style={[pm.textInput, { color: colors.foreground }]}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.mutedForeground}
                  value={Number.isFinite(part.amount) ? String(part.amount) : ''}
                  onChangeText={t => {
                    const n = parseFloat(t.replace(/[^\d.]/g, ''));
                    setSplitPart(idx, { amount: Number.isFinite(n) ? n : 0 });
                  }}
                />
              </View>
            </View>
          ))}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, marginBottom: 6 }}>
            <TouchableOpacity
              onPress={addSplitPart}
              activeOpacity={0.85}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1,
                borderColor: colors.primary, backgroundColor: colors.primary + '11',
              }}
            >
              <Ionicons name="add-circle" size={14} color={colors.primary} />
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: colors.primary }}>Add part</Text>
            </TouchableOpacity>
          </View>

          {fare != null && (
            <View style={[pm.subsidyRow, {
              backgroundColor: splitValid ? '#22c55e18' : '#f59e0b18',
              borderColor:     splitValid ? '#22c55e55' : '#f59e0b55',
            }]}>
              <Ionicons name={splitValid ? 'checkmark-circle' : 'warning'} size={15} color={splitValid ? '#16a34a' : '#b45309'} />
              <Text style={[pm.subsidyText, { color: splitValid ? '#16a34a' : '#b45309', flex: 1 }]}>
                {splitValid
                  ? `Sum $${splitSum.toFixed(2)} matches fare. Ready to confirm.`
                  : `Sum $${splitSum.toFixed(2)} of $${fare.toFixed(2)} — ${splitRemaining > 0 ? `$${splitRemaining.toFixed(2)} short` : `$${(-splitRemaining).toFixed(2)} over`}.`
                }
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── ACC (Accident Compensation) extras ── */}
      {value.type === 'acc' && (
        <View style={[pm.extrasBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[pm.tmBadge, { backgroundColor: '#16a34a22', borderColor: '#16a34a44' }]}>
            <Ionicons name="shield-checkmark" size={14} color="#16a34a" />
            <Text style={[pm.tmBadgeText, { color: '#16a34a' }]}>ACC Claim</Text>
          </View>

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>ACC CLAIM NUMBER</Text>
          <View style={[pm.inputRow, {
            backgroundColor: colors.background,
            borderColor: value.accClaimNo ? '#16a34a55' : colors.border,
          }]}>
            <Ionicons name="document-text-outline" size={18} color={value.accClaimNo ? '#16a34a' : colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="e.g. CLM-9876543"
              placeholderTextColor={colors.mutedForeground}
              value={value.accClaimNo ?? ''}
              onChangeText={t => update({ accClaimNo: t.trim() ? t.toUpperCase() : undefined })}
              autoCapitalize="characters"
              returnKeyType="next"
            />
            {!!value.accClaimNo && <Ionicons name="checkmark-circle" size={16} color="#16a34a" />}
          </View>

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>
            CLIENT REFERENCE{' '}
            <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>(optional)</Text>
          </Text>
          <View style={[pm.inputRow, {
            backgroundColor: colors.background,
            borderColor: value.accClientRef ? '#16a34a55' : colors.border,
          }]}>
            <Ionicons name="person-circle-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="e.g. ACC-00142"
              placeholderTextColor={colors.mutedForeground}
              value={value.accClientRef ?? ''}
              onChangeText={t => update({ accClientRef: t.trim() ? t.toUpperCase() : undefined })}
              autoCapitalize="characters"
              returnKeyType="done"
            />
          </View>

          <View style={[pm.infoBox, { backgroundColor: '#dcfce7', borderColor: '#bbf7d0', marginTop: 4 }]}>
            <Ionicons name="information-circle-outline" size={15} color="#16a34a" />
            <Text style={[pm.infoBody, { color: '#16a34a', flex: 1 }]}>
              ACC-funded trip. Enter the injury claim number provided by the passenger. Trip cost is invoiced to ACC.
            </Text>
          </View>
        </View>
      )}

      {/* ── EFTPOS info ── */}
      {value.type === 'eftpos' && (
        <View style={[pm.infoBox, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '33' }]}>
          <Ionicons name="card-outline" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[pm.infoTitle, { color: colors.primary }]}>EFTPOS / Tap & Go / Debit Card</Text>
            <Text style={[pm.infoBody, { color: colors.foreground }]}>
              Process the payment on your EFTPOS terminal, then tap Complete Trip.
              Supports tap-and-go (contactless), chip & PIN, and swipe.
            </Text>
          </View>
        </View>
      )}

      {/* ── Credit / Debit card extras ── */}
      {value.type === 'card' && (
        <View style={[pm.extrasBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <View style={[pm.brandPill, { backgroundColor: brandColor + '18', borderColor: brandColor + '44' }]}>
              <Ionicons name="card" size={14} color={brandColor} />
              <Text style={[pm.brandLabel, { color: brandColor }]}>{BRAND_LABELS[brand]}</Text>
            </View>
            {value.stripeCharged && (
              <View style={[pm.chargedBadge, { backgroundColor: '#22c55e18', borderColor: '#22c55e44' }]}>
                <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                <Text style={[pm.chargedText, { color: '#22c55e' }]}>Charged</Text>
              </View>
            )}
          </View>

          {/* Card number */}
          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>CARD NUMBER</Text>
          <View style={[pm.inputRow, {
            backgroundColor: colors.background,
            borderColor: cardValid === true ? '#22c55e55' : cardValid === false ? '#ef444455' : colors.border,
          }]}>
            <Ionicons name="card-outline" size={18} color={cardValid === true ? '#22c55e' : cardValid === false ? '#ef4444' : colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground, flex: 1 }]}
              placeholder="1234 5678 9012 3456"
              placeholderTextColor={colors.mutedForeground}
              value={formattedCard}
              onChangeText={handleCardNumberChange}
              keyboardType="number-pad"
              maxLength={brand === 'amex' ? 17 : 19}
              autoComplete="cc-number"
            />
            {cardValid === true && <Ionicons name="checkmark-circle" size={16} color="#22c55e" />}
            {cardValid === false && <Ionicons name="close-circle" size={16} color="#ef4444" />}
            <TouchableOpacity onPress={() => { setOcrError(''); openScanner('card'); }} style={pm.scanBtn} activeOpacity={0.7}>
              <Ionicons name="camera-outline" size={18} color={colors.primary} />
              <Text style={[pm.scanLabel, { color: colors.primary }]}>Photo</Text>
            </TouchableOpacity>
          </View>
          {cardValid === false && rawCardNum.length > 0 && (
            <Text style={[pm.statusLabel, { color: '#ef4444' }]}>Invalid card number</Text>
          )}

          {/* Row: expiry + CVC */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 3 }}>
              <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>EXPIRY</Text>
              <View style={[pm.inputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Ionicons name="calendar-outline" size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[pm.textInput, { color: colors.foreground }]}
                  placeholder="MM/YY"
                  placeholderTextColor={colors.mutedForeground}
                  value={value.cardExpiry ?? ''}
                  onChangeText={handleExpiry}
                  keyboardType="number-pad"
                  maxLength={5}
                  autoComplete="cc-exp"
                />
              </View>
            </View>
            <View style={{ flex: 2 }}>
              <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>
                {brand === 'amex' ? 'CID (4)' : 'CVC (3)'}
              </Text>
              <View style={[pm.inputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <TextInput
                  style={[pm.textInput, { color: colors.foreground }]}
                  placeholder={brand === 'amex' ? '1234' : '123'}
                  placeholderTextColor={colors.mutedForeground}
                  value={cvc}
                  onChangeText={t => setCvc(t.replace(/\D/g, '').slice(0, brand === 'amex' ? 4 : 3))}
                  keyboardType="number-pad"
                  maxLength={brand === 'amex' ? 4 : 3}
                  secureTextEntry
                  autoComplete="cc-csc"
                />
              </View>
            </View>
          </View>

          {/* Cardholder name */}
          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>CARDHOLDER NAME</Text>
          <View style={[pm.inputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name="person-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="Name on card"
              placeholderTextColor={colors.mutedForeground}
              value={value.cardHolder ?? ''}
              onChangeText={t => update({ cardHolder: t })}
              autoCapitalize="words"
              autoComplete="cc-name"
            />
          </View>

          {/* R11: Stripe not configured warning */}
          {stripeConfigured === false && chargeStatus !== 'charged' && (
            <View style={[pm.warnBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b55', marginBottom: 6 }]}>
              <Ionicons name="warning-outline" size={15} color="#f59e0b" />
              <Text style={[pm.warnText, { color: '#f59e0b' }]}>
                Card payments may not be configured for this company. Contact your operator if charging fails.
              </Text>
            </View>
          )}

          {/* Charge error */}
          {chargeStatus === 'failed' && chargeError ? (
            <View style={[pm.warnBanner, { backgroundColor: '#ef444418', borderColor: '#ef444455' }]}>
              <Ionicons name="close-circle" size={15} color="#ef4444" />
              <Text style={[pm.warnText, { color: '#ef4444' }]}>{chargeError}</Text>
            </View>
          ) : null}

          {/* Charge / charged button */}
          {!value.stripeCharged ? (
            <TouchableOpacity
              style={[pm.chargeBtn, {
                backgroundColor: (cardValid && chargeStatus !== 'charging') ? colors.primary : colors.border,
                opacity: (cardValid && chargeStatus !== 'charging') ? 1 : 0.5,
              }]}
              onPress={handleCharge}
              disabled={!cardValid || chargeStatus === 'charging'}
              activeOpacity={0.8}
            >
              {chargeStatus === 'charging' ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="flash" size={17} color="#000" />
              )}
              <Text style={pm.chargeBtnText}>
                {chargeStatus === 'charging' ? 'Processing…' : fare ? `Charge $${fare.toFixed(2)}` : 'Charge card'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={[pm.chargedBox, { backgroundColor: '#22c55e18', borderColor: '#22c55e55' }]}>
              <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
              <View style={{ flex: 1 }}>
                <Text style={[pm.chargedBoxTitle, { color: '#22c55e' }]}>Payment successful</Text>
                {value.stripePaymentIntentId ? (
                  <Text style={[pm.chargedBoxSub, { color: colors.mutedForeground }]}>
                    Ref: {value.stripePaymentIntentId.slice(-12)}
                  </Text>
                ) : null}
              </View>
            </View>
          )}

          <Text style={[pm.stripeNote, { color: colors.mutedForeground }]}>
            🔒 Payments processed securely via Stripe
          </Text>
        </View>
      )}

      {/* ── Total Mobility extras ── */}
      {value.type === 'total_mobility' && (
        <View style={[pm.extrasBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[pm.tmBadge, { backgroundColor: '#7c3aed22', borderColor: '#7c3aed44' }]}>
            <Ionicons name="accessibility" size={14} color="#7c3aed" />
            <Text style={[pm.tmBadgeText, { color: '#7c3aed' }]}>Total Mobility</Text>
            {councilConfig?.councilName ? (
              <Text style={[pm.tmCouncilText, { color: '#7c3aed99' }]}>· {councilConfig.councilName}</Text>
            ) : null}
          </View>

          {duplicateWarning && (
            <View style={[pm.warnBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b55' }]}>
              <Ionicons name="warning" size={15} color="#f59e0b" />
              <Text style={[pm.warnText, { color: '#f59e0b' }]}>
                This card was used within the last hour — check if this is a duplicate trip.
              </Text>
            </View>
          )}

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>TM CARD / VOUCHER NUMBER</Text>
          <View style={[pm.inputRow, {
            backgroundColor: colors.background,
            borderColor: cardStatus === 'valid' ? '#22c55e55' : (cardStatus === 'suspended' || cardStatus === 'invalid') ? '#ef444455' : colors.border,
          }]}>
            <Ionicons name="barcode-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="e.g. TM-123456"
              placeholderTextColor={colors.mutedForeground}
              value={value.tmVoucherNo ?? ''}
              onChangeText={t => { update({ tmVoucherNo: t.toUpperCase() }); setCardStatus('idle'); }}
              onBlur={() => { if (value.tmVoucherNo) validateTmCard(value.tmVoucherNo); }}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={() => { if (value.tmVoucherNo) validateTmCard(value.tmVoucherNo); }}
            />
            {/* v22y: TM Scan button removed — Total Mobility cards in NZ
                do NOT have barcodes (just name / photo / card number /
                expiry printed on the front), so the barcode scanner sat
                there forever waiting for a code that doesn't exist.
                Driver now just types the number from the front of the card. */}
            {cardStatus === 'checking' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : cardStatus !== 'idle' ? (
              <Ionicons name={tmStatusIcon} size={18} color={tmStatusColor} />
            ) : null}
          </View>
          {tmStatusLabel ? <Text style={[pm.statusLabel, { color: tmStatusColor }]}>{tmStatusLabel}</Text> : null}
          {cardInfo?.name ? (
            <Text style={[pm.cardHolderHint, { color: '#22c55e' }]}>
              Card holder: {cardInfo.name}{cardInfo.council ? ` · ${cardInfo.council}` : ''}
            </Text>
          ) : null}

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>PASSENGER NAME</Text>
          <View style={[pm.inputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name="person-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="Name on TM card"
              placeholderTextColor={colors.mutedForeground}
              value={value.tmPassengerName ?? ''}
              onChangeText={t => update({ tmPassengerName: t })}
              autoCapitalize="words"
            />
          </View>

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>TRIP PURPOSE</Text>
          <View style={pm.categoryRow}>
            {TRIP_CATEGORIES.map(cat => {
              const active = (value.tmTripCategory ?? 'other') === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[pm.categoryBtn, {
                    backgroundColor: active ? '#7c3aed22' : colors.background,
                    borderColor: active ? '#7c3aed' : colors.border,
                  }]}
                  onPress={() => { Haptics.selectionAsync(); update({ tmTripCategory: cat.key }); }}
                  activeOpacity={0.75}
                >
                  <Ionicons name={cat.icon as any} size={13} color={active ? '#7c3aed' : colors.mutedForeground} />
                  <Text style={[pm.categoryLbl, { color: active ? '#7c3aed' : colors.mutedForeground }]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>PASSENGER PAYS ($)</Text>
          <View style={[pm.inputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[pm.currencySign, { color: colors.mutedForeground }]}>$</Text>
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="0.00"
              placeholderTextColor={colors.mutedForeground}
              value={value.tmPassengerPays != null ? String(value.tmPassengerPays) : ''}
              onChangeText={t => { const n = parseFloat(t); update({ tmPassengerPays: isNaN(n) ? undefined : n }); }}
              keyboardType="decimal-pad"
            />
            {fare != null && <Text style={[pm.fareHint, { color: colors.mutedForeground }]}>of ${fare.toFixed(2)}</Text>}
          </View>

          {tmSubsidy != null && (
            <View style={[pm.subsidyRow, { backgroundColor: '#7c3aed12', borderColor: '#7c3aed30' }]}>
              <Ionicons name="information-circle-outline" size={15} color="#7c3aed" />
              <Text style={[pm.subsidyText, { color: '#7c3aed' }]}>
                TM subsidy: ${tmSubsidy.toFixed(2)}
                {capApplied && councilConfig ? ` (cap $${councilConfig.capPerTrip.toFixed(2)})` : ''}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Gift Card extras ── */}
      {value.type === 'gift_card' && (
        <View style={[pm.extrasBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[pm.tmBadge, { backgroundColor: '#d9770622', borderColor: '#d9770644' }]}>
            <Ionicons name="gift" size={14} color="#d97706" />
            <Text style={[pm.tmBadgeText, { color: '#d97706' }]}>Gift Card</Text>
          </View>

          <Text style={[pm.extraLabel, { color: colors.mutedForeground }]}>GIFT CARD CODE</Text>
          <View style={[pm.inputRow, {
            backgroundColor: colors.background,
            borderColor: value.giftCardCode ? '#d9770655' : colors.border,
          }]}>
            <Ionicons name="barcode-outline" size={18} color={value.giftCardCode ? '#d97706' : colors.mutedForeground} />
            <TextInput
              style={[pm.textInput, { color: colors.foreground }]}
              placeholder="Scan or enter gift card number"
              placeholderTextColor={colors.mutedForeground}
              value={value.giftCardCode ?? ''}
              onChangeText={t => update({ giftCardCode: t.toUpperCase() })}
              autoCapitalize="characters"
              returnKeyType="done"
            />
            {value.giftCardCode ? (
              <Ionicons name="checkmark-circle" size={16} color="#d97706" />
            ) : (
              <TouchableOpacity onPress={() => openScanner('tm')} style={pm.scanBtn} activeOpacity={0.7}>
                <Ionicons name="scan-outline" size={18} color={colors.primary} />
                <Text style={[pm.scanLabel, { color: colors.primary }]}>Scan</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={[pm.infoBox, { backgroundColor: '#fffbeb', borderColor: '#fde68a', marginTop: 4 }]}>
            <Ionicons name="information-circle-outline" size={15} color="#d97706" />
            <Text style={[pm.infoBody, { color: '#d97706', flex: 1 }]}>
              Redeem the gift card before completing the trip. Enter the card number for your records.
            </Text>
          </View>
        </View>
      )}

      {/* ── Camera scanner modal ── */}
      <Modal
        visible={scannerVisible}
        animationType="slide"
        onRequestClose={() => { setScannerVisible(false); setOcrError(''); setOcrLoading(false); }}
      >
        <View style={pm.scannerContainer}>
          {CameraView ? (
            scannerMode === 'card' ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
              />
            ) : (
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ['code39', 'code128', 'qr', 'pdf417', 'aztec', 'ean13', 'ean8', 'code93'] }}
                onBarcodeScanned={handleBarcode}
              />
            )
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }]}>
              <ActivityIndicator color="#fff" />
            </View>
          )}

          <View style={pm.scannerOverlay}>
            {/* Title */}
            <Text style={pm.scannerTitle}>
              {scannerMode === 'tm' ? 'Scan TM Card / Voucher' : 'Scan Card — Point at Front'}
            </Text>

            {/* Frame — credit-card landscape for card mode, barcode portrait for TM */}
            {scannerMode === 'card' ? (
              <View style={pm.scannerCardFrame}>
                <View style={[pm.corner, pm.cornerTL]} />
                <View style={[pm.corner, pm.cornerTR]} />
                <View style={[pm.corner, pm.cornerBL]} />
                <View style={[pm.corner, pm.cornerBR]} />
                <Text style={pm.scannerCardLabel}>card number</Text>
              </View>
            ) : (
              <View style={pm.scannerFrame}>
                <View style={[pm.corner, pm.cornerTL]} />
                <View style={[pm.corner, pm.cornerTR]} />
                <View style={[pm.corner, pm.cornerBL]} />
                <View style={[pm.corner, pm.cornerBR]} />
              </View>
            )}

            {/* Hint / status */}
            {ocrLoading ? (
              <View style={pm.ocrLoadingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={pm.ocrLoadingText}>Reading card…</Text>
              </View>
            ) : ocrError ? (
              <View style={pm.ocrErrorBox}>
                <Ionicons name="warning" size={15} color="#f59e0b" />
                <Text style={pm.ocrErrorText}>{ocrError}</Text>
              </View>
            ) : (
              <Text style={pm.scannerHint}>
                {scannerMode === 'tm'
                  ? 'Point camera at the barcode on the TM card or voucher'
                  : 'Fill the frame with the front of the card, then tap Capture'}
              </Text>
            )}

            {/* Capture button — only in card mode */}
            {scannerMode === 'card' && (
              <TouchableOpacity
                style={[pm.captureBtn, ocrLoading && { opacity: 0.5 }]}
                onPress={handleCardPhotoCapture}
                disabled={ocrLoading}
                activeOpacity={0.85}
              >
                {ocrLoading ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Ionicons name="camera" size={22} color="#000" />
                )}
                <Text style={pm.captureBtnText}>
                  {ocrLoading ? 'Processing…' : 'Capture Card'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={pm.scannerClose}
            onPress={() => { setScannerVisible(false); setOcrError(''); setOcrLoading(false); }}
            activeOpacity={0.8}
          >
            <Ionicons name="close-circle" size={52} color="#fff" />
            <Text style={pm.scannerCloseLabel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const pm = StyleSheet.create({
  typeRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  typeBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2, borderRadius: 10, borderWidth: 1.5, gap: 3 },
  typeLbl: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },

  extrasBox:  { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 4, gap: 6 },
  infoBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 4 },
  infoTitle:  { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  infoBody:   { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  brandPill:  { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  brandLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },

  chargedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  chargedText:  { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  tmBadge:       { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6 },
  tmBadgeText:   { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  tmCouncilText: { fontSize: 11, fontFamily: 'Inter_400Regular', flex: 1 },

  warnBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 4 },
  warnText:   { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 17 },

  extraLabel:     { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, marginTop: 2, marginBottom: 4, color: '#94a3b8' },
  statusLabel:    { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: -2, marginLeft: 2, marginBottom: 2 },
  cardHolderHint: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: -2, marginLeft: 2, marginBottom: 2 },

  inputRow:    { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 4 },
  textInput:   { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', padding: 0 },
  currencySign:{ fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  fareHint:    { fontSize: 12, fontFamily: 'Inter_400Regular' },

  categoryRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  categoryBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, gap: 3 },
  categoryLbl: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.2 },

  scanBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4 },
  scanLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  subsidyRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, marginTop: 2 },
  subsidyText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  chargeBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 13, marginTop: 4 },
  chargeBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#000' },

  chargedBox:      { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  chargedBoxTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  chargedBoxSub:   { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  stripeNote: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },

  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scannerOverlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 20 },
  scannerTitle:     { color: '#fff', fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 10, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  scannerFrame:     { width: 280, height: 180, position: 'relative' },

  scannerCardFrame: { width: 320, height: 200, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  scannerCardLabel: { color: '#ffffff88', fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, position: 'absolute', bottom: 12 },

  corner:           { position: 'absolute', width: 30, height: 30, borderColor: '#fff', borderWidth: 3 },
  cornerTL:         { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR:         { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL:         { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR:         { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },

  scannerHint:      { color: '#ffffffcc', fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 40 },

  ocrLoadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  ocrLoadingText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  ocrErrorBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, maxWidth: 300 },
  ocrErrorText:   { color: '#fbbf24', fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 18 },

  captureBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 32, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  captureBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#000' },

  scannerClose:     { position: 'absolute', bottom: 60, alignSelf: 'center', alignItems: 'center', gap: 6 },
  scannerCloseLabel:{ color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
