import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ScreenHeader } from '@/components/ScreenHeader';
import { createPreBooking } from '@/lib/dispatchApi';
import { useAuth } from '@/context/AuthContext';
import { sharedStyles } from '@/constants/styles';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';

export default function PreBookingScreen() {
  const { driver } = useAuth();
  const [form, setForm] = useState({
    passengerName: '',
    passengerPhone: '',
    pickup: '',
    dropoff: '',
    scheduledAt: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async () => {
    if (!form.passengerName || !form.passengerPhone || !form.pickup || !form.dropoff || !form.scheduledAt) {
      Alert.alert('Missing fields', 'Fill in passenger details, addresses, and scheduled time.');
      return;
    }
    setLoading(true);
    try {
      await createPreBooking({
        ...form,
        driverId: driver?.id,
        companyId: driver?.companyId,
        createdBy: 'driver',
      });
      Alert.alert('Pre-booking created', 'The booking has been sent to dispatch.');
      setForm({ passengerName: '', passengerPhone: '', pickup: '', dropoff: '', scheduledAt: '', notes: '' });
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Could not create pre-booking');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <ScreenHeader
        title="Pre-booking"
        subtitle="Create a future booking for a passenger"
      />
      <Input label="Passenger name" value={form.passengerName} onChangeText={(v) => update('passengerName', v)} />
      <Input label="Passenger phone" keyboardType="phone-pad" value={form.passengerPhone} onChangeText={(v) => update('passengerPhone', v)} />
      <Input label="Pickup address" value={form.pickup} onChangeText={(v) => update('pickup', v)} />
      <Input label="Dropoff address" value={form.dropoff} onChangeText={(v) => update('dropoff', v)} />
      <Input label="Scheduled date/time" placeholder="e.g. 2026-05-25 14:30" value={form.scheduledAt} onChangeText={(v) => update('scheduledAt', v)} />
      <Input label="Notes" value={form.notes} onChangeText={(v) => update('notes', v)} multiline />
      <Button title={loading ? 'Creating…' : 'Create Pre-booking'} onPress={onSubmit} disabled={loading} />
    </ScrollView>
  );
}
