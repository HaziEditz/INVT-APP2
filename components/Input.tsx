import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

type Props = TextInputProps & { label?: string };

export function Input({ label, style, ...props }: Props) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={Colors.textMuted}
        style={[sharedStyles.input, style]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  label: {
    color: Colors.textMuted,
    fontSize: 13,
    marginBottom: 6,
    fontWeight: '600',
  },
});
