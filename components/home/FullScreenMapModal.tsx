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
  onPause: () => void;
  onWait: () => void;
};

export function FullScreenMapModal({
  visible,
  onClose,
  activeJob,
  meter,
  showMeter,
  onPause,
  onWait,
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
          showRoute={!!activeJob}
        />

        <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          {showMeter && meter ? (
            <View style={styles.topMeter}>
              <Text style={styles.fare}>${meter.fare.toFixed(2)}</Text>
              <Text style={styles.time}>
                {Math.floor((Date.now() - meter.startedAt) / 60000)}m trip
              </Text>
            </View>
          ) : activeJob ? (
            <View style={styles.topMeter}>
              <Text style={styles.fare}>${(activeJob.fare ?? 0).toFixed(2)}</Text>
              <Text style={styles.time}>{activeJob.durationMin} min</Text>
            </View>
          ) : null}
        </View>

        {showMeter && meter ? (
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.dist}>{meter.distanceKm.toFixed(2)} km</Text>
            <View style={styles.bottomControls}>
              <Pressable style={styles.ctrl} onPress={onPause}>
                <Text style={styles.ctrlText}>{meter.paused ? 'Resume' : 'Pause'}</Text>
              </Pressable>
              <Pressable style={[styles.ctrl, meter.waiting && styles.ctrlWait]} onPress={onWait}>
                <Text style={styles.ctrlText}>{meter.waiting ? 'End Wait' : 'Wait'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 12,
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
  topMeter: {
    flex: 1,
    backgroundColor: Colors.surface + 'DD',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fare: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  time: { color: Colors.textMuted, fontSize: 14 },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface + 'EE',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  dist: { color: Colors.text, fontSize: 22, fontWeight: '700', marginBottom: 10 },
  bottomControls: { flexDirection: 'row', gap: 10 },
  ctrl: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ctrlWait: { borderColor: Colors.accent },
  ctrlText: { color: Colors.text, fontWeight: '700' },
});
