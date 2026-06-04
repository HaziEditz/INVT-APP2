import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { getData, STORAGE_KEYS } from '@/lib/storage';
import { useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const REDIRECT_COOLDOWN_MS = 600;

type RouteTarget = '/(auth)/login' | '/select-vehicle' | '/(tabs)';

/** Route guard: auth → vehicle selection → main tabs. */
export function AuthNavigator() {
  const { firebaseUser, driver, loading } = useAuth();
  const { shiftActive } = useDriver();
  const segments = useSegments();
  const router = useRouter();
  const [vehicleReady, setVehicleReady] = useState<boolean | null>(null);
  const lastRedirectRef = useRef<{ target: string; at: number }>({ target: '', at: 0 });
  const guardUntilRef = useRef(0);

  const refreshVehicleReady = useCallback(async () => {
    if (!firebaseUser) {
      setVehicleReady(null);
      return;
    }
    const stored = await getData<boolean>(STORAGE_KEYS.vehicleSessionReady);
    setVehicleReady(!!stored);
  }, [firebaseUser?.uid]);

  useEffect(() => {
    refreshVehicleReady().catch((err) => console.warn('[AuthNavigator] refreshVehicleReady', err));
  }, [refreshVehicleReady, shiftActive]);

  useEffect(() => {
    if (loading || vehicleReady === null) return;
    if (Date.now() < guardUntilRef.current) return;

    const root = segments[0] ?? '';
    const inAuth = root === '(auth)';
    const onSelectVehicle = root === 'select-vehicle';
    const inTabs = root === '(tabs)';

    /** Shift on or vehicle confirmed this session — never send user back to select-vehicle. */
    const sessionLocked = shiftActive || vehicleReady;

    let target: RouteTarget | null = null;

    if (!firebaseUser) {
      if (!inAuth) target = '/(auth)/login';
    } else if (shiftActive) {
      // On shift: stay on tabs (or job screens), never select-vehicle or login
      if (!inTabs && (onSelectVehicle || inAuth)) {
        target = '/(tabs)';
      }
    } else if (sessionLocked) {
      // Vehicle confirmed but off shift: allow tabs, leave select-vehicle/auth
      if (onSelectVehicle || inAuth) {
        target = '/(tabs)';
      }
    } else if (!driver && !onSelectVehicle && !inAuth) {
      target = '/select-vehicle';
    } else if (!sessionLocked && !onSelectVehicle && !inAuth) {
      target = '/select-vehicle';
    }

    if (!target) return;

    const alreadyThere =
      (target === '/(tabs)' && inTabs) ||
      (target === '/select-vehicle' && onSelectVehicle) ||
      (target === '/(auth)/login' && inAuth);

    if (alreadyThere) return;

    const now = Date.now();
    if (
      lastRedirectRef.current.target === target &&
      now - lastRedirectRef.current.at < REDIRECT_COOLDOWN_MS
    ) {
      return;
    }

    lastRedirectRef.current = { target, at: now };
    guardUntilRef.current = now + REDIRECT_COOLDOWN_MS;

    console.log('[AuthNavigator] redirect', { from: root, to: target, shiftActive, vehicleReady });
    router.replace(target);
  }, [firebaseUser, driver, loading, vehicleReady, shiftActive, segments, router]);

  return null;
}
