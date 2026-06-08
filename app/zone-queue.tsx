import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenScroll } from '@/components/ScreenScroll';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { StyleSheet, Text, View } from 'react-native';

export default function ZoneQueueScreen() {
  const { driver } = useAuth();
  const { zone, shiftActive } = useDriver();
  const zoneName = zone.name?.trim();
  const hasQueuePosition = zone.position > 0;
  const hasZone = !!zoneName;

  return (
    <ScreenScroll>
      <ScreenHeader title="Zone Queue" subtitle="Your position in the dispatch queue" />

      <View style={[sharedStyles.card, styles.hero]}>
        <Text style={styles.zoneLabel}>Current zone</Text>
        <Text style={styles.zoneName}>{hasZone ? zoneName : 'Not assigned'}</Text>
        {shiftActive ? (
          <Text style={styles.position}>
            {hasQueuePosition
              ? `You are #${zone.position}${zone.totalInQueue > 0 ? ` of ${zone.totalInQueue}` : ''}`
              : 'Waiting'}
          </Text>
        ) : (
          <Text style={styles.position}>Start your shift to join the queue</Text>
        )}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Your status</Text>
        <Text style={sharedStyles.cardText}>Driver ID: {driver?.id ?? '—'}</Text>
        <Text style={sharedStyles.cardText}>
          Nearby drivers: {zone.nearbyDrivers > 0 ? zone.nearbyDrivers : '—'}
        </Text>
      </View>

      <Text style={styles.listTitle}>Drivers in queue</Text>
      <View style={sharedStyles.card}>
        <Text style={styles.empty}>
          {shiftActive
            ? 'Queue list is provided by dispatch. No drivers listed in Firebase for this zone yet.'
            : 'Go on shift to see your queue position.'}
        </Text>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 28 },
  zoneLabel: { color: Colors.textMuted, textTransform: 'uppercase', fontSize: 12, letterSpacing: 1 },
  zoneName: { color: Colors.accent, fontSize: 32, fontWeight: '800', marginVertical: 8, textAlign: 'center' },
  position: { color: Colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  listTitle: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8, marginTop: 8 },
  empty: { color: Colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingVertical: 12 },
});
