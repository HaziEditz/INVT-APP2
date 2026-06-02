import { Colors } from '@/constants/theme';
import { JobType } from '@/types';
import { StyleSheet, Text, View } from 'react-native';

const TYPE_COLORS: Record<JobType, string> = {
  Taxi: Colors.taxi,
  Freight: Colors.freight,
  Food: Colors.food,
  Tow: Colors.tow,
};

export function JobTypeBadge({ type }: { type: JobType }) {
  return (
    <View style={[styles.badge, { backgroundColor: TYPE_COLORS[type] + '22', borderColor: TYPE_COLORS[type] }]}>
      <Text style={[styles.text, { color: TYPE_COLORS[type] }]}>{type}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
