import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  Platform, KeyboardAvoidingView, ScrollView, Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { get, ref } from 'firebase/database';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useDriver } from '@/context/DriverContext';
import { database } from '@/lib/firebase';

const { width: SCREEN_W } = Dimensions.get('window');
const STEP_COUNT = 2;

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { driver, updateVehicleId, updateName, clearJustSignedIn } = useAuth();
  const { startShift, shiftActive } = useDriver();

  const [step, setStep] = useState(0);
  const [vehicleInput, setVehicleInput] = useState(driver?.vehicleId ?? '');
  const [nameInput] = useState(
    driver?.name && !driver.name.includes('@') ? driver.name : ''
  );
  const [saving, setSaving] = useState(false);

  const [vehicles, setVehicles] = useState<string[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!driver?.companyId) {
      setVehiclesLoading(false);
      return;
    }

    let cancelled = false;
    const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    const hardStop = setTimeout(() => {
      if (cancelled) return;
      console.warn('[Onboarding] Vehicle load hard-timeout (10s) — falling back to last-used vehicle');
      const last = driver?.vehicleId?.trim().toUpperCase();
      setVehicles(last ? [last] : []);
      setVehiclesLoading(false);
      if (last && !vehicleInput) setVehicleInput(last);
    }, 10000);

    const loadVehicles = async () => {
      setVehiclesLoading(true);
      // Vehicles allocated to THIS driver by admin
      const allocated: string[] = [];
      // Vehicles currently active (taken) by another driver
      const taken = new Set<string>();

      try {
        // ── Step 1: Collect vehicles allocated to this driver ─────────────────
        // Admin can allocate vehicles via:
        //   a) assignedVehicles array/object in the driver profile
        //   b) assignedVehicleIds array/object (alternate field name)
        //   c) single vehicleId field (legacy / single-vehicle drivers)
        // We read the driver profile keyed by Firebase UID (and by numeric id if different).
        const profilePaths = [
          `drivers/${driver.companyId}/${driver.uid}`,
          ...(driver.id && driver.id !== driver.uid
            ? [`drivers/${driver.companyId}/${driver.id}`]
            : []),
        ];
        for (const path of profilePaths) {
          try {
            const snap = await get(ref(database, path));
            if (!snap.exists()) continue;
            const data = snap.val() as Record<string, any>;
            console.log('[Onboarding] Driver Firebase profile at', path, '— keys:', Object.keys(data).join(', '));

            // Normalize helper — uppercase so "t003" and "T003" are treated identically
            const norm = (v: any): string | null =>
              v && typeof v === 'string' ? v.trim().toUpperCase() : null;

            // Multi-vehicle fields — admin consoles use various names and shapes:
            //   assignedVehicles / assignedVehicleIds / vehicles  → values are vehicle ID strings
            //   vehicleIds  → keys are vehicle IDs, values are boolean (true/false)
            for (const field of ['assignedVehicles', 'assignedVehicleIds', 'vehicles']) {
              const raw = data[field];
              if (!raw) continue;
              if (Array.isArray(raw)) {
                raw.forEach((v: any) => { const n = norm(v); if (n) allocated.push(n); });
              } else if (typeof raw === 'object') {
                Object.values(raw).forEach((v: any) => { const n = norm(v); if (n) allocated.push(n); });
              }
            }
            // vehicleIds: object where KEYS are the vehicle IDs (values are booleans)
            // e.g. { "T201": true, "t003": true }
            if (data.vehicleIds && typeof data.vehicleIds === 'object' && !Array.isArray(data.vehicleIds)) {
              Object.entries(data.vehicleIds).forEach(([k, v]) => {
                const n = norm(k);
                if (n && v) allocated.push(n); // only include if value is truthy (not false/removed)
              });
            }

            // Single vehicle: vehicleId / VehicleId / SelectedVehicleid
            const single = data.vehicleId || data.VehicleId || data.SelectedVehicleid || data.vehicle_id || '';
            const n = norm(single);
            if (n) allocated.push(n);
          } catch {}
        }

        // ── Step 2: Find which allocated vehicles are already taken ───────────
        // Primary check: vehicles/{companyId}/{vehicleId}/currentDriverId
        //   — written when a driver starts their shift, cleared when they end it.
        //   This persists even while the driver is off-shift so the vehicle
        //   stays locked to them between shifts.
        // Fallback check: online/{companyId}/{vehicleId}/current
        //   — active-shift presence used as a safety net for vehicles that
        //   haven't been stamped yet (e.g. first run after this update).
        const myId = String(driver.id ?? driver.uid ?? '');

        // Primary: check vehicle claim stamps
        const unique_allocated = [...new Set(allocated)].filter(Boolean);
        await Promise.all(unique_allocated.map(async (vId) => {
          try {
            const vSnap = await get(ref(database, `vehicles/${driver.companyId}/${vId}`));
            if (!vSnap.exists()) return;
            const claimedBy = String(vSnap.val()?.currentDriverId ?? '');
            if (claimedBy && claimedBy !== myId) {
              console.log('[Onboarding] Vehicle', vId, 'claimed by', claimedBy, '— marking taken');
              taken.add(vId.toLowerCase());
            }
          } catch {}
        }));

        // Fallback: active-shift presence (catches vehicles with no stamp yet)
        const onlineSnap = await get(ref(database, `online/${driver.companyId}`));
        if (onlineSnap.exists()) {
          const onlineData = onlineSnap.val() as Record<string, any>;
          Object.entries(onlineData).forEach(([vehicleId, data]) => {
            if (!data?.current) return;
            const status: string   = data.current.vehiclestatus ?? '';
            const onlineDriverId   = String(data.current.driverid ?? '');
            const vId              = vehicleId.trim().toLowerCase();
            const isMySlot         = onlineDriverId === myId;
            const isActive         = status !== '' && status !== 'Away';
            if (!isMySlot && isActive) taken.add(vId);
          });
        }

      } catch (err) {
        console.warn('[Onboarding] Vehicle load failed:', err);
      }

      // ── Fallback: if admin has not set assignedVehicles, show ALL company vehicles ──
      // This handles new companies where the owner panel hasn't written assignedVehicles yet.
      if (allocated.length === 0) {
        try {
          // Try vehicles/{companyId} first (structured vehicle registry)
          const allVehiclesSnap = await get(ref(database, `vehicles/${driver.companyId}`));
          if (allVehiclesSnap.exists()) {
            allVehiclesSnap.forEach((child) => {
              const vId = child.key?.trim().toUpperCase();
              if (vId) allocated.push(vId);
            });
            console.log('[Onboarding] No assigned vehicles — loaded all company vehicles:', allocated);
          } else {
            // Try online/{companyId} as secondary fallback (vehicles currently registered)
            const onlineVehiclesSnap = await get(ref(database, `online/${driver.companyId}`));
            if (onlineVehiclesSnap.exists()) {
              onlineVehiclesSnap.forEach((child) => {
                const vId = child.key?.trim().toUpperCase();
                if (vId) allocated.push(vId);
              });
              console.log('[Onboarding] No assigned vehicles — loaded from online presence:', allocated);
            }
          }
        } catch (err) {
          console.warn('[Onboarding] Fallback vehicle load failed:', err);
        }
      }

      // Safety net: always include the driver's last-used vehicleId in the allocated list
      if (driver?.vehicleId?.trim()) allocated.push(driver.vehicleId.trim().toUpperCase());

      // Deduplicate, then show ONLY available (not taken) vehicles, sorted
      // taken set uses lowercase keys — compare lowercase to handle case mismatches (T201 vs t201)
      const unique    = [...new Set(allocated)].filter(Boolean);
      const available = unique.filter(v => !taken.has(v.toLowerCase())).sort();

      console.log('[Onboarding] Allocated:', unique, '— Taken:', [...taken], '— Available:', available);
      if (cancelled) return;
      clearTimeout(hardStop);
      setVehicles(available);
      setVehiclesLoading(false);

      // Auto-select: if only one vehicle is free, pick it automatically.
      // Also pre-select the driver's last-used vehicle if it's still free.
      const current = driver?.vehicleId?.trim().toUpperCase();
      if (available.length === 1) {
        setVehicleInput(available[0]);
      } else if (current && available.includes(current)) {
        setVehicleInput(current);
      } else if (available.length > 0 && !vehicleInput) {
        setVehicleInput(available[0]);
      }
    };

    loadVehicles().catch((err) => {
      console.warn('[Onboarding] loadVehicles threw:', err);
      if (cancelled) return;
      clearTimeout(hardStop);
      const last = driver?.vehicleId?.trim().toUpperCase();
      setVehicles(last ? [last] : []);
      setVehiclesLoading(false);
      if (last && !vehicleInput) setVehicleInput(last);
    });

    return () => {
      cancelled = true;
      clearTimeout(hardStop);
    };
  }, [driver?.companyId, driver?.uid]);

  const animateToStep = (next: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: false }),
    ]).start(() => {
      setStep(next);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: false, tension: 120, friction: 10 }),
      ]).start();
    });
    Animated.timing(slideAnim, { toValue: -20, duration: 150, useNativeDriver: false }).start();
  };

  const withDeadline = async <T,>(p: Promise<T>, ms: number, label: string): Promise<void> => {
    try {
      await Promise.race([
        p,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
      ]);
    } catch (err) {
      console.warn('[Onboarding]', label, 'failed/timeout — continuing anyway:', err);
    }
  };

  const handleNext = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (step === 0) {
      const trimVehicle = vehicleInput.trim();
      if (!trimVehicle) return;
      setSaving(true);
      await withDeadline(updateVehicleId(trimVehicle), 8000, 'updateVehicleId');
      if (nameInput.trim()) await withDeadline(updateName(nameInput.trim()), 5000, 'updateName');
      setSaving(false);
      animateToStep(1);
    } else {
      setSaving(true);
      await withDeadline(startShift(), 10000, 'startShift');
      clearJustSignedIn();
      setSaving(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/home');
    }
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 24 : insets.bottom + 24;


  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Progress dots */}
      <View style={[styles.progressBar, { paddingTop: 16 }]}>
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: i <= step ? colors.primary : colors.border,
                width: i === step ? 28 : 8,
              },
            ]}
          />
        ))}
      </View>

      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* ── Step 0: Vehicle selection ── */}
        {step === 0 && (
          <ScrollView contentContainerStyle={styles.stepContainer} keyboardShouldPersistTaps="handled">
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + '22' }]}>
              <Ionicons name="car-sport-outline" size={44} color={colors.primary} />
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>Welcome aboard!</Text>
            <Text style={[styles.stepSub, { color: colors.mutedForeground }]}>
              Tap the cab you are driving today.
            </Text>

            {vehiclesLoading ? (
              <View style={[styles.loadingBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                  Checking available vehicles…
                </Text>
              </View>
            ) : vehicles.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="ban-outline" size={36} color={colors.warning ?? '#f59e0b'} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No vehicles available</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  No vehicles have been added to your company yet.{'\n'}Ask your admin to add vehicles in the owner panel.
                </Text>
              </View>
            ) : (
              <View style={styles.vehicleGrid}>
                {vehicles.map((v) => {
                  const isSelected = vehicleInput === v;
                  return (
                    <TouchableOpacity
                      key={v}
                      activeOpacity={0.8}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setVehicleInput(v);
                      }}
                      style={[
                        styles.vehicleCard,
                        {
                          backgroundColor: isSelected ? colors.primary + '12' : colors.card,
                          borderColor: isSelected ? colors.primary : colors.border,
                          borderWidth: isSelected ? 2 : 1.5,
                        },
                      ]}
                    >
                      <View style={[
                        styles.vehicleCardIcon,
                        { backgroundColor: isSelected ? colors.primary + '22' : colors.surface },
                      ]}>
                        <Ionicons
                          name="car-outline"
                          size={28}
                          color={isSelected ? colors.primary : colors.mutedForeground}
                        />
                      </View>
                      <Text style={[
                        styles.vehicleCardNumber,
                        { color: isSelected ? colors.primary : colors.foreground },
                      ]}>
                        {v}
                      </Text>
                      <View style={[styles.vehicleCardBadge, { backgroundColor: (colors.success ?? '#22c55e') + '22' }]}>
                        <Text style={[styles.vehicleCardBadgeText, { color: colors.success ?? '#22c55e' }]}>
                          Free
                        </Text>
                      </View>
                      {isSelected && (
                        <View style={styles.vehicleCardCheck}>
                          <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}

        {/* ── Step 1: Ready to roll ── */}
        {step === 1 && (
          <View style={[styles.stepContainer, styles.centered]}>
            <View style={[styles.iconCircle, styles.bigCircle, { backgroundColor: colors.success + '22' }]}>
              <Ionicons name="checkmark-circle-outline" size={64} color={colors.success} />
            </View>
            <Text style={[styles.stepTitle, styles.centeredText, { color: colors.foreground }]}>
              {shiftActive ? 'Back online!' : 'Ready to roll!'}
            </Text>
            <Text style={[styles.stepSub, styles.centeredText, { color: colors.mutedForeground }]}>
              Vehicle{' '}
              <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}>
                {vehicleInput || driver?.vehicleId}
              </Text>{' '}
              is all set.{' '}
              {shiftActive
                ? 'Tap Continue to refresh your position on the map.'
                : 'Tap Start Shift to go online.'}
            </Text>

            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SummaryRow icon="car-outline" label="Vehicle" value={vehicleInput || driver?.vehicleId || '—'} colors={colors} />
            </View>
          </View>
        )}
      </Animated.View>

      {/* Bottom CTA */}
      <View style={[styles.footer, { paddingBottom: botPad }]}>
        {step > 0 && (
          <TouchableOpacity
            style={[styles.backBtn, { borderColor: colors.border }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); animateToStep(step - 1); }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.nextBtn,
            { backgroundColor: step === 0 && !vehicleInput.trim() ? colors.primary + '55' : colors.primary },
            { flex: 1 },
          ]}
          onPress={handleNext}
          disabled={saving || (step === 0 && !vehicleInput.trim())}
          activeOpacity={0.85}
        >
          {saving ? (
            <Text style={[styles.nextBtnText, { color: colors.primaryForeground }]}>Please wait…</Text>
          ) : step === 1 ? (
            <>
              <Ionicons name="play-circle-outline" size={22} color={colors.primaryForeground} />
              <Text style={[styles.nextBtnText, { color: colors.primaryForeground }]}>
                {shiftActive ? 'Continue Shift' : 'Start Shift'}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.nextBtnText, { color: colors.primaryForeground }]}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color={colors.primaryForeground} />
            </>
          )}
        </TouchableOpacity>
      </View>

    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}


function SummaryRow({ icon, label, value, colors }: { icon: any; label: string; value: string; colors: any }) {
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 8,
  },
  dot: { height: 8, borderRadius: 4 },
  content: { flex: 1 },
  stepContainer: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24, gap: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  centeredText: { textAlign: 'center' },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
  },
  bigCircle: { width: 120, height: 120, borderRadius: 60 },
  stepTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  stepSub: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, textAlign: 'center' },
  loadingBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderRadius: 14, padding: 18,
  },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  emptyBox: {
    alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderRadius: 18, padding: 28,
  },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  vehicleGrid: { gap: 12 },
  vehicleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, padding: 18,
  },
  vehicleCardIcon: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  vehicleCardNumber: {
    flex: 1, fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: 0.5,
  },
  vehicleCardBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  vehicleCardBadgeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  vehicleCardCheck: { marginLeft: 4 },
  summaryCard: {
    width: '100%', borderRadius: 18, borderWidth: 1,
    overflow: 'hidden', marginTop: 8,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  summaryLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  summaryValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  backBtn: {
    width: 52, height: 52, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  nextBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnText: { fontSize: 17, fontFamily: 'Inter_700Bold' },
});

