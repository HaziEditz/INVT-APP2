import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { Modal, StyleSheet, Text, View } from 'react-native';

type Props = {
  errorMessage: string;
  onRetry: () => void;
};

export function PaymentModalFallback({ errorMessage, onRetry }: Props) {
  const { dismissPayment, paymentJob } = useDriver();

  return (
    <Modal visible={!!paymentJob} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.box}>
        <Text style={styles.title}>Payment screen error</Text>
        <Text style={styles.msg}>{errorMessage}</Text>
        <Button title="Try again" onPress={onRetry} />
        <Button title="Back to trip" variant="secondary" onPress={dismissPayment} />
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
