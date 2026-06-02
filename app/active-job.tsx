import { Button } from '@/components/Button';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { JobStage } from '@/types';
import JobMap from '@/components/JobMap';
import { Link, router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

const STAGES: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];
const STAGE_LABELS: Record<JobStage, string> = {
  pickup: 'En route to pickup',
  arrived: 'Arrived at pickup',
  onboard: 'Passenger onboard',
  complete: 'Complete job',
};

const FLOW_HINTS: Record<string, string> = {
  Taxi: 'Use the meter for fare calculation.',
  Freight: 'Fixed fare — confirm parcel delivery at dropoff.',
  Food: 'Collect from restaurant, deliver to customer.',
  Tow: 'Vehicle recovery — confirm pickup and destination.',
};

export default function ActiveJobScreen() {
  const { activeJob, advanceStage, completeJob } = useDriver();

  if (!activeJob) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={sharedStyles.cardText}>No active job.</Text>
        <Button title="Back to Home" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }

  const stageIndex = STAGES.indexOf(activeJob.stage);
  const isTaxi = activeJob.type === 'Taxi';
  const isFixedFare = activeJob.type === 'Freight' || activeJob.type === 'Food' || activeJob.type === 'Tow';

  const onAdvance = async () => {
    if (activeJob.stage === 'complete') {
      await completeJob();
      router.replace('/(tabs)');
      return;
    }
    if (activeJob.stage === 'onboard' && isTaxi) {
      router.push('/meter');
      return;
    }
    await advanceStage();
    if (activeJob.stage === 'onboard' && isFixedFare) {
      Alert.alert('Confirm delivery', 'Mark job complete when delivered.');
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <JobTypeBadge type={activeJob.type} />
      <Text style={styles.hint}>{FLOW_HINTS[activeJob.type]}</Text>

      <View style={styles.mapWrap}>
        <JobMap
          pickup={{ latitude: -46.4132, longitude: 168.3538 }}
          dropoff={{ latitude: -46.3874, longitude: 168.3212 }}
        />
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Route</Text>
        <Text style={styles.address}>{activeJob.pickup}</Text>
        <Text style={styles.arrow}>↓</Text>
        <Text style={styles.address}>{activeJob.dropoff}</Text>
      </View>

      <View style={styles.progress}>
        {STAGES.map((stage, i) => (
          <View key={stage} style={styles.stepRow}>
            <View style={[styles.dot, i <= stageIndex && styles.dotActive]} />
            <Text style={[styles.stepLabel, i <= stageIndex && styles.stepActive]}>{STAGE_LABELS[stage]}</Text>
          </View>
        ))}
      </View>

      {activeJob.isAcc ? <Text style={styles.badgeAcc}>ACC Job — separate from Total Mobility</Text> : null}
      {activeJob.isTotalMobility ? <Text style={styles.badgeTm}>Total Mobility Job</Text> : null}

      <Button
        title={activeJob.stage === 'complete' ? 'Finish & Complete' : STAGE_LABELS[STAGES[Math.min(stageIndex + 1, STAGES.length - 1)]]}
        onPress={onAdvance}
      />
      {isTaxi ? (
        <Link href="/meter" asChild>
          <Button title="Open Meter" variant="secondary" style={{ marginTop: 10 }} />
        </Link>
      ) : null}
      <Link href="/chat" asChild>
        <Button title="Message Dispatcher" variant="secondary" style={{ marginTop: 10 }} />
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  hint: { color: Colors.textMuted, marginVertical: 8 },
  mapWrap: { height: 220, borderRadius: 16, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  address: { color: Colors.text, fontSize: 16 },
  arrow: { color: Colors.accent, textAlign: 'center', marginVertical: 4, fontSize: 18 },
  progress: { marginVertical: 16, gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.accent },
  stepLabel: { color: Colors.textMuted },
  stepActive: { color: Colors.text, fontWeight: '600' },
  badgeAcc: { color: Colors.acc, fontWeight: '700', marginBottom: 8 },
  badgeTm: { color: Colors.tm, fontWeight: '700', marginBottom: 8 },
});
