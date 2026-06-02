import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { registerDriver } from '@/lib/dispatchApi';
import { sharedStyles } from '@/constants/styles';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { ScreenHeader } from '@/components/ScreenHeader';

export default function RegisterScreen() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    driverType: 'Taxi',
  });
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async () => {
    if (!form.name || !form.email || !form.phone || !form.password) {
      Alert.alert('Missing fields', 'Please complete all fields.');
      return;
    }
    setLoading(true);
    try {
      await registerDriver(form);
      Alert.alert('Application submitted', 'Your registration is pending approval.', [
        { text: 'OK', onPress: () => router.replace('/login') },
      ]);
    } catch (e) {
      Alert.alert('Registration failed', e instanceof Error ? e.message : 'Try again later');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <ScreenHeader title="Become a Driver" subtitle="Register to join BookaWaka" />
      <Input label="Full name" value={form.name} onChangeText={(v) => update('name', v)} />
      <Input label="Email" autoCapitalize="none" value={form.email} onChangeText={(v) => update('email', v)} />
      <Input label="Phone" keyboardType="phone-pad" value={form.phone} onChangeText={(v) => update('phone', v)} />
      <Input label="Password" secureTextEntry value={form.password} onChangeText={(v) => update('password', v)} />
      <Input label="Driver type" placeholder="Taxi, Freight, Food, Tow" value={form.driverType} onChangeText={(v) => update('driverType', v)} />
      <Text style={sharedStyles.cardText}>Your application will be reviewed by your taxi company.</Text>
      <Button title={loading ? 'Submitting…' : 'Submit Application'} onPress={onSubmit} disabled={loading} />
    </ScrollView>
  );
}
