/**
 * ExtrasPicker (v22bm)
 *
 * Shown on the trip-completion modal (dispatch + hail) so the driver can
 * tack on per-trip extras BEFORE choosing a payment method — airport fee,
 * bike carrier, extra bags, EFTPOS surcharge, etc.
 *
 * Each preset is a tappable chip:
 *   - tap once → adds with default amount, chip turns filled, amount becomes
 *     editable inline
 *   - tap again → removes
 *
 * "percent" extras (e.g. EFTPOS surcharge 5%) compute against the trip fare
 * passed in via `fare`. Everything else is a flat dollar amount the driver
 * can adjust per-trip.
 *
 * Output (via onChange):
 *   - items: `{ id, name, amount }[]` — what got picked, with the resolved
 *     dollar amount (not the percentage) so the audit POST has real numbers.
 *   - total: sum of amounts, parsed to 2dp.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export type ExtraItem = { id: string; name: string; amount: number };

type Preset = {
  id: string;
  name: string;
  icon: string;
  type: 'fixed' | 'variable' | 'percent';
  defaultValue: number;
};

const DEFAULT_PRESETS: Preset[] = [
  { id: 'airport', name: 'Airport pickup',   icon: 'airplane-outline',    type: 'fixed',    defaultValue: 5 },
  { id: 'bike',    name: 'Bike carrier',     icon: 'bicycle-outline',     type: 'fixed',    defaultValue: 3 },
  { id: 'bag',     name: 'Extra bag',        icon: 'briefcase-outline',   type: 'variable', defaultValue: 2 },
  { id: 'eftpos',  name: 'EFTPOS surcharge', icon: 'card-outline',        type: 'percent',  defaultValue: 5 },
  { id: 'clean',   name: 'Cleaning fee',     icon: 'sparkles-outline',    type: 'variable', defaultValue: 20 },
  { id: 'other',   name: 'Other',            icon: 'ellipsis-horizontal', type: 'variable', defaultValue: 0 },
];

type Props = {
  value: ExtraItem[];
  onChange: (items: ExtraItem[], total: number) => void;
  fare: number;
  presets?: Preset[];
};

export function ExtrasPicker({ value, onChange, fare, presets = DEFAULT_PRESETS }: Props) {
  const colors = useColors();
  const selectedById = useMemo(() => {
    const m: Record<string, ExtraItem> = {};
    for (const it of value) m[it.id] = it;
    return m;
  }, [value]);

  const total = useMemo(
    () => parseFloat(value.reduce((s, it) => s + (it.amount || 0), 0).toFixed(2)),
    [value],
  );

  const computeAmount = (p: Preset) => {
    if (p.type === 'percent') {
      return parseFloat(((fare * p.defaultValue) / 100).toFixed(2));
    }
    return p.defaultValue;
  };

  const toggle = (p: Preset) => {
    if (selectedById[p.id]) {
      const next = value.filter(it => it.id !== p.id);
      onChange(next, parseFloat(next.reduce((s, it) => s + (it.amount || 0), 0).toFixed(2)));
    } else {
      const amt = computeAmount(p);
      const next: ExtraItem[] = [...value, { id: p.id, name: p.name, amount: amt }];
      onChange(next, parseFloat(next.reduce((s, it) => s + (it.amount || 0), 0).toFixed(2)));
    }
  };

  const updateAmount = (id: string, raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const amt = parseFloat(cleaned) || 0;
    const next = value.map(it => (it.id === id ? { ...it, amount: amt } : it));
    onChange(next, parseFloat(next.reduce((s, it) => s + (it.amount || 0), 0).toFixed(2)));
  };

  return (
    <View style={{ marginTop: 4 }}>
      <View style={styles.chipsWrap}>
        {presets.map(p => {
          const sel = !!selectedById[p.id];
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => toggle(p)}
              activeOpacity={0.8}
              style={[
                styles.chip,
                {
                  backgroundColor: sel ? colors.primary + '22' : colors.surface,
                  borderColor:     sel ? colors.primary       : colors.border,
                },
              ]}
            >
              <Ionicons name={p.icon as any} size={14} color={sel ? colors.primary : colors.mutedForeground} />
              <Text
                style={[
                  styles.chipLabel,
                  { color: sel ? colors.primary : colors.foreground, fontFamily: sel ? 'Inter_600SemiBold' : 'Inter_500Medium' },
                ]}
              >
                {p.name}
                {p.type === 'percent' ? ` (${p.defaultValue}%)` : ''}
              </Text>
              {sel && <Ionicons name="checkmark-circle" size={14} color={colors.primary} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {value.length > 0 && (
        <View style={[styles.itemsBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {value.map(it => (
            <View key={it.id} style={styles.itemRow}>
              <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>{it.name}</Text>
              <View style={[styles.amountBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>$</Text>
                <TextInput
                  style={[styles.amountInput, { color: colors.foreground }]}
                  value={it.amount ? String(it.amount) : ''}
                  onChangeText={t => updateAmount(it.id, t)}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <TouchableOpacity
                onPress={() => toggle(DEFAULT_PRESETS.find(p => p.id === it.id) ?? { id: it.id, name: it.name, icon: '', type: 'fixed', defaultValue: 0 })}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Extras total</Text>
            <Text style={[styles.totalVal, { color: colors.primary }]}>${total.toFixed(2)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chipsWrap:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  chipLabel:  { fontSize: 12 },
  itemsBox:   { borderWidth: 1, borderRadius: 10, padding: 8, gap: 6, marginTop: 4 },
  itemRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName:   { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium' },
  amountBox:  { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, minWidth: 80 },
  amountInput:{ flex: 1, paddingVertical: 6, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, marginTop: 2 },
  totalLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  totalVal:   { fontSize: 15, fontFamily: 'Inter_700Bold' },
});
