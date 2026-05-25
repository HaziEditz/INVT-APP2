import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useDriver, DriverStatus } from '@/context/DriverContext';
import * as Haptics from '@/lib/haptics';

export function StatusBadge() {
  const colors = useColors();
  const { status, setStatus } = useDriver();

  const options: { key: DriverStatus; label: string; color: string }[] = [
    { key: 'Available', label: 'Available', color: colors.success },
    { key: 'Away', label: 'Away', color: colors.warning },
  ];

  const handlePress = (s: DriverStatus) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStatus(s);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt.key}
          style={[
            styles.pill,
            status === opt.key && { backgroundColor: opt.color + '22', borderColor: opt.color, borderWidth: 1 },
          ]}
          onPress={() => handlePress(opt.key)}
          activeOpacity={0.7}
        >
          <View style={[styles.dot, { backgroundColor: status === opt.key ? opt.color : colors.mutedForeground }]} />
          <Text style={[styles.label, { color: status === opt.key ? opt.color : colors.mutedForeground }]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 40,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 32,
    gap: 6,
    borderColor: 'transparent',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 13, fontWeight: '600' },
});
