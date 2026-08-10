import { Colors } from '@/constants/theme';
import { scanCardFromImageUri, type CardScanFields } from '@/lib/cardScan';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  title?: string;
  onCancel: () => void;
  /** Called after driver confirms/edits OCR prefill. Photo already discarded. */
  onConfirm: (fields: CardScanFields) => void;
};

/**
 * Snap → on-device OCR → editable confirm. Never stores the photo.
 */
export function CardScanModal({
  visible,
  title = 'Scan card',
  onCancel,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardScanFields | null>(null);

  const reset = () => {
    setBusy(false);
    setError(null);
    setDraft(null);
  };

  const handleClose = () => {
    reset();
    onCancel();
  };

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: Platform.OS === 'android',
      });
      if (!photo?.uri) throw new Error('No photo captured');
      const result = await scanCardFromImageUri(photo.uri);
      setDraft({
        cardNumber: result.cardNumber || '',
        cardName: result.cardName || '',
        cardExpiry: result.cardExpiry || '',
      });
    } catch (e: any) {
      setError(String(e?.message || e || 'Scan failed'));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!draft) return;
    onConfirm({
      cardNumber: String(draft.cardNumber || '').trim() || undefined,
      cardName: String(draft.cardName || '').trim() || undefined,
      cardExpiry: String(draft.cardExpiry || '').trim() || undefined,
    });
    reset();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={handleClose} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>

        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.hint}>Camera access is needed to scan the card.</Text>
            <Pressable style={styles.primaryBtn} onPress={() => requestPermission()}>
              <Text style={styles.primaryBtnText}>Allow camera</Text>
            </Pressable>
          </View>
        ) : draft ? (
          <View style={styles.confirm}>
            <Text style={styles.hint}>Check the details, then apply. Nothing is submitted yet.</Text>
            <TextInput
              style={styles.field}
              placeholder="Card number"
              placeholderTextColor={Colors.textMuted}
              value={draft.cardNumber || ''}
              onChangeText={(v) => setDraft((d) => ({ ...d, cardNumber: v }))}
              keyboardType="number-pad"
            />
            <TextInput
              style={styles.field}
              placeholder="Name on card"
              placeholderTextColor={Colors.textMuted}
              value={draft.cardName || ''}
              onChangeText={(v) => setDraft((d) => ({ ...d, cardName: v }))}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.field}
              placeholder="Expiry MM/YY"
              placeholderTextColor={Colors.textMuted}
              value={draft.cardExpiry || ''}
              onChangeText={(v) => setDraft((d) => ({ ...d, cardExpiry: v }))}
              keyboardType="numbers-and-punctuation"
            />
            <Pressable style={styles.primaryBtn} onPress={apply}>
              <Text style={styles.primaryBtnText}>Use these details</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                setDraft(null);
                setError(null);
              }}
            >
              <Text style={styles.secondaryBtnText}>Scan again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
            <Text style={styles.hint}>Hold the card steady and tap Capture. Photo is not saved.</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              onPress={capture}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Capture</Text>
              )}
            </Pressable>
            {error ? (
              <Text style={styles.hint}>Tip: fill the frame, avoid glare, and keep the card flat.</Text>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  cancel: { color: Colors.accent, fontSize: 16 },
  center: { flex: 1, justifyContent: 'center', gap: 16 },
  cameraWrap: { flex: 1, gap: 12 },
  camera: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  confirm: { flex: 1, gap: 10 },
  hint: { color: Colors.textMuted, fontSize: 13, lineHeight: 18 },
  error: { color: Colors.danger, fontSize: 13 },
  field: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    color: Colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: Colors.accent, fontSize: 15 },
  btnDisabled: { opacity: 0.6 },
});
