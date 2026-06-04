import { ActiveJobPanel } from '@/components/home/ActiveJobPanel';
import { QueuedOffersSheet } from '@/components/home/QueuedOffersSheet';
import { HomeBottomBar } from '@/components/home/HomeBottomBar';
import { HomeStatusBar } from '@/components/home/HomeStatusBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MapErrorFallback } from '@/components/MapErrorFallback';
import JobMap from '@/components/JobMap';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
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
  useSafeEffect(() => {
    console.log('[MainScreen] mounted');
    return () => console.log('[MainScreen] unmounted');
  }, [], 'MainScreen-mount');

  const { firebaseUser, driver, profileLoading, refreshDriver } = useAuth();
  const {
    shiftActive,
    activeJob,
    hailActive,
    meter,
    startHail,
    endHail,
  } = useDriver();

  const [queueSheetOpen, setQueueSheetOpen] = useState(false);

  useSafeEffect(() => {
    if (!firebaseUser) return;
    refreshDriver().catch((err) => console.error('[Main] refreshDriver failed:', err));
  }, [firebaseUser?.uid], 'MainScreen-loadProfile');

  const onHailPress = () => {
    if (!shiftActive) {
      Alert.alert('Off shift', 'End shift is in Profile. Sign in again to start a new shift.');
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

  const mapShowsRoute = !!activeJob || hailActive;
  const tripActive = !!activeJob || hailActive;

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
        <HomeStatusBar onOffersPress={() => setQueueSheetOpen(true)} />
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
        {hailActive && meter ? (
          <View style={styles.meterBadge}>
            <Text style={styles.meterFare}>${meter.fare.toFixed(2)}</Text>
            <Text style={styles.meterSub}>{meter.distanceKm.toFixed(1)} km · meter running</Text>
          </View>
        ) : null}
      </View>

      {activeJob ? (
        <ErrorBoundary name="ActiveJobPanel">
          <ActiveJobPanel />
        </ErrorBoundary>
      ) : null}

      <HomeBottomBar />

      <Pressable
        style={[styles.hailBtn, hailActive && styles.hailBtnActive]}
        onPress={onHailPress}
      >
        <Text style={styles.hailBtnText}>{hailActive ? 'END HAIL TRIP' : 'HAIL PASSENGER'}</Text>
      </Pressable>

      {!shiftActive ? (
        <Text style={styles.offHint}>You are off shift. Open Profile to sign out and sign in again to start a new shift.</Text>
      ) : null}

      <QueuedOffersSheet visible={queueSheetOpen} onClose={() => setQueueSheetOpen(false)} />
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
  mapSection: { flex: 1, minHeight: 220, position: 'relative' },
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
  meterSub: { color: Colors.textMuted, fontSize: 13 },
  hailBtn: {
    marginHorizontal: 14,
    marginVertical: 10,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  hailBtnActive: { backgroundColor: Colors.danger },
  hailBtnText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  offHint: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 },
});
