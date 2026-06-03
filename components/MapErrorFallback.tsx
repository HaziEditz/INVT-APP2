import { Colors } from '@/constants/theme';
import { StyleSheet, Text, View } from 'react-native';

export function MapErrorFallback() {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Map unavailable</Text>
      <Text style={styles.text}>
        Navigation map could not load. You can still take jobs and use the meter.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    minHeight: 120,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
  },
  title: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  text: { color: Colors.textMuted, textAlign: 'center', fontSize: 13 },
});
