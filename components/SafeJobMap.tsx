import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MapErrorFallback } from '@/components/MapErrorFallback';
import React from 'react';
import type { JobMapProps } from '@/components/JobMap.types';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Colors } from '@/constants/theme';

type Props = JobMapProps;

export default function SafeJobMap(props: Props) {
  const [mapEnabled, setMapEnabled] = useState(false);

  useSafeEffect(() => {
    const timer = setTimeout(() => setMapEnabled(true), 350);
    return () => clearTimeout(timer);
  }, [], 'SafeJobMap-delay');

  if (!mapEnabled) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ErrorBoundary name="JobMap" fallback={<MapErrorFallback />}>
      <JobMapInner {...props} />
    </ErrorBoundary>
  );
}

function JobMapInner(props: Props) {
  const JobMap = require('@/components/JobMap.native').default as React.ComponentType<Props>;
  return <JobMap {...props} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
});
