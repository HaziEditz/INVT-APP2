import { ChatPanel } from '@/components/ChatPanel';
import { useDriver } from '@/context/DriverContext';
import { Redirect } from 'expo-router';

export default function ChatScreen() {
  const { chatEnabled } = useDriver();
  if (!chatEnabled) return <Redirect href="/(tabs)" />;
  return <ChatPanel />;
}
