import { useAuthOptional } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  // Optional: if root layout failed to mount AuthProvider (e.g. native module
  // import crash), do not hard-crash — fall through to login.
  const auth = useAuthOptional();

  if (!auth) return <Redirect href="/(auth)/login" />;

  const { firebaseUser, loading } = auth;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (firebaseUser) return <Redirect href="/select-vehicle" />;
  return <Redirect href="/(auth)/login" />;
}
