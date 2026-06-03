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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Select your vehicle</Text>
          <Text style={styles.subtitle}>You will go online on dispatch as soon as you confirm.</Text>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {vehicles.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => onSelect(v.id)}
                style={[styles.row, selectedId === v.id && styles.rowSelected]}
              >
                <View>
                  <Text style={styles.number}>{v.number}</Text>
                  <Text style={styles.type}>{v.vehicleType}</Text>
                </View>
                <Text style={styles.idHint}>{v.id}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Button
            title={loading ? 'Starting…' : 'Start Shift & Go Online'}
            onPress={onConfirm}
            disabled={!selectedId || loading}
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
  number: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  type: { color: Colors.accent, fontSize: 15, fontWeight: '600', marginTop: 2 },
  idHint: { color: Colors.textMuted, fontSize: 12 },
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { color: Colors.textMuted, fontSize: 15 },
});
