/**
 * PassengerContactBar (v22bn)
 *
 * One-tap passenger contact for every booking source (dispatch / hail /
 * website / passenger app / account). Drops into:
 *   - Incoming offer modal (so a confused driver can call before accepting)
 *   - Job details sheet
 *   - Active job card on the Meter tab (most-used — arrived but no passenger)
 *
 * Two big buttons:
 *   - Call    → Linking.openURL('tel:…')
 *   - Text    → quick-pick modal with canned messages, then sms: URI
 *
 * Quick texts are tap-to-send: opens the OS SMS composer pre-filled with the
 * message, driver hits send. No background SMS API needed.
 *
 * Logs each contact attempt to Firebase `driverContactLog/{cid}/{bookingId}`
 * so dispatch HQ can see when the driver tried to reach the passenger
 * (useful for no-show disputes). Best-effort write, never blocks the action.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Linking, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ref, set } from 'firebase/database';
import { database } from '@/lib/firebase';
import { useColors } from '@/hooks/useColors';
import * as Haptics from '@/lib/haptics';

type Props = {
  phone?: string | null;
  passengerName?: string | null;
  bookingId?: string | null;
  source?: string | null; // 'dispatch' | 'hail' | 'website' | 'passenger' | 'account'
  companyId?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  compact?: boolean; // smaller variant for offer cards
};

const CANNED = [
  { id: 'arrived',  label: "I've arrived",          template: (d: string) => `${d ? d + ': ' : ''}I have arrived at the pickup location.` },
  { id: 'onway',    label: "I'm on the way",        template: (d: string) => `${d ? d + ': ' : ''}I'm on my way to pick you up.` },
  { id: 'late5',    label: "Running 5 min late",    template: (d: string) => `${d ? d + ': ' : ''}I'm running about 5 minutes late — sorry for the wait.` },
  { id: 'outside',  label: "Outside, can't see you",template: (d: string) => `${d ? d + ': ' : ''}I'm outside at the pickup but can't see you — can you confirm your exact location?` },
  { id: 'call',     label: "Please call me back",   template: (d: string) => `${d ? d + ': ' : ''}Hi, this is your driver. Please give me a call back when you can.` },
];

function logContact(
  kind: 'call' | 'sms',
  templateId: string | null,
  { phone, bookingId, source, companyId, driverId, driverName }: Props,
) {
  if (!companyId || !bookingId) return; // can't log without keys — silent
  try {
    const stamp = Date.now();
    const path = `driverContactLog/${companyId}/${bookingId}/${stamp}`;
    set(ref(database, path), {
      at:        new Date(stamp).toISOString(),
      kind,
      template:  templateId ?? null,
      phone:     phone  ?? null,
      source:    source ?? null,
      driverId:  driverId  ?? null,
      driverName:driverName ?? null,
    }).catch(() => {});
  } catch {}
}

export function PassengerContactBar(props: Props) {
  const colors = useColors();
  const [smsOpen, setSmsOpen] = useState(false);

  const phone = (props.phone ?? '').trim();
  if (!phone) return null;

  const sanitised = phone.replace(/[^\d+]/g, '');

  const onCall = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    logContact('call', null, props);
    const url = `tel:${sanitised}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Cannot place call', `Your device cannot dial ${phone}.`);
    });
  };

  const onSms = (templateId: string, body: string) => {
    setSmsOpen(false);
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    logContact('sms', templateId, props);
    // iOS uses sms:NUMBER&body=…  Android uses sms:NUMBER?body=…
    const sep = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${sanitised}${sep}body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Cannot send text', `Your device cannot send a text to ${phone}.`);
    });
  };

  const compact = !!props.compact;

  return (
    <>
      <View style={[styles.row, compact && styles.rowCompact]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onCall}
          style={[
            styles.btn,
            { backgroundColor: '#22c55e', borderColor: '#16a34a' },
            compact && styles.btnCompact,
          ]}
        >
          <Ionicons name="call" size={compact ? 14 : 16} color="#fff" />
          <Text style={[styles.btnText, compact && styles.btnTextCompact]}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setSmsOpen(true)}
          style={[
            styles.btn,
            { backgroundColor: colors.primary, borderColor: colors.primary },
            compact && styles.btnCompact,
          ]}
        >
          <Ionicons name="chatbubble" size={compact ? 14 : 16} color="#000" />
          <Text style={[styles.btnText, { color: '#000' }, compact && styles.btnTextCompact]}>Text</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={smsOpen} transparent animationType="fade" onRequestClose={() => setSmsOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setSmsOpen(false)}
          style={styles.overlay}
        >
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                Text {props.passengerName ?? 'passenger'}
              </Text>
              <TouchableOpacity onPress={() => setSmsOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
              Pick a message — your phone will open with it ready to send.
            </Text>
            {CANNED.map(c => (
              <TouchableOpacity
                key={c.id}
                onPress={() => onSms(c.id, c.template(props.driverName ?? ''))}
                activeOpacity={0.85}
                style={[styles.cannedBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
                <Text style={[styles.cannedLabel, { color: colors.foreground }]}>{c.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => { setSmsOpen(false); const sep = Platform.OS === 'ios' ? '&' : '?';
                logContact('sms', 'blank', props);
                Linking.openURL(`sms:${sanitised}${sep}body=`).catch(() =>
                  Alert.alert('Cannot send text', `Your device cannot send a text to ${phone}.`));
              }}
              style={[styles.customBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="create-outline" size={16} color={colors.mutedForeground} />
              <Text style={[styles.customLabel, { color: colors.mutedForeground }]}>Write a custom message</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row:         { flexDirection: 'row', gap: 8, marginTop: 8 },
  rowCompact:  { gap: 6, marginTop: 6 },
  btn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  btnCompact:  { paddingVertical: 7, borderRadius: 8 },
  btnText:     { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14 },
  btnTextCompact:{ fontSize: 12 },
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:       { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 18, paddingBottom: 32, gap: 8 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle:  { fontFamily: 'Inter_700Bold', fontSize: 18 },
  sheetSub:    { fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 6 },
  cannedBtn:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, borderWidth: 1 },
  cannedLabel: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  customBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', marginTop: 4 },
  customLabel: { fontFamily: 'Inter_500Medium', fontSize: 13 },
});
