import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { useRouter, useSegments } from 'expo-router';

/** When dispatch closes an SOS, return responders to main if they are not on the map screen. */
export function SosIncidentRelease() {
  const {
    incomingSosResolved,
    clearIncomingSosAlert,
  } = useDriver();
  const segments = useSegments();
  const router = useRouter();

  useSafeEffect(() => {
    if (!incomingSosResolved) return;
    const onSosAlert = segments.includes('sos-alert');
    if (onSosAlert) return;

    const timer = setTimeout(() => {
      clearIncomingSosAlert();
      if (!segments.includes('(tabs)')) {
        router.replace('/(tabs)');
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [incomingSosResolved, segments, clearIncomingSosAlert, router], 'SosIncidentRelease');

  return null;
}
