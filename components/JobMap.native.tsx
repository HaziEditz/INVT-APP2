import { jobCoords, regionForRoute } from '@/lib/geo';
import { Colors } from '@/constants/theme';
import { MapErrorFallback } from '@/components/MapErrorFallback';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

export type MapCoord = { latitude: number; longitude: number };

type Props = {
  pickup?: MapCoord;
  dropoff?: MapCoord;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  showRoute?: boolean;
  showsUserLocation?: boolean;
};

/** Use Google Maps on native builds (API key is injected via app.json at build time). */
const MAP_PROVIDER = Platform.OS === 'android' || Platform.OS === 'ios' ? PROVIDER_GOOGLE : undefined;

export default function JobMap({
  pickup,
  dropoff,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  showRoute = true,
  showsUserLocation = true,
}: Props) {
  const mapRef = useRef<MapView | null>(null);
  const [mapBroken, setMapBroken] = useState(false);

  const p = pickup ?? jobCoords(pickupLat, pickupLng);
  const d = dropoff ?? jobCoords(dropoffLat, dropoffLng, p.latitude + 0.02, p.longitude + 0.02);
  const region = regionForRoute(p, d);

  useSafeEffect(() => {
    try {
      mapRef.current?.animateToRegion(region, 400);
    } catch (err) {
      console.error('[JobMap] animateToRegion failed:', err);
    }
  }, [p.latitude, p.longitude, d.latitude, d.longitude], 'JobMap-animate');

  if (mapBroken) {
    return <MapErrorFallback />;
  }

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={MAP_PROVIDER}
        initialRegion={region}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        loadingEnabled
        mapType="standard"
        onMapReady={() => console.log('[JobMap] map ready', { provider: MAP_PROVIDER, platform: Platform.OS })}
        onError={(e) => {
          console.error('[JobMap] native error:', e?.nativeEvent?.error ?? e);
          setMapBroken(true);
        }}
      >
        <Marker coordinate={p} title="Pickup" pinColor={Colors.accent} />
        <Marker coordinate={d} title="Dropoff" pinColor={Colors.success} />
        {showRoute ? (
          <Polyline coordinates={[p, d]} strokeColor={Colors.accent} strokeWidth={4} />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', minHeight: 120 },
  map: { ...StyleSheet.absoluteFillObject },
});
