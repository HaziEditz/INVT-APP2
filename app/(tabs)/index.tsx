import { Button } from '@/components/Button';
import { ActiveJobPanel } from '@/components/home/ActiveJobPanel';
import { DispatchTripOverlay } from '@/components/home/DispatchTripOverlay';
import { FullScreenMapModal } from '@/components/home/FullScreenMapModal';
import { HomeStatusBar } from '@/components/home/HomeStatusBar';
import { MeterOverlay } from '@/components/home/MeterOverlay';
import { QueuedOffersSheet } from '@/components/home/QueuedOffersSheet';
import { TariffPicker } from '@/components/home/TariffPicker';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MapErrorFallback } from '@/components/MapErrorFallback';
import JobMap from '@/components/JobMap';
import { VehiclePickerModal } from '@/components/VehiclePickerModal';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  const [, setTick] = useState(0);

  useSafeEffect(() => {
    if (!hailActive && !activeJob) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hailActive, activeJob], 'MainScreen-tick');

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

  const showHailMeter = hailActive && !!meter;
  const showDispatchMeter = !!activeJob && !hailActive;
  const tripActive = showHailMeter || showDispatchMeter;
  const mapShowsRoute = !!activeJob;

  return (
    <View style={styles.root}>
      <ErrorBoundary name="HomeStatusBar">
        <HomeStatusBar onOffersPress={() => setQueueSheetOpen(true)} />
      </ErrorBoundary>

      {jobEditNotice ? (
        <Pressable style={styles.notice} onPress={dismissJobEditNotice}>
          <Text style={styles.noticeText}>Job updated: {jobEditNotice}</Text>
          <Text style={styles.noticeDismiss}>Tap to dismiss</Text>
        </Pressable>
      ) : null}

      <View style={styles.mapSection}>
        <ErrorBoundary name="MainMap" fallback={<MapErrorFallback />}>
          <JobMap
            pickupLat={activeJob?.pickupLat}
            pickupLng={activeJob?.pickupLng}
            dropoffLat={activeJob?.dropoffLat}
            dropoffLng={activeJob?.dropoffLng}
            showRoute={mapShowsRoute}
            showsUserLocation={shiftActive}
          />
        </ErrorBoundary>

        {showHailMeter && meter ? (
          <View style={styles.overlayTop} pointerEvents="box-none">
            <ErrorBoundary name="MeterOverlay">
              <MeterOverlay
                meter={meter}
                onPause={pauseMeter}
                onWait={toggleWaitMeter}
                onExpand={() => setMapExpanded(true)}
              />
            </ErrorBoundary>
          </View>
        ) : null}

        {showDispatchMeter && activeJob ? (
          <View style={styles.overlayTop} pointerEvents="box-none">
            <ErrorBoundary name="DispatchTripOverlay">
              <DispatchTripOverlay job={activeJob} onExpand={() => setMapExpanded(true)} />
            </ErrorBoundary>
          </View>
        ) : null}

        {tripActive ? (
          <Pressable style={styles.expandFab} onPress={() => setMapExpanded(true)}>
            <Text style={styles.expandFabText}>⛶ Full screen</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.lower}
        contentContainerStyle={styles.lowerContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {activeJob ? (
          <ErrorBoundary name="ActiveJobPanel">
            <ActiveJobPanel />
          </ErrorBoundary>
        ) : null}

        {shiftActive ? (
          <>
            <ErrorBoundary name="TariffPicker">
              <TariffPicker
                tariffs={tariffs}
                selected={selectedTariff}
                open={tariffOpen}
                onOpen={() => setTariffOpen(true)}
                onClose={() => setTariffOpen(false)}
                onSelect={setSelectedTariff}
              />
            </ErrorBoundary>
            <View style={styles.bottomBar}>
              <Button
                title={hailActive ? 'END HAIL TRIP' : 'HAIL PASSENGER'}
                onPress={onHailPress}
              />
              <Button
                title="END SHIFT"
                variant="danger"
                onPress={() => {
                  Alert.alert('End shift?', 'You will go offline.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'End shift', style: 'destructive', onPress: endShift },
                  ]);
                }}
              />
            </View>
            {readyForJobs && presenceStatus === 'Online' && !tripActive && !activeJob ? (
              <Text style={styles.hint}>
                Online · {zone.name || 'Awaiting zone'} · ready for offers
              </Text>
            ) : null}
          </>
        ) : (
          <View style={styles.offlineBar}>
            <Text style={styles.offlineTitle}>Off shift</Text>
            <Text style={styles.offlineSub}>Start shift to go online</Text>
            <Button title="Start Shift" onPress={openStartFlow} disabled={vehiclesLoading} />
            {vehiclesLoading ? (
              <ActivityIndicator color={Colors.accent} style={{ marginTop: 8 }} />
            ) : null}
          </View>
        )}
      </ScrollView>

      <FullScreenMapModal
        visible={mapExpanded}
        onClose={() => setMapExpanded(false)}
        activeJob={activeJob}
        meter={meter}
        showMeter={showHailMeter}
        onPause={pauseMeter}
        onWait={toggleWaitMeter}
      />

      <QueuedOffersSheet visible={queueSheetOpen} onClose={() => setQueueSheetOpen(false)} />

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
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  noticeText: { color: Colors.text, fontWeight: '600' },
  noticeDismiss: { color: Colors.textMuted, fontSize: 11, marginTop: 4 },
  mapSection: { flex: 1, minHeight: 180, position: 'relative' },
  overlayTop: { position: 'absolute', left: 0, right: 0, top: 4 },
  expandFab: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    backgroundColor: Colors.surface + 'DD',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  expandFabText: { color: Colors.accent, fontWeight: '700', fontSize: 12 },
  lower: { flexGrow: 0, maxHeight: '42%' },
  lowerContent: { paddingBottom: 4 },
  offlineBar: {
    padding: 16,
    marginHorizontal: 12,
    marginTop: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  offlineTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  offlineSub: { color: Colors.textMuted, fontSize: 14 },
  bottomBar: { paddingHorizontal: 12, paddingTop: 6, gap: 8 },
  hint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', paddingBottom: 8 },
});
