import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenScroll } from '@/components/ScreenScroll';
import { VehiclePickerModal } from '@/components/VehiclePickerModal';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { PresenceDisplayStatus } from '@/types';
import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

function statusColor(status: PresenceDisplayStatus) {
  switch (status) {
    case 'Online':
      return Colors.success;
    case 'Away':
      return Colors.warning;
    default:
      return Colors.textMuted;
  }
}

function statusLabel(status: PresenceDisplayStatus, ready: boolean) {
  if (ready && status === 'Online') return '● Online — ready for jobs';
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
    readyForJobs,
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
    pushDemoOffer,
  } = useDriver();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pickerVehicle, setPickerVehicle] = useState(selectedVehicleId);

  const openStartFlow = () => {
    if (vehiclesLoading) return;
    if (vehicles.length === 0) {
      Alert.alert('No vehicles', 'Ask your fleet admin to allocate vehicles to your profile.');
      return;
    }
    if (vehicles.length === 1) {
      const id = vehicles[0].id;
      setPickerVehicle(id);
      void runStartShift(id);
      return;
    }
    setPickerVehicle(selectedVehicleId || vehicles[0]?.id || '');
    setPickerOpen(true);
  };

  const runStartShift = async (vehicleId: string) => {
    setStarting(true);
    try {
      await startShift(vehicleId);
      setPickerOpen(false);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not start shift');
    } finally {
      setStarting(false);
    }
  };

  const zoneName = zone.name?.trim() || (shiftActive ? 'Awaiting zone assignment' : '—');

  return (
    <>
      <ScreenScroll padBottom>
        <ScreenHeader
          title={`Hello, ${driver?.name ?? 'Driver'}`}
          subtitle={
            isOffline
              ? 'Offline mode — changes sync when connected'
              : `Driver ID: ${driver?.id ?? '—'}`
          }
        />

        {readyForJobs && shiftActive ? (
          <View style={styles.readyBanner}>
            <Text style={styles.readyTitle}>You are online</Text>
            <Text style={styles.readyText}>Ready to receive job offers from dispatch.</Text>
          </View>
        ) : null}

        <View style={[sharedStyles.card, (readyForJobs || presenceStatus === 'Online') && styles.onlineCard]}>
          <Text style={sharedStyles.cardTitle}>Shift</Text>
          <Text style={[styles.status, { color: statusColor(presenceStatus) }]}>
            {statusLabel(presenceStatus, readyForJobs)}
          </Text>
          <Text style={sharedStyles.cardText}>
            {shiftActive
              ? 'Tap End Shift when you finish for the day.'
              : 'Start shift to select your vehicle and go online automatically.'}
          </Text>
          <View style={styles.cardActions}>
            {!shiftActive ? (
              <Button title="Start Shift" onPress={openStartFlow} disabled={vehiclesLoading} />
            ) : (
              <Button title="End Shift" variant="danger" onPress={endShift} />
            )}
          </View>
        </View>

        {!shiftActive && vehicles.length > 0 ? (
          <View style={sharedStyles.card}>
            <Text style={sharedStyles.cardTitle}>Your vehicles</Text>
            {vehiclesLoading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginTop: 12 }} />
            ) : (
              vehicles.map((v) => (
                <View key={v.id} style={styles.vehicleRow}>
                  <View>
                    <Text style={styles.vehicleNumber}>{v.number}</Text>
                    <Text style={styles.vehicleType}>{v.bodyType} · {v.vehicleType}</Text>
                  </View>
                  <Text style={styles.vehicleId}>{v.id}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {shiftActive && selectedVehicleId ? (
          <View style={sharedStyles.card}>
            <Text style={sharedStyles.cardTitle}>Active vehicle</Text>
            {(() => {
              const v = vehicles.find((x) => x.id === selectedVehicleId);
              return (
                <>
                  <Text style={styles.vehicleNumber}>{v?.number ?? selectedVehicleId}</Text>
                  <Text style={styles.vehicleType}>{v?.bodyType ?? 'Sedan'} · {v?.vehicleType ?? 'Taxi'}</Text>
                </>
              );
            })()}
          </View>
        ) : null}

        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>Current zone</Text>
          <Text style={styles.zoneName}>{zoneName}</Text>
          {zone.position > 0 ? (
            <Text style={sharedStyles.cardText}>
              Queue position: {zone.position}
              {zone.totalInQueue > 0 ? ` of ${zone.totalInQueue}` : ''}
            </Text>
          ) : (
            <Text style={sharedStyles.cardText}>
              {shiftActive ? 'Zone will appear when dispatch assigns you.' : 'Start shift to join the queue.'}
            </Text>
          )}
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
      </ScreenScroll>

      <VehiclePickerModal
        visible={pickerOpen}
        vehicles={vehicles}
        selectedId={pickerVehicle}
        loading={starting}
        onSelect={setPickerVehicle}
        onConfirm={() => runStartShift(pickerVehicle)}
        onClose={() => !starting && setPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  onlineCard: { borderColor: Colors.success },
  readyBanner: {
    backgroundColor: Colors.success + '22',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.success,
  },
  readyTitle: { color: Colors.success, fontSize: 18, fontWeight: '800' },
  readyText: { color: Colors.text, fontSize: 14, marginTop: 4 },
  status: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  cardActions: { marginTop: 12, gap: 8 },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  vehicleNumber: { color: Colors.text, fontSize: 24, fontWeight: '800' },
  vehicleType: { color: Colors.accent, fontSize: 15, fontWeight: '600', marginTop: 2 },
  vehicleId: { color: Colors.textMuted, fontSize: 12 },
  zoneName: { color: Colors.accent, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  quickLinks: { gap: 10, marginTop: 4, marginBottom: 8 },
});
