import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { createUserWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { ref, set, update, serverTimestamp } from 'firebase/database';
import { auth, database } from '@/lib/firebase';
import { useColors } from '@/hooks/useColors';
import * as Haptics from '@/lib/haptics';

type Step = 1 | 2 | 3;

interface FormData {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  companyCode: string;
  licenceNumber: string;
  vehicleType: string;
}

const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van / MPV', 'Wheelchair Accessible', 'Other'];

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [vehicleMenuOpen, setVehicleMenuOpen] = useState(false);

  const [form, setForm] = useState<FormData>({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    companyCode: '',
    licenceNumber: '',
    vehicleType: '',
  });

  const set1 = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  const validateStep1 = (): boolean => {
    if (!form.fullName.trim()) { Alert.alert('Missing field', 'Please enter your full name.'); return false; }
    if (!form.email.trim() || !form.email.includes('@')) { Alert.alert('Invalid email', 'Please enter a valid email address.'); return false; }
    if (!form.phone.trim()) { Alert.alert('Missing field', 'Please enter your phone number.'); return false; }
    if (form.password.length < 6) { Alert.alert('Weak password', 'Password must be at least 6 characters.'); return false; }
    if (form.password !== form.confirmPassword) { Alert.alert('Password mismatch', 'Passwords do not match.'); return false; }
    return true;
  };

  const validateStep2 = (): boolean => {
    if (!form.companyCode.trim()) { Alert.alert('Missing field', 'Please enter your company code.'); return false; }
    if (!form.licenceNumber.trim()) { Alert.alert('Missing field', 'Please enter your driver licence number.'); return false; }
    if (!form.vehicleType) { Alert.alert('Missing field', 'Please select your vehicle type.'); return false; }
    return true;
  };

  const handleNext = () => {
    if (step === 1) {
      if (!validateStep1()) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(2);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep2()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);

    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password);
      const uid = cred.user.uid;
      const companyId = form.companyCode.trim();

      const registrationData = {
        uid,
        name: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        licenceNumber: form.licenceNumber.trim(),
        vehicleType: form.vehicleType,
        status: 'pending',
        registeredAt: serverTimestamp(),
      };

      await set(ref(database, `driverRegistrations/${companyId}/${uid}`), registrationData);

      await set(ref(database, `drivers/${companyId}/${uid}`), {
        name: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        licenceNumber: form.licenceNumber.trim(),
        vehicleType: form.vehicleType,
        companyId,
        status: 'pending',
        approved: false,
        createdAt: serverTimestamp(),
      });

      // Stamp the top-level UID-keyed node so this driver is discoverable across companies.
      // sharedWith is intentionally not written here — it is admin-managed in the owner panel.
      await update(ref(database, `drivers/${uid}`), {
        companyId,
        uid,
        email: form.email.trim(),
      });

      // Sign out the new Firebase Auth account — the driver cannot use the
      // app until the admin approves them. They will sign in after approval.
      await firebaseSignOut(auth).catch(() => {});

      setStep(3);
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg =
        code === 'auth/email-already-in-use'
          ? 'An account with this email already exists. Try signing in instead.'
          : code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : code === 'auth/network-request-failed'
          ? 'Network error. Please check your connection and try again.'
          : `Registration failed. Please try again. (${code || err?.message || 'unknown'})`;
      Alert.alert('Registration Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const progressDot = (n: number) => (
    <View
      key={n}
      style={[
        styles.dot,
        {
          backgroundColor: step >= n ? colors.primary : colors.border,
          width: step === n ? 24 : 8,
        },
      ]}
    />
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            {step < 3 ? (
              <TouchableOpacity
                onPress={() => (step === 1 ? router.back() : setStep(1))}
                style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Ionicons name="chevron-back" size={20} color={colors.foreground} />
              </TouchableOpacity>
            ) : <View style={{ width: 40 }} />}
            <View style={styles.progressRow}>{[1, 2, 3].map(progressDot)}</View>
            <View style={{ width: 40 }} />
          </View>

          {/* Logo + title */}
          <View style={styles.titleBlock}>
            <View style={[styles.logoBox, { backgroundColor: colors.primary }]}>
              <Ionicons name="car-sport" size={32} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {step === 1 ? 'Create Account' : step === 2 ? 'Your Details' : 'Application Sent'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {step === 1
                ? 'Step 1 of 2 — Personal information'
                : step === 2
                ? 'Step 2 of 2 — Driver & vehicle info'
                : 'Pending admin approval'}
            </Text>
          </View>

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <View style={styles.form}>
              <FieldLabel label="Full Name" colors={colors} />
              <InputBox
                icon="person-outline"
                placeholder="e.g. John Smith"
                value={form.fullName}
                onChangeText={v => set1('fullName', v)}
                colors={colors}
                autoCapitalize="words"
              />

              <FieldLabel label="Email Address" colors={colors} />
              <InputBox
                icon="mail-outline"
                placeholder="your@email.com"
                value={form.email}
                onChangeText={v => set1('email', v)}
                colors={colors}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <FieldLabel label="Phone Number" colors={colors} />
              <InputBox
                icon="call-outline"
                placeholder="+64 21 000 0000"
                value={form.phone}
                onChangeText={v => set1('phone', v)}
                colors={colors}
                keyboardType="phone-pad"
              />

              <FieldLabel label="Password" colors={colors} />
              <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  key={showPassword ? 'reg-pw-show' : 'reg-pw-hide'}
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="At least 6 characters"
                  placeholderTextColor={colors.mutedForeground}
                  value={form.password}
                  onChangeText={v => set1('password', v)}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(v => !v)}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <FieldLabel label="Confirm Password" colors={colors} />
              <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  key={showConfirm ? 'reg-cf-show' : 'reg-cf-hide'}
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="Re-enter password"
                  placeholderTextColor={colors.mutedForeground}
                  value={form.confirmPassword}
                  onChangeText={v => set1('confirmPassword', v)}
                  secureTextEntry={!showConfirm}
                />
                <TouchableOpacity onPress={() => setShowConfirm(v => !v)}>
                  <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={handleNext}
                activeOpacity={0.85}
              >
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.primaryForeground} />
              </TouchableOpacity>
            </View>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <View style={styles.form}>
              <View style={[styles.infoBox, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}>
                <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
                <Text style={[styles.infoText, { color: colors.primary }]}>
                  Your company code is provided by your fleet manager or company admin.
                </Text>
              </View>

              <FieldLabel label="Company Code" colors={colors} />
              <InputBox
                icon="business-outline"
                placeholder="e.g. 382805"
                value={form.companyCode}
                onChangeText={v => set1('companyCode', v)}
                colors={colors}
                keyboardType="number-pad"
              />

              <FieldLabel label="Driver Licence Number" colors={colors} />
              <InputBox
                icon="card-outline"
                placeholder="e.g. AB123456"
                value={form.licenceNumber}
                onChangeText={v => set1('licenceNumber', v.toUpperCase())}
                colors={colors}
                autoCapitalize="characters"
              />

              <FieldLabel label="Vehicle Type" colors={colors} />
              <TouchableOpacity
                style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setVehicleMenuOpen(v => !v)}
                activeOpacity={0.8}
              >
                <Ionicons name="car-outline" size={18} color={colors.mutedForeground} />
                <Text style={[styles.input, { color: form.vehicleType ? colors.foreground : colors.mutedForeground, paddingVertical: 0 }]}>
                  {form.vehicleType || 'Select vehicle type'}
                </Text>
                <Ionicons name={vehicleMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
              </TouchableOpacity>

              {vehicleMenuOpen && (
                <View style={[styles.vehicleMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {VEHICLE_TYPES.map(vt => (
                    <TouchableOpacity
                      key={vt}
                      style={[
                        styles.vehicleOption,
                        { borderBottomColor: colors.border },
                        form.vehicleType === vt && { backgroundColor: colors.primary + '15' },
                      ]}
                      onPress={() => { set1('vehicleType', vt); setVehicleMenuOpen(false); }}
                    >
                      <Text style={[styles.vehicleOptionText, { color: colors.foreground }]}>{vt}</Text>
                      {form.vehicleType === vt && (
                        <Ionicons name="checkmark" size={16} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1, marginTop: vehicleMenuOpen ? 4 : 20 }]}
                onPress={handleSubmit}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <>
                      <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Submit Application</Text>
                      <Ionicons name="checkmark-circle-outline" size={18} color={colors.primaryForeground} />
                    </>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* ── STEP 3 — Success ── */}
          {step === 3 && (
            <View style={styles.successBlock}>
              <View style={[styles.successIcon, { backgroundColor: colors.success + '20' }]}>
                <Ionicons name="checkmark-circle" size={56} color={colors.success} />
              </View>

              <Text style={[styles.successTitle, { color: colors.foreground }]}>Application Submitted!</Text>
              <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
                Your driver application has been sent to your company admin for review. You will be notified once your account is approved.
              </Text>

              <View style={[styles.pendingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Row icon="person-outline" label="Name" value={form.fullName} colors={colors} />
                <Row icon="mail-outline" label="Email" value={form.email} colors={colors} />
                <Row icon="business-outline" label="Company Code" value={form.companyCode} colors={colors} />
                <Row icon="car-outline" label="Vehicle Type" value={form.vehicleType} colors={colors} last />
              </View>

              <View style={[styles.statusBadge, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b40' }]}>
                <Ionicons name="time-outline" size={14} color="#f59e0b" />
                <Text style={[styles.statusText, { color: '#f59e0b' }]}>Pending admin approval</Text>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 8 }]}
                onPress={() => router.replace('/login')}
                activeOpacity={0.85}
              >
                <Ionicons name="log-in-outline" size={18} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Back to Sign In</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FieldLabel({ label, colors }: { label: string; colors: any }) {
  return (
    <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
  );
}

function InputBox({
  icon, placeholder, value, onChangeText, colors, keyboardType, autoCapitalize, secureTextEntry,
}: {
  icon: string; placeholder: string; value: string;
  onChangeText: (v: string) => void; colors: any;
  keyboardType?: any; autoCapitalize?: any; secureTextEntry?: boolean;
}) {
  return (
    <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon as any} size={18} color={colors.mutedForeground} />
      <TextInput
        style={[styles.input, { color: colors.foreground }]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
}

function Row({ icon, label, value, colors, last }: { icon: string; label: string; value: string; colors: any; last?: boolean }) {
  return (
    <View style={[styles.cardRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <Ionicons name={icon as any} size={15} color={colors.mutedForeground} />
      <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.cardValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 24, paddingTop: 16 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { height: 8, borderRadius: 4 },

  titleBlock: { alignItems: 'center', gap: 10, marginBottom: 32 },
  logoBox: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 26, fontWeight: '800', fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  form: { gap: 4 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 8, marginTop: 14, letterSpacing: 0.3 },
  inputBox: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, paddingVertical: 16, marginTop: 20,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 4,
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  vehicleMenu: {
    borderRadius: 14, borderWidth: 1,
    marginTop: 4, overflow: 'hidden',
  },
  vehicleOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  vehicleOptionText: { fontSize: 15, fontFamily: 'Inter_400Regular' },

  successBlock: { alignItems: 'center', gap: 16, paddingTop: 8 },
  successIcon: {
    width: 100, height: 100, borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  successBody: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 22, paddingHorizontal: 8,
  },

  pendingCard: {
    width: '100%', borderRadius: 16, borderWidth: 1,
    overflow: 'hidden', marginTop: 4,
  },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  cardLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', width: 100 },
  cardValue: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'right' },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
  },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
