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
import { loadVehicleBodyType } from '@/lib/vehicles';
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
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';

const EMPTY_NZTA: NztaHoursState = {
  shiftStartedAt: null,
  workedMinutes: 0,
  breakMinutes: 0,
  lastBreakAt: null,
  breakReminderShown: false,
  breakDeferredUntil: null,
};

export default function ProfileScreen() {
  const { driver, signOut } = useAuth();
  const {
    sessionEarnings,
    historyEarnings,
    completedJobs,
    company,
    activeVehicleBodyType,
    selectedVehicleId,
    vehicles,
    shiftActive,
    endShift,
    refreshJobHistory,
    refreshVehicles,
  } = useDriver();
  const [nzta, setNzta] = useState<NztaHoursState | null>(null);
  const [notifications, setNotifications] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileBodyType, setProfileBodyType] = useState<string>('');
  const breakAlertOpen = useRef(false);

  const refreshNzta = useCallback(() => {
    loadNztaHours().then(setNzta);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshJobHistory(), refreshVehicles()]);
    refreshNzta();
    setRefreshing(false);
  }, [refreshJobHistory, refreshVehicles, refreshNzta]);

  useFocusEffect(
    useCallback(() => {
      refreshNzta();
      refreshJobHistory().catch(() => undefined);
    }, [refreshNzta, refreshJobHistory]),
  );

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
      `You have been driving for ${NZTA_BREAK_AFTER_HOURS}+ hours. Choose when to take your break.`,
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
          text: 'Continue driving',
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
    if (!nzta || !shiftActive || !notifications) return;
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
        `Maximum ${NZTA_MAX_WORK_HOURS} hours of driving reached. Take a break or end your shift.`,
      );
    }
    if (exceedsMaxShiftHours(nzta)) {
      Alert.alert(
        'Shift length limit',
        `Maximum ${NZTA_MAX_SHIFT_HOURS}-hour shift reached (${NZTA_MAX_WORK_HOURS}h work + 1h break). Please end your shift.`,
      );
    }
  }, [nzta, shiftActive, notifications, showBreakChoice]);

  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const vehicleIdForMeta = selectedVehicleId || driver?.vehicleId || '';
  const vehicleNumber = activeVehicle?.number || vehicleIdForMeta || '—';
  const bodyType =
    activeVehicle?.bodyType ||
    profileBodyType ||
    (activeVehicleBodyType !== '—' ? activeVehicleBodyType : '') ||
    '—';

  useEffect(() => {
    if (!driver?.companyId || !vehicleIdForMeta) {
      setProfileBodyType('');
      return;
    }
    if (activeVehicle?.bodyType) {
      setProfileBodyType(activeVehicle.bodyType);
      return;
    }
    loadVehicleBodyType(driver.companyId, vehicleIdForMeta).then(setProfileBodyType);
  }, [driver?.companyId, vehicleIdForMeta, activeVehicle?.bodyType]);

  const onSignOut = async () => {
    if (shiftActive) {
      await endShift();
    }
    await signOut();
    console.log('[Profile] signed out — AuthNavigator routes to login');
  };

  return (
    <ScreenScroll
      padBottom
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
    >
      <ScreenHeader title="Profile" subtitle="Driver info, earnings & compliance" />

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>{driver?.name ?? 'Driver'}</Text>
        <Text style={sharedStyles.cardText}>Driver ID: {driver?.id ?? '—'}</Text>
        <Text style={sharedStyles.cardText}>{driver?.email}</Text>
        {driver?.phone ? <Text style={sharedStyles.cardText}>{driver.phone}</Text> : null}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Company</Text>
        <Text style={styles.companyName}>{company?.name ?? '—'}</Text>
        <Text style={sharedStyles.cardText}>Company ID: {company?.id ?? driver?.companyId ?? '—'}</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>Vehicle</Text>
        <Text style={styles.vehicleNumber}>{vehicleNumber}</Text>
        <Text style={styles.bodyTypeLabel}>Vehicle type: {bodyType}</Text>
        <Text style={sharedStyles.cardText}>
          {vehicleIdForMeta ? `Fleet ID: ${vehicleIdForMeta.toUpperCase()}` : 'No vehicle selected'}
        </Text>
      </View>

      <EarningsBreakdownCard
        title="Earnings (last 7 days)"
        breakdown={historyEarnings}
        jobCount={undefined}
      />

      {completedJobs.length > 0 ? (
        <EarningsBreakdownCard
          title="Earnings (this session)"
          breakdown={sessionEarnings}
          jobCount={completedJobs.length}
        />
      ) : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.cardTitle}>NZTA hours</Text>
        <Text style={styles.hours}>{formatHours(nzta?.workedMinutes ?? 0)}</Text>
        <Text style={sharedStyles.cardText}>
          Driving: max {NZTA_MAX_WORK_HOURS}h · Shift total: max {NZTA_MAX_SHIFT_HOURS}h ({NZTA_MAX_WORK_HOURS}h work + 1h break)
        </Text>
        <Text style={sharedStyles.cardText}>
          Shift elapsed: {formatHours(shiftElapsedMinutes(nzta ?? EMPTY_NZTA))}
        </Text>
        <Text style={sharedStyles.cardText}>
          Break logged: {formatHours(nzta?.breakMinutes ?? 0)}
        </Text>
        <Text style={sharedStyles.cardText}>
          Push reminder after {NZTA_BREAK_AFTER_HOURS}h — you choose when to break
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

      {shiftActive ? (
        <Button
          title="End Shift"
          variant="danger"
          style={{ marginTop: 16 }}
          onPress={() => {
            Alert.alert('End shift?', 'You will go offline until you sign in and choose a vehicle again.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'End shift', style: 'destructive', onPress: () => void endShift() },
            ]);
          }}
        />
      ) : null}

      <Button title="Sign Out" variant="danger" onPress={onSignOut} style={{ marginTop: 12 }} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  companyName: { color: Colors.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
  vehicleNumber: { color: Colors.accent, fontSize: 28, fontWeight: '800', marginTop: 4 },
  bodyTypeLabel: { color: Colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  hours: { color: Colors.accent, fontSize: 28, fontWeight: '800', marginTop: 4 },
});
