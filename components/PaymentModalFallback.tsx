import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useEffect } from 'react';
import { Alert, BackHandler, Modal, StyleSheet, Text, View } from 'react-native';

type Props = {
  errorMessage: string;
  onRetry: () => void;
};

/**
 * Fallback when PaymentModal fails to load / crashes.
 * Must not dismiss paymentJob — that abandons an incomplete Active job.
 */
export function PaymentModalFallback({ errorMessage, onRetry }: Props) {
  const { paymentJob } = useDriver();

  const stayOnPayment = () => {
    Alert.alert(
      'Payment required',
      'This trip is not finished. Tap Try again to reload the payment screen, or choose another payment method once it loads.',
      [{ text: 'OK', style: 'cancel' }],
    );
  };

  useEffect(() => {
    if (!paymentJob) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      stayOnPayment();
      return true;
    });
    return () => sub.remove();
  }, [paymentJob]);

  return (
    <Modal
      visible={!!paymentJob}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={stayOnPayment}
    >
      <View style={styles.box}>
        <Text style={styles.title}>Payment screen error</Text>
        <Text style={styles.msg}>{errorMessage}</Text>
        <Button title="Try again" onPress={onRetry} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: { color: Colors.warning, fontSize: 20, fontWeight: '800' },
  msg: { color: Colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 8 },
});
