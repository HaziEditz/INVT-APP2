import { VehiclePickerModal } from '@/components/VehiclePickerModal';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { storeData, STORAGE_KEYS } from '@/lib/storage';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Gate after login: driver must confirm vehicle before main screen. */
export default function SelectVehicleScreen() {
  const { driver, profileLoading, refreshDriver, firebaseUser } = useAuth();
  const { vehicles, vehiclesLoading, selectedVehicleId, refreshVehicles, startShift, setSelectedVehicleId } =
    useDriver();
  const [pickerVehicle, setPickerVehicle] = useState(selectedVehicleId);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (firebaseUser) {
      refreshDriver().catch(() => undefined);
      refreshVehicles().catch(() => undefined);
    }
  }, [firebaseUser?.uid]);

  useEffect(() => {
    if (selectedVehicleId) setPickerVehicle(selectedVehicleId);
    else if (vehicles[0]?.id) setPickerVehicle(vehicles[0].id);
  }, [selectedVehicleId, vehicles]);

  const onConfirm = async () => {
    if (!pickerVehicle) return;
    setStarting(true);
    try {
      console.log('[SelectVehicle] setSelectedVehicleId', pickerVehicle);
      await setSelectedVehicleId(pickerVehicle);
      await storeData(STORAGE_KEYS.vehicleSessionReady, true);
      console.log('[SelectVehicle] startShift');
      await startShift(pickerVehicle);
      console.log('[SelectVehicle] shift started — AuthNavigator will open tabs');
    } catch (err) {
      console.error('[SelectVehicle] onConfirm failed:', err);
    } finally {
      setStarting(false);
    }
  };

  if (profileLoading || !driver) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} size="large" />
        <Text style={styles.muted}>Loading profile…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Choose your vehicle</Text>
      <Text style={styles.sub}>Confirm your vehicle before going on shift.</Text>
      <VehiclePickerModal
        visible
        vehicles={vehicles}
        selectedId={pickerVehicle}
        loading={starting || vehiclesLoading}
        onSelect={setPickerVehicle}
        onConfirm={onConfirm}
        onClose={() => undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background, padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: Colors.background },
  title: { color: Colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  sub: { color: Colors.textMuted, fontSize: 16, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  muted: { color: Colors.textMuted, fontSize: 15 },
});
