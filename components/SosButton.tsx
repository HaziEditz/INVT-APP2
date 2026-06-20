import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { cancelDriverSos, triggerDriverSos } from '@/lib/dispatchApi';
import { getLastKnownCoords } from '@/services/locationService';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

const HOLD_MS = 3000;

type Props = {
  disabled?: boolean;
};

export function SosButton({ disabled }: Props) {
  const { driver } = useAuth();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState(false);
  const holdStart = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

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
      });
      setActive(true);
      Alert.alert(
        'Emergency sent',
        'Dispatch has been alerted. Hold Cancel SOS below if this was accidental.',
      );
    } catch (e) {
      Alert.alert('SOS failed', e instanceof Error ? e.message : 'Could not reach dispatch');
    } finally {
      setSending(false);
    }
  }, [driver, sending]);

  const onHoldStart = () => {
    if (disabled || sending || active) return;
    holdStart.current = Date.now();
    setHolding(true);
    tickRef.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - holdStart.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        clearHoldTimer();
        void fireSos();
      }
    }, 50);
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
            Alert.alert('SOS cancelled', 'Dispatch has been notified.');
          } catch (e) {
            Alert.alert('Cancel failed', e instanceof Error ? e.message : 'Try again');
          }
        },
      },
    ]);
  };

  if (active) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.activeLabel}>SOS ACTIVE — dispatch alerted</Text>
        <Button title="Cancel SOS" variant="danger" onPress={cancelActive} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>Hold 3 seconds to send emergency SOS to dispatch</Text>
      <Pressable
        disabled={disabled || sending}
        onPressIn={onHoldStart}
        onPressOut={clearHoldTimer}
        style={[styles.btn, holding && styles.btnHolding, (disabled || sending) && styles.btnDisabled]}
      >
        <Text style={styles.btnText}>{sending ? 'Sending…' : 'SOS / EMERGENCY'}</Text>
        {holding ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, gap: 8 },
  hint: { color: Colors.textMuted, fontSize: 13, textAlign: 'center' },
  activeLabel: { color: Colors.danger, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  btn: {
    backgroundColor: Colors.danger,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  btnHolding: { opacity: 0.92 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  progressTrack: {
    marginTop: 10,
    height: 4,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fff' },
});
