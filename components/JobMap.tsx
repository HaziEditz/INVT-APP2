import { Platform } from 'react-native';
import type { ComponentType } from 'react';
import type { MapCoord } from './JobMap.native';

export type JobMapProps = {
  pickup?: MapCoord;
  dropoff?: MapCoord;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  showRoute?: boolean;
  showsUserLocation?: boolean;
};

const JobMap: ComponentType<JobMapProps> =
  Platform.OS === 'web'
    ? require('./JobMap.web').default
    : require('./JobMap.native').default;

export default JobMap;
