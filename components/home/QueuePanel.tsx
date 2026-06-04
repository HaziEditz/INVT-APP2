import { Button } from '@/components/Button';
import { JobTypeBadge } from '@/components/JobTypeBadge';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export function QueuePanel() {
  const { queuedOffers, promoteQueuedOffer } = useDriver();

  if (queuedOffers.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No jobs in your queue.</Text>
        <Text style={styles.emptySub}>Pick an offer while on a trip — taxi allows 1 queued job.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator={false}>
      {queuedOffers.map((o, i) => (
        <View key={o.id} style={styles.card}>
          <Text style={styles.queuePos}>#{i + 1} in queue</Text>
          <JobTypeBadge type={o.type} />
          <Text style={styles.addr} numberOfLines={2}>
            {o.pickup}
          </Text>
          <Text style={styles.addr} numberOfLines={1}>
            → {o.dropoff}
          </Text>
          <Button
            title="Show when ready"
            variant="secondary"
            onPress={() => promoteQueuedOffer(o.id)}
            style={{ marginTop: 8 }}
          />
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
  queuePos: { color: Colors.accent, fontWeight: '800', marginBottom: 6 },
  addr: { color: Colors.text, fontSize: 14, marginTop: 4 },
});
