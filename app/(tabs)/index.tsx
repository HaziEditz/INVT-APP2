import { Button } from '@/components/Button';
import { ActiveJobPanel } from '@/components/home/ActiveJobPanel';
import { FullScreenMapModal } from '@/components/home/FullScreenMapModal';
import { HomeStatusBar } from '@/components/home/HomeStatusBar';
import { MeterOverlay } from '@/components/home/MeterOverlay';
import { TariffPicker } from '@/components/home/TariffPicker';
import JobMap from '@/components/JobMap';
import { VehiclePickerModal } from '@/components/VehiclePickerModal';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

export default function MainScreen() {
  const {
    shiftActive,
    readyForJobs,
    presenceStatus,
    vehicles,
    vehiclesLoading,
    selectedVehicleId,
    zone,
    activeJob,
    hailActive,
    meter,
    tariffs,
    selectedTariff,
    jobEditNotice,
    startShift,
    endShift,
    startHail,
    endHail,
    pauseMeter,
    toggleWaitMeter,
    setSelectedTariff,
    dismissJobEditNotice,
  } = useDriver();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pickerVehicle, setPickerVehicle] = useState(selectedVehicleId);
  const [tariffOpen, setTariffOpen] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!hailActive && !activeJob) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hailActive, activeJob]);

  const openStartFlow = () => {
    if (vehiclesLoading) return;
    if (vehicles.length === 0) {
      Alert.alert('No vehicles', 'Ask your fleet admin to allocate vehicles to your profile.');
      return;
    }
    if (vehicles.length === 1) {
      void runStartShift(vehicles[0].id);
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

  const onHailPress = () => {
    if (!shiftActive) {
      openStartFlow();
      return;
    }
    if (hailActive) {
      Alert.alert('End hail trip?', 'Finish street hail and return to queue.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End trip', onPress: endHail },
      ]);
      return;
    }
    if (activeJob) {
      Alert.alert('On dispatch job', 'Complete or cancel the active job before hailing.');
      return;
    }
    startHail();
  };

  const showMeter = hailActive && !!meter;
  const tripActive = !!activeJob || showMeter;

  return (
    <View style={styles.root}>
      <HomeStatusBar />

      {jobEditNotice ? (
        <Pressable style={styles.notice} onPress={dismissJobEditNotice}>
          <Text style={styles.noticeText}>Job updated: {jobEditNotice}</Text>
          <Text style={styles.noticeDismiss}>Tap to dismiss</Text>
        </Pressable>
      ) : null}

      <View style={styles.mapSection}>
        <JobMap
          pickupLat={activeJob?.pickupLat}
          pickupLng={activeJob?.pickupLng}
          dropoffLat={activeJob?.dropoffLat}
          dropoffLng={activeJob?.dropoffLng}
          showRoute={!!activeJob}
          showsUserLocation={shiftActive}
        />

        {showMeter && meter ? (
          <View style={styles.meterWrap} pointerEvents="box-none">
            <MeterOverlay
              meter={meter}
              onPause={pauseMeter}
              onWait={toggleWaitMeter}
              onExpand={() => setMapExpanded(true)}
            />
          </View>
        ) : null}

        {!shiftActive ? (
          <View style={styles.offlineOverlay}>
            <Text style={styles.offlineTitle}>Off shift</Text>
            <Text style={styles.offlineSub}>Start shift to go online and receive jobs</Text>
            <Button title="Start Shift" onPress={openStartFlow} disabled={vehiclesLoading} />
            {vehiclesLoading ? <ActivityIndicator color={Colors.accent} style={{ marginTop: 12 }} /> : null}
          </View>
        ) : null}
      </View>

      {activeJob ? <ActiveJobPanel /> : null}

      {shiftActive ? (
        <>
          <TariffPicker
            tariffs={tariffs}
            selected={selectedTariff}
            open={tariffOpen}
            onOpen={() => setTariffOpen(true)}
            onClose={() => setTariffOpen(false)}
            onSelect={setSelectedTariff}
          />

          <View style={styles.bottomBar}>
            <Button
              title={hailActive ? 'END HAIL TRIP' : 'HAIL PASSENGER'}
              onPress={onHailPress}
              style={styles.hailBtn}
            />
            <Button title="END SHIFT" variant="danger" onPress={() => {
              Alert.alert('End shift?', 'You will go offline.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'End shift', style: 'destructive', onPress: endShift },
              ]);
            }} />
          </View>

          {readyForJobs && presenceStatus === 'Online' && !tripActive ? (
            <Text style={styles.hint}>Online · {zone.name || 'Awaiting zone'} · ready for offers</Text>
          ) : null}
        </>
      ) : null}

      <FullScreenMapModal
        visible={mapExpanded}
        onClose={() => setMapExpanded(false)}
        activeJob={activeJob}
        meter={meter}
        showMeter={showMeter}
        onPause={pauseMeter}
        onWait={toggleWaitMeter}
      />

      <VehiclePickerModal
        visible={pickerOpen}
        vehicles={vehicles}
        selectedId={pickerVehicle}
        loading={starting}
        onSelect={setPickerVehicle}
        onConfirm={() => runStartShift(pickerVehicle)}
        onClose={() => !starting && setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  notice: {
    backgroundColor: Colors.warning + '33',
    padding: 10,
    marginHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  noticeText: { color: Colors.text, fontWeight: '600' },
  noticeDismiss: { color: Colors.textMuted, fontSize: 11, marginTop: 4 },
  mapSection: { flex: 1, minHeight: 200, position: 'relative' },
  meterWrap: { position: 'absolute', left: 0, right: 0, top: 8 },
  offlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.background + 'CC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  offlineTitle: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  offlineSub: { color: Colors.textMuted, textAlign: 'center', marginBottom: 8 },
  bottomBar: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  hailBtn: { marginBottom: 0 },
  hint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', paddingBottom: 6 },
});
