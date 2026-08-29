import { Colors } from '@/constants/theme';
import { IdleHailButton } from '@/components/home/IdleHailButton';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Idle Current tab — message + HAIL PASSENGER in one content-sized block.
 * Rendered from index.tsx instead of flex:1 CurrentTripPanel empty state so the
 * button is never lost inside a collapsing flex panel (see IDLE HAIL comments there).
 */
export function IdleCurrentSection() {
  return (
    <View style={styles.wrap}>
      <View style={styles.message}>
        <Text style={styles.title}>No active trip.</Text>
        <Text style={styles.sub}>
          Tap HAIL PASSENGER for street pickups, or accept an offer from the Offers tab.
        </Text>
      </View>
      <IdleHailButton />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    flexShrink: 1,
    minHeight: 160,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  message: {
    gap: 8,
  },
  title: {
    color: Colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
