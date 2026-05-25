import React from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Tariff } from '@/context/DriverContext';

interface TariffPickerProps {
  visible: boolean;
  tariffs: Tariff[];
  selected: Tariff;
  onSelect: (t: Tariff) => void;
  onConfirm: () => void;
  onClose: () => void;
  title?: string;
  confirmLabel?: string;
}

export function TariffPicker({
  visible, tariffs, selected, onSelect, onConfirm, onClose,
  title = 'Select Tariff',
  confirmLabel = 'Confirm',
}: TariffPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Choose the rate that applies to this trip.
          </Text>

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {tariffs.map((t) => {
              const isActive = t.id === selected.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.tariffCard,
                    {
                      backgroundColor: isActive ? colors.primary + '18' : colors.surface,
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => onSelect(t)}
                  activeOpacity={0.75}
                >
                  <View style={styles.tariffRow}>
                    <View style={[styles.radio, { borderColor: isActive ? colors.primary : colors.border }]}>
                      {isActive && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tariffName, { color: isActive ? colors.primary : colors.foreground }]}>
                        {t.name}
                      </Text>
                      <View style={styles.tariffRates}>
                        <Text style={[styles.rateChip, { color: colors.mutedForeground }]}>
                          Flag ${t.flagFall.toFixed(2)}
                        </Text>
                        <Text style={[styles.rateChip, { color: colors.mutedForeground }]}>
                          ${t.ratePerMile.toFixed(2)}/km
                        </Text>
                        <Text style={[styles.rateChip, { color: colors.mutedForeground }]}>
                          ${t.waitingPerMin.toFixed(2)}/min wait
                        </Text>
                      </View>
                    </View>
                    {isActive && (
                      <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
            onPress={onConfirm}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark" size={20} color={colors.primaryForeground} />
            <Text style={[styles.confirmText, { color: colors.primaryForeground }]}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingTop: 24,
    paddingHorizontal: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  hint: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: -8 },
  tariffCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 10,
  },
  tariffRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  tariffName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  tariffRates: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rateChip: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  confirmBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
});
