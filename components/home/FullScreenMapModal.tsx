import JobMap from '@/components/JobMap';
import { MeterOverlay } from '@/components/home/MeterOverlay';
import { Colors } from '@/constants/theme';
import { ActiveJob, MeterState } from '@/types';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  onClose: () => void;
  activeJob: ActiveJob | null;
  meter: MeterState | null;
  showMeter: boolean;
  showRoute: boolean;
  showsUserLocation: boolean;
  onPause: () => void;
};

export function FullScreenMapModal({
  visible,
  onClose,
  activeJob,
  meter,
  showMeter,
  showRoute,
  showsUserLocation,
  onPause,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={styles.root}>
        <JobMap
          pickupLat={activeJob?.pickupLat}
          pickupLng={activeJob?.pickupLng}
          dropoffLat={activeJob?.dropoffLat}
          dropoffLng={activeJob?.dropoffLng}
          showRoute={showRoute}
          showsUserLocation={showsUserLocation}
        />

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close map">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {showMeter && meter ? (
          <View style={[styles.meterWrap, { paddingBottom: insets.bottom + 8 }]}>
            <MeterOverlay meter={meter} onPause={onPause} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  closeText: { color: Colors.text, fontSize: 20, fontWeight: '700' },
  meterWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});
