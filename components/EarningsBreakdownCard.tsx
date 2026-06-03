import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { EARNINGS_LABELS, EarningsBreakdown, EarningsBucket } from '@/lib/earnings';
import { StyleSheet, Text, View } from 'react-native';

const BUCKETS: EarningsBucket[] = ['cash', 'card', 'account', 'tm', 'acc'];

type Props = {
  title?: string;
  breakdown: EarningsBreakdown;
  jobCount?: number;
};

export function EarningsBreakdownCard({ title = 'Earnings', breakdown, jobCount }: Props) {
  return (
    <View style={sharedStyles.card}>
      <Text style={sharedStyles.cardTitle}>{title}</Text>
      <Text style={styles.total}>${breakdown.total.toFixed(2)}</Text>
      {jobCount != null ? (
        <Text style={sharedStyles.cardText}>{jobCount} jobs</Text>
      ) : null}
      <View style={styles.grid}>
        {BUCKETS.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.label}>{EARNINGS_LABELS[key]}</Text>
            <Text style={styles.amount}>${breakdown[key].toFixed(2)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  total: { color: Colors.success, fontSize: 28, fontWeight: '800', marginTop: 4 },
  grid: { marginTop: 12, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: Colors.textMuted, fontSize: 14 },
  amount: { color: Colors.text, fontSize: 14, fontWeight: '600' },
});
