import { ChatPanel } from '@/components/ChatPanel';
import { TabSosBar } from '@/components/TabSosBar';
import { useDriver } from '@/context/DriverContext';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

export default function ChatTabScreen() {
  const { markChatViewed, markChatTabBlurred, chatEnabled } = useDriver();

  useFocusEffect(
    useCallback(() => {
      if (!chatEnabled) return;
      markChatViewed();
      return () => markChatTabBlurred();
    }, [chatEnabled, markChatViewed, markChatTabBlurred]),
  );

  if (!chatEnabled) return <Redirect href="/(tabs)" />;

  return (
    <View style={{ flex: 1 }}>
      <TabSosBar />
      <ChatPanel />
    </View>
  );
}
