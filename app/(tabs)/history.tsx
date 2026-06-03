import { EarningsBreakdownCard } from '@/components/EarningsBreakdownCard';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenScroll } from '@/components/ScreenScroll';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { formatPaymentLabel } from '@/lib/earnings';
import { HistoryJob } from '@/lib/jobHistory';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';

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

function JobCard({ job }: { job: HistoryJob }) {
  return (
    <View style={sharedStyles.card}>
      <View style={styles.row}>
        <JobTypeBadge type={job.type} />
        <Text style={[styles.statusBadge, { color: statusColor(job) }]}>{statusLabel(job)}</Text>
      </View>
      {job.status === 'completed' ? (
        <>
          <Text style={styles.fare}>${job.fare.toFixed(2)}</Text>
          <Text style={styles.paymentType}>{formatPaymentLabel(job.paymentType)}</Text>
        </>
      ) : null}
      <Text style={styles.route}>{job.pickup || '—'}</Text>
      <Text style={styles.route}>→ {job.dropoff || '—'}</Text>
      {job.passengerName ? <Text style={sharedStyles.cardText}>{job.passengerName}</Text> : null}
      <Text style={sharedStyles.cardText}>{new Date(job.completedAt).toLocaleString()}</Text>
      {job.cancelledBy ? (
        <Text style={sharedStyles.cardText}>Cancelled by: {job.cancelledBy}</Text>
      ) : null}
    </View>
  );
}

function Section({ title, jobs }: { title: string; jobs: HistoryJob[] }) {
  if (!jobs.length) return null;
  return (
    <>
      <Text style={styles.sectionTitle}>{title} ({jobs.length})</Text>
      {jobs.map((job) => (
        <JobCard key={`${job.id}-${job.status}-${job.completedAt}`} job={job} />
      ))}
    </>
  );
}

export default function HistoryScreen() {
  const { jobHistory, jobHistoryLoading, historyEarnings, refreshJobHistory } = useDriver();

  useFocusEffect(
    useCallback(() => {
      refreshJobHistory().catch(() => undefined);
    }, [refreshJobHistory]),
  );

  const completed = jobHistory.filter((j) => j.status === 'completed');
  const cancelled = jobHistory.filter((j) => j.status === 'cancelled');
  const noshows = jobHistory.filter((j) => j.status === 'noshow');

  return (
    <ScreenScroll
      padBottom
      refreshControl={
        <RefreshControl
          refreshing={jobHistoryLoading}
          onRefresh={() => refreshJobHistory()}
          tintColor={Colors.accent}
        />
      }
    >
      <ScreenHeader title="Job History" subtitle="Last 7 days from dispatch" />

      {jobHistoryLoading && jobHistory.length === 0 ? (
        <ActivityIndicator color={Colors.accent} style={{ marginVertical: 24 }} />
      ) : (
        <>
          <EarningsBreakdownCard
            title="Total income (completed)"
            breakdown={historyEarnings}
            jobCount={completed.length}
          />

          <View style={sharedStyles.card}>
            <Text style={sharedStyles.cardTitle}>Summary</Text>
            <Text style={sharedStyles.cardText}>{completed.length} completed</Text>
            <Text style={sharedStyles.cardText}>{cancelled.length} cancelled</Text>
            <Text style={sharedStyles.cardText}>{noshows.length} no-show</Text>
          </View>

          {jobHistory.length === 0 ? (
            <Text style={sharedStyles.cardText}>No jobs in the last 7 days.</Text>
          ) : (
            <>
              <Section title="Completed" jobs={completed} />
              <Section title="Cancelled" jobs={cancelled} />
              <Section title="No-shows" jobs={noshows} />
            </>
          )}
        </>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusBadge: { fontSize: 13, fontWeight: '700' },
  fare: { color: Colors.success, fontSize: 22, fontWeight: '800', marginBottom: 2 },
  paymentType: { color: Colors.accent, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  route: { color: Colors.text, marginBottom: 2 },
});
