const DEFAULT_LAT = -46.4132;
const DEFAULT_LNG = 168.3538;

export function jobCoords(
  lat?: number,
  lng?: number,
  fallbackLat = DEFAULT_LAT,
  fallbackLng = DEFAULT_LNG,
) {
  const latitude = typeof lat === 'number' && !Number.isNaN(lat) ? lat : fallbackLat;
  const longitude = typeof lng === 'number' && !Number.isNaN(lng) ? lng : fallbackLng;
  return { latitude, longitude };
}

export function regionForRoute(
  pickup: { latitude: number; longitude: number },
  dropoff: { latitude: number; longitude: number },
) {
  const midLat = (pickup.latitude + dropoff.latitude) / 2;
  const midLng = (pickup.longitude + dropoff.longitude) / 2;
  const latDelta = Math.max(0.02, Math.abs(pickup.latitude - dropoff.latitude) * 1.8);
  const lngDelta = Math.max(0.02, Math.abs(pickup.longitude - dropoff.longitude) * 1.8);
  return {
    latitude: midLat,
    longitude: midLng,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}
