import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { cancelDriverSos, triggerDriverSos } from '@/lib/dispatchApi';
import { getDatabaseInstance, isFirebaseReady } from '@/lib/firebase';
import { getLastKnownCoords } from '@/services/locationService';
import { onValue, ref } from 'firebase/database';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

const DOUBLE_TAP_MS = 500;
const COUNTDOWN_SEC = 5;

type Props = {
  disabled?: boolean;
  /** Corner button on main screen; secondary is a smaller backup on Profile. */
  variant?: 'corner' | 'secondary';
  vehicleNumber?: string;
};

export function SosButton({ disabled, variant = 'secondary', vehicleNumber }: Props) {
  const { driver } = useAuth();
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [countdownOpen, setCountdownOpen] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const lastTapRef = useRef(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdownOpen(false);
    setCountdown(COUNTDOWN_SEC);
  }, []);

  useEffect(() => () => clearCountdown(), [clearCountdown]);

  useEffect(() => {
    if (!driver?.companyId || !driver?.id || !isFirebaseReady) return;
    const sosRef = ref(getDatabaseInstance(), `Emergency/${driver.companyId}/${driver.id}`);
    return onValue(sosRef, (snap) => {
      const val = snap.val() as Record<string, unknown> | null;
      if (!val || typeof val !== 'object') {
        setActive(false);
        setAcknowledged(false);
        return;
      }
      const status = String(val.status ?? 'active').toLowerCase();
      setActive(status === 'active' || status === 'acknowledged');
      setAcknowledged(status === 'acknowledged');
    });
  }, [driver?.companyId, driver?.id]);

  const fireSos = useCallback(async () => {
    if (!driver || sending) return;
    setSending(true);
    try {
      const coords = await getLastKnownCoords();
      const lat = coords?.latitude ?? 0;
      const lng = coords?.longitude ?? 0;
      await triggerDriverSos({
        lat,
        lng,
        phone: driver.phone,
        driverName: driver.name,
        vehiclenumber: vehicleNumber?.trim() || driver.vehicleId || '',
      });
      setActive(true);
      setAcknowledged(false);
      Alert.alert(
        'Emergency sent',
        'Dispatch has been alerted. You will be notified when dispatch responds.',
      );
    } catch (e) {
      Alert.alert('SOS failed', e instanceof Error ? e.message : 'Could not reach dispatch');
    } finally {
      setSending(false);
    }
  }, [driver, sending, vehicleNumber]);

  const startCountdown = useCallback(() => {
    if (disabled || sending || active) return;
    setCountdownOpen(true);
    setCountdown(COUNTDOWN_SEC);
    let remaining = COUNTDOWN_SEC;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearCountdown();
        void fireSos();
      }
    }, 1000);
  }, [active, clearCountdown, disabled, fireSos, sending]);

  const onSosPress = () => {
    if (disabled || sending || active) return;
    const now = Date.now();
    if (now - lastTapRef.current <= DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      startCountdown();
      return;
    }
    lastTapRef.current = now;
  };

  const cancelActive = () => {
    Alert.alert('Cancel SOS?', 'Tell dispatch the emergency is over or was a mistake.', [
      { text: 'Keep SOS', style: 'cancel' },
      {
        text: 'Cancel SOS',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelDriverSos();
            setActive(false);
            setAcknowledged(false);
            Alert.alert('SOS cancelled', 'Dispatch has been notified.');
          } catch (e) {
            Alert.alert('Cancel failed', e instanceof Error ? e.message : 'Try again');
          }
        },
      },
    ]);
  };

  if (active) {
    if (variant === 'corner') {
      return (
        <View style={styles.cornerActiveWrap}>
          <Text style={styles.cornerActiveText}>
            {acknowledged ? 'Dispatch responding' : 'SOS active'}
          </Text>
          <Pressable onPress={cancelActive} style={styles.cornerCancel}>
            <Text style={styles.cornerCancelText}>Cancel</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.wrap}>
        <Text style={[styles.activeLabel, acknowledged && styles.ackLabel]}>
          {acknowledged ? 'Dispatch is responding' : 'SOS ACTIVE — dispatch alerted'}
        </Text>
        <Button title="Cancel SOS" variant="danger" onPress={cancelActive} />
      </View>
    );
  }

  const trigger = variant === 'corner' ? (
    <Pressable
      disabled={disabled || sending}
      onPress={onSosPress}
      style={[styles.cornerBtn, (disabled || sending) && styles.btnDisabled]}
      accessibilityLabel="SOS emergency — double tap"
    >
      <Text style={styles.cornerBtnText}>SOS</Text>
    </Pressable>
  ) : (
    <View style={styles.wrap}>
      <Text style={styles.hintSecondary}>Double-tap to send emergency SOS (backup)</Text>
      <Pressable
        disabled={disabled || sending}
        onPress={onSosPress}
        style={[styles.btnSecondary, (disabled || sending) && styles.btnDisabled]}
      >
        <Text style={styles.btnSecondaryText}>{sending ? 'Sending…' : 'SOS / Emergency'}</Text>
      </Pressable>
    </View>
  );

  return (
    <>
      {trigger}
      <Modal visible={countdownOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Sending SOS in</Text>
            <Text style={styles.modalCount}>{countdown}</Text>
            <Text style={styles.modalSub}>Dispatch will be alerted with your location.</Text>
            <Button title="Cancel" variant="secondary" onPress={clearCountdown} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 8 },
  hintSecondary: { color: Colors.textMuted, fontSize: 12, textAlign: 'center' },
  activeLabel: { color: Colors.danger, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  ackLabel: { color: '#22c55e' },
  btnSecondary: {
    backgroundColor: Colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    opacity: 0.85,
  },
  btnSecondaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },
  cornerBtn: {
    backgroundColor: Colors.danger,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 44,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  cornerBtnText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  cornerActiveWrap: {
    backgroundColor: Colors.danger,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 2,
  },
  cornerActiveText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  cornerCancel: { paddingVertical: 2 },
  cornerCancelText: { color: '#fff', fontSize: 9, textDecorationLine: 'underline' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: 12,
  },
  modalTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  modalCount: { color: Colors.danger, fontSize: 48, fontWeight: '900' },
  modalSub: { color: Colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: 8 },
});
