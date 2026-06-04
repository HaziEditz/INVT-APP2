import { Colors } from '@/constants/theme';
import {
  formatHours,
  loadNztaHours,
  remainingShiftMinutes,
  remainingWeeklyMinutes,
  remainingWorkMinutesToday,
} from '@/services/nztaService';
import { NztaHoursState } from '@/types';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = { embedded?: boolean };

export function NztaHoursBar({ embedded }: Props) {
  const [nzta, setNzta] = useState<NztaHoursState | null>(null);

  const refresh = useCallback(() => {
    loadNztaHours().then(setNzta).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!nzta) return null;

  const todayLeft = remainingWorkMinutesToday(nzta);
  const weekLeft = remainingWeeklyMinutes(nzta);
  const shiftLeft = remainingShiftMinutes(nzta);

  return (
    <View style={[styles.bar, embedded && styles.barEmbedded]}>
      <Text style={styles.label}>NZTA remaining</Text>
      <View style={styles.row}>
        <Text style={styles.item}>Today {formatHours(todayLeft)}</Text>
        <Text style={styles.sep}>·</Text>
        <Text style={styles.item}>Week {formatHours(weekLeft)}</Text>
        <Text style={styles.sep}>·</Text>
        <Text style={styles.item}>Shift {formatHours(shiftLeft)}</Text>
      </View>
      {nzta.continuedWindow ? (
        <Text style={styles.hint}>Continuing 14h window (rest under 10h)</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    marginTop: 4,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  barEmbedded: {
    marginHorizontal: 0,
    marginTop: 8,
    backgroundColor: Colors.surfaceElevated,
  },
  label: { color: Colors.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 4, gap: 4 },
  item: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  sep: { color: Colors.textMuted, fontSize: 12 },
  hint: { color: Colors.textMuted, fontSize: 11, marginTop: 4 },
});
