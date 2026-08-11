import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { formatHours, type EndShiftSummary } from '@/services/nztaService';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  summary: EndShiftSummary | null;
  onContinue: () => void;
};

export function EndShiftSummaryModal({ visible, summary, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  if (!visible || !summary) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.title}>Shift summary</Text>
        <Text style={styles.subtitle}>Your hours for this shift (NZTA)</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Shift window (wall clock)</Text>
            <Text style={styles.value}>{formatHours(summary.shiftElapsedMinutes)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Work time (ticks + catch-up)</Text>
            <Text style={styles.value}>{formatHours(summary.workedMinutes)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Breaks confirmed</Text>
            <Text style={styles.value}>{formatHours(summary.breakMinutes)}</Text>
          </View>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.label}>Weekly total (ticks + catch-up)</Text>
            <Text style={styles.valueHighlight}>{formatHours(summary.weeklyWorkedMinutes)}</Text>
          </View>
        </View>

        <Text style={styles.hint}>
          Window time is wall clock from when this 14h shift window opened (includes offline).
          Work and weekly totals use logged minutes, plus catch-up if the app was backgrounded.
          Breaks only count when you confirm a break reminder — they are not window minus work.
          {'\n\n'}
          Tap continue to sign out and return to the login screen.
        </Text>

        <Button title="Continue" onPress={onContinue} style={styles.btn} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
  },
  title: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 15,
    marginBottom: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  label: {
    color: Colors.textMuted,
    fontSize: 15,
  },
  value: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  valueHighlight: {
    color: Colors.accent,
    fontSize: 18,
    fontWeight: '800',
  },
  hint: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  btn: {
    marginTop: 'auto',
  },
});
