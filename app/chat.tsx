import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { ChatMessage } from '@/types';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

const INITIAL: ChatMessage[] = [
  { id: '1', sender: 'dispatcher', text: 'You are next in queue for City Centre.', timestamp: Date.now() - 60000 },
];

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL);
  const [text, setText] = useState('');

  const send = () => {
    if (!text.trim()) return;
    setMessages((prev) => [
      ...prev,
      { id: String(Date.now()), sender: 'driver', text: text.trim(), timestamp: Date.now() },
    ]);
    setText('');
  };

  return (
    <KeyboardAvoidingView style={sharedStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.sender === 'driver' ? styles.mine : styles.theirs]}>
            <Text style={styles.sender}>{item.sender === 'driver' ? 'You' : 'Dispatcher'}</Text>
            <Text style={styles.message}>{item.text}</Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <Input placeholder="Message dispatcher…" value={text} onChangeText={setText} style={styles.input} />
        <Button title="Send" onPress={send} style={styles.sendBtn} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, flexGrow: 1 },
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
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
  composer: { flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  input: { flex: 1, marginBottom: 0 },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 14 },
});
