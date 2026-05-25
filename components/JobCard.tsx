import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Job } from '@/context/DriverContext';

interface Props {
  job: Job;
  onPress: () => void;
}

function JobCardImpl({ job, onPress }: Props) {
  const colors = useColors();

  const isTM = job.paymentType === 'total_mobility';

  const statusColor =
    job.status === 'offered' ? colors.warning :
    job.status === 'current' ? colors.success :
    job.status === 'queued' ? colors.info :
    colors.mutedForeground;

  const statusLabel =
    job.status === 'offered' ? 'New Offer' :
    job.status === 'current' ? 'Active' :
    job.status === 'queued' ? 'Queued' : 'Done';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: isTM ? '#7c3aed55' : colors.border },
        isTM && { borderWidth: 1.5 },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.header}>
        <View style={styles.passengerRow}>
          <Ionicons name="person-circle" size={36} color={isTM ? '#7c3aed' : colors.primary} />
          <View style={{ marginLeft: 10 }}>
            <Text style={[styles.name, { color: colors.foreground }]}>{job.passengerName}</Text>
            <Text style={[styles.phone, { color: colors.mutedForeground }]}>{job.passengerPhone}</Text>
          </View>
        </View>
        <View style={styles.badgeGroup}>
          {isTM && (
            <View style={[styles.tmBadge, { backgroundColor: '#7c3aed22', borderColor: '#7c3aed55' }]}>
              <Ionicons name="accessibility" size={11} color="#7c3aed" />
              <Text style={[styles.tmBadgeText, { color: '#7c3aed' }]}>TM</Text>
            </View>
          )}
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.addressBlock}>
        <View style={styles.addressRow}>
          <Ionicons name="location" size={16} color={colors.success} />
          <Text style={[styles.address, { color: colors.foreground }]} numberOfLines={1}>
            {job.pickupAddress}
          </Text>
        </View>
        <View style={styles.connector}>
          <View style={[styles.connLine, { backgroundColor: colors.border }]} />
        </View>
        <View style={styles.addressRow}>
          <Ionicons name="flag" size={16} color={colors.error} />
          <Text style={[styles.address, { color: colors.foreground }]} numberOfLines={1}>
            {job.dropAddress}
          </Text>
        </View>
      </View>

      {/* Cross-company badge — shown when job is dispatched by a different company */}
      {job.sourceCompanyId && (
        <View style={[styles.companyBanner, { backgroundColor: colors.info + '15', borderColor: colors.info + '44' }]}>
          <Ionicons name="business-outline" size={13} color={colors.info} />
          <Text style={[styles.companyBannerText, { color: colors.info }]}>
            Dispatched by Company {job.sourceCompanyId}
          </Text>
        </View>
      )}

      {/* Special type badges — hoist, freight, food */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        {isTM && job.tmHoistRequired && (
          <View style={[styles.typeBadge, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b55' }]}>
            <Ionicons name="accessibility-outline" size={12} color="#f59e0b" />
            <Text style={[styles.typeText, { color: '#f59e0b' }]}>
              HOIST{job.tmHoistCount ? ` ×${job.tmHoistCount}` : ''}
            </Text>
          </View>
        )}
        {job.bookingType && (() => {
          const bt = job.bookingType!.toLowerCase();
          const isFreight = bt.includes('freight') || bt.includes('parcel') || bt.includes('cargo');
          const isFood    = bt.includes('food') || bt.includes('meal') || bt.includes('restaurant') || bt.includes('deliver');
          // ota22c-cutover-d: tow badge — aliases tow/towing/recovery
          const isTow     = bt.includes('tow')  || bt.includes('recovery');
          if (!isFreight && !isFood && !isTow) return null;
          const col = isFreight ? '#f59e0b' : isFood ? '#10b981' : '#ef4444';
          const icon = isFreight ? 'cube-outline' : isFood ? 'fast-food-outline' : 'car-sport-outline';
          const label = isFreight ? 'FREIGHT' : isFood ? 'FOOD' : 'TOW';
          return (
            <View style={[styles.typeBadge, { backgroundColor: col + '18', borderColor: col + '55' }]}>
              <Ionicons name={icon as any} size={12} color={col} />
              <Text style={[styles.typeText, { color: col }]}>{label}</Text>
            </View>
          );
        })()}
      </View>

      {/* ota22c-cutover-d: food/freight/tow order details preview — these
          bookings carry free-text "what to pick up" info that taxi trips
          don't have. Showing the first 2 lines inline saves the driver
          opening the job detail page just to see what they're picking up. */}
      {job.orderDetails && (() => {
        const bt = (job.bookingType ?? '').toLowerCase();
        const showOrder =
          bt.includes('freight') || bt.includes('parcel') || bt.includes('cargo') ||
          bt.includes('food')    || bt.includes('meal')   || bt.includes('restaurant') || bt.includes('deliver') ||
          bt.includes('tow')     || bt.includes('recovery');
        if (!showOrder) return null;
        return (
          <View style={[styles.orderBox, { backgroundColor: colors.mutedForeground + '15', borderColor: colors.border }]}>
            <Ionicons name="document-text-outline" size={13} color={colors.mutedForeground} />
            <Text
              style={[styles.orderText, { color: colors.foreground }]}
              numberOfLines={2}
            >
              {job.orderDetails}
            </Text>
          </View>
        );
      })()}

      <View style={styles.footer}>
        <View style={styles.footerItem}>
          <Ionicons name="navigate-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{job.distance}</Text>
        </View>
        <View style={styles.footerItem}>
          <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{job.duration}</Text>
        </View>
        {(() => {
          if (isTM) {
            return (
              <View style={[styles.payBadge, { backgroundColor: '#7c3aed22', borderColor: '#7c3aed55' }]}>
                <Text style={[styles.payText, { color: '#7c3aed' }]}>TM</Text>
              </View>
            );
          }
          const pt = job.paymentType ?? 'cash';
          const label =
            pt === 'eftpos'  ? 'EFTPOS' :
            pt === 'card'    ? 'CARD' :
            pt === 'account' ? 'ACCT' : 'CASH';
          const col =
            pt === 'account' ? colors.warning :
            pt === 'cash'    ? colors.success : colors.primary;
          return (
            <View style={[styles.payBadge, { backgroundColor: col + '22', borderColor: col }]}>
              <Text style={[styles.payText, { color: col }]}>{label}</Text>
            </View>
          );
        })()}
        <View style={styles.fareBox}>
          <Text style={[styles.fare, { color: isTM ? '#7c3aed' : colors.primary }]}>${job.fare.toFixed(2)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// v12-ota22g: skip re-render when job + onPress are unchanged. JobCard is
// rendered in lists (Dashboard, Meter) that re-render on every state change;
// without memo each card recreated its DOM tree on every parent render.
export const JobCard = React.memo(JobCardImpl, (a, b) =>
  a.onPress === b.onPress &&
  a.job.id === b.job.id &&
  a.job.status === b.job.status &&
  a.job.fare === b.job.fare &&
  a.job.pickupAddress === b.job.pickupAddress &&
  a.job.dropAddress === b.job.dropAddress &&
  a.job.passengerName === b.job.passengerName
);

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  passengerRow: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '600' },
  phone: { fontSize: 13, marginTop: 2 },
  badgeGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  tmBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1,
  },
  tmBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  divider: { height: 1, marginBottom: 12 },
  addressBlock: { gap: 4, marginBottom: 12 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  address: { fontSize: 14, flex: 1 },
  connector: { paddingLeft: 7, height: 12 },
  connLine: { width: 1, flex: 1, marginLeft: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { fontSize: 13 },
  payBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1,
  },
  payText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  fareBox: { marginLeft: 'auto' },
  fare: { fontSize: 20, fontWeight: '700' },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1,
    alignSelf: 'flex-start',
  },
  typeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  orderBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 7,
    marginBottom: 8,
  },
  orderText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 16 },
  companyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8,
  },
  companyBannerText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', flex: 1 },
});
