import { useAuth } from '@/context/AuthContext';
import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

/** Route guard: signed-in users leave auth stack; signed-out users cannot stay on tabs. */
export function AuthNavigator() {
  const { firebaseUser, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const root = segments[0];
    const inAuth = root === '(auth)';
    const inTabs = root === '(tabs)';

    if (firebaseUser && inAuth) {
      router.replace('/(tabs)');
      return;
    }

    if (!firebaseUser && inTabs) {
      router.replace('/(auth)/login');
    }
  }, [firebaseUser, loading, segments, router]);

  return null;
}
