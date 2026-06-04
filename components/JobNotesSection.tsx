import { notesFromOffer } from '@/lib/jobNotes';
import { Colors } from '@/constants/theme';
import { JobOffer } from '@/types';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  job: Pick<JobOffer, 'allNotes' | 'notes'>;
  title?: string;
  compact?: boolean;
};

export function JobNotesSection({ job, title = 'Notes & instructions', compact }: Props) {
  const lines = notesFromOffer(job);
  if (lines.length === 0) return null;

  return (
    <View style={[styles.box, compact && styles.boxCompact]}>
      <Text style={styles.title}>{title}</Text>
      {lines.map((line, i) => (
        <View key={`${line.label}-${i}`} style={styles.line}>
          <Text style={styles.label}>{line.label}</Text>
          <Text style={styles.text}>{line.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.warning + '18',
    borderWidth: 1,
    borderColor: Colors.warning + '55',
  },
  boxCompact: { marginTop: 6, padding: 10 },
  title: { color: Colors.warning, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8 },
  line: { marginBottom: 8 },
  label: { color: Colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  text: { color: Colors.text, fontSize: 15, lineHeight: 21 },
});
