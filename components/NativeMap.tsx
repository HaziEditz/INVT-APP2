import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';

let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
let PROVIDER_GOOGLE: any = undefined;
try {
  const RNMaps = require('react-native-maps');
  MapView = RNMaps.default;
  Marker = RNMaps.Marker;
  Polyline = RNMaps.Polyline;
  PROVIDER_GOOGLE = RNMaps.PROVIDER_GOOGLE;
} catch {
  // Expo Go / web — keep all null, render fallback
}

export interface LatLng { lat: number; lng: number; }

export interface NativeMapProps {
  driver?: LatLng | null;
  pickup?: LatLng | null;
  drop?:   LatLng | null;
  /** Which destination the route should be drawn TO. */
  phase?:  'pickup' | 'drop' | 'none';
  /** Show a route polyline between driver and the phase target. Default true if phase is set. */
  showRoute?: boolean;
  /** Default zoom when only the driver dot exists. */
  defaultZoomDelta?: number;
  style?: any;
}

const SUR = { lat: -46.4132, lng: 168.3538 };

function NativeMapImpl({
  driver,
  pickup,
  drop,
  phase = 'none',
  showRoute,
  defaultZoomDelta = 0.02,
  style,
}: NativeMapProps) {
  const mapRef = useRef<any>(null);
  const lastFitKey = useRef<string>('');

  const center = driver ?? pickup ?? drop ?? SUR;
  const initialRegion = useMemo(() => ({
    latitude:  center.lat,
    longitude: center.lng,
    latitudeDelta:  defaultZoomDelta,
    longitudeDelta: defaultZoomDelta,
  }), []); // initial only — never recompute

  // Fit bounds whenever the set of markers changes
  useEffect(() => {
    if (!mapRef.current || !driver) return;
    const target = phase === 'drop' ? drop : pickup;
    if (!target) return;
    const fitKey = `${driver.lat.toFixed(4)}|${target.lat.toFixed(4)}|${target.lng.toFixed(4)}|${phase}`;
    if (fitKey === lastFitKey.current) return;
    lastFitKey.current = fitKey;
    const coords = [
      { latitude: driver.lat, longitude: driver.lng },
      { latitude: target.lat, longitude: target.lng },
    ];
    if (phase === 'pickup' && drop) {
      coords.push({ latitude: drop.lat, longitude: drop.lng });
    }
    setTimeout(() => {
      try {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 90, right: 60, bottom: 60, left: 60 },
          animated: true,
        });
      } catch {}
    }, 350);
  }, [driver?.lat, driver?.lng, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, phase]);

  // Animate driver marker smoothly when GPS updates
  const driverMarkerRef = useRef<any>(null);
  useEffect(() => {
    if (!driver || !driverMarkerRef.current) return;
    try {
      driverMarkerRef.current.animateMarkerToCoordinate?.(
        { latitude: driver.lat, longitude: driver.lng },
        800,
      );
    } catch {}
  }, [driver?.lat, driver?.lng]);

  // ── OSRM route fetching ────────────────────────────────────────────────
  const [routeCoords, setRouteCoords] = React.useState<{ latitude: number; longitude: number; }[]>([]);
  useEffect(() => {
    const target = phase === 'drop' ? drop : pickup;
    const wantRoute = showRoute !== false && phase !== 'none' && driver && target;
    if (!wantRoute) { setRouteCoords([]); return; }
    let cancelled = false;
    const from = `${driver!.lng},${driver!.lat}`;
    const to   = `${target!.lng},${target!.lat}`;
    fetch(`https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        const coords: [number, number][] = j?.routes?.[0]?.geometry?.coordinates ?? [];
        setRouteCoords(coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [phase, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]); // intentionally NOT driver — refetch only on phase / target change

  if (!MapView) {
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackText}>Native map requires a dev build</Text>
      </View>
    );
  }

  return (
    <MapView
      ref={mapRef}
      style={[StyleSheet.absoluteFill, style]}
      provider={PROVIDER_GOOGLE}
      initialRegion={initialRegion}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      showsTraffic={false}
      showsBuildings={false}
      showsIndoors={false}
      pitchEnabled={false}
      rotateEnabled={false}
      toolbarEnabled={false}
      moveOnMarkerPress={false}
      loadingEnabled
      loadingBackgroundColor="#0f172a"
      loadingIndicatorColor="#3b82f6"
    >
      {driver && (
        <Marker
          ref={driverMarkerRef}
          coordinate={{ latitude: driver.lat, longitude: driver.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          flat
          tracksViewChanges={false}
        >
          <View style={styles.driverDot}><Text style={styles.driverEmoji}>🚕</Text></View>
        </Marker>
      )}
      {pickup && (
        <Marker
          coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={[styles.pin, { backgroundColor: '#22c55e' }]}><Text style={styles.pinTxt}>P</Text></View>
        </Marker>
      )}
      {drop && (
        <Marker
          coordinate={{ latitude: drop.lat, longitude: drop.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={[styles.pin, { backgroundColor: '#ef4444' }]}><Text style={styles.pinTxt}>D</Text></View>
        </Marker>
      )}
      {routeCoords.length > 1 && (
        <Polyline
          coordinates={routeCoords}
          strokeColor="#3b82f6"
          strokeWidth={5}
        />
      )}
    </MapView>
  );
}

// v12-ota17: memoize so re-renders from parents (with same lat/lng/etc) skip
// reconciliation entirely. Marker movement is handled imperatively by
// animateMarkerToCoordinate in a useEffect — no re-render of the MapView tree
// is needed when only the driver position changes.
export const NativeMap = React.memo(NativeMapImpl, (a, b) => (
  a.driver?.lat === b.driver?.lat &&
  a.driver?.lng === b.driver?.lng &&
  a.pickup?.lat === b.pickup?.lat &&
  a.pickup?.lng === b.pickup?.lng &&
  a.drop?.lat   === b.drop?.lat   &&
  a.drop?.lng   === b.drop?.lng   &&
  a.phase       === b.phase       &&
  a.showRoute   === b.showRoute   &&
  a.defaultZoomDelta === b.defaultZoomDelta &&
  a.style       === b.style
));

const styles = StyleSheet.create({
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  fallbackText: { color: '#64748b', fontSize: 13 },
  driverDot: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#3b82f6',
    borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 6 },
      ios:     { shadowColor: '#3b82f6', shadowOpacity: 0.7, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    }),
  },
  driverEmoji: { fontSize: 18 },
  pin: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 5 },
      ios:     { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    }),
  },
  pinTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
