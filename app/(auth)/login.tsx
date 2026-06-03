import { Input } from '@/components/Input';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { AuthError } from 'firebase/auth';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

function authErrorMessage(err: unknown): string {
  const code = (err as AuthError)?.code ?? '';
  console.log('[Login] mapping error code:', code);
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
  const { signIn, driver, loading: authLoading } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && driver) {
      console.log('[Login] Already signed in, redirecting to tabs');
      router.replace('/(tabs)');
    }
  }, [authLoading, driver, router]);

  const handleSignIn = async () => {
    console.log('[Login] Sign In button pressed');

    if (!loginId.trim() || !password) {
      Alert.alert('Missing fields', 'Enter email or Driver ID and password.');
      return;
    }

    setLoading(true);
    try {
      console.log('[Login] Calling signIn…');
      await signIn(loginId.trim(), password);
      console.log('[Login] signIn succeeded, navigating to home');
      router.replace('/(tabs)');
    } catch (err) {
      console.error('[Login] signIn error:', err);
      Alert.alert('Sign In Failed', authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={sharedStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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
            accessibilityRole="button"
            accessibilityLabel="Sign In"
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
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  brand: {
    color: Colors.text,
    fontSize: 36,
    fontWeight: '800',
    textAlign: 'center',
  },
  brandAccent: { color: Colors.accent },
  tagline: {
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    fontSize: 16,
  },
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
