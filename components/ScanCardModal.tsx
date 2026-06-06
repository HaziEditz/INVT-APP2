import { Colors } from '@/constants/theme';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onScanned: (value: string) => void;
};

export function ScanCardModal({ visible, title = 'Scan Card', onClose, onScanned }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [lastScan, setLastScan] = useState('');

  const handleBarcode = ({ data }: { data: string }) => {
    if (!data || data === lastScan) return;
    setLastScan(data);
    onScanned(data);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.hint}>Camera permission is required to scan cards.</Text>
            <Pressable style={styles.permBtn} onPress={() => void requestPermission()}>
              <Text style={styles.permBtnText}>Allow Camera</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['code128', 'code39', 'ean13', 'ean8', 'qr', 'pdf417'],
              }}
              onBarcodeScanned={handleBarcode}
            />
            <Text style={styles.hint}>
              Point the camera at the card barcode or number. You can also enter details manually.
            </Text>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  closeText: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  camera: { flex: 1, borderRadius: 12, marginHorizontal: 16, overflow: 'hidden' },
  hint: {
    color: Colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    lineHeight: 20,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  permBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
