import { Colors } from '@/constants/theme';
import { Tariff } from '@/types';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  tariffs: Tariff[];
  selected: Tariff;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (t: Tariff) => void;
};

export function TariffPicker({ tariffs, selected, open, onOpen, onClose, onSelect }: Props) {
  return (
    <>
      <Pressable style={styles.dropdown} onPress={onOpen}>
        <Text style={styles.name}>{selected.name}</Text>
        <Text style={styles.rates}>
          ${selected.flagFall.toFixed(2)} flag · ${selected.ratePerKm.toFixed(2)}/km · $
          {selected.waitingPerMin.toFixed(2)}/min wait
        </Text>
        <Text style={styles.chevron}>▼</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={onClose}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Select tariff</Text>
            <ScrollView style={styles.list}>
              {tariffs.map((t) => (
                <Pressable
                  key={t.id}
                  style={[styles.option, t.id === selected.id && styles.optionActive]}
                  onPress={() => {
                    onSelect(t);
                    onClose();
                  }}
                >
                  <Text style={styles.optionName}>{t.name}</Text>
                  <Text style={styles.optionRates}>
                    ${t.flagFall.toFixed(2)} + ${t.ratePerKm.toFixed(2)}/km + ${t.waitingPerMin.toFixed(2)}/min
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  name: { color: Colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  rates: { color: Colors.textMuted, fontSize: 12, flexBasis: '100%' },
  chevron: { color: Colors.accent, fontSize: 12, marginLeft: 8 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '50%',
  },
  sheetTitle: { color: Colors.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  list: { maxHeight: 280 },
  option: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionActive: { borderColor: Colors.accent },
  optionName: { color: Colors.text, fontWeight: '700' },
  optionRates: { color: Colors.textMuted, fontSize: 13, marginTop: 4 },
});
