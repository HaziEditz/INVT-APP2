import { jobCoords, regionForRoute } from '@/lib/geo';
import { Colors } from '@/constants/theme';
import { MapErrorFallback } from '@/components/MapErrorFallback';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

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

type MapsModule = {
  default: React.ComponentType<Record<string, unknown>>;
  Marker: React.ComponentType<Record<string, unknown>>;
  Polyline: React.ComponentType<Record<string, unknown>>;
  PROVIDER_GOOGLE?: string;
};

function loadMapsModule(): MapsModule | null {
  try {
    return require('react-native-maps') as MapsModule;
  } catch (err) {
    console.error('[JobMap] react-native-maps load failed:', err);
    return null;
  }
}

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
  const maps = loadMapsModule();
  const mapRef = useRef<{ animateToRegion?: (r: unknown, ms: number) => void } | null>(null);
  const [mapBroken, setMapBroken] = useState(false);

  const p = pickup ?? jobCoords(pickupLat, pickupLng);
  const d = dropoff ?? jobCoords(dropoffLat, dropoffLng, p.latitude + 0.02, p.longitude + 0.02);
  const region = regionForRoute(p, d);

  useSafeEffect(() => {
    try {
      mapRef.current?.animateToRegion?.(region, 400);
    } catch (err) {
      console.error('[JobMap] animateToRegion failed:', err);
    }
  }, [p.latitude, p.longitude, d.latitude, d.longitude], 'JobMap-animate');

  if (mapBroken || !maps?.default) {
    return <MapErrorFallback />;
  }

  const MapView = maps.default;
  const Marker = maps.Marker;
  const Polyline = maps.Polyline;

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef as never}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        loadingEnabled
        mapType="standard"
        onMapReady={() => console.log('[JobMap] map ready')}
        onError={(e: { nativeEvent?: { error?: string } }) => {
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
