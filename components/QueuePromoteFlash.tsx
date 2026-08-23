import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

/** Non-modal attention cue when a queued job is auto-adopted after trip complete. */
export function QueuePromoteFlash() {
  const { queuePromoteFlash } = useDriver();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!queuePromoteFlash) {
      opacity.setValue(0);
      return;
    }
    opacity.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(opacity, { toValue: 0.55, duration: 90, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.15, duration: 160, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.5, duration: 120, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [queuePromoteFlash, opacity]);

  if (!queuePromoteFlash) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Animated.View
        style={[styles.flash, { opacity }]}
        accessibilityLabel="Queued job promoted"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.accent,
    zIndex: 9999,
  },
});
