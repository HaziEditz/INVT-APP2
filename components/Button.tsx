import { Colors } from '@/constants/theme';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  compact?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', disabled, compact, style }: Props) {
  const bg =
    variant === 'primary' ? Colors.accent : variant === 'danger' ? Colors.danger : Colors.surfaceElevated;
  const textColor = variant === 'secondary' ? Colors.text : '#fff';

  const handlePress = () => {
    if (disabled) return;
    console.log('[Button] pressed:', title);
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && styles.secondary,
        style,
      ]}
    >
      <Text style={[styles.text, compact && styles.textCompact, { color: textColor }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  compact: {
    paddingVertical: 11,
    borderRadius: 10,
  },
  secondary: {
    borderWidth: 1,
    borderColor: Colors.border,
  },
  text: {
    fontSize: 16,
    fontWeight: '700',
  },
  textCompact: {
    fontSize: 14,
  },
});
