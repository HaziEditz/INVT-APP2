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
  /** When true, map fills a fixed-height parent (e.g. 120px trip strip) without min-height overflow. */
  compact?: boolean;
  zones?: Array<{ name: string; active?: boolean; boundary: number[][] }>;
};
