import { Colors } from '@/constants/theme';
import { StyleSheet, Text, View } from 'react-native';

/** Web stub — maps are only available on iOS/Android. */
export default function JobMap() {
  return (
    <View style={styles.stub}>
      <Text style={styles.title}>Map preview</Text>
      <Text style={styles.text}>Navigation map is available on the mobile app only.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stub: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
    padding: 16,
  },
  title: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  text: { color: Colors.textMuted, textAlign: 'center', fontSize: 14 },
});
