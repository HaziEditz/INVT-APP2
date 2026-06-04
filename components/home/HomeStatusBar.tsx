import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { PresenceDisplayStatus } from '@/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  onOffersPress?: () => void;
};

export function HomeStatusBar({ onOffersPress }: Props) {
  const insets = useSafeAreaInsets();
  const {
    presenceStatus,
    shiftActive,
    selectedVehicleId,
    vehicles,
    offersBadgeCount,
    nextQueuedOffer,
    togglePresence,
  } = useDriver();

  const isOnline = presenceStatus === 'Online' && shiftActive;
  const isAway = presenceStatus === 'Away' && shiftActive;

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Pressable
        style={[styles.toggle, isOnline ? styles.toggleOn : isAway ? styles.toggleAway : styles.toggleOff]}
        onPress={shiftActive ? togglePresence : undefined}
        disabled={!shiftActive}
      >
        <Text style={styles.toggleText}>
          {shiftActive ? (isOnline ? 'Available' : isAway ? 'Away' : 'Available') : 'Away'}
        </Text>
        {shiftActive ? <Text style={styles.toggleHint}>tap</Text> : null}
      </Pressable>

      {offersBadgeCount > 0 && onOffersPress ? (
        <Pressable style={styles.offerPill} onPress={onOffersPress}>
          <Text style={styles.offerPillText}>Offers {offersBadgeCount}</Text>
        </Pressable>
      ) : (
        <View style={styles.offerPillMuted}>
          <Text style={styles.offerPillMutedText}>No offers</Text>
        </View>
      )}

      {nextQueuedOffer ? (
        <View style={styles.nextWrap}>
          <Text style={styles.nextLabel}>Next</Text>
          <Text style={styles.nextValue} numberOfLines={1}>
            {nextQueuedOffer.type}: {nextQueuedOffer.pickup}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  toggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 88,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: Colors.success },
  toggleAway: { backgroundColor: Colors.warning },
  toggleOff: { backgroundColor: Colors.textMuted },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  toggleHint: { color: 'rgba(255,255,255,0.8)', fontSize: 10 },
  offerPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: Colors.danger,
  },
  offerPillText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  offerPillMuted: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  offerPillMutedText: { color: Colors.textMuted, fontSize: 14 },
  nextWrap: { flex: 1, minWidth: 80 },
  nextLabel: { color: Colors.textMuted, fontSize: 11, textTransform: 'uppercase' },
  nextValue: { color: Colors.text, fontSize: 13, fontWeight: '600' },
});
