import JobMap from '@/components/JobMap';
import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { sharedStyles } from '@/constants/styles';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SosAlertScreen() {
  const insets = useSafeAreaInsets();
  const {
    incomingSosAlert,
    incomingSosResolved,
    incomingSosResolvedMessage,
    sosResponding,
    respondToIncomingSos,
    dismissIncomingSosAlert,
    clearIncomingSosAlert,
  } = useDriver();

  useSafeEffect(() => {
    if (!incomingSosResolved) return;
    const timer = setTimeout(() => {
      clearIncomingSosAlert();
      router.replace('/(tabs)');
    }, 2500);
    return () => clearTimeout(timer);
  }, [incomingSosResolved, clearIncomingSosAlert], 'SosAlertScreen-resolved');

  if (!incomingSosAlert && !incomingSosResolved) {
    return (
      <View style={[sharedStyles.screen, styles.empty, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.emptyTitle}>No active SOS alert</Text>
        <Button title="Close" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  if (incomingSosResolved) {
    return (
      <View style={[sharedStyles.screen, styles.empty, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.resolvedTitle}>Emergency resolved</Text>
        <Text style={styles.resolvedMessage}>
          {incomingSosResolvedMessage || 'Dispatch has closed this SOS incident.'}
        </Text>
        <Text style={styles.resolvedHint}>Returning to main screen…</Text>
        <Button
          title="Clear"
          variant="secondary"
          onPress={() => {
            clearIncomingSosAlert();
            router.replace('/(tabs)');
          }}
        />
      </View>
    );
  }

  const { driverName, vehiclenumber, locationAddress, lat, lng, content } = incomingSosAlert!;
  const hasCoords = Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001;

  return (
    <View style={[sharedStyles.screen, { paddingTop: insets.top }]}>
      <View style={styles.mapWrap}>
        {hasCoords ? (
          <JobMap pickupLat={lat} pickupLng={lng} showRoute={false} showsUserLocation />
        ) : (
          <View style={styles.mapFallback}>
            <Text style={styles.mapFallbackText}>SOS location unavailable</Text>
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.title}>Driver emergency nearby</Text>
        <Text style={styles.meta}>
          {driverName}
          {vehiclenumber ? ` · ${vehiclenumber}` : ''}
        </Text>
        <Text style={styles.location}>{locationAddress || content || 'Location unavailable'}</Text>

        <Button
          title={sosResponding ? 'Sending response…' : 'Going to help'}
          variant="danger"
          disabled={sosResponding}
          onPress={() => void respondToIncomingSos()}
        />
        <Button
          title="Clear"
          variant="secondary"
          style={{ marginTop: 10 }}
          onPress={() => {
            dismissIncomingSosAlert();
            router.replace('/(tabs)');
          }}
        />
        {sosResponding ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 12 }} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  resolvedTitle: { color: Colors.success, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  resolvedMessage: { color: Colors.text, fontSize: 16, textAlign: 'center', lineHeight: 22 },
  resolvedHint: { color: Colors.textMuted, fontSize: 14, textAlign: 'center' },
  mapWrap: { flex: 1, minHeight: 280 },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  mapFallbackText: { color: Colors.textMuted, fontSize: 14 },
  panel: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    gap: 8,
  },
  title: { color: Colors.danger, fontSize: 18, fontWeight: '800' },
  meta: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  location: { color: Colors.textMuted, fontSize: 14, marginBottom: 8 },
});
