import { Colors } from '@/constants/theme';
import {
  formatJobDateTimeCompact,
  pickupTypeLabelFromOffer,
  sourceDisplayLabel,
} from '@/lib/jobDisplayMeta';
import { JobOffer } from '@/types';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  job: JobOffer;
  compact?: boolean;
};

/** Pickup time, ASAP/LATER, source, and booked-at — parity with dispatch JobCard meta row. */
export function JobDispatchMetaSection({ job, compact }: Props) {
  const pickupType = pickupTypeLabelFromOffer(job);
  const pickupLabel =
    job.pickupTimeMs != null ? formatJobDateTimeCompact(new Date(job.pickupTimeMs)) : null;
  const bookedLabel =
    job.bookedAtMs != null ? formatJobDateTimeCompact(new Date(job.bookedAtMs)) : null;
  const sourceLabel = sourceDisplayLabel(job.source, job.createdBy, job.dispatcherName);

  const hasPickupRow = pickupType || pickupLabel;
  const hasMetaRow = bookedLabel || sourceLabel;
  if (!hasPickupRow && !hasMetaRow) return null;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {hasPickupRow ? (
        <View style={styles.pickupRow}>
          <View style={styles.typeChip}>
            <Text style={styles.typeChipText}>{pickupType}</Text>
          </View>
          {pickupLabel ? (
            <Text style={styles.pickupTime} numberOfLines={1}>
              {pickupLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
      {hasMetaRow ? (
        <Text style={styles.metaLine} numberOfLines={2}>
          {[bookedLabel, sourceLabel].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 4, gap: 6 },
  wrapCompact: { marginTop: 6, marginBottom: 2, gap: 4 },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typeChip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeChipText: { color: Colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  pickupTime: { color: Colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  metaLine: { color: Colors.textMuted, fontSize: 12 },
});
