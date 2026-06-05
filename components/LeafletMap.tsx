import { buildLeafletMapHtml, LeafletMapPayload } from '@/lib/leafletMapHtml';
import { jobCoords } from '@/lib/geo';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import * as Location from 'expo-location';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { JobMapProps } from './JobMap.types';

export default function LeafletMap({
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  showRoute = false,
  showsUserLocation = true,
  zones,
}: JobMapProps) {
  const webRef = useRef<WebView | null>(null);
  const [ready, setReady] = useState(false);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);

  const pickup = jobCoords(pickupLat, pickupLng);
  const dropoff = jobCoords(dropoffLat, dropoffLng, pickup.latitude + 0.02, pickup.longitude + 0.02);
  const hasJobCoords = pickupLat != null && pickupLng != null;

  const postPayload = useCallback(
    (payload: LeafletMapPayload) => {
      if (!webRef.current) return;
      webRef.current.postMessage(JSON.stringify(payload));
    },
    [],
  );

  const mapPayload = useMemo<LeafletMapPayload>(() => {
    const payload: LeafletMapPayload = {
      driverLat: driverCoords?.lat,
      driverLng: driverCoords?.lng,
      pickupLat: hasJobCoords ? pickup.latitude : undefined,
      pickupLng: hasJobCoords ? pickup.longitude : undefined,
      dropoffLat: dropoffLat != null ? dropoff.latitude : undefined,
      dropoffLng: dropoffLng != null ? dropoff.longitude : undefined,
      showRoute: showRoute && hasJobCoords && dropoffLat != null && dropoffLng != null,
      zones,
    };
    if (!hasJobCoords && driverCoords) {
      payload.fitDriver = true;
      payload.fitZoom = 14;
    } else if (!hasJobCoords && !driverCoords) {
      payload.centerLat = -41.0;
      payload.centerLng = 174.0;
      payload.centerZoom = 5;
    }
    return payload;
  }, [
    driverCoords,
    dropoff.latitude,
    dropoff.longitude,
    dropoffLat,
    dropoffLng,
    hasJobCoords,
    pickup.latitude,
    pickup.longitude,
    showRoute,
    zones,
  ]);

  useSafeEffect(() => {
    if (!showsUserLocation) {
      setDriverCoords(null);
      return;
    }
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setDriverCoords({
            lat: current.coords.latitude,
            lng: current.coords.longitude,
          });
        }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 3000 },
          (loc) => {
            setDriverCoords({
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
            });
          },
        );
      } catch (err) {
        console.warn('[LeafletMap] location watch failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [showsUserLocation], 'LeafletMap-location');

  useSafeEffect(() => {
    if (!ready) return;
    postPayload(mapPayload);
  }, [ready, mapPayload, postPayload], 'LeafletMap-sync');

  const html = useMemo(() => buildLeafletMapHtml(), []);

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data) as { type?: string };
            if (msg.type === 'ready') setReady(true);
          } catch {
            // ignore
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', minHeight: 120 },
  webview: { flex: 1, backgroundColor: '#e8eef2' },
});
