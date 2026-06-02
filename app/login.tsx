import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { sharedStyles } from '@/constants/styles';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!loginId.trim() || !password) {
      Alert.alert('Missing fields', 'Enter email or Driver ID and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(loginId.trim(), password);
    } catch (e) {
      Alert.alert('Login failed', e instanceof Error ? e.message : 'Unable to sign in');
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
          />
          <Input
            label="Password"
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Button title={loading ? 'Signing in…' : 'Sign In'} onPress={onSubmit} disabled={loading} />
        </View>

        <Link href="/register" asChild>
          <Button title="Become a Driver" variant="secondary" />
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
});
