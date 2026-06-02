import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { formatHours, loadNztaHours, markBreakTaken, needsBreak, exceedsMaxHours } from '@/services/nztaService';
import { useDriver } from '@/context/DriverContext';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { NztaHoursState } from '@/types';

export default function ProfileScreen() {
  const { driver, signOut } = useAuth();
  const { completedJobs } = useDriver();
  const [nzta, setNzta] = useState<NztaHoursState | null>(null);
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    loadNztaHours().then(setNzta);
    const id = setInterval(() => loadNztaHours().then(setNzta), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (nzta && needsBreak(nzta)) {
      Alert.alert('Break reminder', 'NZTA recommends a break after 5 hours of driving.');
      markBreakTaken().then(setNzta);
    }
    if (nzta && exceedsMaxHours(nzta)) {
      Alert.alert('Hours limit', 'You have reached the 13-hour daily driving limit.');
    }
  }, [nzta]);

  const earnings = completedJobs.reduce((s, j) => s + j.fare, 0);

  const onSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <ScreenHeader title="Profile" subtitle="Driver info and settings" />

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>{driver?.name}</Text>
        <Text style={sharedStyles.cardText}>ID: {driver?.id}</Text>
        <Text style={sharedStyles.cardText}>{driver?.email}</Text>
        <Text style={sharedStyles.cardText}>{driver?.phone}</Text>
        <Text style={sharedStyles.cardText}>Type: {driver?.driverType}</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Earnings (session)</Text>
        <Text style={styles.earnings}>${earnings.toFixed(2)}</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>NZTA Hours Tracker</Text>
        <Text style={styles.hours}>{formatHours(nzta?.workedMinutes ?? 0)}</Text>
        <Text style={sharedStyles.cardText}>Break reminders enabled after 5 hours</Text>
        <Text style={sharedStyles.cardText}>Daily limit: 13 hours</Text>
      </View>

      <View style={[sharedStyles.card, sharedStyles.row]}>
        <Text style={sharedStyles.cardTitle}>Push notifications</Text>
        <Switch value={notifications} onValueChange={setNotifications} trackColor={{ true: Colors.accent }} />
      </View>

      <Button title="Sign Out" variant="danger" onPress={onSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  earnings: { color: Colors.success, fontSize: 28, fontWeight: '800', marginTop: 4 },
  hours: { color: Colors.accent, fontSize: 28, fontWeight: '800', marginTop: 4 },
});
