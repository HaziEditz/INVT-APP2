import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn, resetPassword, wasKicked, clearKicked } = useAuth();
  const router = useRouter();

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleForgotPassword = async () => {
    const input = loginId.trim();
    if (!input) {
      Alert.alert('Enter your login', 'Type your email address or driver ID in the field above, then tap Forgot password.');
      return;
    }
    // Driver ID entered — reset requires the email address, not the ID
    if (!input.includes('@')) {
      Alert.alert(
        'Email Required for Password Reset',
        'Password reset links are sent to your email address. Please enter your email address (e.g. name@example.com) in the field above and try again.',
      );
      return;
    }
    try {
      await resetPassword(input);
      Alert.alert('Reset email sent', `A password reset link has been sent to ${input}. Check your inbox and follow the link to set a new password, then log in here.`);
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg = code === 'auth/user-not-found'
        ? 'No account found with that email address.'
        : code === 'auth/invalid-email'
        ? 'Please enter a valid email address.'
        : 'Could not send reset email. Try again.';
      Alert.alert('Error', msg);
    }
  };

  const handleSignIn = async () => {
    if (!loginId.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your email or driver ID and password.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      await signIn(loginId.trim(), password);
      router.replace('/(tabs)/home');
    } catch (err: any) {
      console.error('Login error:', err?.code, err?.message);
      const code = err?.code ?? '';

      if (code === 'app/suspended') {
        Alert.alert('Account Suspended', err.message, [{ text: 'OK' }]);
        return;
      }
      if (code === 'app/deactivated') {
        Alert.alert('Account Deactivated', err.message, [{ text: 'OK' }]);
        return;
      }
      if (code === 'app/driver-not-found') {
        Alert.alert('Driver ID Not Set Up', err.message, [{ text: 'OK' }]);
        return;
      }

      const msg =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password'
          ? 'Incorrect password. Please check and try again.'
          : code === 'auth/user-not-found'
          ? 'No account found. Contact your company admin.'
          : code === 'auth/invalid-email'
          ? 'Invalid login. Enter your email address or driver ID (e.g. D001).'
          : code === 'auth/network-request-failed'
          ? 'Network error. Please check your connection and try again.'
          : code === 'auth/too-many-requests'
          ? 'Too many failed attempts. Please wait a moment before trying again.'
          : code === 'auth/user-disabled'
          ? 'This account has been disabled. Contact your company admin.'
          : `Sign in failed (${code || 'unknown'}). Please try again.`;
      Alert.alert('Sign In Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.root, { backgroundColor: colors.background }]}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: 32, paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* v22ah: BUILD label on login screen — driver requested visibility
            BEFORE sign-in so they can verify the OTA loaded without having
            to sign in (and risk a crash). If this number doesn't match the
            latest OTA, kill the app and reopen until it does. */}
        <View style={{
          alignSelf: 'center',
          backgroundColor: '#FFC10722',
          borderColor: '#FFC107',
          borderWidth: 1,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 10,
          marginTop: 8,
          marginBottom: 16,
        }}>
          <Text style={{
            color: '#FFC107',
            fontFamily: 'Inter_700Bold',
            fontSize: 14,
            textAlign: 'center',
          }}>
            BUILD: ota22c-cutover-d4
          </Text>
          <Text style={{
            color: colors.mutedForeground,
            fontFamily: 'Inter_400Regular',
            fontSize: 10,
            textAlign: 'center',
            marginTop: 2,
          }}>
            kill app + reopen twice to load new builds
          </Text>
        </View>

        <View style={styles.header}>
          <View style={[styles.logoBox, { backgroundColor: colors.primary }]}>
            <Ionicons name="car" size={36} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Booka<Text style={{ color: colors.primary }}>waka</Text>
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Driver Portal</Text>
        </View>

        {/* ── Session kick banner ── */}
        {wasKicked && (
          <View style={[styles.kickBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
            <View style={[styles.kickIconWrap, { backgroundColor: '#f59e0b22' }]}>
              <Ionicons name="phone-portrait-outline" size={22} color="#f59e0b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kickTitle, { color: '#f59e0b' }]}>Signed Out — Another Device Logged In</Text>
              <Text style={[styles.kickBody, { color: colors.mutedForeground }]}>
                Your account was opened on another device, so you were signed out here. Sign in again to continue.
              </Text>
            </View>
            <TouchableOpacity onPress={clearKicked} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Ionicons name="close" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Email or Driver ID</Text>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="person-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="e.g. D001 or name@example.com"
              placeholderTextColor={colors.mutedForeground}
              value={loginId}
              onChangeText={setLoginId}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
            />
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>Password</Text>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              key={showPassword ? 'pw-show' : 'pw-hide'}
              style={[styles.input, { color: colors.foreground }]}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="current-password"
            />
            <TouchableOpacity onPress={() => setShowPassword(v => !v)}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotBtn}>
            <Text style={[styles.forgotText, { color: colors.primary }]}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.signInBtn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
            onPress={handleSignIn}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.signInText, { color: colors.primaryForeground }]}>Sign In</Text>
            }
          </TouchableOpacity>
        </View>

        <View style={[styles.firebaseNote, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
            Powered by Bookawaka
          </Text>
        </View>

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>New to the platform?</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <TouchableOpacity
          style={[styles.becomeBtn, { backgroundColor: colors.surface, borderColor: colors.primary + '55' }]}
          onPress={() => router.push('/register')}
          activeOpacity={0.8}
        >
          <View style={[styles.becomeBtnIcon, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="car-sport-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.becomeBtnTitle, { color: colors.foreground }]}>Become a Driver</Text>
            <Text style={[styles.becomeBtnSub, { color: colors.mutedForeground }]}>Join Bookawaka — set up your own fleet</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={colors.primary} />
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 28 },
  header: { alignItems: 'center', gap: 12, marginBottom: 40 },
  logoBox: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 36, fontWeight: '800', letterSpacing: -1, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 16, fontFamily: 'Inter_400Regular' },
  form: { gap: 4, marginBottom: 28 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 8, letterSpacing: 0.3 },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
  forgotBtn: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 4 },
  forgotText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  signInBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  signInText: { fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  firebaseNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  noteText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 20,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  becomeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  becomeBtnIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  becomeBtnTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  becomeBtnSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  kickBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 20,
  },
  kickIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  kickTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  kickBody: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
});
