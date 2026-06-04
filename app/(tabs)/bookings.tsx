import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ScreenHeader } from '@/components/ScreenHeader';
import { createPreBooking } from '@/lib/dispatchApi';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { sharedStyles } from '@/constants/styles';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

const PAYMENT_OPTIONS = ['Cash', 'Card', 'EFTPOS', 'Account', 'TM', 'ACC'];
const VEHICLE_TYPES = ['Taxi', 'Freight', 'Food', 'Tow'];

export default function BookingsTab() {
  const { driver } = useAuth();
  const { selectedVehicleId } = useDriver();
  const [form, setForm] = useState({
    passengerName: '',
    passengerPhone: '',
    passengerEmail: '',
    pickup: '',
    dropoff: '',
    scheduledAt: '',
    paymentType: 'Cash',
    vehicleType: 'Taxi',
    notes: '',
  });
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async () => {
    if (!form.passengerName || !form.passengerPhone || !form.pickup || !form.dropoff || !form.scheduledAt) {
      Alert.alert('Missing fields', 'Fill passenger details, addresses, and date/time.');
      return;
    }
    setLoading(true);
    try {
      await createPreBooking({
        ...form,
        driverId: driver?.id,
        companyId: driver?.companyId,
        vehicleId: selectedVehicleId,
        createdBy: 'driver',
        sendConfirmationEmail: true,
      });
      Alert.alert(
        'Booking sent',
        'Pre-booking sent to dispatch. Confirmation emails will go to the company and passenger when configured.',
      );
      setForm({
        passengerName: '',
        passengerPhone: '',
        passengerEmail: '',
        pickup: '',
        dropoff: '',
        scheduledAt: '',
        paymentType: 'Cash',
        vehicleType: 'Taxi',
        notes: '',
      });
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Could not create booking');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <ScreenHeader title="Bookings" subtitle="Create a pre-booking for a passenger" />
      <Text style={styles.hint}>Works while on trip — booking goes to company dispatch.</Text>

      <Input label="Passenger name" value={form.passengerName} onChangeText={(v) => update('passengerName', v)} />
      <Input label="Phone" keyboardType="phone-pad" value={form.passengerPhone} onChangeText={(v) => update('passengerPhone', v)} />
      <Input
        label="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        value={form.passengerEmail}
        onChangeText={(v) => update('passengerEmail', v)}
      />
      <Input label="Pickup" value={form.pickup} onChangeText={(v) => update('pickup', v)} />
      <Input label="Dropoff" value={form.dropoff} onChangeText={(v) => update('dropoff', v)} />
      <Input
        label="Date / time"
        placeholder="e.g. 2026-06-05 14:30"
        value={form.scheduledAt}
        onChangeText={(v) => update('scheduledAt', v)}
      />

      <Text style={styles.label}>Payment type</Text>
      <View style={styles.chips}>
        {PAYMENT_OPTIONS.map((p) => (
          <Button
            key={p}
            title={p}
            variant={form.paymentType === p ? 'primary' : 'secondary'}
            onPress={() => update('paymentType', p)}
            style={styles.chipBtn}
          />
        ))}
      </View>

      <Text style={styles.label}>Vehicle type</Text>
      <View style={styles.chips}>
        {VEHICLE_TYPES.map((v) => (
          <Button
            key={v}
            title={v}
            variant={form.vehicleType === v ? 'primary' : 'secondary'}
            onPress={() => update('vehicleType', v)}
            style={styles.chipBtn}
          />
        ))}
      </View>

      <Input label="Notes" value={form.notes} onChangeText={(v) => update('notes', v)} multiline />
      <Button title={loading ? 'Sending…' : 'Send to dispatch'} onPress={onSubmit} disabled={loading} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hint: { color: '#9CA3AF', fontSize: 15, marginBottom: 12 },
  label: { color: '#F5F5F7', fontWeight: '700', fontSize: 15, marginTop: 8, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chipBtn: { minWidth: 72 },
});
