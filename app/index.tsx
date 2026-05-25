import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { driver, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (driver) {
        router.replace('/(tabs)/meter');
      } else {
        router.replace('/login');
      }
    }
  }, [driver, isLoading]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0A0F', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#F7C948" size="large" />
    </View>
  );
}
