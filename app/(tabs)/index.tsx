import { CurrentTripPanel } from '@/components/home/CurrentTripPanel';
import { FullScreenMapModal } from '@/components/home/FullScreenMapModal';
import { HomeMainTabs } from '@/components/home/HomeMainTabs';
import { HomeStatusBar } from '@/components/home/HomeStatusBar';
import { MeterOverlay } from '@/components/home/MeterOverlay';
import { OffersPanel } from '@/components/home/OffersPanel';
import { QueuePanel } from '@/components/home/QueuePanel';
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
    tariffs,
    selectedTariff,
    setSelectedTariff,
    tariffLocked,
    pendingOffers,
    queuedOffers,
    offersBadgeCount,
    pauseMeter,
  } = useDriver();

  const [mainTab, setMainTab] = useState<MainPanelTab>('offers');
  const [tariffOpen, setTariffOpen] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  const hasCurrent = !!activeJob || hailActive;
  const meterRunning = !!meter?.running;
  const showHailButton = shiftActive && !hailActive && !meterRunning && !activeJob;

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
    if (activeJob) {
      Alert.alert('On dispatch job', 'Complete or cancel the active job before hailing.');
      return;
    }
    void startHail();
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

      <View style={styles.mapFlex}>
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

        <Pressable
          style={styles.expandBtn}
          onPress={() => setMapExpanded(true)}
          accessibilityLabel="Expand map"
        >
          <Text style={styles.expandIcon}>⛶</Text>
        </Pressable>

        {meterRunning && meter ? (
          <View style={styles.meterOverlayWrap} pointerEvents="box-none">
            <MeterOverlay meter={meter} onPause={pauseMeter} />
          </View>
        ) : null}
      </View>

      <View style={styles.bottomChrome}>
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

        {showHailButton ? (
          <Pressable style={styles.hailBtn} onPress={onHailPress}>
            <Text style={styles.hailBtnText}>HAIL PASSENGER</Text>
          </Pressable>
        ) : null}

        {!shiftActive ? (
          <Text style={styles.offHint}>
            You are off shift. Start a shift from Profile or vehicle selection.
          </Text>
        ) : null}
      </View>

      <FullScreenMapModal
        visible={mapExpanded}
        onClose={() => setMapExpanded(false)}
        activeJob={activeJob}
        meter={meter}
        showMeter={meterRunning && mapExpanded}
        showRoute={mapShowsRoute}
        showsUserLocation={shiftActive}
        onPause={pauseMeter}
      />
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
  mapFlex: { flex: 1, position: 'relative', minHeight: 120 },
  expandBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface + 'EE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    zIndex: 10,
  },
  expandIcon: { color: Colors.accent, fontSize: 22, fontWeight: '700' },
  meterOverlayWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    maxHeight: '20%',
    justifyContent: 'flex-end',
  },
  bottomChrome: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  hailBtn: {
    marginHorizontal: 14,
    marginVertical: 8,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  hailBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  offHint: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
