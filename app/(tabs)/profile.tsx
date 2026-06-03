import { Button } from '@/components/Button';
import { EarningsBreakdownCard } from '@/components/EarningsBreakdownCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenScroll } from '@/components/ScreenScroll';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import {
  NZTA_BREAK_AFTER_HOURS,
  NZTA_MAX_SHIFT_HOURS,
  NZTA_MAX_WORK_HOURS,
} from '@/constants/theme';
import {
  confirmBreakTaken,
  deferBreakReminder,
  exceedsMaxShiftHours,
  exceedsMaxWorkHours,
  formatHours,
  loadNztaHours,
  needsBreak,
  shiftElapsedMinutes,
} from '@/services/nztaService';
import { notifyBreakReminder } from '@/services/notificationService';
import { NztaHoursState } from '@/types';
import { Link, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

export default function ProfileScreen() {
  const { driver, signOut } = useAuth();
  const {
    sessionEarnings,
    completedJobs,
    company,
    activeVehicleBodyType,
    selectedVehicleId,
    vehicles,
    shiftActive,
  } = useDriver();
  const [nzta, setNzta] = useState<NztaHoursState | null>(null);
  const [notifications, setNotifications] = useState(true);
  const breakAlertOpen = useRef(false);

  const refreshNzta = useCallback(() => {
    loadNztaHours().then(setNzta);
  }, []);

  useEffect(() => {
    refreshNzta();
    const id = setInterval(refreshNzta, 30000);
    return () => clearInterval(id);
  }, [refreshNzta, shiftActive]);

  const showBreakChoice = useCallback(() => {
    if (breakAlertOpen.current) return;
    breakAlertOpen.current = true;
    Alert.alert(
      'Break reminder (NZTA)',
      `You have been driving for ${NZTA_BREAK_AFTER_HOURS}+ hours. Take a break when it is safe to do so.`,
      [
        {
          text: 'Take break now',
          onPress: async () => {
            await confirmBreakTaken();
            await notifyBreakReminder('Break logged', 'Your break has been recorded. Drive safely.');
            refreshNzta();
            breakAlertOpen.current = false;
          },
        },
        {
          text: 'Remind in 30 min',
          onPress: async () => {
            await deferBreakReminder(30);
            refreshNzta();
            breakAlertOpen.current = false;
          },
        },
        {
          text: 'Continue',
          style: 'cancel',
          onPress: async () => {
            const { markBreakReminderShown } = await import('@/services/nztaService');
            await markBreakReminderShown();
            refreshNzta();
            breakAlertOpen.current = false;
          },
        },
      ],
      { cancelable: true, onDismiss: () => { breakAlertOpen.current = false; } },
    );
  }, [refreshNzta]);

  useEffect(() => {
    if (!nzta || !shiftActive) return;
    if (needsBreak(nzta)) {
      notifyBreakReminder(
        'Break reminder',
        `NZTA recommends a break after ${NZTA_BREAK_AFTER_HOURS} hours of driving.`,
      ).catch(() => undefined);
      showBreakChoice();
    }
    if (exceedsMaxWorkHours(nzta)) {
      Alert.alert(
        'Work hours limit',
        `You have reached the ${NZTA_MAX_WORK_HOURS}-hour driving limit. End your shift or take a break.`,
      );
    }
    if (exceedsMaxShiftHours(nzta)) {
      Alert.alert(
        'Shift length limit',
        `Your shift has reached the ${NZTA_MAX_SHIFT_HOURS}-hour maximum (including break time). Please end your shift.`,
      );
    }
  }, [nzta, shiftActive, showBreakChoice]);

  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const vehicleNumber = activeVehicle?.number ?? selectedVehicleId ?? '—';
  const serviceType = activeVehicle?.vehicleType ?? driver?.driverType ?? '—';

  const onSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <ScreenScroll padBottom>
      <ScreenHeader title="Profile" subtitle="Driver info, earnings & compliance" />

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>{driver?.name ?? 'Driver'}</Text>
        <Text style={sharedStyles.cardText}>Driver ID: {driver?.id ?? '—'}</Text>
        <Text style={sharedStyles.cardText}>{driver?.email}</Text>
        {driver?.phone ? <Text style={sharedStyles.cardText}>{driver.phone}</Text> : null}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Company</Text>
        <Text style={styles.companyName}>{company?.name ?? 'Loading…'}</Text>
        <Text style={sharedStyles.cardText}>Company ID: {company?.id ?? driver?.companyId ?? '—'}</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Vehicle</Text>
        <Text style={styles.vehicleNumber}>{vehicleNumber}</Text>
        <Text style={sharedStyles.cardText}>Type: {activeVehicleBodyType}</Text>
        <Text style={sharedStyles.cardText}>Service: {serviceType}</Text>
        {selectedVehicleId ? (
          <Text style={sharedStyles.cardText}>Vehicle ID: {selectedVehicleId}</Text>
        ) : null}
      </View>

      <EarningsBreakdownCard
        title="Earnings (this session)"
        breakdown={sessionEarnings}
        jobCount={completedJobs.length}
      />

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>NZTA hours</Text>
        <Text style={styles.hours}>{formatHours(nzta?.workedMinutes ?? 0)}</Text>
        <Text style={sharedStyles.cardText}>Driving time (max {NZTA_MAX_WORK_HOURS}h)</Text>
        <Text style={sharedStyles.cardText}>
          Shift elapsed: {formatHours(shiftElapsedMinutes(nzta ?? { shiftStartedAt: null, workedMinutes: 0, breakMinutes: 0, lastBreakAt: null, breakReminderShown: false, breakDeferredUntil: null }))} (max {NZTA_MAX_SHIFT_HOURS}h incl. break)
        </Text>
        <Text style={sharedStyles.cardText}>
          Break time logged: {formatHours(nzta?.breakMinutes ?? 0)}
        </Text>
        <Text style={sharedStyles.cardText}>
          Break reminder after {NZTA_BREAK_AFTER_HOURS}h — you choose when to break
        </Text>
        {shiftActive ? (
          <Button
            title="Log 15 min break"
            variant="secondary"
            style={{ marginTop: 12 }}
            onPress={async () => {
              await confirmBreakTaken();
              refreshNzta();
              Alert.alert('Break logged', '15 minutes added to your break time.');
            }}
          />
        ) : null}
      </View>

      <View style={[sharedStyles.card, sharedStyles.row]}>
        <Text style={sharedStyles.cardTitle}>Push notifications</Text>
        <Switch value={notifications} onValueChange={setNotifications} trackColor={{ true: Colors.accent }} />
      </View>

      <Link href="/(tabs)/chat" asChild>
        <Button title="Chat with dispatcher" variant="secondary" />
      </Link>

      <Button title="Sign Out" variant="danger" onPress={onSignOut} style={{ marginTop: 12 }} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  companyName: { color: Colors.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
  vehicleNumber: { color: Colors.accent, fontSize: 28, fontWeight: '800', marginTop: 4 },
  hours: { color: Colors.accent, fontSize: 28, fontWeight: '800', marginTop: 4 },
});
