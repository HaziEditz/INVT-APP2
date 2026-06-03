import { Platform } from 'react-native';
import type { ComponentType } from 'react';
import type { JobMapProps } from './JobMap.types';

export type { JobMapProps } from './JobMap.types';

const JobMap: ComponentType<JobMapProps> =
  Platform.OS === 'web'
    ? require('./JobMap.web').default
    : require('./SafeJobMap').default;

export default JobMap;
