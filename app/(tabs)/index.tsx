import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { Link, router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const VEHICLES = [
  { id: 'V001', label: 'Toyota Camry', plate: 'ABC123' },
  { id: 'V002', label: 'Hyundai Ioniq', plate: 'XYZ789' },
];

export default function HomeScreen() {
  const { driver } = useAuth();
  const {
    online,
    shiftActive,
    selectedVehicleId,
    zone,
    activeJob,
    isOffline,
    setSelectedVehicleId,
    startShift,
    endShift,
    goOnline,
    goOffline,
    pushDemoOffer,
  } = useDriver();

  const toggleOnline = async () => {
    try {
      if (online) await goOffline();
      else await goOnline();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not update status');
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <ScreenHeader
        title={`Hello, ${driver?.name ?? 'Driver'}`}
        subtitle={isOffline ? 'Offline mode — changes will sync when connected' : `Driver ID: ${driver?.id ?? '—'}`}
      />

      <View style={[sharedStyles.card, online && styles.onlineCard]}>
        <Text style={sharedStyles.cardTitle}>Shift</Text>
        <Text style={sharedStyles.cardText}>
          {shiftActive ? 'Shift in progress' : 'Start your shift to begin working'}
        </Text>
        <View style={{ marginTop: 12, gap: 8 }}>
          {!shiftActive ? (
            <Button title="Start Shift" onPress={startShift} />
          ) : (
            <Button title="End Shift" variant="danger" onPress={endShift} />
          )}
        </View>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Vehicle</Text>
        {VEHICLES.map((v) => (
          <Pressable
            key={v.id}
            onPress={() => setSelectedVehicleId(v.id)}
            style={[styles.vehicleRow, selectedVehicleId === v.id && styles.vehicleSelected]}
          >
            <Text style={styles.vehicleLabel}>{v.label}</Text>
            <Text style={styles.vehiclePlate}>{v.plate}</Text>
          </Pressable>
        ))}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Status</Text>
        <Text style={[styles.status, { color: online ? Colors.success : Colors.textMuted }]}>
          {online ? '● Online' : '○ Offline'}
        </Text>
        <View style={{ marginTop: 12 }}>
          <Button
            title={online ? 'Go Offline' : 'Go Online'}
            onPress={toggleOnline}
            disabled={!shiftActive || !selectedVehicleId}
          />
        </View>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Current Zone</Text>
        <Text style={styles.zoneName}>{zone.name}</Text>
        <Text style={sharedStyles.cardText}>Queue position: {zone.position || '—'} of {zone.totalInQueue || '—'}</Text>
        <Link href="/zone-queue" asChild>
          <Button title="View Zone Queue" variant="secondary" style={{ marginTop: 12 }} />
        </Link>
      </View>

      <View style={styles.quickLinks}>
        {activeJob ? (
          <>
            <Link href="/active-job" asChild><Button title="Active Job" /></Link>
            <Link href="/meter" asChild><Button title="Meter" variant="secondary" /></Link>
          </>
        ) : null}
        <Link href="/pre-booking" asChild><Button title="Pre-booking" variant="secondary" /></Link>
        <Link href="/chat" asChild><Button title="Chat Dispatcher" variant="secondary" /></Link>
        <Button title="Simulate Job Offer" variant="secondary" onPress={pushDemoOffer} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  onlineCard: { borderColor: Colors.success },
  vehicleRow: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 8,
  },
  vehicleSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent + '15' },
  vehicleLabel: { color: Colors.text, fontWeight: '600' },
  vehiclePlate: { color: Colors.textMuted, marginTop: 2 },
  status: { fontSize: 18, fontWeight: '700' },
  zoneName: { color: Colors.accent, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  quickLinks: { gap: 10, marginTop: 8 },
});
