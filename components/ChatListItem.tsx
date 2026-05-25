import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ChatThread } from '@/context/DriverContext';
import { COMPANY_TZ } from '@/lib/timezone';

interface Props {
  thread: ChatThread;
  onPress: () => void;
  isMe?: boolean;
}

function smartTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = diffMs / 60000;
    if (diffMins < 2) return 'Just now';
    if (diffMins < 60) return `${Math.floor(diffMins)}m ago`;
    // Compare calendar dates in company timezone so "Yesterday"/weekday labels
    // are correct for NZ drivers regardless of device timezone.
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: COMPANY_TZ });
    const msgStr   = d.toLocaleDateString('en-CA', { timeZone: COMPANY_TZ });
    const todayStart = new Date(todayStr).getTime();
    const msgStart   = new Date(msgStr).getTime();
    if (msgStart >= todayStart)
      return d.toLocaleTimeString('en-NZ', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit' });
    if (todayStart - msgStart <= 86400000) return 'Yesterday';
    if (todayStart - msgStart <= 6 * 86400000)
      return d.toLocaleDateString('en-NZ', { timeZone: COMPANY_TZ, weekday: 'short' });
    return d.toLocaleDateString('en-NZ', { timeZone: COMPANY_TZ, day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function ChatListItem({ thread, onPress, isMe }: Props) {
  const colors = useColors();
  const hasUnread = thread.unread > 0;
  const badgeCount = thread.unread > 99 ? '99+' : String(thread.unread);
  const timeStr = smartTime(thread.lastTime);
  const isDispatch = thread.contactType === 'dispatcher';

  const resolvedIsMe = isMe ?? false;
  const previewText = thread.lastMessage;
  const previewPrefix = resolvedIsMe ? 'You: ' : '';

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { borderBottomColor: colors.border },
        hasUnread && { backgroundColor: colors.primary + '06' },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Unread left accent bar */}
      {hasUnread && (
        <View style={[styles.accentBar, { backgroundColor: colors.primary }]} />
      )}

      {/* Avatar */}
      <View style={[
        styles.avatar,
        {
          backgroundColor: isDispatch
            ? colors.primary + '22'
            : colors.info + '22',
          borderWidth: hasUnread ? 1.5 : 0,
          borderColor: isDispatch
            ? colors.primary + '55'
            : colors.info + '55',
        },
      ]}>
        <Ionicons
          name={isDispatch ? 'radio' : 'person'}
          size={22}
          color={isDispatch ? colors.primary : colors.info}
        />
        {isDispatch && (
          <View style={[styles.dispatchDot, { backgroundColor: colors.success }]} />
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.name,
                {
                  color: colors.foreground,
                  fontFamily: hasUnread ? 'Inter_700Bold' : 'Inter_600SemiBold',
                },
              ]}
              numberOfLines={1}
            >
              {thread.contactName}
            </Text>
            {isDispatch && (
              <View style={[styles.dispatchBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.dispatchBadgeText, { color: colors.primary }]}>DISPATCH</Text>
              </View>
            )}
          </View>
          <Text style={[
            styles.time,
            { color: hasUnread ? colors.primary : colors.mutedForeground },
            hasUnread && { fontFamily: 'Inter_600SemiBold' },
          ]}>
            {timeStr}
          </Text>
        </View>

        <View style={styles.bottomRow}>
          {isMe && !hasUnread && (
            <Ionicons name="checkmark-done" size={13} color={colors.mutedForeground} style={{ marginRight: 3 }} />
          )}
          <Text
            style={[
              styles.preview,
              {
                color: hasUnread ? colors.foreground : colors.mutedForeground,
                fontFamily: hasUnread ? 'Inter_500Medium' : 'Inter_400Regular',
              },
            ]}
            numberOfLines={1}
          >
            {previewPrefix}{previewText}
          </Text>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>{badgeCount}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', paddingVertical: 14, paddingRight: 16,
    alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accentBar: {
    width: 3, alignSelf: 'stretch', borderRadius: 2, marginRight: 13, marginLeft: 0,
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center', marginLeft: 16,
  },
  dispatchDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 1.5, borderColor: 'white',
  },
  content: { flex: 1, marginLeft: 12 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 8 },
  name: { fontSize: 15 },
  dispatchBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  dispatchBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.8 },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular', flexShrink: 0 },
  bottomRow: { flexDirection: 'row', alignItems: 'center' },
  preview: { fontSize: 13, flex: 1 },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 8, paddingHorizontal: 5,
  },
  badgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
});
