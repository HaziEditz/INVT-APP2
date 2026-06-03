import { jobCoords, regionForRoute } from '@/lib/geo';
import { shouldUseGoogleMapsProvider } from '@/lib/mapConfig';
import { Colors } from '@/constants/theme';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
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
  const mapRef = useRef<MapView>(null);
  const p = pickup ?? jobCoords(pickupLat, pickupLng);
  const d = dropoff ?? jobCoords(dropoffLat, dropoffLng, p.latitude + 0.02, p.longitude + 0.02);
  const region = regionForRoute(p, d);

  useEffect(() => {
    mapRef.current?.animateToRegion(region, 400);
  }, [p.latitude, p.longitude, d.latitude, d.longitude]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={shouldUseGoogleMapsProvider() ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        loadingEnabled
        mapType="standard"
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
