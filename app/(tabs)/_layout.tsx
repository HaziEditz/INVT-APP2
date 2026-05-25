import React from 'react';
import { Tabs } from 'expo-router';
import { Platform, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useDriver, useDriverChat } from '@/context/DriverContext';
import * as Sentry from '@sentry/react-native';

// v22x: Tab-level ErrorBoundary. The root ErrorBoundary in app/_layout.tsx
// replaces the WHOLE app on any crash, which is why "press anywhere crashes
// + lose shift" was reported — every tap into a tab whose render threw was
// blowing up the entire navigation stack. With per-tab boundaries the tab
// bar stays mounted, the driver can flip to another tab, and we capture the
// actual error message on-screen so we can finally see what's failing.
class TabErrorBoundary extends React.Component<
  { children: React.ReactNode; tabName: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) {
    console.error(`[TabErrorBoundary:${this.props.tabName}]`, error.message, error.stack, info?.componentStack);
    try { Sentry.captureException(error, { tags: { tabBoundary: this.props.tabName } }); } catch {}
  }
  render() {
    if (this.state.error) {
      return (
        <ScrollView style={{ flex: 1, backgroundColor: '#0A0A0F' }} contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
          <Text style={{ color: '#ef4444', fontSize: 20, fontWeight: '700', marginBottom: 8 }}>
            {this.props.tabName} screen error
          </Text>
          <Text style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>
            Other tabs still work. Switch tabs to keep driving — tell support what this says:
          </Text>
          <View style={{ backgroundColor: '#1f2937', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#ef4444' }}>
            <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
              {(this.state.error as any).name}: {(this.state.error as any).message}
            </Text>
            <Text style={{ color: '#9ca3af', fontSize: 11, lineHeight: 15 }} numberOfLines={20}>
              {(this.state.error as any).stack}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => this.setState({ error: null })}
            style={{ backgroundColor: '#facc15', padding: 14, borderRadius: 10, alignItems: 'center' }}
          >
            <Text style={{ color: '#000', fontWeight: '700' }}>Try again</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

function TabBarIcon({ name, color, size }: { name: any; color: string; size: number }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { offeredJobs, meterRunning } = useDriver();
  const { chatThreads } = useDriverChat();
  const offeredCount = offeredJobs.length;
  const unreadChats = chatThreads.reduce((sum, t) => sum + t.unread, 0);

  const androidBottom = Platform.OS === 'android' ? insets.bottom : 0;
  const tabBarHeight  = Platform.OS === 'web' ? 84 : 68 + androidBottom;
  const tabBarPadBot  = Platform.OS === 'web' ? 34 : 10 + androidBottom;

  return (
    <TabErrorBoundary tabName="Tabs">
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: tabBarPadBot,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarShowLabel: true,
        tabBarLabelStyle: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
      }}
    >
      {/* ── Primary visible tabs ── */}
      <Tabs.Screen
        name="meter"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon
              name={meterRunning ? 'speedometer' : 'home-outline'}
              color={meterRunning ? '#ef4444' : color}
              size={size}
            />
          ),
          tabBarBadge: offeredCount > 0 ? offeredCount : (meterRunning ? '●' : undefined),
          tabBarBadgeStyle: {
            backgroundColor: offeredCount > 0 ? colors.warning : '#ef4444',
            fontSize: offeredCount > 0 ? 10 : 8,
            minWidth: 14, height: 14,
          },
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size }) => <TabBarIcon name="chatbubbles" color={color} size={size} />,
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <TabBarIcon name="person" color={color} size={size} />,
        }}
      />

      {/* ── Hidden tabs (routes still work, just not in the tab bar) ── */}
      <Tabs.Screen name="home"  options={{ href: null }} />
      <Tabs.Screen name="jobs"  options={{ href: null }} />
      <Tabs.Screen name="shift" options={{ href: null }} />
    </Tabs>
    </TabErrorBoundary>
  );
}
