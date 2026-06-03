import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenScroll } from '@/components/ScreenScroll';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { StyleSheet, Text, View } from 'react-native';

const NEARBY = [
  { id: 'D002', name: 'James', position: 1 },
  { id: 'D005', name: 'Sarah', position: 2 },
  { id: 'D008', name: 'Mike', position: 3 },
];

export default function ZoneQueueScreen() {
  const { driver } = useAuth();
  const { zone } = useDriver();
  const zoneName = zone.name?.trim() || 'Not assigned yet';

  return (
    <ScreenScroll>
      <ScreenHeader title="Zone Queue" subtitle="Your position in the dispatch queue" />

      <View style={[sharedStyles.card, styles.hero]}>
        <Text style={styles.zoneLabel}>Current zone</Text>
        <Text style={styles.zoneName}>{zoneName}</Text>
        <Text style={styles.position}>
          You are #{zone.position || '—'} of {zone.totalInQueue || NEARBY.length + 1}
        </Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Your status</Text>
        <Text style={sharedStyles.cardText}>Driver ID: {driver?.id ?? '—'}</Text>
        <Text style={sharedStyles.cardText}>Nearby drivers: {zone.nearbyDrivers || NEARBY.length}</Text>
      </View>

      <Text style={styles.listTitle}>Drivers in queue</Text>
      {NEARBY.map((d) => (
        <View key={d.id} style={[sharedStyles.card, styles.driverRow]}>
          <View>
            <Text style={styles.driverName}>{d.name}</Text>
            <Text style={sharedStyles.cardText}>{d.id}</Text>
          </View>
          <Text style={styles.queueNum}>#{d.position}</Text>
        </View>
      ))}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 28 },
  zoneLabel: { color: Colors.textMuted, textTransform: 'uppercase', fontSize: 12, letterSpacing: 1 },
  zoneName: { color: Colors.accent, fontSize: 32, fontWeight: '800', marginVertical: 8, textAlign: 'center' },
  position: { color: Colors.text, fontSize: 18, fontWeight: '600' },
  listTitle: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8, marginTop: 8 },
  driverRow: { ...sharedStyles.row },
  driverName: { color: Colors.text, fontWeight: '600', fontSize: 16 },
  queueNum: { color: Colors.accent, fontSize: 22, fontWeight: '800' },
});
