import { ChatPanel } from '@/components/ChatPanel';
import { TabSosBar } from '@/components/TabSosBar';
import { useDriver } from '@/context/DriverContext';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

export default function ChatTabScreen() {
  const { markChatViewed, markChatTabBlurred } = useDriver();

  useFocusEffect(
    useCallback(() => {
      markChatViewed();
      return () => markChatTabBlurred();
    }, [markChatViewed, markChatTabBlurred]),
  );

  return (
    <View style={{ flex: 1 }}>
      <TabSosBar />
      <ChatPanel />
    </View>
  );
}
