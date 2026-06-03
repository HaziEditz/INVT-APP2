import { EarningsBreakdownCard } from '@/components/EarningsBreakdownCard';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenScroll } from '@/components/ScreenScroll';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { formatPaymentLabel } from '@/lib/earnings';
import { HistoryJob } from '@/lib/jobHistory';
import {
  applyHistoryFilters,
  getPeriodLabel,
  HistoryPeriod,
  PAYMENT_FILTER_OPTIONS,
  PaymentFilter,
  PERIOD_OPTIONS,
  periodSummary,
} from '@/lib/historyFilters';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
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
  const { jobHistory, jobHistoryLoading, refreshJobHistory } = useDriver();
  const [period, setPeriod] = useState<HistoryPeriod>('week');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');

  useFocusEffect(
    useCallback(() => {
      refreshJobHistory().catch(() => undefined);
    }, [refreshJobHistory]),
  );

  const periodJobs = useMemo(
    () => applyHistoryFilters(jobHistory, period, 'all'),
    [jobHistory, period],
  );

  const summary = useMemo(() => periodSummary(periodJobs), [periodJobs]);

  const displayJobs = useMemo(
    () => applyHistoryFilters(jobHistory, period, paymentFilter),
    [jobHistory, period, paymentFilter],
  );

  const completed = displayJobs.filter((j) => j.status === 'completed');
  const cancelled =
    paymentFilter === 'all' ? periodJobs.filter((j) => j.status === 'cancelled') : [];
  const noshows =
    paymentFilter === 'all' ? periodJobs.filter((j) => j.status === 'noshow') : [];

  const periodLabel = getPeriodLabel(period);
  const paymentLabel =
    PAYMENT_FILTER_OPTIONS.find((p) => p.id === paymentFilter)?.label ?? 'All';

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
      <ScreenHeader title="Job History" subtitle="Filter by period and payment type" />

      <Text style={styles.filterHeading}>Period</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {PERIOD_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.id}
            label={opt.label}
            active={period === opt.id}
            onPress={() => setPeriod(opt.id)}
          />
        ))}
      </ScrollView>

      <Text style={styles.filterHeading}>Payment type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {PAYMENT_FILTER_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.id}
            label={opt.label}
            active={paymentFilter === opt.id}
            onPress={() => setPaymentFilter(opt.id)}
          />
        ))}
      </ScrollView>

      {jobHistoryLoading && jobHistory.length === 0 ? (
        <ActivityIndicator color={Colors.accent} style={{ marginVertical: 24 }} />
      ) : (
        <>
          <EarningsBreakdownCard
            title={`${periodLabel} — income`}
            breakdown={summary.earnings}
            jobCount={summary.completedCount}
          />

          <View style={sharedStyles.card}>
            <Text style={sharedStyles.cardTitle}>{periodLabel} summary</Text>
            <Text style={styles.summaryTotal}>${summary.earnings.total.toFixed(2)} total</Text>
            <Text style={sharedStyles.cardText}>{summary.completedCount} completed</Text>
            <Text style={sharedStyles.cardText}>{summary.cancelledCount} cancelled</Text>
            <Text style={sharedStyles.cardText}>{summary.noshowCount} no-show</Text>
            {paymentFilter !== 'all' ? (
              <Text style={[sharedStyles.cardText, { marginTop: 8 }]}>
                Showing {paymentLabel} jobs only ({completed.length})
              </Text>
            ) : null}
          </View>

          {displayJobs.length === 0 && !jobHistoryLoading ? (
            <Text style={sharedStyles.cardText}>
              No jobs for {periodLabel}
              {paymentFilter !== 'all' ? ` · ${paymentLabel}` : ''}.
            </Text>
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
  filterHeading: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
  },
  chipRow: { marginBottom: 12, flexGrow: 0 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceElevated,
    marginRight: 8,
  },
  chipActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '22',
  },
  chipText: { color: Colors.textMuted, fontSize: 14, fontWeight: '600' },
  chipTextActive: { color: Colors.accent },
  summaryTotal: {
    color: Colors.success,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
    marginBottom: 8,
  },
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
