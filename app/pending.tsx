import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ref, onValue, off } from 'firebase/database';
import { database } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function PendingScreen() {
  const { driver, signOut } = useAuth();
  const router = useRouter();
  const colors = useColors();

  useEffect(() => {
    if (!driver?.uid || !driver?.companyId) return;
    const approvedRef = ref(database, `drivers/${driver.companyId}/${driver.uid}/approved`);
    const unsub = onValue(approvedRef, (snap) => {
      const val = snap.val();
      if (val === true) {
        router.replace('/onboarding');
      }
    });
    return () => off(approvedRef);
  }, [driver?.uid, driver?.companyId]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>

      <View style={styles.center}>

        <View style={[styles.iconCircle, { backgroundColor: colors.warning + '22' }]}>
          <Ionicons name="time-outline" size={52} color={colors.warning} />
        </View>

        <Text style={[styles.heading, { color: colors.foreground }]}>
          Pending Approval
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Your account is waiting for approval from your dispatcher. You'll be let in automatically as soon as they approve you — no need to refresh.
        </Text>

        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Name</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{driver?.name ?? '—'}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Email</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={1}>{driver?.email ?? '—'}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.infoRow}>
            <Ionicons name="business-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Company</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{driver?.companyId ?? '—'}</Text>
          </View>
        </View>

        <View style={[styles.waitingRow, { backgroundColor: colors.warning + '15', borderColor: colors.warning + '44' }]}>
          <ActivityIndicator size="small" color={colors.warning} />
          <Text style={[styles.waitingText, { color: colors.warning }]}>Waiting for dispatcher approval…</Text>
        </View>

      </View>

      <TouchableOpacity
        style={[styles.signOutBtn, { borderColor: colors.border }]}
        onPress={signOut}
        activeOpacity={0.75}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.mutedForeground} />
        <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign Out</Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 20,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heading: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  infoCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  infoLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    width: 60,
  },
  infoValue: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    flex: 1,
  },
  divider: {
    height: 1,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    width: '100%',
  },
  waitingText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  signOutText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
});
