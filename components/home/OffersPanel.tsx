import { Button } from '@/components/Button';
import { JobNotesSection } from '@/components/JobNotesSection';
import { hasJobNotes } from '@/lib/jobNotes';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export function OffersPanel() {
  const { pendingOffers, pickOfferFromList, shiftActive, activeVehicle } = useDriver();

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
        <Text style={styles.emptyText}>No pending jobs for your vehicle right now.</Text>
        <Text style={styles.emptySub}>
          {activeVehicle
            ? `${activeVehicle.bodyType} · ${activeVehicle.seatCapacity} seats · ${activeVehicle.vehicleType}`
            : 'Select a vehicle on shift'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator={false}>
      {pendingOffers.map((o) => (
        <View key={o.id} style={styles.card}>
          <View style={styles.cardHead}>
            <JobTypeBadge type={o.type} />
            {o.vehicleTypeRequired ? (
              <Text style={styles.vehicleReq}>{o.vehicleTypeRequired}</Text>
            ) : null}
          </View>
          <Text style={styles.addr} numberOfLines={2}>
            ↑ {o.pickup || '—'}
          </Text>
          <Text style={styles.addr} numberOfLines={1}>
            ↓ {o.dropoff || '—'}
          </Text>
          {o.passengerName ? <Text style={styles.meta}>{o.passengerName}</Text> : null}
          {hasJobNotes(o) ? <JobNotesSection job={o} compact title="Notes" /> : null}
          {(o.estimatedFare ?? o.fixedFare) != null ? (
            <Text style={styles.fare}>${(o.fixedFare ?? o.estimatedFare)!.toFixed(2)}</Text>
          ) : null}
          <Button title="Take job" onPress={() => pickOfferFromList(o.id)} style={{ marginTop: 8 }} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 220, paddingHorizontal: 12, paddingVertical: 8 },
  empty: { padding: 20, alignItems: 'center' },
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
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  vehicleReq: { color: Colors.textMuted, fontSize: 12 },
  addr: { color: Colors.text, fontSize: 15, marginBottom: 4 },
  meta: { color: Colors.textMuted, fontSize: 13 },
  fare: { color: Colors.success, fontSize: 17, fontWeight: '800', marginTop: 4 },
});
