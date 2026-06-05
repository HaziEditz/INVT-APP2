export type MapCoord = { latitude: number; longitude: number };

export type JobMapProps = {
  pickup?: MapCoord;
  dropoff?: MapCoord;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  showRoute?: boolean;
  showsUserLocation?: boolean;
  zones?: Array<{ name: string; active?: boolean; boundary: number[][] }>;
};
