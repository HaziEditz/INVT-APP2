import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import {
  formatJobDateTimeCompact,
  pickupTypeLabelFromOffer,
  sourceDisplayLabel,
  vehicleTypeDisplayLabel,
} from '@/lib/jobDisplayMeta';
import { ActiveJob, JobOffer } from '@/types';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  job: JobOffer | ActiveJob;
  compact?: boolean;
};

/**
 * Always-visible compact strip: ASAP/LATER · vehicle · created · source.
 * Expand stays reserved for long notes / full stop breakdowns.
 */
export function JobDispatchMetaSection({ job, compact }: Props) {
  const pickupType = pickupTypeLabelFromOffer(job);
  const bookedLabel =
    job.bookedAtMs != null ? formatJobDateTimeCompact(new Date(job.bookedAtMs)) : null;
  const sourceLabel = sourceDisplayLabel(job.source, job.createdBy, job.dispatcherName);
  const vehicleLabel = vehicleTypeDisplayLabel(job);

  if (!pickupType && !vehicleLabel && !bookedLabel && !sourceLabel) return null;

  return (
    <View
      style={[styles.strip, compact && styles.stripCompact]}
      accessibilityLabel={[pickupType, vehicleLabel, bookedLabel, sourceLabel]
        .filter(Boolean)
        .join(', ')}
    >
      {pickupType ? (
        <View style={styles.typeChip}>
          <Text style={styles.typeChipText}>{pickupType}</Text>
        </View>
      ) : null}
      {vehicleLabel ? (
        <View style={styles.item}>
          <Ionicons name="car-outline" size={12} color={Colors.textMuted} />
          <Text style={styles.itemText} numberOfLines={1}>
            {vehicleLabel}
          </Text>
        </View>
      ) : null}
      {bookedLabel ? (
        <View style={styles.item}>
          <Ionicons name="time-outline" size={12} color={Colors.textMuted} />
          <Text style={styles.itemText} numberOfLines={1}>
            {bookedLabel}
          </Text>
        </View>
      ) : null}
      {sourceLabel ? (
        <View style={styles.item}>
          <Ionicons name="globe-outline" size={12} color={Colors.textMuted} />
          <Text style={styles.itemText} numberOfLines={1}>
            {sourceLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
    marginTop: 6,
    marginBottom: 4,
  },
  stripCompact: { marginTop: 4, marginBottom: 2 },
  typeChip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeChipText: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: '100%',
    flexShrink: 1,
  },
  itemText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
});
