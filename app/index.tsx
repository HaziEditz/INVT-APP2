import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  const { firebaseUser, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (firebaseUser) return <Redirect href="/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
