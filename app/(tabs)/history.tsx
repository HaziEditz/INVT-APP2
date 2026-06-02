import { JobTypeBadge } from '@/components/JobTypeBadge';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function HistoryScreen() {
  const { completedJobs } = useDriver();
  const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.fare ?? 0), 0);

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <ScreenHeader title="Job History" subtitle="Completed jobs and earnings" />

      <View style={[sharedStyles.card, styles.summary]}>
        <Text style={sharedStyles.cardTitle}>Total earnings</Text>
        <Text style={styles.earnings}>${totalEarnings.toFixed(2)}</Text>
        <Text style={sharedStyles.cardText}>{completedJobs.length} completed jobs</Text>
      </View>

      {completedJobs.length === 0 ? (
        <Text style={sharedStyles.cardText}>No completed jobs yet.</Text>
      ) : (
        completedJobs.map((job) => (
          <View key={job.id} style={sharedStyles.card}>
            <View style={styles.row}>
              <JobTypeBadge type={job.type} />
              <Text style={styles.fare}>${job.fare.toFixed(2)}</Text>
            </View>
            <Text style={styles.route}>{job.pickup}</Text>
            <Text style={styles.route}>→ {job.dropoff}</Text>
            <Text style={sharedStyles.cardText}>
              {job.paymentType ?? 'Cash'} · {new Date(job.completedAt).toLocaleString()}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'flex-start' },
  earnings: { color: Colors.success, fontSize: 32, fontWeight: '800', marginVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  fare: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  route: { color: Colors.text, marginBottom: 2 },
});
