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
 * Still must not silently abandon an incomplete job via Back.
 */
export function PaymentModalFallback({ errorMessage, onRetry }: Props) {
  const { dismissPayment, paymentJob } = useDriver();

  const requestLeavePayment = () => {
    Alert.alert(
      'Payment not complete',
      'The payment screen hit an error, but this trip is still incomplete. Leave anyway?',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave incomplete', style: 'destructive', onPress: () => dismissPayment() },
      ],
    );
  };

  useEffect(() => {
    if (!paymentJob) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestLeavePayment();
      return true;
    });
    return () => sub.remove();
  }, [paymentJob, dismissPayment]);

  return (
    <Modal
      visible={!!paymentJob}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={requestLeavePayment}
    >
      <View style={styles.box}>
        <Text style={styles.title}>Payment screen error</Text>
        <Text style={styles.msg}>{errorMessage}</Text>
        <Button title="Try again" onPress={onRetry} />
        <Button title="Leave incomplete" variant="secondary" onPress={requestLeavePayment} />
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
