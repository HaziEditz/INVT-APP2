import MapView, { Marker } from 'react-native-maps';
import { StyleSheet } from 'react-native';

type Props = {
  pickup: { latitude: number; longitude: number };
  dropoff: { latitude: number; longitude: number };
};

export default function JobMap({ pickup, dropoff }: Props) {
  return (
    <MapView
      style={styles.map}
      initialRegion={{
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
    >
      <Marker coordinate={pickup} title="Pickup" />
      <Marker coordinate={dropoff} title="Dropoff" />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
