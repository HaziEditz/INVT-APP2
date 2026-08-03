import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { resolveSessionRoute } from '@/lib/sessionRoutePolicy';
import { useRouter, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

const REDIRECT_COOLDOWN_MS = 600;

/** Route guard: auth → vehicle selection → main tabs (only while shift active). */
export function AuthNavigator() {
  const { firebaseUser, loading } = useAuth();
  const { shiftActive, endShiftInProgress } = useDriver();
  const segments = useSegments();
  const router = useRouter();
  const lastRedirectRef = useRef<{ target: string; at: number }>({ target: '', at: 0 });
  const guardUntilRef = useRef(0);

  useEffect(() => {
    if (loading) return;
    if (Date.now() < guardUntilRef.current) return;

    const root = segments[0] ?? '';
    const target = resolveSessionRoute({
      hasFirebaseUser: !!firebaseUser,
      shiftActive,
      endShiftInProgress,
      inAuth: root === '(auth)',
      onSelectVehicle: root === 'select-vehicle',
      inTabs: root === '(tabs)',
    });

    if (!target) return;

    const alreadyThere =
      (target === '/(tabs)' && root === '(tabs)') ||
      (target === '/select-vehicle' && root === 'select-vehicle') ||
      (target === '/(auth)/login' && root === '(auth)');

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

    console.log('[AuthNavigator] redirect', { from: root, to: target, shiftActive });
    router.replace(target);
  }, [firebaseUser, loading, shiftActive, endShiftInProgress, segments, router]);

  return null;
}
