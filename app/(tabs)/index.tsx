import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { PresenceDisplayStatus } from '@/types';
import { Link } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

function statusColor(status: PresenceDisplayStatus) {
  switch (status) {
    case 'Online':
      return Colors.success;
    case 'Away':
      return Colors.warning ?? '#e6a700';
    default:
      return Colors.textMuted;
  }
}

function statusLabel(status: PresenceDisplayStatus) {
  switch (status) {
    case 'Online':
      return '● Online';
    case 'Away':
      return '◐ Away';
    default:
      return '○ Offline';
  }
}

export default function HomeScreen() {
  const { driver } = useAuth();
  const {
    presenceStatus,
    shiftActive,
    selectedVehicleId,
    vehicles,
    vehiclesLoading,
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

  const canGoOnline = shiftActive && selectedVehicleId && presenceStatus !== 'Online';

  const togglePresence = async () => {
    try {
      if (presenceStatus === 'Online') await goOffline();
      else await goOnline();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not update status');
    }
  };

  const handleStartShift = async () => {
    if (!selectedVehicleId) {
      Alert.alert('Vehicle required', 'Select your vehicle, then start your shift.');
      return;
    }
    try {
      await startShift();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not start shift');
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <ScreenHeader
        title={`Hello, ${driver?.name ?? 'Driver'}`}
        subtitle={isOffline ? 'Offline mode — changes will sync when connected' : `Driver ID: ${driver?.id ?? '—'}`}
      />

      <View style={[sharedStyles.card, presenceStatus === 'Online' && styles.onlineCard]}>
        <Text style={sharedStyles.cardTitle}>Shift</Text>
        <Text style={sharedStyles.cardText}>
          {shiftActive ? 'Shift in progress' : 'Start your shift to register with dispatch'}
        </Text>
        <View style={{ marginTop: 12, gap: 8 }}>
          {!shiftActive ? (
            <Button
              title="Start Shift"
              onPress={handleStartShift}
              disabled={vehiclesLoading || !selectedVehicleId}
            />
          ) : (
            <Button title="End Shift" variant="danger" onPress={endShift} />
          )}
        </View>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Vehicle</Text>
        {vehiclesLoading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 12 }} />
        ) : vehicles.length === 0 ? (
          <Text style={sharedStyles.cardText}>
            No vehicles allocated. Ask your fleet admin to assign vehicles in the driver portal.
          </Text>
        ) : (
          vehicles.map((v) => (
            <Pressable
              key={v.id}
              onPress={() => setSelectedVehicleId(v.id)}
              style={[styles.vehicleRow, selectedVehicleId === v.id && styles.vehicleSelected]}
            >
              <Text style={styles.vehicleLabel}>{v.label}</Text>
              <Text style={styles.vehiclePlate}>{v.plate}</Text>
              <Text style={styles.vehicleId}>{v.id}</Text>
            </Pressable>
          ))
        )}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Status</Text>
        <Text style={[styles.status, { color: statusColor(presenceStatus) }]}>
          {statusLabel(presenceStatus)}
        </Text>
        <Text style={sharedStyles.cardText}>
          {shiftActive
            ? 'Synced from Firebase dispatch presence'
            : 'Start shift to appear on the dispatch board'}
        </Text>
        <View style={{ marginTop: 12 }}>
          <Button
            title={presenceStatus === 'Online' ? 'Go Away' : 'Go Online'}
            onPress={togglePresence}
            disabled={!canGoOnline && presenceStatus !== 'Online'}
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
  vehicleId: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  status: { fontSize: 18, fontWeight: '700' },
  zoneName: { color: Colors.accent, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  quickLinks: { gap: 10, marginTop: 8 },
});
