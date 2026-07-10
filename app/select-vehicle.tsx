import { VehiclePickerModal } from '@/components/VehiclePickerModal';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { storeData, STORAGE_KEYS } from '@/lib/storage';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Gate after login: driver must confirm vehicle before main screen. */
export default function SelectVehicleScreen() {
  const { driver, profileLoading, refreshDriver, firebaseUser, signOut } = useAuth();
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
    const available =
      vehicles.find((v) => v.id === selectedVehicleId && !v.inUseByOther) ??
      vehicles.find((v) => !v.inUseByOther);
    if (available) {
      setPickerVehicle(available.id);
    } else if (selectedVehicleId && !vehicles.find((v) => v.id === selectedVehicleId)?.inUseByOther) {
      setPickerVehicle(selectedVehicleId);
    } else {
      setPickerVehicle('');
    }
  }, [selectedVehicleId, vehicles]);

  const onCancel = useCallback(async () => {
    if (starting) return;
    try {
      await signOut();
    } catch (err) {
      console.error('[SelectVehicle] cancel sign-out failed:', err);
    }
  }, [signOut, starting]);

  const onConfirm = async () => {
    if (!pickerVehicle) return;
    const picked = vehicles.find((v) => v.id === pickerVehicle);
    if (picked?.inUseByOther) return;
    setStarting(true);
    try {
      console.log('[SelectVehicle] setSelectedVehicleId', pickerVehicle);
      await setSelectedVehicleId(pickerVehicle);
      console.log('[SelectVehicle] startShift');
      const started = await startShift(pickerVehicle);
      if (!started) return;
      await storeData(STORAGE_KEYS.vehicleSessionReady, true);
      console.log('[SelectVehicle] shift started — AuthNavigator will open tabs');
    } catch (err) {
      console.error('[SelectVehicle] onConfirm failed:', err);
    } finally {
      setStarting(false);
    }
  };

  if (profileLoading && !driver) {
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
        onClose={onCancel}
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
