import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { offersBadgeCount } = useDriver();

  useSafeEffect(() => {
    console.log('[TabLayout] mounted', { offersBadgeCount });
    return () => console.log('[TabLayout] unmounted');
  }, [], 'TabLayout-mount');

  return (
    <ErrorBoundary name="Tabs">
    <Tabs
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          paddingBottom: Math.max(insets.bottom, 8),
          height: 56 + Math.max(insets.bottom, 8),
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Main',
          tabBarBadge: offersBadgeCount > 0 ? offersBadgeCount : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Bookings',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
    </ErrorBoundary>
  );
}
