import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Idle-state HAIL PASSENGER control — mount from index.tsx IdleCurrentSection only.
 * Uses explicit minHeight/width (not flex:1) so the button cannot collapse or clip invisible.
 */
export function IdleHailButton() {
  const { shiftActive, activeJob, hailActive, meter, startHail, clearOrphanedIdleMeter } = useDriver();

  if (activeJob || hailActive) return null;

  const meterRunning = !!meter?.running;

  const onPress = () => {
    if (!shiftActive) {
      Alert.alert('Off shift', 'Start your shift from Profile or sign in again.');
      return;
    }
    if (meterRunning) {
      Alert.alert(
        'Clear open meter?',
        'A fare meter is still running from a previous session. Clear it and start a new hail trip?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear & start hail',
            onPress: () => {
              void clearOrphanedIdleMeter().then(() => {
                Alert.alert('Start Hail Trip?', 'Begin a street hail trip with the meter running.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Confirm', onPress: () => void startHail() },
                ]);
              });
            },
          },
        ],
      );
      return;
    }
    Alert.alert('Start Hail Trip?', 'Begin a street hail trip with the meter running.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void startHail() },
    ]);
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Hail passenger"
      testID="hail-passenger-button"
    >
      <Text style={styles.btnText}>HAIL PASSENGER</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: '100%',
    minHeight: 56,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.accentDark,
  },
  btnPressed: {
    opacity: 0.88,
    backgroundColor: Colors.accentDark,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
});
