import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { COMPANY_TZ } from '@/lib/timezone';
import { useDriver, useDriverChat, useDriverFleet, ChatMessage } from '@/context/DriverContext';
import { useAuth } from '@/context/AuthContext';

const QUICK_REPLIES_FALLBACK = [
  'On my way',
  'Running late',
  'Here now',
  'Need assistance',
];

function getDateLabel(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    // Compare calendar dates in company timezone so "Today"/"Yesterday" is
    // always correct for NZ drivers regardless of the device's local timezone.
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: COMPANY_TZ });
    const msgStr   = d.toLocaleDateString('en-CA', { timeZone: COMPANY_TZ });
    const diff = Math.round(
      (new Date(todayStr).getTime() - new Date(msgStr).getTime()) / 86400000
    );
    if (diff < 1) return 'Today';
    if (diff < 2) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString('en-NZ', { timeZone: COMPANY_TZ, weekday: 'long' });
    return d.toLocaleDateString('en-NZ', { timeZone: COMPANY_TZ, day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

type ListItem =
  | { type: 'dateSep'; id: string; label: string }
  | { type: 'msg'; id: string; msg: ChatMessage };

function buildItems(msgs: ChatMessage[]): ListItem[] {
  const items: ListItem[] = [];
  let lastLabel = '';
  for (const msg of msgs) {
    const label = getDateLabel(msg.timestamp);
    if (label && label !== lastLabel) {
      items.push({ type: 'dateSep', id: `sep-${label}`, label });
      lastLabel = label;
    }
    items.push({ type: 'msg', id: msg.id, msg });
  }
  return items;
}

function MediaContent({ msg, isMe, colors }: { msg: ChatMessage; isMe: boolean; colors: any }) {
  if (!msg.mediaUrl) return null;
  if (msg.mediaType === 'image') {
    return (
      <Image
        source={{ uri: msg.mediaUrl }}
        style={styles.mediaImage}
        resizeMode="cover"
      />
    );
  }
  if (msg.mediaType === 'audio') {
    return (
      <View style={[styles.mediaAudio, { backgroundColor: isMe ? colors.primaryForeground + '22' : colors.border }]}>
        <Ionicons name="musical-notes" size={16} color={isMe ? colors.primaryForeground : colors.mutedForeground} />
        <Text style={[styles.mediaLabel, { color: isMe ? colors.primaryForeground : colors.mutedForeground }]}>
          Voice message
        </Text>
      </View>
    );
  }
  if (msg.mediaType === 'video') {
    return (
      <View style={[styles.mediaAudio, { backgroundColor: isMe ? colors.primaryForeground + '22' : colors.border }]}>
        <Ionicons name="videocam" size={16} color={isMe ? colors.primaryForeground : colors.mutedForeground} />
        <Text style={[styles.mediaLabel, { color: isMe ? colors.primaryForeground : colors.mutedForeground }]}>
          Video
        </Text>
      </View>
    );
  }
  return null;
}

function MessageBubble({
  msg, isMe, colors,
}: { msg: ChatMessage; isMe: boolean; colors: any }) {
  const d = new Date(msg.timestamp);
  const time = isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-NZ', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit' });

  return (
    <View style={[styles.bubbleWrapper, isMe ? styles.myWrapper : styles.theirWrapper]}>
      {!isMe && (
        <Text style={[styles.senderName, { color: colors.mutedForeground }]}>
          {msg.senderName ?? 'Dispatch'}
        </Text>
      )}
      <View style={[
        styles.bubble,
        isMe
          ? { backgroundColor: colors.primary }
          : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
        !!msg.mediaUrl && { padding: 4 },
      ]}>
        <MediaContent msg={msg} isMe={isMe} colors={colors} />
        {!!msg.body && (
          <Text style={[
            styles.bubbleText,
            { color: isMe ? colors.primaryForeground : colors.foreground },
            !!msg.mediaUrl && { marginTop: 6, paddingHorizontal: 10 },
          ]}>
            {msg.body}
          </Text>
        )}
      </View>
      <View style={[styles.metaRow, { justifyContent: isMe ? 'flex-end' : 'flex-start' }]}>
        <Text style={[styles.bubbleTime, { color: colors.mutedForeground }]}>{time}</Text>
        {isMe && (
          <Ionicons name="checkmark-done" size={13} color={colors.mutedForeground} style={{ marginLeft: 3 }} />
        )}
      </View>
    </View>
  );
}

function DateSeparator({ label, colors }: { label: string; colors: any }) {
  return (
    <View style={styles.dateSepRow}>
      <View style={[styles.dateSepLine, { backgroundColor: colors.border }]} />
      <View style={[styles.dateSepChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.dateSepText, { color: colors.mutedForeground }]}>{label}</Text>
      </View>
      <View style={[styles.dateSepLine, { backgroundColor: colors.border }]} />
    </View>
  );
}

export default function ChatThreadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    isConnected, currentJob, meterRunning,
  } = useDriver();
  // v12-ota16: fleet/zone moved to dedicated context — see home.tsx for rationale.
  const { myZoneInfo } = useDriverFleet();
  // v12-ota18: chat data in dedicated context — keeps Profile/SignOut still on chat msgs.
  const { chatThreads, sendChatMessage, quickReplies: firebaseQuickReplies } = useDriverChat();
  const { driver } = useAuth();

  // Base quick replies — Firebase first, then built-in fallback
  const baseQuickReplies = firebaseQuickReplies.length > 0 ? firebaseQuickReplies : QUICK_REPLIES_FALLBACK;

  // Job-aware context replies — prepended when there's an active current job
  const jobQuickReplies: string[] = (() => {
    if (!currentJob) return [];
    const vs = myZoneInfo?.vehicleStatus ?? '';
    if (meterRunning) {
      return ['Passenger aboard, en route', 'Almost at the destination', 'Dropping off now'];
    }
    if (vs === 'InDelivery' || vs === 'InTransit') {
      return ['Order picked up, on my way', 'Almost at delivery address', 'Delivered — returning'];
    }
    if (vs === 'Arrived') {
      return ["I've arrived at pickup", 'Waiting at pickup — please come out', 'ETA at pickup: here now'];
    }
    // On the way
    return ['On my way to pickup', 'Running a few minutes late', 'ETA 5 minutes'];
  })();

  const quickReplies = jobQuickReplies.length > 0
    ? [...jobQuickReplies, ...baseQuickReplies]
    : baseQuickReplies;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ListItem>>(null);

  const botPad = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16);

  const thread = chatThreads.find(t => t.id === id) ?? (
    id === 'thread-dispatch'
      ? {
          id: 'thread-dispatch',
          contactName: 'Dispatch Control',
          contactType: 'dispatcher' as const,
          lastMessage: '',
          lastTime: new Date().toISOString(),
          unread: 0,
          messages: [],
        }
      : null
  );

  const sortedMessages = thread
    ? [...thread.messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    : [];

  const listItems = buildItems(sortedMessages);

  useEffect(() => {
    if (sortedMessages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [sortedMessages.length]);

  if (!thread) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="chatbubbles-outline" size={36} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 12, fontFamily: 'Inter_400Regular' }}>
          Conversation not found
        </Text>
        <TouchableOpacity style={{ marginTop: 24 }} onPress={() => router.back()}>
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleSend = async (override?: string) => {
    const msg = (override ?? text).trim();
    if (!msg || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setText('');
    setSending(true);
    try {
      await sendChatMessage(thread.id, msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ── Header ── */}
      <View style={[styles.topBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>

        <View style={[styles.contactAvatar, {
          backgroundColor: thread.contactType === 'dispatcher' ? colors.primary + '22' : colors.info + '22',
        }]}>
          <Ionicons
            name={thread.contactType === 'dispatcher' ? 'radio' : 'person'}
            size={20}
            color={thread.contactType === 'dispatcher' ? colors.primary : colors.info}
          />
        </View>

        <View style={styles.contactInfo}>
          <Text style={[styles.contactName, { color: colors.foreground }]}>{thread.contactName}</Text>
          <View style={styles.contactMeta}>
            <View style={[styles.connDot, { backgroundColor: isConnected ? colors.success : colors.mutedForeground }]} />
            <Text style={[styles.contactSub, { color: isConnected ? colors.success : colors.mutedForeground }]}>
              {isConnected
                ? `Live · Connected${driver?.vehicleId ? ` · ${driver.vehicleId}` : ''}`
                : 'Offline — messages may not send'}
            </Text>
          </View>
        </View>

        {/* Message count pill */}
        {sortedMessages.length > 0 && (
          <View style={[styles.msgCountPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.msgCountText, { color: colors.mutedForeground }]}>
              {sortedMessages.length}
            </Text>
          </View>
        )}
      </View>

      {/* ── Active job context banner (inside thread) ── */}
      {currentJob && (
        <TouchableOpacity
          style={[styles.jobBanner, {
            backgroundColor: meterRunning ? '#ef444412' : colors.primary + '12',
            borderBottomColor: meterRunning ? '#ef444433' : colors.primary + '33',
          }]}
          onPress={() => router.push(`/job/${currentJob.id}`)}
          activeOpacity={0.75}
        >
          <View style={[styles.jobBannerDot, {
            backgroundColor: meterRunning ? '#ef4444' : colors.primary,
          }]} />
          <Ionicons
            name={meterRunning ? 'speedometer' : 'navigate'}
            size={13}
            color={meterRunning ? '#ef4444' : colors.primary}
          />
          <Text style={[styles.jobBannerText, { color: meterRunning ? '#ef4444' : colors.primary }]} numberOfLines={1}>
            {meterRunning
              ? `Meter running · ${currentJob.pickupAddress || 'Active trip'}`
              : `Active job · ${(() => {
                  const vs = myZoneInfo?.vehicleStatus ?? '';
                  if (vs === 'Arrived') return 'Arrived at pickup';
                  if (vs === 'InDelivery' || vs === 'InTransit') return 'In delivery';
                  return 'On my way';
                })()} · ${currentJob.pickupAddress || ''}`
            }
          </Text>
          <Ionicons name="chevron-forward" size={13} color={meterRunning ? '#ef4444' : colors.primary} />
        </TouchableOpacity>
      )}

      {/* ── Messages ── */}
      <FlatList
        ref={listRef}
        data={listItems}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          if (item.type === 'dateSep') {
            return <DateSeparator label={item.label} colors={colors} />;
          }
          return (
            <MessageBubble
              msg={item.msg}
              isMe={item.msg.senderId === driver?.id}
              colors={colors}
            />
          );
        }}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 8,
          flexGrow: 1,
          justifyContent: listItems.length === 0 ? 'center' : 'flex-start',
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="chatbubbles-outline" size={36} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Quick tap to send a message to Dispatch
            </Text>
            <View style={styles.quickList}>
              {quickReplies.slice(0, 3).map(qr => (
                <TouchableOpacity
                  key={qr}
                  style={[styles.quickChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => handleSend(qr)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickChipText, { color: colors.foreground }]}>{qr}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
      />

      {/* ── Quick replies strip (visible when there's no text) ── */}
      {sortedMessages.length > 0 && !text.trim() && (
        <View style={[styles.quickBar, { borderTopColor: colors.border }]}>
          <FlatList
            data={quickReplies}
            keyExtractor={q => q}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}
            renderItem={({ item: qr }) => (
              <TouchableOpacity
                style={[styles.quickBarChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => handleSend(qr)}
                activeOpacity={0.7}
              >
                <Text style={[styles.quickBarText, { color: colors.foreground }]}>{qr}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* ── Input bar ── */}
      <View style={[
        styles.inputBar,
        { borderTopColor: colors.border, backgroundColor: colors.card, paddingBottom: botPad + 4 },
      ]}>
        <TextInput
          style={[styles.input, {
            color: colors.foreground,
            backgroundColor: colors.surface,
            borderColor: colors.border,
          }]}
          placeholder="Message Dispatch..."
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={500}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => handleSend()}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: (text.trim() && !sending) ? colors.primary : colors.surface },
          ]}
          onPress={() => handleSend()}
          disabled={!text.trim() || sending}
          activeOpacity={0.8}
        >
          <Ionicons
            name={sending ? 'hourglass' : 'send'}
            size={18}
            color={(text.trim() && !sending) ? colors.primaryForeground : colors.mutedForeground}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  backBtn: { padding: 4 },
  contactAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  contactMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  contactSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  bubbleWrapper: { marginBottom: 10, maxWidth: '80%' },
  myWrapper: { alignSelf: 'flex-end' },
  theirWrapper: { alignSelf: 'flex-start' },
  senderName: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 3, marginLeft: 4 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, marginHorizontal: 4 },
  bubbleTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  dateSepRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12, paddingHorizontal: 4 },
  dateSepLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dateSepChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, marginHorizontal: 10,
  },
  dateSepText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 240 },
  quickList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 },
  quickChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  quickChipText: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  quickBar: { borderTopWidth: StyleSheet.hairlineWidth },
  quickBarChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1,
  },
  quickBarText: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  input: {
    flex: 1, borderRadius: 22, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, fontFamily: 'Inter_400Regular', maxHeight: 120, minHeight: 44,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  mediaImage: { width: 220, height: 160, borderRadius: 12 },
  mediaAudio: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  mediaLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  msgCountPill: {
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, borderWidth: 1,
  },
  msgCountText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  jobBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  jobBannerDot: { width: 6, height: 6, borderRadius: 3 },
  jobBannerText: {
    flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.1,
  },
});
