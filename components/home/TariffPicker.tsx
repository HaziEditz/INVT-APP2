import { Colors } from '@/constants/theme';
import { Tariff } from '@/types';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

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

type AnchorRect = { top: number; left: number; width: number };

export function TariffPicker({ tariffs, selected, open, locked, compact, strip, onOpen, onClose, onSelect }: Props) {
  const hasTariffs = tariffs.length > 0;
  const canOpen = hasTariffs && !locked;
  const anchorRef = useRef<View>(null);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  const openDropdown = () => {
    if (!canOpen) return;
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchorRect({ top: y + height + 4, left: x, width: Math.max(width, 240) });
      onOpen();
    });
  };

  const menuMaxHeight = anchorRect
    ? Math.min(280, Math.max(120, windowHeight - anchorRect.top - 16))
    : 280;

  return (
    <>
      <View
        ref={anchorRef}
        collapsable={false}
        style={[
          styles.dropdown,
          compact && styles.dropdownCompact,
          strip && styles.dropdownStrip,
          strip && styles.dropdownStripRow,
        ]}
      >
        <Pressable
          style={[styles.dropdownPressable, compact && styles.dropdownCompactPressable]}
          onPress={openDropdown}
          disabled={!canOpen}
          accessibilityRole="button"
          accessibilityLabel="Select tariff"
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
            <Text style={styles.ratesCompact} numberOfLines={1}>
              ${selected.flagFall.toFixed(2)} + ${selected.ratePerKm.toFixed(2)}/km
            </Text>
          ) : null}
          {locked ? <Text style={styles.locked}>Locked</Text> : null}
          {canOpen ? (
            <View style={styles.tariffControl}>
              <Text style={styles.tariffLabel}>Tariff</Text>
              <Text style={styles.chevron}>▼</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close tariff picker" />
        {anchorRect ? (
          <View
            style={[
              styles.dropdownMenu,
              {
                top: anchorRect.top,
                left: anchorRect.left,
                width: anchorRect.width,
                maxHeight: menuMaxHeight,
              },
            ]}
          >
            <Text style={styles.menuTitle}>Select tariff</Text>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
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
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropdownPressable: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: 12,
    gap: 4,
  },
  dropdownCompact: {
    marginVertical: 0,
  },
  dropdownCompactPressable: {
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
  dropdownStripRow: {},
  nameStrip: {
    flexShrink: 1,
    flexGrow: 0,
    maxWidth: '42%',
  },
  name: { color: Colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  nameCompact: { fontSize: 13 },
  rates: { color: Colors.textMuted, fontSize: 12, flexBasis: '100%' },
  ratesCompact: { color: Colors.textMuted, fontSize: 12, flex: 1 },
  tariffControl: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  tariffLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  chevron: { color: Colors.accent, fontSize: 12, fontWeight: '800' },
  locked: { color: Colors.textMuted, fontSize: 11, marginLeft: 8 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  dropdownMenu: {
    position: 'absolute',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  menuTitle: { color: Colors.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  list: { flexGrow: 0 },
  empty: { color: Colors.textMuted, fontSize: 14, padding: 12, textAlign: 'center' },
  option: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionActive: { borderColor: Colors.accent },
  optionName: { color: Colors.text, fontWeight: '700' },
  optionRates: { color: Colors.textMuted, fontSize: 12, marginTop: 4 },
});
