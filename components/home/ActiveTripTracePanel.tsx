import { Colors } from '@/constants/theme';
import type { ActiveTripDiag } from '@/lib/activeTripDiag';
import { StyleSheet, Text, View } from 'react-native';

/** Always-visible on Current tab so Ad can see why the trip panel shows or not. */
export function ActiveTripTracePanel({ diag }: { diag: ActiveTripDiag | null | undefined }) {
  const d = diag;
  const lines: string[] = [];
  if (!d) {
    lines.push('diag: (not wired)');
  } else {
    lines.push(`phase: ${d.phase}`);
    lines.push(`company/vehicle/driver: ${d.companyId} / ${d.vehicleId} / ${d.driverId}`);
    lines.push(`AsyncStorage job: ${d.storageJobId}`);
    lines.push(`activeJob: ${d.activeJobId} / stage=${d.activeJobStage}`);
    lines.push(`hailActive: ${d.hailActive ? 'yes' : 'no'}  ·  hasCurrent UI: ${d.hasCurrentUi ? 'yes' : 'no'}`);
    lines.push(`allbookings: ${d.allbookingsPath}`);
    lines.push(`  Status: ${d.allbookingsStatus}`);
    lines.push(`jobs path: ${d.jobsPath}`);
    lines.push(`online/.../current jobId: ${d.onlineCurrentJobId}`);
    lines.push(`server refresh: ${d.serverRefresh}`);
    lines.push(`pickupVerifiedAt: ${d.pickupVerifiedAt}`);
    lines.push(`UI branch: ${d.uiBranch}`);
    lines.push(`DECISION: ${d.decision}`);
    lines.push(`updated: ${d.at}`);
  }

  return (
    <View style={styles.wrap} accessibilityLabel="Active trip trace">
      <Text style={styles.title}>ACTIVE TRIP TRACE (for Ad)</Text>
      {lines.map((line, i) => (
        <Text key={`${i}-${line.slice(0, 24)}`} style={styles.line} selectable>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#111827',
    borderWidth: 2,
    borderColor: '#f59e0b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    gap: 2,
  },
  title: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  line: {
    color: '#e5e7eb',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 15,
  },
});
