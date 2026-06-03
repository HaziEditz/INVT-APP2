import { AuthProvider } from '@/context/AuthContext';
import { DriverProvider } from '@/context/DriverContext';
import { AuthNavigator } from '@/components/AuthNavigator';
import { Colors } from '@/constants/theme';
import { JobOfferModal } from '@/components/JobOfferModal';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { registerForPushNotifications } from '@/services/notificationService';

export default function RootLayout() {
  useEffect(() => {
    registerForPushNotifications().catch(() => undefined);
  }, []);

  return (
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
        <JobOfferModal />
      </DriverProvider>
    </AuthProvider>
  );
}
