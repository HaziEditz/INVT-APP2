import { getAppBuildLabel } from '@/lib/appBuildInfo';
import { getOtaDebugSuffix } from '@/lib/otaUpdates';
import { Colors } from '@/constants/theme';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

type Props = {
  style?: ViewStyle;
  /** Optional prefix, e.g. "Build" */
  prefix?: string;
};

/** Small non-intrusive build marker (version + git short SHA + OTA channel). */
export function AppBuildLabel({ style, prefix }: Props) {
  const base = getAppBuildLabel();
  const ota = getOtaDebugSuffix();
  const full = `${base} · ${ota}`;
  const label = prefix ? `${prefix} ${full}` : full;
  return (
    <View style={[styles.wrap, style]} accessibilityLabel={`App build ${full}`}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  text: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
