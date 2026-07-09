import { ChatPanel } from '@/components/ChatPanel';
import { useDriver } from '@/context/DriverContext';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

export default function ChatTabScreen() {
  const { markChatViewed, markChatTabBlurred } = useDriver();

  useFocusEffect(
    useCallback(() => {
      markChatViewed();
      return () => markChatTabBlurred();
    }, [markChatViewed, markChatTabBlurred]),
  );

  return <ChatPanel />;
}
