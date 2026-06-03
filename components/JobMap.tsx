import { Platform } from 'react-native';
import type { ComponentType } from 'react';

type JobMapProps = {
  pickup: { latitude: number; longitude: number };
  dropoff: { latitude: number; longitude: number };
};

const JobMap: ComponentType<JobMapProps> =
  Platform.OS === 'web'
    ? require('./JobMap.web').default
    : require('./JobMap.native').default;

export default JobMap;
