import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDriver, useDriverSync } from '@/context/DriverContext';

/**
 * v12-ota22k: 4-state banner.
 *   - 'offline'     → red,    "No Signal — Offline Mode"
 *   - 'syncing'     → green,  "Back Online — Syncing… (N items)"  pulsing
 *   - 'reconnected' → green,  "Back Online — All synced ✓"        auto-hides 3s
 *   - 'hidden'      → not visible
 *
 * Driver feedback (22j review): "once it stays offline it stays offline,
 * doesn't say back online green signal". Now we always flash a 3-second
 * "Back Online" confirmation when connectivity is restored — even if there
 * was nothing to sync. So the driver always knows they're reconnected.
 */
export function OfflineBanner() {
  const { isConnected } = useDriver();
  const { isOnline, isSyncing, pendingQueueCount } = useDriverSync();
  const insets = useSafeAreaInsets();

  // Truth = both layers agree. expo-network can lie on Android — Firebase
  // .info/connected is the real test of "can I write to the server right now".
  const trulyOffline = !isOnline && !isConnected;

  // Track state transitions to detect offline → online edge for the flash
  const wasOfflineRef = useRef(trulyOffline);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showReconnect, setShowReconnect] = useState(false);

  useEffect(() => {
    if (wasOfflineRef.current && !trulyOffline) {
      // Just transitioned offline → online. Show "Back Online" flash for 3s.
      setShowReconnect(true);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => setShowReconnect(false), 3000);
    }
    wasOfflineRef.current = trulyOffline;
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [trulyOffline]);

  // While syncing, suppress the standalone "reconnected" flash — the syncing
  // banner is more informative (shows item count) and itself confirms we're back.
  const effectiveReconnect = showReconnect && !isSyncing && !trulyOffline;

  // Decide which mode is active. Order matters: offline > syncing > reconnect.
  const mode: 'offline' | 'syncing' | 'reconnected' | 'hidden' =
    trulyOffline      ? 'offline'
    : isSyncing       ? 'syncing'
    : effectiveReconnect ? 'reconnected'
    : 'hidden';

  const visible = mode !== 'hidden';

  const slideAnim    = useRef(new Animated.Value(-80)).current;
  const opacityAnim  = useRef(new Animated.Value(0)).current;
  const syncFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim,   { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(slideAnim,   { toValue: -80, useNativeDriver: true, tension: 80, friction: 12 }),
        Animated.timing(opacityAnim, { toValue: 0,   duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  // Pulse the sync icon while syncing
  useEffect(() => {
    if (mode !== 'syncing') { syncFadeAnim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(syncFadeAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(syncFadeAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [mode]);

  const bg =
    mode === 'offline'     ? '#dc2626' :  // red
    mode === 'syncing'     ? '#16a34a' :  // green pulsing
    mode === 'reconnected' ? '#16a34a' :  // green solid
                             '#16a34a';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          top: insets.top,
          backgroundColor: bg,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <View style={styles.inner}>
        {mode === 'offline' && (
          <>
            <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
            <Text style={styles.text}>No Signal — Offline Mode</Text>
            <View style={styles.dot} />
            <Text style={styles.sub}>Actions saved locally</Text>
          </>
        )}
        {mode === 'syncing' && (
          <>
            <Animated.View style={{ opacity: syncFadeAnim }}>
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
            </Animated.View>
            <Text style={styles.text}>
              Back Online — Syncing{pendingQueueCount > 0 ? ` (${pendingQueueCount} items)` : ''}…
            </Text>
          </>
        )}
        {mode === 'reconnected' && (
          <>
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
            <Text style={styles.text}>Back Online ✓</Text>
            <Text style={styles.sub}>All set</Text>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 12,
    boxShadow: '0px 3px 6px rgba(0,0,0,0.25)',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 7,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
  },
  sub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
});
