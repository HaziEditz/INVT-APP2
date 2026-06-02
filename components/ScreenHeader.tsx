import { Colors } from '@/constants/theme';
import { StyleSheet, Text, View } from 'react-native';

export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  title: { color: Colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: Colors.textMuted, fontSize: 15, marginTop: 4 },
});
