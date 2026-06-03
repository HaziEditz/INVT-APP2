import 'react-native-gesture-handler';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider } from '@/context/AuthContext';
import { DriverProvider } from '@/context/DriverContext';
import { AuthNavigator } from '@/components/AuthNavigator';
import { Colors } from '@/constants/theme';
import { JobOfferModal } from '@/components/JobOfferModal';
import { ShiftKeepAwake } from '@/components/ShiftKeepAwake';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { registerForPushNotifications } from '@/services/notificationService';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  useSafeEffect(() => {
    registerForPushNotifications().catch((err) => {
      console.error('[RootLayout] push registration failed:', err);
    });
  }, [], 'RootLayout-push');

  return (
    <SafeAreaProvider>
    <ErrorBoundary name="App">
    <AuthProvider>
      <DriverProvider>
        <AuthNavigator />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.text,
            contentStyle: { backgroundColor: Colors.background },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="active-job" options={{ title: 'Active Job' }} />
          <Stack.Screen name="meter" options={{ title: 'Meter' }} />
          <Stack.Screen name="zone-queue" options={{ title: 'Zone Queue' }} />
          <Stack.Screen name="pre-booking" options={{ title: 'Pre-booking' }} />
          <Stack.Screen name="chat" options={{ title: 'Dispatcher Chat' }} />
        </Stack>
        <ErrorBoundary name="ShiftKeepAwake">
          <ShiftKeepAwake />
        </ErrorBoundary>
        <ErrorBoundary name="JobOfferModal">
          <JobOfferModal />
        </ErrorBoundary>
      </DriverProvider>
    </AuthProvider>
    </ErrorBoundary>
    </SafeAreaProvider>
  );
}
