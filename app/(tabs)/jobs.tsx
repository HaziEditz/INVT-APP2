import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Platform, ActivityIndicator, Alert, Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useDriver } from '@/context/DriverContext';
import { COMPANY_TZ } from '@/lib/timezone';
import { useAuth } from '@/context/AuthContext';
import { AddressInput } from '@/components/AddressInput';
import * as Haptics from '@/lib/haptics';

const VEHICLE_TYPES = [
  { label: 'Any',        value: 'Not Specified', icon: 'car-outline'         },
  { label: 'Car',        value: 'Car',           icon: 'car'                 },
  { label: 'Wagon',      value: 'Wagon',         icon: 'car-sport'           },
  { label: 'Van',        value: 'Van',           icon: 'bus-outline'         },
  { label: 'SUV',        value: 'SUV',           icon: 'car-sport-outline'   },
  { label: 'Luxury',     value: 'Luxury',        icon: 'diamond-outline'     },
  { label: 'Wheelchair', value: 'Wheelchair',    icon: 'accessibility-outline'},
] as const;

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-NZ', { timeZone: COMPANY_TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-NZ', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit' });
}

type DoneState = { bookingId: string; dispatchVisible: boolean } | null;

export default function BookRideScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const botPad  = Platform.OS === 'web' ? 34 : insets.bottom;
  const { createPendingJob } = useDriver();
  const { driver } = useAuth();

  // Form state
  const [passengerName,  setPassengerName]  = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [passengerEmail, setPassengerEmail] = useState('');
  const [pickupAddress,  setPickupAddress]  = useState('');
  const [dropAddress,    setDropAddress]    = useState('');
  const [vehicleType,    setVehicleType]    = useState('Not Specified');
  const [notes,          setNotes]          = useState('');
  const [dispatcherOnly, setDispatcherOnly] = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [showVehicle,    setShowVehicle]    = useState(false);
  const [done,           setDone]           = useState<DoneState>(null);

  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setMinutes(0, 0, 0);
  const [scheduledFor,  setScheduledFor]  = useState<Date>(tomorrow);
  const [showDate,      setShowDate]      = useState(false);
  const [showTime,      setShowTime]      = useState(false);
  const [scheduleNow,   setScheduleNow]   = useState(false);

  const selectedVehicle = VEHICLE_TYPES.find(v => v.value === vehicleType) ?? VEHICLE_TYPES[0];

  const reset = () => {
    setPassengerName(''); setPassengerPhone(''); setPassengerEmail('');
    setPickupAddress(''); setDropAddress(''); setNotes('');
    setVehicleType('Not Specified'); setDispatcherOnly(true);
    setScheduleNow(false);
    const t = new Date(Date.now() + 86400000); t.setMinutes(0,0,0); setScheduledFor(t);
    setDone(null);
  };

  const handleSubmit = async () => {
    if (!passengerName.trim()) { Alert.alert('Name required', 'Please enter the passenger name.'); return; }
    if (!pickupAddress.trim()) { Alert.alert('Pickup required', 'Please enter a pickup address.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      const result = await createPendingJob({
        passengerName, passengerPhone, passengerEmail,
        pickupAddress, dropAddress, vehicleType, notes,
        scheduledFor: scheduleNow ? null : scheduledFor,
        dispatcherOnly,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(result);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not create booking. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (done) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Ionicons name="checkmark-circle" size={28} color="#22c55e" />
          <Text style={[styles.heading, { color: colors.foreground }]}>Booking Created</Text>
        </View>
        <View style={[styles.doneBox, { paddingBottom: botPad + 32 }]}>
          <View style={[styles.doneIconCircle, { backgroundColor: '#22c55e22' }]}>
            <Ionicons name="checkmark-circle" size={64} color="#22c55e" />
          </View>
          <Text style={[styles.doneTitle, { color: colors.foreground }]}>Booking Sent to Dispatch</Text>
          <Text style={[styles.doneId, { color: colors.mutedForeground }]}>Ref: {done.bookingId}</Text>
          {!done.dispatchVisible && (
            <View style={[styles.warnBox, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
              <Ionicons name="warning-outline" size={18} color="#f59e0b" />
              <Text style={[styles.warnText, { color: '#f59e0b' }]}>
                Booking saved locally — dispatcher will see it once Firebase rules are deployed to this environment.
              </Text>
            </View>
          )}
          <Text style={[styles.doneSub, { color: colors.mutedForeground }]}>
            The dispatcher will assign a driver and the job will appear as an offer.
          </Text>
          <TouchableOpacity
            style={[styles.newBookingBtn, { backgroundColor: colors.primary }]}
            onPress={reset}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle" size={22} color="#fff" />
            <Text style={styles.newBookingBtnText}>New Booking</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Ionicons name="calendar" size={28} color={colors.primary} />
        <Text style={[styles.heading, { color: colors.foreground }]}>Book a Ride</Text>
      </View>
      <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
        Create a booking — it goes straight to dispatch.
      </Text>

      <ScrollView
        contentContainerStyle={[styles.form, { paddingBottom: botPad + 80 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Passenger ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PASSENGER</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.field, { borderBottomColor: colors.border }]}>
            <Ionicons name="person-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="Full name *"
              placeholderTextColor={colors.mutedForeground}
              value={passengerName}
              onChangeText={setPassengerName}
              autoCapitalize="words"
            />
          </View>
          <View style={[styles.field, { borderBottomColor: colors.border }]}>
            <Ionicons name="call-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="Phone number"
              placeholderTextColor={colors.mutedForeground}
              value={passengerPhone}
              onChangeText={setPassengerPhone}
              keyboardType="phone-pad"
            />
          </View>
          <View style={styles.field}>
            <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="Email (optional — for confirmation)"
              placeholderTextColor={colors.mutedForeground}
              value={passengerEmail}
              onChangeText={setPassengerEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* ── Route ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ROUTE</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.field, { borderBottomColor: colors.border, zIndex: 20 }]}>
            <Ionicons name="location" size={18} color="#22c55e" />
            <View style={{ flex: 1 }}>
              <AddressInput
                value={pickupAddress}
                onChangeText={setPickupAddress}
                placeholder="Pickup address *"
                iconName="location"
                iconColor="#22c55e"
                onSelect={setPickupAddress}
              />
            </View>
          </View>
          <View style={[styles.field, { zIndex: 10 }]}>
            <Ionicons name="flag" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <AddressInput
                value={dropAddress}
                onChangeText={setDropAddress}
                placeholder="Drop-off address"
                iconName="flag"
                iconColor={colors.primary}
                onSelect={setDropAddress}
              />
            </View>
          </View>
        </View>

        {/* ── When ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WHEN</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.field, { borderBottomColor: colors.border }]}
            onPress={() => setScheduleNow(v => !v)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={scheduleNow ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={scheduleNow ? colors.primary : colors.mutedForeground}
            />
            <Text style={[styles.input, { color: scheduleNow ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              As soon as possible
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.field, { borderBottomColor: colors.border, opacity: scheduleNow ? 0.4 : 1 }]}
            onPress={() => { if (!scheduleNow) setShowDate(true); }}
            activeOpacity={scheduleNow ? 1 : 0.8}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.mutedForeground} />
            <Text style={[styles.input, { color: colors.foreground }]}>{fmtDate(scheduledFor)}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.field, { opacity: scheduleNow ? 0.4 : 1 }]}
            onPress={() => { if (!scheduleNow) setShowTime(true); }}
            activeOpacity={scheduleNow ? 1 : 0.8}
          >
            <Ionicons name="time-outline" size={18} color={colors.mutedForeground} />
            <Text style={[styles.input, { color: colors.foreground }]}>{fmtTime(scheduledFor)}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {showDate && (
          <DateTimePicker
            value={scheduledFor} mode="date" display="default"
            minimumDate={new Date()}
            onChange={(_, d) => { setShowDate(false); if (d) setScheduledFor(prev => { const n=new Date(d); n.setHours(prev.getHours(),prev.getMinutes(),0,0); return n; }); }}
          />
        )}
        {showTime && (
          <DateTimePicker
            value={scheduledFor} mode="time" display="default"
            onChange={(_, d) => { setShowTime(false); if (d) setScheduledFor(prev => { const n=new Date(prev); n.setHours(d.getHours(),d.getMinutes(),0,0); return n; }); }}
          />
        )}

        {/* ── Vehicle type ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>VEHICLE TYPE</Text>
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowVehicle(true)}
          activeOpacity={0.85}
        >
          <View style={styles.field}>
            <Ionicons name={selectedVehicle.icon as any} size={20} color={colors.primary} />
            <Text style={[styles.input, { color: colors.foreground }]}>{selectedVehicle.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </View>
        </TouchableOpacity>

        {/* ── Notes ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTES</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.field, { alignItems: 'flex-start', paddingVertical: 12 }]}>
            <Ionicons name="create-outline" size={18} color={colors.mutedForeground} style={{ marginTop: 2 }} />
            <TextInput
              style={[styles.input, { color: colors.foreground, minHeight: 64, textAlignVertical: 'top' }]}
              placeholder="Special requests, wheelchair access, child seats…"
              placeholderTextColor={colors.mutedForeground}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>
        </View>

        {/* ── Dispatcher only toggle ── */}
        <TouchableOpacity
          style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setDispatcherOnly(v => !v)}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleLabel, { color: colors.foreground }]}>For dispatcher only</Text>
            <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>
              {dispatcherOnly
                ? 'Only dispatcher can see and assign this booking'
                : 'All drivers may see this booking as an offer'}
            </Text>
          </View>
          <View style={[styles.toggleTrack, { backgroundColor: dispatcherOnly ? colors.primary : colors.border }]}>
            <View style={[styles.toggleThumb, { transform: [{ translateX: dispatcherOnly ? 20 : 2 }] }]} />
          </View>
        </TouchableOpacity>

        {/* ── Submit ── */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
          onPress={handleSubmit}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="send" size={20} color="#fff" />
              <Text style={styles.submitBtnText}>Send to Dispatch</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Vehicle picker modal ── */}
      <Modal visible={showVehicle} transparent animationType="slide" onRequestClose={() => setShowVehicle(false)}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setShowVehicle(false)} activeOpacity={1}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Vehicle Type</Text>
            {VEHICLE_TYPES.map(v => (
              <TouchableOpacity
                key={v.value}
                style={[
                  styles.vehicleRow,
                  { borderColor: colors.border },
                  v.value === vehicleType && { backgroundColor: colors.primary + '18', borderColor: colors.primary },
                ]}
                onPress={() => { setVehicleType(v.value); setShowVehicle(false); }}
                activeOpacity={0.8}
              >
                <Ionicons name={v.icon as any} size={22} color={v.value === vehicleType ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.vehicleLabel, { color: v.value === vehicleType ? colors.primary : colors.foreground }]}>
                  {v.label}
                </Text>
                {v.value === vehicleType && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1 },
  header:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  heading:    { fontSize: 26, fontWeight: '800', fontFamily: 'Inter_700Bold', flex: 1 },
  subheading: { fontSize: 14, fontFamily: 'Inter_400Regular', paddingHorizontal: 20, marginBottom: 12 },

  form:         { paddingHorizontal: 16, gap: 4 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginTop: 12, marginBottom: 6, paddingLeft: 4 },
  card:         { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  field:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1 },
  input:        { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 16, marginTop: 12 },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  toggleSub:   { fontSize: 12, fontFamily: 'Inter_400Regular' },
  toggleTrack: { width: 44, height: 26, borderRadius: 13, justifyContent: 'center' },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, boxShadow: '0px 1px 4px rgba(0,0,0,0.2)' },

  submitBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 18, gap: 10, marginTop: 16 },
  submitBtnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet:   { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, padding: 20, gap: 8 },
  modalTitle:   { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  vehicleRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, borderWidth: 1, padding: 14 },
  vehicleLabel: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold' },

  doneBox:        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  doneIconCircle: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  doneTitle:      { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  doneId:         { fontSize: 13, fontFamily: 'Inter_400Regular' },
  doneSub:        { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
  warnBox:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, borderWidth: 1.5, padding: 14 },
  warnText:       { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  newBookingBtn:  { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32 },
  newBookingBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});
