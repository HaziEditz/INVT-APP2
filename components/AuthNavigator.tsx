import { useAuth } from '@/context/AuthContext';
import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

/**
 * Keeps the route stack in sync with auth state so login → home works without restarting.
 */
export function AuthNavigator() {
  const { driver, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const root = segments[0];
    const inAuth = root === '(auth)' || root === 'login';
    const inTabs = root === '(tabs)';

    if (driver && inAuth) {
      router.replace('/(tabs)');
      return;
    }

    if (!driver && inTabs) {
      router.replace('/(auth)/login');
    }
  }, [driver, loading, segments, router]);

  return null;
}
