import { Colors } from '@/constants/theme';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
};

export function EndShiftOverlay({ visible }: Props) {
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.text}>Ending shift…</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 220,
  },
  text: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
});
