import { Input } from '@/components/Input';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { resolveEmailForLogin } from '@/lib/driverAuth';
import { getAuthInstance, isFirebaseReady } from '@/lib/firebase';
import { removeData, STORAGE_KEYS } from '@/lib/storage';
import { AuthError, signInWithEmailAndPassword } from 'firebase/auth';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function authErrorMessage(err: unknown): string {
  const code = (err as AuthError)?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again.';
    case 'auth/user-not-found':
      return 'No account found. Contact your fleet administrator.';
    case 'auth/invalid-email':
      return 'Invalid email format.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    default:
      return err instanceof Error ? err.message : 'Unable to sign in.';
  }
}

export default function LoginScreen() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    const trimmed = loginId.trim();
    if (!trimmed || !password) {
      Alert.alert('Missing fields', 'Enter your email or Driver ID (e.g. D001) and password.');
      return;
    }

    if (!isFirebaseReady) {
      Alert.alert('Sign In Failed', 'Firebase is not ready. Restart the app and try again.');
      return;
    }

    setLoading(true);
    try {
      const emailToUse = await resolveEmailForLogin(trimmed);
      const auth = getAuthInstance();
      await signInWithEmailAndPassword(auth, emailToUse, password);
      await removeData(STORAGE_KEYS.vehicleSessionReady);
      router.replace('/select-vehicle');
    } catch (err) {
      Alert.alert('Sign In Failed', authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={sharedStyles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.brand}>
            Booka<Text style={styles.brandAccent}>Waka</Text>
          </Text>
          <Text style={styles.tagline}>Driver Portal</Text>

          <View style={sharedStyles.card}>
            <Input
              label="Email or Driver ID"
              placeholder="you@email.com or D001"
              autoCapitalize="none"
              value={loginId}
              onChangeText={setLoginId}
              onSubmitEditing={handleSignIn}
              returnKeyType="next"
            />
            <Input
              label="Password"
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleSignIn}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.signInBtn, loading && styles.signInBtnDisabled]}
              onPress={handleSignIn}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.signInText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          <Link href="/register" asChild>
            <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.85}>
              <Text style={styles.secondaryText}>Become a Driver</Text>
            </TouchableOpacity>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 16,
    minHeight: '100%',
  },
  brand: { color: Colors.text, fontSize: 36, fontWeight: '800', textAlign: 'center' },
  brandAccent: { color: Colors.accent },
  tagline: { color: Colors.textMuted, textAlign: 'center', marginBottom: 24, fontSize: 16 },
  signInBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  signInBtnDisabled: { opacity: 0.7 },
  signInText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryText: { color: Colors.text, fontSize: 16, fontWeight: '600' },
});
