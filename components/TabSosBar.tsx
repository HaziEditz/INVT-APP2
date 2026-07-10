import { SosButton } from '@/components/SosButton';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { StyleSheet, View } from 'react-native';

/** Compact SOS access row for secondary tabs (Chat, Add Booking). */
export function TabSosBar() {
  const { driver } = useAuth();
  const { shiftActive, selectedVehicleId, vehicles } = useDriver();

  if (!shiftActive) return null;

  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const vehicleNumber = activeVehicle?.number || selectedVehicleId || driver?.vehicleId || '';

  return (
    <View style={styles.bar}>
      <View style={styles.spacer} />
      <SosButton variant="corner" vehicleNumber={vehicleNumber} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  spacer: { flex: 1 },
});
