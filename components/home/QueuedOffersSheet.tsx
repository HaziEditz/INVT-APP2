import { Button } from '@/components/Button';
import { Colors } from '@/constants/theme';
import { useDriver } from '@/context/DriverContext';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function QueuedOffersSheet({ visible, onClose }: Props) {
  const { queuedOffers, promoteQueuedOffer } = useDriver();

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Queued offers ({queuedOffers.length})</Text>
          <ScrollView style={styles.list}>
            {queuedOffers.length === 0 ? (
              <Text style={styles.empty}>No queued offers</Text>
            ) : (
              queuedOffers.map((o) => (
                <View key={o.id} style={styles.card}>
                  <Text style={styles.type}>{o.type}</Text>
                  <Text style={styles.addr} numberOfLines={2}>{o.pickup}</Text>
                  <Text style={styles.addr} numberOfLines={1}>→ {o.dropoff}</Text>
                  <Button
                    title="Show offer"
                    variant="secondary"
                    onPress={() => {
                      promoteQueuedOffer(o.id);
                      onClose();
                    }}
                    style={{ marginTop: 8 }}
                  />
                </View>
              ))
            )}
          </ScrollView>
          <Button title="Close" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: { color: Colors.text, fontSize: 20, fontWeight: '800', marginBottom: 12 },
  list: { maxHeight: 360, marginBottom: 12 },
  empty: { color: Colors.textMuted, paddingVertical: 24, textAlign: 'center' },
  card: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  type: { color: Colors.accent, fontWeight: '700', marginBottom: 4 },
  addr: { color: Colors.text, fontSize: 14 },
});
