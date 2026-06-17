import { Colors } from '@/constants/theme';
import { Tariff } from '@/types';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  tariffs: Tariff[];
  selected: Tariff;
  open: boolean;
  locked?: boolean;
  compact?: boolean;
  /** Flush inline strip under compact map (no outer margins / card chrome). */
  strip?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (t: Tariff) => void;
};

export function TariffPicker({ tariffs, selected, open, locked, compact, strip, onOpen, onClose, onSelect }: Props) {
  const hasTariffs = tariffs.length > 0;
  const canOpen = hasTariffs && !locked;

  return (
    <>
      <Pressable
        style={[
          styles.dropdown,
          compact && styles.dropdownCompact,
          strip && styles.dropdownStrip,
          strip && styles.dropdownStripRow,
        ]}
        onPress={canOpen ? onOpen : undefined}
        disabled={!canOpen}
      >
        <Text style={[styles.name, compact && styles.nameCompact, strip && styles.nameStrip]} numberOfLines={1}>
          {selected.name}
        </Text>
        {!compact ? (
          hasTariffs ? (
            <Text style={styles.rates}>
              ${selected.flagFall.toFixed(2)} flag · ${selected.ratePerKm.toFixed(2)}/km · $
              {selected.waitingPerMin.toFixed(2)}/min wait
            </Text>
          ) : (
            <Text style={styles.rates}>Configure tariffs in Firebase for your company</Text>
          )
        ) : hasTariffs ? (
          <Text style={styles.ratesCompact}>
            ${selected.flagFall.toFixed(2)} + ${selected.ratePerKm.toFixed(2)}/km
          </Text>
        ) : null}
        {locked ? <Text style={styles.locked}>Locked</Text> : null}
        {canOpen ? <Text style={styles.chevron}>▼</Text> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={onClose}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Select tariff</Text>
            <ScrollView style={styles.list}>
              {tariffs.length === 0 ? (
                <Text style={styles.empty}>No tariff configured</Text>
              ) : null}
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
  dropdownCompact: {
    marginVertical: 0,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  dropdownStrip: {
    marginHorizontal: 0,
    marginVertical: 0,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: Colors.surface,
  },
  dropdownStripRow: {
    flexWrap: 'nowrap',
    gap: 8,
  },
  nameStrip: {
    flexShrink: 1,
    flexGrow: 0,
    maxWidth: '38%',
  },
  name: { color: Colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  nameCompact: { fontSize: 13 },
  rates: { color: Colors.textMuted, fontSize: 12, flexBasis: '100%' },
  ratesCompact: { color: Colors.textMuted, fontSize: 11, flex: 1 },
  chevron: { color: Colors.accent, fontSize: 12, marginLeft: 8 },
  locked: { color: Colors.textMuted, fontSize: 11, marginLeft: 8 },
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
  empty: { color: Colors.textMuted, fontSize: 15, padding: 16, textAlign: 'center' },
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
