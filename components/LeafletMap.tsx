import { buildLeafletMapHtml, LeafletMapPayload } from '@/lib/leafletMapHtml';
import { jobCoords } from '@/lib/geo';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import * as Location from 'expo-location';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { JobMapProps } from './JobMap.types';

const DEFAULT_CENTER = { lat: -41.0, lng: 174.0, zoom: 5 };

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

  const pushToMap = useCallback((payload: LeafletMapPayload) => {
    if (!webRef.current) return;
    const json = JSON.stringify(payload).replace(/</g, '\\u003c');
    webRef.current.injectJavaScript(`window.updateMap && window.updateMap(${json}); true;`);
    if (Platform.OS === 'android') {
      webRef.current.postMessage(JSON.stringify(payload));
    }
  }, []);

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
      payload.centerLat = DEFAULT_CENTER.lat;
      payload.centerLng = DEFAULT_CENTER.lng;
      payload.centerZoom = DEFAULT_CENTER.zoom;
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

    void Location.getLastKnownPositionAsync().then((last) => {
      if (cancelled || !last) return;
      setDriverCoords({
        lat: last.coords.latitude,
        lng: last.coords.longitude,
      });
    });

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
    pushToMap(mapPayload);
  }, [ready, mapPayload, pushToMap], 'LeafletMap-sync');

  const html = useMemo(() => buildLeafletMapHtml(), []);

  const handleLoadEnd = () => {
    webRef.current?.injectJavaScript(
      'if(window.map){window.map.invalidateSize();}else if(window.initMap){window.initMap();} true;',
    );
    pushToMap(mapPayload);
    setTimeout(() => setReady((was) => was || true), 1200);
  };

  const handleReady = () => {
    setReady(true);
    pushToMap(mapPayload);
  };

  return (
    <View style={styles.wrap}>
      {!ready ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color="#1565C0" size="large" />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      ) : null}
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost/' }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        {...(Platform.OS === 'android' ? { cacheMode: 'LOAD_CACHE_ELSE_NETWORK' as const } : {})}
        scrollEnabled={false}
        mixedContentMode="always"
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        onLoadEnd={handleLoadEnd}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data) as { type?: string };
            if (msg.type === 'ready') {
              handleReady();
            }
          } catch {
            // ignore
          }
        }}
        onError={(e) => console.warn('[LeafletMap] WebView error:', e.nativeEvent)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', minHeight: 160, backgroundColor: '#dbeafe' },
  webview: { flex: 1, backgroundColor: '#dbeafe' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: { color: '#475569', fontSize: 14, fontWeight: '600' },
});
