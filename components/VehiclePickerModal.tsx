import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { Vehicle } from '@/types';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  vehicles: Vehicle[];
  selectedId: string;
  loading?: boolean;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

export function VehiclePickerModal({
  visible,
  vehicles,
  selectedId,
  loading,
  onSelect,
  onConfirm,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const selectable = vehicles.filter((v) => !v.inUseByOther);
  const selectedVehicle = vehicles.find((v) => v.id === selectedId);
  const confirmDisabled =
    !selectedId || loading || !!selectedVehicle?.inUseByOther || selectable.length === 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Select your vehicle</Text>
          <Text style={styles.subtitle}>You will go online on dispatch as soon as you confirm.</Text>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {vehicles.length === 0 ? (
              <Text style={styles.empty}>No vehicles assigned to your account.</Text>
            ) : null}
            {vehicles.map((v) => {
              const locked = !!v.inUseByOther;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => {
                    if (!locked) onSelect(v.id);
                  }}
                  disabled={locked}
                  style={[
                    styles.row,
                    selectedId === v.id && !locked && styles.rowSelected,
                    locked && styles.rowLocked,
                  ]}
                >
                  <View style={styles.rowMain}>
                    <Text style={[styles.number, locked && styles.textMuted]}>{v.number}</Text>
                    <Text style={[styles.type, locked && styles.typeMuted]}>
                      {v.bodyType} · {v.vehicleType}
                    </Text>
                    {locked ? (
                      <Text style={styles.inUseLabel}>
                        In use{v.inUseDriverLabel ? ` · ${v.inUseDriverLabel}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.idHint, locked && styles.textMuted]}>{v.id}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {selectable.length === 0 && vehicles.length > 0 ? (
            <Text style={styles.allBusy}>
              All assigned vehicles are currently on shift with another driver. End the other shift
              or contact dispatch.
            </Text>
          ) : null}

          <Button
            title={loading ? 'Starting…' : 'Start Shift & Go Online'}
            onPress={onConfirm}
            disabled={confirmDisabled}
          />
          <Pressable onPress={onClose} style={styles.cancelBtn} disabled={loading}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          {loading ? <ActivityIndicator color={Colors.accent} style={{ marginTop: 8 }} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: { color: Colors.text, fontSize: 20, fontWeight: '700' },
  subtitle: { color: Colors.textMuted, fontSize: 14, marginTop: 6, marginBottom: 16 },
  list: { maxHeight: 320, marginBottom: 16 },
  empty: { color: Colors.textMuted, fontSize: 15, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8,
  },
  rowSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent + '18' },
  rowLocked: { opacity: 0.72, backgroundColor: Colors.surfaceElevated },
  rowMain: { flex: 1, paddingRight: 8 },
  number: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  type: { color: Colors.accent, fontSize: 15, fontWeight: '600', marginTop: 2 },
  typeMuted: { color: Colors.textMuted },
  inUseLabel: { color: Colors.warning, fontSize: 13, fontWeight: '600', marginTop: 6 },
  idHint: { color: Colors.textMuted, fontSize: 12 },
  textMuted: { color: Colors.textMuted },
  allBusy: {
    color: Colors.warning,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    textAlign: 'center',
  },
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { color: Colors.textMuted, fontSize: 15 },
});
