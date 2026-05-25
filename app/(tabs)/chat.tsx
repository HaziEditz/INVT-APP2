import React, { useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Platform, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useDriver, useDriverChat } from '@/context/DriverContext';
import { useAuth } from '@/context/AuthContext';
import { fmtTodayHeading } from '@/lib/timezone';
import { ChatListItem } from '@/components/ChatListItem';

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isConnected, currentJob } = useDriver();
  const { chatThreads } = useDriverChat();
  const { driver } = useAuth();
  const totalUnread = chatThreads.reduce((n, t) => n + t.unread, 0);

  // Always ensure the Dispatch thread exists in the list
  const dispatchExists = chatThreads.some(t => t.id === 'thread-dispatch');
  const threads = dispatchExists
    ? chatThreads
    : [
        {
          id: 'thread-dispatch',
          contactName: 'Dispatch Control',
          contactType: 'dispatcher' as const,
          lastMessage: 'Tap to send a message to dispatch',
          lastTime: new Date().toISOString(),
          unread: 0,
          messages: [],
        },
        ...chatThreads,
      ];

  // Pulse animation for connection dot
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isConnected) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.6, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isConnected]);

  const todayStr = fmtTodayHeading();

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: 16 }]}>
        <View style={styles.headerLeft}>
          <View>
            <Text style={[styles.heading, { color: colors.foreground }]}>Messages</Text>
            <Text style={[styles.headingSub, { color: colors.mutedForeground }]}>{todayStr}</Text>
          </View>
          {totalUnread > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.unreadBadgeText, { color: colors.primaryForeground }]}>
                {totalUnread}
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.composeBtn, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}
          onPress={() => router.push('/chat/thread-dispatch')}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={18} color={colors.primary} />
          <Text style={[styles.composeTxt, { color: colors.primary }]}>Dispatch</Text>
        </TouchableOpacity>
      </View>

      {/* ── Connection strip ── */}
      <View style={[styles.connStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.connLeft}>
          <Animated.View
            style={[
              styles.connPulseRing,
              {
                borderColor: isConnected ? colors.success + '55' : 'transparent',
                transform: [{ scale: pulse }],
              },
            ]}
          />
          <View style={[styles.connDot, { backgroundColor: isConnected ? colors.success : colors.mutedForeground }]} />
        </View>
        <Text style={[styles.connText, { color: isConnected ? colors.success : colors.mutedForeground }]}>
          {isConnected ? 'Live · Connected to Dispatch' : 'Offline — messages may not send'}
        </Text>
        <Ionicons
          name={isConnected ? 'radio-outline' : 'cloud-offline-outline'}
          size={15}
          color={isConnected ? colors.success : colors.mutedForeground}
        />
      </View>

      {/* ── Active job context banner ── */}
      {currentJob && (
        <TouchableOpacity
          style={[styles.activeJobBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '44' }]}
          onPress={() => router.push(`/job/${currentJob.id}`)}
          activeOpacity={0.8}
        >
          <View style={[styles.activeJobIconWrap, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="navigate" size={14} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.activeJobLabel, { color: colors.primary }]}>ACTIVE JOB IN PROGRESS</Text>
            <Text style={[styles.activeJobAddr, { color: colors.foreground }]} numberOfLines={1}>
              {currentJob.pickupAddress || currentJob.passengerName || 'Job in progress'}
              {currentJob.dropAddress ? ` → ${currentJob.dropAddress}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={15} color={colors.primary} />
        </TouchableOpacity>
      )}

      {/* ── Conversations label ── */}
      {threads.length > 0 && (
        <View style={[styles.convHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.convLabel, { color: colors.mutedForeground }]}>CONVERSATIONS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {totalUnread === 0 && (
              <View style={[styles.allReadPill, { backgroundColor: colors.success + '18', borderColor: colors.success + '44' }]}>
                <Ionicons name="checkmark-circle" size={11} color={colors.success} />
                <Text style={[styles.allReadText, { color: colors.success }]}>All read</Text>
              </View>
            )}
            <View style={[styles.convCount, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.convCountText, { color: colors.mutedForeground }]}>{threads.length}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Thread list ── */}
      <FlatList
        data={threads}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <View style={index === 0 && item.contactType === 'dispatcher' ? styles.pinnedWrapper : undefined}>
            {index === 0 && item.contactType === 'dispatcher' && (
              <View style={[styles.pinnedLabel, { backgroundColor: colors.primary + '18' }]}>
                <Ionicons name="pin" size={11} color={colors.primary} />
                <Text style={[styles.pinnedText, { color: colors.primary }]}>PINNED · DISPATCH</Text>
              </View>
            )}
            {index === 1 && threads[0]?.contactType === 'dispatcher' && (
              <View style={[styles.sectionDivider, { backgroundColor: colors.surface }]}>
                <Text style={[styles.sectionDividerText, { color: colors.mutedForeground }]}>OTHER CONVERSATIONS</Text>
              </View>
            )}
            <ChatListItem
              thread={item}
              onPress={() => router.push(`/chat/${item.id}`)}
              isMe={
                item.messages.length > 0 &&
                !!driver?.id &&
                item.messages[item.messages.length - 1].senderId === driver.id
              }
            />
          </View>
        )}
        contentContainerStyle={threads.length === 0 ? styles.emptyContainer : undefined}
        style={{ flex: 1 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIconStack, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="radio-outline" size={36} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Messages Yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Send a message to Dispatch Control. They can see your messages in real time.
            </Text>
            <TouchableOpacity
              style={[styles.emptyCta, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/chat/thread-dispatch')}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primaryForeground} />
              <Text style={[styles.emptyCtaText, { color: colors.primaryForeground }]}>Message Dispatch</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <View style={{ height: Platform.OS === 'web' ? 0 : insets.bottom }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { fontSize: 28, fontWeight: '800', fontFamily: 'Inter_700Bold' },
  headingSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  unreadBadge: {
    minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  composeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7,
  },
  composeTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  connStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  connLeft: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  connPulseRing: {
    position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 2,
  },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  pinnedWrapper: {},
  pinnedLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  pinnedText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 },

  sectionDivider: {
    paddingHorizontal: 16, paddingVertical: 6,
  },
  sectionDividerText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2 },

  emptyContainer: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16, paddingVertical: 60 },
  emptyIconStack: {
    width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 24, paddingVertical: 13, borderRadius: 14, marginTop: 8,
  },
  emptyCtaText: { fontSize: 15, fontFamily: 'Inter_700Bold' },

  convHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  convLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.4 },
  convCount: {
    minWidth: 20, height: 20, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  convCountText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  allReadPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1,
  },
  allReadText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  activeJobBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  activeJobIconWrap: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  activeJobLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginBottom: 2 },
  activeJobAddr: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
