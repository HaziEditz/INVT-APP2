import { useAuth } from '@/context/AuthContext';
import { getData, STORAGE_KEYS } from '@/lib/storage';
import { useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';

/** Route guard: auth → vehicle selection → main tabs. */
export function AuthNavigator() {
  const { firebaseUser, driver, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [vehicleReady, setVehicleReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!firebaseUser) {
      setVehicleReady(null);
      return;
    }
    getData<boolean>(STORAGE_KEYS.vehicleSessionReady).then((v) => setVehicleReady(!!v));
  }, [firebaseUser?.uid]);

  useEffect(() => {
    if (loading || vehicleReady === null) return;

    const root = segments[0];
    const inAuth = root === '(auth)';
    const onSelectVehicle = root === 'select-vehicle';
    const inTabs = root === '(tabs)';

    if (!firebaseUser) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    if (!driver && !onSelectVehicle && !inAuth) {
      router.replace('/select-vehicle');
      return;
    }

    if (firebaseUser && !vehicleReady && !onSelectVehicle) {
      router.replace('/select-vehicle');
      return;
    }

    if (firebaseUser && vehicleReady && (inAuth || onSelectVehicle)) {
      router.replace('/(tabs)');
      return;
    }

    if (firebaseUser && vehicleReady && !inTabs && !onSelectVehicle && root !== 'active-job') {
      router.replace('/(tabs)');
    }
  }, [firebaseUser, driver, loading, vehicleReady, segments, router]);

  return null;
}
