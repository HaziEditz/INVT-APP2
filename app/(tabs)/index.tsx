import { CurrentTripPanel } from '@/components/home/CurrentTripPanel';
import { ConnectionStatusBanner } from '@/components/home/ConnectionStatusBanner';
import { FullScreenMapModal } from '@/components/home/FullScreenMapModal';
import { HomeMainTabs } from '@/components/home/HomeMainTabs';
import { HomeStatusBar } from '@/components/home/HomeStatusBar';
import { IdleCurrentSection } from '@/components/home/IdleCurrentSection';
import { OffersPanel } from '@/components/home/OffersPanel';
import { QueuePanel } from '@/components/home/QueuePanel';
import { TariffPicker } from '@/components/home/TariffPicker';
import { TripToolsBar } from '@/components/home/TripToolsBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MapErrorFallback } from '@/components/MapErrorFallback';
import JobMap from '@/components/JobMap';
import { SosButton } from '@/components/SosButton';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { MainPanelTab } from '@/types';
import { useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

export default function MainScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const tripLayout = useMemo(() => {
    // Keep job details readable after Accept across phone sizes: map capped,
    // work panel gets a solid minimum (details + stage actions).
    const mapMax = Math.round(Math.min(Math.max(windowHeight * 0.3, 180), 280));
    const mapMin = Math.round(Math.min(Math.max(windowHeight * 0.2, 140), 200));
    const workMin = Math.round(Math.max(windowHeight * 0.52, 340));
    return { mapMax, mapMin, workMin };
  }, [windowHeight]);
  const { firebaseUser, driver, profileLoading, refreshDriver } = useAuth();
  const {
    shiftActive,
    activeJob,
    hailActive,
    meter,
    tariffs,
    selectedTariff,
    setSelectedTariff,
    tariffLocked,
    queuedOffers,
    offersBadgeCount,
    offersLockedForEnrouteDispatch,
    preferredPanelTab,
    clearPreferredPanelTab,
    pauseMeter,
    companyZones,
    paymentJob,
    selectedVehicleId,
    vehicles,
  } = useDriver();

  const [mainTab, setMainTab] = useState<MainPanelTab>('current');
  const [tariffOpen, setTariffOpen] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const prevHasCurrentRef = useRef(false);
  const prevShiftActiveRef = useRef(false);
  const prevQueueLenRef = useRef(0);

  const hasCurrent = !!activeJob || hailActive;
  const meterRunning = !!meter?.running;
  const mapShowsRoute = !!activeJob || hailActive;
  const workloadCount = (hasCurrent ? 1 : 0) + queuedOffers.length;

  useSafeEffect(() => {
    if (
      offersLockedForEnrouteDispatch &&
      (mainTab === 'offers' || mainTab === 'queue')
    ) {
      setMainTab('current');
    }
  }, [offersLockedForEnrouteDispatch, mainTab], 'MainScreen-lockOffersQueueTabs');

  useSafeEffect(() => {
    refreshDriver().catch((err) => console.error('[Main] refreshDriver failed:', err));
  }, [firebaseUser?.uid], 'MainScreen-loadProfile');

  useSafeEffect(() => {
    if (preferredPanelTab) {
      setMainTab(preferredPanelTab);
      clearPreferredPanelTab();
    }
  }, [preferredPanelTab, clearPreferredPanelTab], 'MainScreen-preferredTab');

  useSafeEffect(() => {
    if (shiftActive && !prevShiftActiveRef.current) {
      setMainTab('current');
    }
    prevShiftActiveRef.current = shiftActive;
  }, [shiftActive], 'MainScreen-shiftStartTab');

  useSafeEffect(() => {
    if (hasCurrent && !prevHasCurrentRef.current) {
      setMainTab('current');
    } else if (!hasCurrent && prevHasCurrentRef.current) {
      setMainTab('current');
    } else if (
      !hasCurrent &&
      queuedOffers.length > 0 &&
      prevQueueLenRef.current === 0
    ) {
      setMainTab('queue');
    }
    prevHasCurrentRef.current = hasCurrent;
    prevQueueLenRef.current = queuedOffers.length;
  }, [hasCurrent, queuedOffers.length], 'MainScreen-autoTab');

  if (profileLoading && !driver) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color={Colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading your profile…</Text>
      </View>
    );
  }

  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const vehicleNumber = activeVehicle?.number || selectedVehicleId || driver?.vehicleId || '';

  const mapZones = companyZones.map((z) => ({
    name: z.name,
    active: z.active,
    boundary: z.boundary,
  }));

  return (
    <View style={styles.root}>
      <ErrorBoundary name="HomeTopBar">
        <HomeStatusBar
          sosSlot={
            shiftActive ? (
              <SosButton
                variant="corner"
                vehicleNumber={vehicleNumber}
              />
            ) : null
          }
        />
      </ErrorBoundary>
      <ConnectionStatusBanner />

      <View style={[styles.body, hasCurrent && styles.bodyTrip]}>
        <View
          style={[
            styles.mapSection,
            hasCurrent && styles.mapSectionTrip,
            hasCurrent && {
              minHeight: tripLayout.mapMin,
              maxHeight: tripLayout.mapMax,
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: tripLayout.mapMax,
            },
          ]}
        >
          <ErrorBoundary name="MainMap" fallback={<MapErrorFallback />}>
            <JobMap
              compact={hasCurrent}
              pickupLat={activeJob?.pickupLat}
              pickupLng={activeJob?.pickupLng}
              dropoffLat={activeJob?.dropoffLat}
              dropoffLng={activeJob?.dropoffLng}
              showRoute={mapShowsRoute}
              showsUserLocation={shiftActive && !paymentJob}
              zones={mapZones}
            />
          </ErrorBoundary>

          <Pressable
            style={styles.expandBtn}
            onPress={() => setMapExpanded(true)}
            accessibilityLabel="Expand map"
          >
            <Text style={styles.expandIcon}>⛶</Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.workSection,
            hasCurrent ? styles.workSectionTrip : styles.workSectionIdle,
            hasCurrent && { minHeight: tripLayout.workMin, flex: 1 },
          ]}
        >
          {hasCurrent ? (
            <TripToolsBar
              meter={meterRunning && meter && !meter.trackOnly ? meter : null}
              onPause={pauseMeter}
              tariffs={tariffs}
              selected={selectedTariff}
              tariffOpen={tariffOpen}
              tariffLocked={tariffLocked}
              onTariffOpen={() => !tariffLocked && setTariffOpen(true)}
              onTariffClose={() => setTariffOpen(false)}
              onTariffSelect={setSelectedTariff}
            />
          ) : (
            <TariffPicker
              tariffs={tariffs}
              selected={selectedTariff}
              open={tariffOpen}
              locked={tariffLocked}
              onOpen={() => !tariffLocked && setTariffOpen(true)}
              onClose={() => setTariffOpen(false)}
              onSelect={setSelectedTariff}
            />
          )}

          <HomeMainTabs
            active={mainTab}
            offersCount={offersBadgeCount}
            offersLocked={offersLockedForEnrouteDispatch}
            hasCurrent={hasCurrent}
            queueCount={queuedOffers.length}
            workloadCount={workloadCount}
            onChange={setMainTab}
          />

          {/*
            IDLE HAIL REGRESSION GUARD — IdleCurrentSection (text + Pressable) must stay
            OUTSIDE panelHostIdle. Do not move back into CurrentTripPanel flex:1 empty
            state: flex centering + panelHost flex:1 left the button off-screen/invisible
            while only the helper text showed (black gap = Colors.background below panel).
          */}
          {!hasCurrent && mainTab === 'current' ? <IdleCurrentSection /> : null}

          <ErrorBoundary name="MainPanel">
            {!hasCurrent && mainTab === 'current' ? null : (
              <View style={hasCurrent ? styles.panelHostTrip : styles.panelHostIdle}>
                {mainTab === 'offers' ? <OffersPanel /> : null}
                {mainTab === 'current' && hasCurrent ? <CurrentTripPanel /> : null}
                {mainTab === 'queue' ? <QueuePanel /> : null}
              </View>
            )}
          </ErrorBoundary>

          {!shiftActive ? (
            <Text style={styles.offHint}>
              You are off shift. Confirm your vehicle to start a shift.
            </Text>
          ) : null}
        </View>
      </View>

      <FullScreenMapModal
        visible={mapExpanded}
        onClose={() => setMapExpanded(false)}
        activeJob={activeJob}
        meter={meter}
        showMeter={meterRunning && mapExpanded && !meter?.trackOnly}
        showRoute={mapShowsRoute}
        showsUserLocation={shiftActive && !paymentJob}
        zones={mapZones}
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
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyTrip: {
    flexDirection: 'column',
  },
  mapSection: {
    flex: 1,
    minHeight: 120,
    position: 'relative',
    overflow: 'hidden',
  },
  mapSectionTrip: {
    // Height applied dynamically from window size so details stay readable after Accept.
    overflow: 'hidden',
  },
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
  workSection: {
    flexShrink: 0,
    flexDirection: 'column',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  /** Idle (no trip): bounded height so map keeps room. */
  workSectionIdle: {
    flex: 1,
    minHeight: '32%',
    maxHeight: '52%',
  },
  workSectionTrip: {
    flex: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  /** Offers/Queue when idle — Current idle UI is IdleCurrentSection above, not here. */
  panelHostIdle: {
    flex: 1,
    minHeight: 0,
    backgroundColor: Colors.surface,
  },
  panelHostTrip: {
    flex: 1,
    minHeight: 0,
    backgroundColor: Colors.surface,
  },
  offHint: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
