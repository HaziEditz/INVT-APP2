import { EarningsBreakdownCard } from '@/components/EarningsBreakdownCard';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenScroll } from '@/components/ScreenScroll';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { HistoryJob } from '@/lib/jobHistory';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

function statusLabel(job: HistoryJob) {
  if (job.status === 'cancelled') return 'Cancelled';
  if (job.status === 'noshow') return 'No-show';
  return 'Completed';
}

function statusColor(job: HistoryJob) {
  if (job.status === 'cancelled') return Colors.warning;
  if (job.status === 'noshow') return Colors.danger;
  return Colors.success;
}

function paymentDisplay(job: HistoryJob) {
  if (job.status !== 'completed') return '—';
  const pt = String(job.paymentType ?? 'Cash');
  return pt;
}

export default function HistoryScreen() {
  const { jobHistory, jobHistoryLoading, historyEarnings } = useDriver();

  const completed = jobHistory.filter((j) => j.status === 'completed');
  const cancelled = jobHistory.filter((j) => j.status === 'cancelled');
  const noshows = jobHistory.filter((j) => j.status === 'noshow');

  return (
    <ScreenScroll padBottom>
      <ScreenHeader title="Job History" subtitle="Last 7 days from dispatch" />

      {jobHistoryLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginVertical: 24 }} />
      ) : (
        <>
          <EarningsBreakdownCard
            title="Total income (completed)"
            breakdown={historyEarnings}
            jobCount={completed.length}
          />

          {(cancelled.length > 0 || noshows.length > 0) && (
            <View style={sharedStyles.card}>
              <Text style={sharedStyles.cardTitle}>Cancelled & no-shows</Text>
              <Text style={sharedStyles.cardText}>
                {cancelled.length} cancelled · {noshows.length} no-show
              </Text>
            </View>
          )}

          {jobHistory.length === 0 ? (
            <Text style={sharedStyles.cardText}>No jobs in the last 7 days.</Text>
          ) : (
            jobHistory.map((job) => (
              <View key={`${job.id}-${job.status}`} style={sharedStyles.card}>
                <View style={styles.row}>
                  <JobTypeBadge type={job.type} />
                  <Text style={[styles.statusBadge, { color: statusColor(job) }]}>
                    {statusLabel(job)}
                  </Text>
                </View>
                {job.status === 'completed' ? (
                  <Text style={styles.fare}>${job.fare.toFixed(2)}</Text>
                ) : null}
                <Text style={styles.route}>{job.pickup || '—'}</Text>
                <Text style={styles.route}>→ {job.dropoff || '—'}</Text>
                {job.passengerName ? (
                  <Text style={sharedStyles.cardText}>{job.passengerName}</Text>
                ) : null}
                <Text style={sharedStyles.cardText}>
                  {job.status === 'completed' ? `${paymentDisplay(job)} · ` : ''}
                  {new Date(job.completedAt).toLocaleString()}
                </Text>
                {job.cancelledBy ? (
                  <Text style={sharedStyles.cardText}>Cancelled by: {job.cancelledBy}</Text>
                ) : null}
              </View>
            ))
          )}
        </>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { fontSize: 13, fontWeight: '700' },
  fare: { color: Colors.success, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  route: { color: Colors.text, marginBottom: 2 },
});
