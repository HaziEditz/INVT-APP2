import { CurrentTripPanel } from '@/components/home/CurrentTripPanel';
import { HomeBottomBar } from '@/components/home/HomeBottomBar';
import { HomeMainTabs } from '@/components/home/HomeMainTabs';
import { HomeStatusBar } from '@/components/home/HomeStatusBar';
import { OffersPanel } from '@/components/home/OffersPanel';
import { QueuePanel } from '@/components/home/QueuePanel';
import { NztaHoursBar } from '@/components/home/NztaHoursBar';
import { TariffPicker } from '@/components/home/TariffPicker';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MapErrorFallback } from '@/components/MapErrorFallback';
import JobMap from '@/components/JobMap';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { MainPanelTab } from '@/types';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function MainScreen() {
  const { firebaseUser, driver, profileLoading, refreshDriver } = useAuth();
  const {
    shiftActive,
    activeJob,
    hailActive,
    meter,
    startHail,
    endHail,
    tariffs,
    selectedTariff,
    setSelectedTariff,
    tariffLocked,
    pendingOffers,
    queuedOffers,
    offersBadgeCount,
  } = useDriver();

  const [mainTab, setMainTab] = useState<MainPanelTab>('offers');
  const [tariffOpen, setTariffOpen] = useState(false);

  const hasCurrent = !!activeJob || hailActive;

  useSafeEffect(() => {
    if (!firebaseUser) return;
    refreshDriver().catch((err) => console.error('[Main] refreshDriver failed:', err));
  }, [firebaseUser?.uid], 'MainScreen-loadProfile');

  useSafeEffect(() => {
    if (hasCurrent) setMainTab('current');
    else if (queuedOffers.length > 0) setMainTab('queue');
  }, [hasCurrent, queuedOffers.length], 'MainScreen-autoTab');

  const onHailPress = () => {
    if (!shiftActive) {
      Alert.alert('Off shift', 'Start your shift from Profile or sign in again.');
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
    setMainTab('current');
  };

  const mapShowsRoute = !!activeJob || hailActive;

  if (profileLoading || (firebaseUser && !driver)) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color={Colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading your profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ErrorBoundary name="HomeTopBar">
        <HomeStatusBar />
      </ErrorBoundary>

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
        {meter?.running ? (
          <View style={styles.meterBadge}>
            <Text style={styles.meterFare}>${meter.fare.toFixed(2)}</Text>
            <Text
              style={[
                styles.modeTag,
                meter.mode === 'moving' ? styles.modeMoving : styles.modeWaiting,
              ]}
            >
              {meter.paused ? 'PAUSED' : meter.mode === 'moving' ? 'MOVING' : 'WAITING'}
            </Text>
            <Text style={styles.meterSub}>
              {meter.distanceKm.toFixed(1)} km · wait {(meter.waitingMs / 60000).toFixed(0)}m
            </Text>
          </View>
        ) : null}
      </View>

      <NztaHoursBar />

      <TariffPicker
        tariffs={tariffs}
        selected={selectedTariff}
        open={tariffOpen}
        locked={tariffLocked}
        onOpen={() => !tariffLocked && setTariffOpen(true)}
        onClose={() => setTariffOpen(false)}
        onSelect={setSelectedTariff}
      />

      <HomeMainTabs
        active={mainTab}
        offersCount={offersBadgeCount || pendingOffers.length}
        hasCurrent={hasCurrent}
        queueCount={queuedOffers.length}
        onChange={setMainTab}
      />

      <ErrorBoundary name="MainPanel">
        {mainTab === 'offers' ? <OffersPanel /> : null}
        {mainTab === 'current' ? <CurrentTripPanel /> : null}
        {mainTab === 'queue' ? <QueuePanel /> : null}
      </ErrorBoundary>

      <HomeBottomBar />

      <Pressable
        style={[styles.hailBtn, hailActive && styles.hailBtnActive]}
        onPress={onHailPress}
      >
        <Text style={styles.hailBtnText}>{hailActive ? 'END HAIL TRIP' : 'HAIL PASSENGER'}</Text>
      </Pressable>

      {!shiftActive ? (
        <Text style={styles.offHint}>You are off shift. Start a shift from Profile or vehicle selection.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { color: Colors.textMuted, fontSize: 16 },
  root: { flex: 1, backgroundColor: Colors.background },
  mapSection: { flex: 1, minHeight: 200, position: 'relative' },
  meterBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: Colors.surface + 'EE',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  meterFare: { color: Colors.success, fontSize: 22, fontWeight: '800' },
  modeTag: { fontSize: 11, fontWeight: '800', marginTop: 2 },
  modeMoving: { color: Colors.success },
  modeWaiting: { color: Colors.warning },
  meterSub: { color: Colors.textMuted, fontSize: 13 },
  hailBtn: {
    marginHorizontal: 14,
    marginVertical: 8,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  hailBtnActive: { backgroundColor: Colors.danger },
  hailBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  offHint: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 },
});
