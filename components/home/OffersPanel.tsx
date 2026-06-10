import { Button } from '@/components/Button';
import { JobNotesSection } from '@/components/JobNotesSection';
import { hasJobNotes } from '@/lib/jobNotes';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

function timeSince(ts?: number): string {
  if (!ts) return 'Just now';
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

export function OffersPanel() {
  const { pendingOffers, pickOfferFromList, shiftActive } = useDriver();

  if (!shiftActive) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Start your shift to see company offers.</Text>
      </View>
    );
  }

  if (pendingOffers.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No pending jobs for you right now.</Text>
        <Text style={styles.emptySub}>New offers appear here when dispatch posts jobs for your fleet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent} nestedScrollEnabled showsVerticalScrollIndicator>
      {pendingOffers.map((o) => {
        const fare = o.fixedFare ?? o.estimatedFare;
        return (
          <View key={o.id} style={styles.card}>
            <View style={styles.cardHead}>
              <JobTypeBadge type={o.type} />
              <Text style={styles.jobId}>#{o.id}</Text>
              <Text style={styles.posted}>{timeSince(o.postedAt)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.addr}>{o.pickup || '—'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Dropoff</Text>
              <Text style={styles.addr}>{o.dropoff || '—'}</Text>
            </View>
            {o.passengerName ? (
              <Text style={styles.meta}>
                <Text style={styles.metaLabel}>Passenger: </Text>
                {o.passengerName}
                {o.passengerPhone ? ` · ${o.passengerPhone}` : ''}
              </Text>
            ) : null}
            {o.vehicleTypeRequired ? <Text style={styles.meta}>Vehicle: {o.vehicleTypeRequired}</Text> : null}
            {hasJobNotes(o) ? <JobNotesSection job={o} compact title="Notes" /> : null}
            {fare != null ? <Text style={styles.fare}>Est. fare ${fare.toFixed(2)}</Text> : null}
            <Button title="Accept" onPress={() => pickOfferFromList(o.id)} style={{ marginTop: 10 }} />
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 16 },
  empty: { padding: 20, alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyText: { color: Colors.textMuted, fontSize: 15, textAlign: 'center' },
  emptySub: { color: Colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  jobId: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  posted: { color: Colors.textMuted, fontSize: 11, marginLeft: 'auto' },
  row: { marginBottom: 6 },
  label: { color: Colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  addr: { color: Colors.text, fontSize: 15, lineHeight: 20 },
  meta: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
  metaLabel: { fontWeight: '700', color: Colors.text },
  fare: { color: Colors.success, fontSize: 17, fontWeight: '800', marginTop: 6 },
});
