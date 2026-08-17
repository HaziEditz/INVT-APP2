import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  createTapPaymentIntent,
  fetchTerminalConnectionToken,
  recordTapLedger,
  shouldSimulateTapToPay,
} from '@/lib/platformPaymentApi';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  amountCents: number;
  bookingId?: string | null;
  onCancel: () => void;
  onPaid: (info: { paymentIntentId: string; amountCents: number }) => void;
};

function tryLoadStripeTerminal(): {
  StripeTerminalProvider: React.ComponentType<{
    children: ReactNode;
    tokenProvider: () => Promise<string>;
    logLevel?: string;
  }>;
  useStripeTerminal: () => any;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@stripe/stripe-terminal-react-native');
  } catch {
    return null;
  }
}

/**
 * Stripe Terminal requires disconnect before a new discoverReaders() when a
 * prior attempt left the reader connected (e.g. card declined mid-collect).
 * Best-effort — never throw into the payment UI.
 */
async function teardownTapReader(terminal: any): Promise<void> {
  if (!terminal) return;
  try {
    if (typeof terminal.cancelCollectPaymentMethod === 'function') {
      await terminal.cancelCollectPaymentMethod();
    }
  } catch {
    /* ignore — may not be collecting */
  }
  try {
    const connected = terminal.connectedReader;
    if (connected && typeof terminal.disconnectReader === 'function') {
      await terminal.disconnectReader();
    } else if (typeof terminal.disconnectReader === 'function') {
      // Still attempt disconnect — SDK may hold connection without exposing reader yet.
      await terminal.disconnectReader();
    }
  } catch {
    /* ignore — already disconnected */
  }
}

function TapToPayBody({
  amountCents,
  bookingId,
  onCancel,
  onPaid,
}: Omit<Props, 'visible'>) {
  const insets = useSafeAreaInsets();
  const { driver } = useAuth();
  const terminal = tryLoadStripeTerminal()!.useStripeTerminal();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(async () => {
    setBusy(true);
    try {
      await teardownTapReader(terminal);
    } finally {
      setBusy(false);
      onCancel();
    }
  }, [onCancel, terminal]);

  const start = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setError('Tap to Pay is Android-only in this release.');
      return;
    }
    if (!terminal) {
      setError('Stripe Terminal native module missing — rebuild the app.');
      return;
    }
    if (!driver?.companyId) {
      setError('Missing company id — sign in again.');
      return;
    }
    if (amountCents < 1) {
      setError('Invalid amount.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Critical for decline→retry: prior connect must be cleared first.
      setStatus('Resetting reader…');
      await teardownTapReader(terminal);

      setStatus('Preparing payment…');
      const intent = await createTapPaymentIntent({
        amountCents,
        companyId: driver.companyId,
        bookingId,
        driverId: driver.id,
      });

      setStatus('Starting Terminal…');
      const init = await terminal.initialize({ logLevel: 'verbose' });
      if (init?.error) throw new Error(init.error.message || 'Terminal init failed');

      setStatus('Finding Tap to Pay on this device…');
      // Simulated only via explicit EXPO_PUBLIC_STRIPE_TERMINAL_SIMULATED=1 — never __DEV__.
      const simulated = shouldSimulateTapToPay();
      const disc = await terminal.discoverReaders({
        discoveryMethod: 'tapToPay',
        simulated,
      });
      if (disc?.error) throw new Error(disc.error.message || 'Discover failed');

      const reader = terminal.discoveredReaders?.[0];
      if (!reader) throw new Error('No Tap to Pay reader on this device');

      setStatus('Connecting…');
      // beta.29+: discoveryMethod + locationId live on the same connectReader object
      // (nested `params: { locationId }` left discoveryMethod null → "Unknown discovery method: null").
      const locationId =
        process.env.EXPO_PUBLIC_STRIPE_TERMINAL_LOCATION_ID ||
        reader?.location?.id ||
        undefined;
      if (!locationId) {
        throw new Error(
          'Missing Stripe Terminal locationId (EXPO_PUBLIC_STRIPE_TERMINAL_LOCATION_ID).',
        );
      }
      const connected = await terminal.connectReader({
        discoveryMethod: 'tapToPay',
        reader,
        locationId,
      });
      if (connected?.error) throw new Error(connected.error.message || 'Connect failed');

      // One PI only: server create-intent → retrieve by clientSecret (do not also create on-device).
      setStatus('Loading payment…');
      const retrieved = await terminal.retrievePaymentIntent(intent.clientSecret);
      if (retrieved?.error || !retrieved.paymentIntent) {
        throw new Error(retrieved?.error?.message || 'retrievePaymentIntent failed');
      }

      setStatus(
        simulated
          ? 'Simulated Tap to Pay — follow on-screen prompts…'
          : 'Briefly tap the bank card on the back of the phone (NFC)…',
      );
      const collected = await terminal.collectPaymentMethod({
        paymentIntent: retrieved.paymentIntent,
      });
      if (collected?.error || !collected.paymentIntent) {
        throw new Error(collected?.error?.message || 'Collect failed');
      }

      setStatus('Confirming…');
      const confirmed = await terminal.confirmPaymentIntent({
        paymentIntent: collected.paymentIntent,
      });
      if (confirmed?.error || !confirmed.paymentIntent) {
        throw new Error(confirmed?.error?.message || 'Confirm failed');
      }

      const paymentIntentId = String(
        confirmed.paymentIntent.id || intent.paymentIntentId,
      ).trim();
      // Ledger must not block trip complete — charge already succeeded.
      setStatus('Recording fee split…');
      try {
        await recordTapLedger({
          paymentIntentId,
          companyId: driver.companyId,
          amountCents: intent.amountCents,
          bookingId,
          driverId: driver.id,
        });
      } catch (ledgerErr) {
        console.warn('[TapToPay] recordTapLedger failed (continuing to close trip):', ledgerErr);
      }

      setStatus('Paid');
      // Disconnect before handing control back so a later trip can discover cleanly.
      await teardownTapReader(terminal);
      onPaid({ paymentIntentId, amountCents: intent.amountCents });
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatus('Failed');
      await teardownTapReader(terminal);
    } finally {
      setBusy(false);
    }
  }, [amountCents, bookingId, driver?.companyId, driver?.id, onPaid, terminal]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Tap to Pay</Text>
        <Pressable onPress={() => void handleClose()} hitSlop={12} disabled={busy}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={styles.amount}>${(amountCents / 100).toFixed(2)}</Text>
      <Text style={styles.hint}>
        Bank cards / wallets only. Briefly tap near the phone’s NFC area (usually the back). TM
        cards cannot use NFC — use Scan or manual entry for TM.
        {shouldSimulateTapToPay() ? ' · SIMULATED mode (EXPO_PUBLIC_STRIPE_TERMINAL_SIMULATED=1).' : ''}
      </Text>
      <Text style={styles.status}>{status}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.primaryBtn, busy && styles.disabled]} onPress={start} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Start tap</Text>}
      </Pressable>
      {error ? (
        <Pressable style={styles.secondaryBtn} onPress={() => void handleClose()} disabled={busy}>
          <Text style={styles.secondaryBtnText}>Use another payment method</Text>
        </Pressable>
      ) : null}
      <Text style={styles.meta}>
        Company {driver?.companyId || '—'}
        {bookingId ? ` · Job ${bookingId}` : ''}
      </Text>
    </View>
  );
}

/**
 * Android Tap to Pay sheet. Wraps StripeTerminalProvider when the native module is present.
 */
export function TapToPaySheet({ visible, amountCents, bookingId, onCancel, onPaid }: Props) {
  const stripeMod = useMemo(() => tryLoadStripeTerminal(), []);
  const tokenProvider = useCallback(() => fetchTerminalConnectionToken(), []);

  if (!visible) return null;

  const body = (
    <TapToPayBody
      amountCents={amountCents}
      bookingId={bookingId}
      onCancel={onCancel}
      onPaid={onPaid}
    />
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      {stripeMod ? (
        <stripeMod.StripeTerminalProvider logLevel="verbose" tokenProvider={tokenProvider}>
          {body}
        </stripeMod.StripeTerminalProvider>
      ) : (
        <View style={styles.root}>
          <Text style={styles.title}>Tap to Pay</Text>
          <Text style={styles.error}>
            Stripe Terminal is not in this build. Rebuild with the Terminal plugin (EAS / dev
            client).
          </Text>
          <Pressable style={styles.primaryBtn} onPress={onCancel}>
            <Text style={styles.primaryBtnText}>Close</Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 16, gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  cancel: { color: Colors.accent, fontSize: 16 },
  amount: { color: Colors.text, fontSize: 36, fontWeight: '800', marginTop: 8 },
  hint: { color: Colors.textMuted, fontSize: 13, lineHeight: 18 },
  status: { color: Colors.text, fontSize: 14 },
  error: { color: Colors.danger, fontSize: 13 },
  meta: { color: Colors.textMuted, fontSize: 12, marginTop: 'auto' as const },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryBtnText: { color: Colors.accent, fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.6 },
});
