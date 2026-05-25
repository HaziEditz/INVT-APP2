import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { HailJob } from '@/context/DriverContext';
import * as Haptics from '@/lib/haptics';

interface Props {
  job: HailJob;
  onClaim: (job: HailJob) => Promise<{ status: 'ok'; jobId: string } | { status: 'taken' } | { status: 'error' }>;
  onClaimed?: (jobId: string) => void;
}

function HailJobCardImpl({ job, onClaim, onClaimed }: Props) {
  const colors = useColors();
  const [state, setState] = useState<'idle' | 'loading' | 'taken' | 'error'>('idle');

  const handleClaim = async () => {
    if (state !== 'idle') return;
    Haptics.impactAsync();
    setState('loading');
    const result = await onClaim(job);
    if (result.status === 'ok') {
      Haptics.notificationAsync();
      onClaimed?.(result.jobId);
    } else if (result.status === 'taken') {
      setState('taken');
      setTimeout(() => setState('idle'), 4000);
    } else {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const isTaken  = state === 'taken';
  const isError  = state === 'error';

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: isTaken ? colors.surface : colors.card,
        borderColor: isTaken ? colors.border : colors.primary + '44',
        opacity: isTaken ? 0.7 : 1,
      },
    ]}>
      {/* Hail badge */}
      <View style={styles.topRow}>
        <View style={[styles.hailBadge, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
          <Ionicons name="hand-left-outline" size={13} color="#f59e0b" />
          <Text style={[styles.hailLabel, { color: '#f59e0b' }]}>OPEN — First Come First Served</Text>
        </View>
        {job.fare > 0 && (
          <Text style={[styles.fare, { color: colors.primary }]}>
            ${job.fare.toFixed(2)}
          </Text>
        )}
      </View>

      {/* Passenger */}
      <Text style={[styles.passenger, { color: colors.foreground }]}>
        {job.passengerName}
        {job.passengerPhone ? `  ·  ${job.passengerPhone}` : ''}
      </Text>

      {/* Pickup / Drop */}
      <View style={styles.addressRow}>
        <Ionicons name="location" size={14} color={colors.primary} style={styles.icon} />
        <Text style={[styles.address, { color: colors.foreground }]} numberOfLines={2}>
          {job.pickupAddress || 'Pickup address not provided'}
        </Text>
      </View>
      {job.dropAddress ? (
        <View style={styles.addressRow}>
          <Ionicons name="flag" size={14} color={colors.error} style={styles.icon} />
          <Text style={[styles.address, { color: colors.mutedForeground }]} numberOfLines={2}>
            {job.dropAddress}
          </Text>
        </View>
      ) : null}

      {/* Distance / Duration */}
      {(job.distance !== '—' || job.duration !== '—') && (
        <View style={styles.metaRow}>
          {job.distance !== '—' && (
            <View style={styles.metaItem}>
              <Ionicons name="navigate-outline" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{job.distance}</Text>
            </View>
          )}
          {job.duration !== '—' && (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{job.duration}</Text>
            </View>
          )}
        </View>
      )}

      {/* Notes */}
      {!!job.notes && (
        <Text style={[styles.notes, { color: colors.mutedForeground }]} numberOfLines={2}>
          {job.notes}
        </Text>
      )}

      {/* Action button */}
      {isTaken ? (
        <View style={[styles.takenBanner, { backgroundColor: colors.error + '18', borderColor: colors.error }]}>
          <Ionicons name="close-circle" size={16} color={colors.error} />
          <Text style={[styles.takenText, { color: colors.error }]}>
            Claimed by another driver — too slow!
          </Text>
        </View>
      ) : isError ? (
        <View style={[styles.takenBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.mutedForeground} />
          <Text style={[styles.takenText, { color: colors.mutedForeground }]}>
            Something went wrong — try again
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.claimBtn, { backgroundColor: colors.primary }]}
          onPress={handleClaim}
          activeOpacity={0.8}
          disabled={state === 'loading'}
        >
          {state === 'loading' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="hand-left" size={16} color="#fff" />
              <Text style={styles.claimBtnText}>Claim This Job</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// v12-ota22g: skip re-render when job + handlers are unchanged.
export const HailJobCard = React.memo(HailJobCardImpl, (a, b) =>
  a.onClaim === b.onClaim &&
  a.onClaimed === b.onClaimed &&
  a.job.id === b.job.id &&
  a.job.fare === b.job.fare &&
  a.job.pickupAddress === b.job.pickupAddress
);

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  hailLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  fare: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  passenger: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  icon: { marginTop: 2 },
  address: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  metaRow: { flexDirection: 'row', gap: 14, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  notes: { fontSize: 12, fontFamily: 'Inter_400Regular', fontStyle: 'italic' },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    borderRadius: 12,
    paddingVertical: 13,
  },
  claimBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold' },
  takenBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  takenText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1 },
});
