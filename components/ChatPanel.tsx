import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { useAuth } from '@/context/AuthContext';
import { clearChatNotification, clearDriverNotification } from '@/lib/driverNotifications';
import {
  loadChatHistory,
  sendChatToDispatch,
  subscribeChat,
} from '@/lib/chatService';
import { ChatMessage } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ChatPanel() {
  const insets = useSafeAreaInsets();
  const { driver } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const seenIds = useRef(new Set<string>());

  const mergeMessage = useCallback((msg: ChatMessage) => {
    const dedupeKey = `${msg.sender}:${msg.text}:${Math.floor(msg.timestamp / 5000)}`;
    if (seenIds.current.has(dedupeKey)) return;
    seenIds.current.add(dedupeKey);
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
    });
  }, []);

  useEffect(() => {
    if (!driver?.id || !driver.companyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    seenIds.current.clear();
    setLoading(true);
    loadChatHistory(driver.companyId, driver.id)
      .then((hist) => {
        if (cancelled) return;
        hist.forEach((m) => {
          seenIds.current.add(`${m.sender}:${m.text}:${Math.floor(m.timestamp / 5000)}`);
        });
        setMessages(hist);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsub = subscribeChat(driver.id, (msg) => {
      mergeMessage(msg);
      void clearChatNotification(driver.id);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [driver?.id, driver?.companyId, mergeMessage]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !driver?.id) return;
    setSending(true);
    setText('');
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      sender: 'driver',
      text: body,
      timestamp: Date.now(),
    };
    mergeMessage(optimistic);
    try {
      await sendChatToDispatch(body);
      await clearDriverNotification(driver.id);
    } catch (e) {
      setText(body);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      Alert.alert(
        'Send failed',
        e instanceof Error ? e.message : 'Could not reach dispatch. Check your connection and try again.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={sharedStyles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : insets.top}
    >
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : null}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: 8, flexGrow: 1 }]}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>No messages yet. Send a note to dispatch when you need help.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.sender === 'driver' ? styles.mine : styles.theirs]}>
            <Text style={styles.sender}>{item.sender === 'driver' ? 'You' : 'Dispatcher'}</Text>
            <Text style={styles.message}>{item.text}</Text>
          </View>
        )}
      />
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Input
          placeholder="Message dispatcher…"
          value={text}
          onChangeText={setText}
          style={styles.input}
          editable={!sending}
        />
        <Button title={sending ? '…' : 'Send'} onPress={() => void send()} disabled={sending} style={styles.sendBtn} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  loadingWrap: { padding: 24, alignItems: 'center' },
  empty: { color: Colors.textMuted, fontSize: 15, textAlign: 'center', paddingVertical: 32, lineHeight: 22 },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 8 },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.accent + '33',
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sender: { color: Colors.textMuted, fontSize: 11, marginBottom: 4, fontWeight: '600' },
  message: { color: Colors.text, fontSize: 15 },
  composer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: { flex: 1, marginBottom: 0 },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 14 },
});
