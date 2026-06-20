import { Colors } from '@/constants/theme';
import { useDriver, type DriverInAppBannerState } from '@/context/DriverContext';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function bannerTitle(banner: DriverInAppBannerState): string {
  return banner.kind === 'chat' ? 'Message from dispatch' : 'Driver emergency nearby';
}

export function DriverInAppBanner() {
  const { inAppBanner, dismissInAppBanner } = useDriver();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (!inAppBanner) return null;

  const onOpen = () => {
    dismissInAppBanner();
    if (inAppBanner.kind === 'chat') {
      router.push('/(tabs)/chat');
    }
  };

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View style={[styles.card, inAppBanner.kind === 'sos' && styles.cardSos]}>
        <Pressable
          style={styles.body}
          onPress={inAppBanner.kind === 'chat' ? onOpen : undefined}
          accessibilityRole="button"
          accessibilityLabel={inAppBanner.kind === 'chat' ? 'Open chat' : undefined}
        >
          <Text style={styles.title}>{bannerTitle(inAppBanner)}</Text>
          <Text style={styles.message} numberOfLines={3}>
            {inAppBanner.message}
          </Text>
          {inAppBanner.kind === 'chat' ? (
            <Text style={styles.hint}>Tap to open chat</Text>
          ) : null}
        </Pressable>
        <Pressable
          style={styles.closeBtn}
          onPress={dismissInAppBanner}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    overflow: 'hidden',
  },
  cardSos: {
    borderColor: '#e53935',
    backgroundColor: '#2a1515',
  },
  body: {
    flex: 1,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
  },
  title: {
    color: Colors.text,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  message: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  hint: {
    marginTop: 6,
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
  },
  closeText: {
    color: Colors.textMuted,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 20,
  },
});
