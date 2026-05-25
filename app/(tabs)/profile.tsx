import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView, Alert,
  TextInput, Modal, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { fmtDate as tzFmtDate } from '@/lib/timezone';
import { useAuth } from '@/context/AuthContext';
import { useDriver, useDriverSync, useDriverTick, useDriverGps, DriverStatus } from '@/context/DriverContext';
import { APP_VERSION } from '@/lib/config';
import { instrumentTap } from '@/lib/perf';
import { auth, database } from '@/lib/firebase';
import { ref as fbRef, set as fbSet, get as fbGet, serverTimestamp } from 'firebase/database';
import { getServerUrl } from '@/lib/remoteConfig';

type EditField = 'driverId' | 'name' | null;

const STATUS_OPTIONS: { label: DriverStatus; color: string; icon: string; desc: string }[] = [
  { label: 'Available', color: '#22c55e', icon: 'checkmark-circle', desc: 'Ready to accept jobs' },
  { label: 'Away',      color: '#94a3b8', icon: 'pause-circle',     desc: 'Temporarily unavailable' },
  { label: 'Busy',      color: '#f59e0b', icon: 'time',             desc: 'On a job or hail' },
];

function formatLastLogin(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const now = new Date();
    const diffDays = (now.getTime() - d.getTime()) / 86400000;
    if (diffDays < 0.042) return 'Just now';
    if (diffDays < 1)     return `${Math.floor(diffDays * 24)}h ago`;
    if (diffDays < 2)     return 'Yesterday';
    return tzFmtDate(d);
  } catch {
    return '—';
  }
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { driver, signOut, updateDriverId, updateName } = useAuth();
  const { status, setStatus, isConnected, shiftActive, endShift, currentJob, completedJobs,
          meterRunning, meterPaused, meterIsWaiting, jobs } = useDriver();
  const { pendingUploadCount, getStuckTripsDetail, clearStuckTrip, retryPendingNow, isSyncing } = useDriverSync();
  // v22ab: pull meter distance from DriverTickContext, GPS from DriverGpsContext.
  // These are split contexts (ota13/ota17) so per-tick re-renders don't churn Profile —
  // but for the diagnostic Health Check we DO want the live values at button-press time.
  const { meterDistance } = useDriverTick();
  const { currentGps, currentSpeedKmh } = useDriverGps();

  // v12-ota22k: Review Stuck Uploads modal — replaces the dangerous bulk-clear.
  // Shows full per-trip detail (jobId, fare, payment, error) so the driver knows
  // exactly what they're potentially deleting BEFORE confirming.
  const [showStuckModal, setShowStuckModal] = useState(false);
  const [stuckTrips, setStuckTrips] = useState<any[]>([]);
  const [loadingStuck, setLoadingStuck] = useState(false);

  const openStuckModal = async () => {
    setShowStuckModal(true);
    setLoadingStuck(true);
    try {
      const list = await getStuckTripsDetail();
      setStuckTrips(list);
    } finally {
      setLoadingStuck(false);
    }
  };

  const refreshStuck = async () => {
    setLoadingStuck(true);
    try {
      const list = await getStuckTripsDetail();
      setStuckTrips(list);
    } finally {
      setLoadingStuck(false);
    }
  };

  const handleRetry = async () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    await retryPendingNow();
    setTimeout(refreshStuck, 1500);
  };

  const handleClearOne = (jobId: string, fare: number, currency: string) => {
    Alert.alert(
      'Permanently Delete This Trip?',
      `Job ${jobId}\nFare: ${currency} ${fare.toFixed(2)}\n\nOnly do this if dispatch has confirmed they don't need this trip. The driver will NOT be paid for this fare and the passenger will NOT be charged. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await clearStuckTrip(jobId);
            if (ok) {
              try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
              await refreshStuck();
            } else {
              Alert.alert('Error', 'Could not delete this trip. Please try again.');
            }
          },
        },
      ],
    );
  };

  const [editField, setEditField] = useState<EditField>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  // v12-ota22h: REMOVED Alert.alert confirmation. Driver reported needing
  // 20 taps to sign out — the native dialog was being dropped silently by
  // Samsung One UI on the A04 (happens when JS thread is busy with other
  // listeners). User just kept tapping the Sign Out button thinking nothing
  // had happened, while in reality the dialog had appeared and disappeared
  // off-screen. Sign out is recoverable (driver can sign back in instantly)
  // so an "are you sure" prompt isn't strictly necessary.
  //
  // v12-ota22c4: SIGN-OUT GUARD. Block sign-out when the driver has an
  // Active trip (status==='current'), an Assigned job (status==='queued')
  // or a hail meter running, AND the device is online. Offline sign-out is
  // always allowed because the driver cannot complete a trip without network
  // anyway, and the existing offline queue + cold-start resume (next OTA)
  // will reconcile state on next login. This protects fare revenue and
  // prevents stuck Active records in dispatch HQ — applies to ALL trip
  // sources (hail/dispatch/website/passenger app) and ALL job types
  // (taxi/TM/ACC/food/freight) because we key off job.status, not source.
  const handleSignOut = () => {
    const hasActive = jobs.some(j => j.status === 'current');
    const hasAssigned = jobs.some(j => j.status === 'queued');
    const hasHailRunning = meterRunning && !hasActive;
    if ((hasActive || hasAssigned || hasHailRunning) && isConnected) {
      const what = hasActive
        ? 'You have an active trip in progress.'
        : hasHailRunning
          ? 'You have a hail trip with the meter running.'
          : 'You have an assigned job waiting.';
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      Alert.alert(
        "Can't sign out yet",
        `${what}\n\nPlease complete the trip (or hand the job back to dispatch) before signing out. This protects your fare and keeps the dispatch board accurate.\n\nIf you have no network, sign-out is allowed.`,
        [{ text: 'OK' }],
      );
      return;
    }
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    if (shiftActive) endShift().catch(() => {});
    signOut().catch(() => {});
  };

  const openEdit = (field: EditField) => {
    if (field === 'driverId') setInputValue(driver?.id || '');
    else if (field === 'name') setInputValue(driver?.name?.includes('@') ? '' : (driver?.name || ''));
    setEditField(field);
  };

  const saveField = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      Alert.alert('Required',
        editField === 'driverId' ? 'Please enter your driver ID.' : 'Please enter your name.');
      return;
    }
    setSaving(true);
    try {
      if (editField === 'driverId') await updateDriverId(trimmed);
      else if (editField === 'name') await updateName(trimmed);
      setEditField(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = (s: DriverStatus) => {
    setShowStatusPicker(false);
    if (s === status) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStatus(s);
  };

  const currentStatusOpt = STATUS_OPTIONS.find(o => o.label === status) ?? STATUS_OPTIONS[0];
  const missingVehicle  = !driver?.vehicleId;
  const missingDriverId = !driver?.id || driver.id === driver?.uid;

  const editLabel       = editField === 'driverId' ? 'Driver ID' : 'Your Name';
  const editHint        = editField === 'driverId'
    ? 'Enter your numeric Driver ID assigned by dispatch (e.g. 123). This links you to the dispatch system.'
    : 'Enter your first name or full name. This is what dispatch sees when you message them.';
  const editPlaceholder = editField === 'driverId' ? 'e.g. 123' : 'e.g. Hasnat';
  const editKeyboard: 'default' | 'number-pad' = editField === 'driverId' ? 'number-pad' : 'default';

  const displayName = driver?.name && !driver.name.includes('@') ? driver.name : null;
  const initials    = displayName
    ? displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  // v22w ROOT-CAUSE FIX: Owner Portal sometimes writes assignedVehicles as an
  // OBJECT like {"Taxi02":true} instead of an array. The previous `?? fallback`
  // didn't trigger (an object is truthy) so `.map()` below threw and crashed
  // the Profile tab. Normalize defensively here regardless of shape.
  const _rawAssigned = (driver as any)?.assignedVehicles;
  const assignedVehicles: string[] = Array.isArray(_rawAssigned)
    ? _rawAssigned.filter((v): v is string => typeof v === 'string')
    : _rawAssigned && typeof _rawAssigned === 'object'
      ? Object.keys(_rawAssigned).filter(k => (_rawAssigned as any)[k])
      : (driver?.vehicleId ? [driver.vehicleId] : []);
  const lastLoginStr = formatLastLogin((driver as any)?.lastLogin);
  // v12-ota22f: memoize — Profile re-renders on every status/currentJob change.
  const todayEarnings = useMemo(
    () => completedJobs.reduce((sum, j) => sum + j.fare, 0),
    [completedJobs]
  );
  const isVerifiedDriver = driver?.active !== false && !!driver?.id;

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>

      <View style={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 8 }}>
        <Text style={[styles.heading, { color: colors.foreground }]}>Profile</Text>
      </View>

      {/* ── Active job pill ── */}
      {currentJob && (
        <TouchableOpacity
          style={[styles.activeJobBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '44' }]}
          onPress={() => router.push(`/job/${currentJob.id}`)}
          activeOpacity={0.8}
        >
          <View style={[styles.activeJobIcon, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="navigate" size={14} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.activeJobLabel, { color: colors.primary }]}>ACTIVE JOB IN PROGRESS</Text>
            <Text style={[styles.activeJobAddr, { color: colors.foreground }]} numberOfLines={1}>
              {currentJob.pickupAddress || currentJob.passengerName || 'Job in progress'}
              {currentJob.dropAddress ? ` → ${currentJob.dropAddress}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={15} color={colors.primary} />
        </TouchableOpacity>
      )}

      {/* ── Avatar ── */}
      <View style={styles.avatarSection}>
        <View style={[styles.avatarOuter, { borderColor: colors.primary + '44' }]}>
          <View style={[styles.avatarInner, { borderColor: colors.primary, backgroundColor: colors.primary + '22' }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
          </View>
        </View>

        <View style={styles.nameBlock}>
          <Text style={[styles.driverName, { color: colors.foreground }]}>
            {displayName ?? 'Driver'}
          </Text>
          <View style={styles.driverBadgeRow}>
            {!!driver?.id && (
              <View style={[styles.driverIdBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}>
                <Ionicons name="id-card-outline" size={11} color={colors.primary} />
                <Text style={[styles.driverIdBadgeText, { color: colors.primary }]}>#{driver.id}</Text>
              </View>
            )}
            {isVerifiedDriver && (
              <View style={[styles.verifiedBadge, { backgroundColor: colors.success + '18', borderColor: colors.success + '44' }]}>
                <Ionicons name="shield-checkmark" size={11} color={colors.success} />
                <Text style={[styles.verifiedBadgeText, { color: colors.success }]}>Active</Text>
              </View>
            )}
            {driver?.active === false && (
              <View style={[styles.verifiedBadge, { backgroundColor: '#dc262618', borderColor: '#dc262644' }]}>
                <Ionicons name="ban" size={11} color="#dc2626" />
                <Text style={[styles.verifiedBadgeText, { color: '#dc2626' }]}>Deactivated</Text>
              </View>
            )}
          </View>
        </View>

        {/* Vehicle badges */}
        {assignedVehicles.length > 0 ? (
          <View style={styles.vehicleRow}>
            {assignedVehicles.map(v => (
              <View
                key={v}
                style={[
                  styles.vehicleBadge,
                  {
                    backgroundColor: v === driver?.vehicleId ? colors.success + '22' : colors.surface,
                    borderColor: v === driver?.vehicleId ? colors.success + '55' : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="car"
                  size={12}
                  color={v === driver?.vehicleId ? colors.success : colors.mutedForeground}
                />
                <Text style={[
                  styles.vehicleBadgeText,
                  { color: v === driver?.vehicleId ? colors.success : colors.mutedForeground },
                ]}>
                  {v}{v === driver?.vehicleId ? ' ✓' : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.vehicleBadge, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '44' }]}>
            <Ionicons name="car-outline" size={12} color={colors.warning} />
            <Text style={[styles.vehicleBadgeText, { color: colors.warning }]}>No vehicle</Text>
          </View>
        )}

        {/* Status pill */}
        <TouchableOpacity
          style={[styles.statusPill, {
            backgroundColor: currentStatusOpt.color + '22',
            borderColor: currentStatusOpt.color,
            opacity: shiftActive ? 1 : 0.5,
          }]}
          onPress={() => shiftActive && setShowStatusPicker(true)}
          activeOpacity={shiftActive ? 0.7 : 1}
        >
          <View style={[styles.statusDot, { backgroundColor: currentStatusOpt.color }]} />
          <Text style={[styles.statusLabel, { color: currentStatusOpt.color }]}>{status}</Text>
          {shiftActive && <Ionicons name="chevron-down" size={13} color={currentStatusOpt.color} />}
        </TouchableOpacity>
        {!shiftActive && (
          <Text style={[styles.statusHint, { color: colors.mutedForeground }]}>Start a shift to change status</Text>
        )}
      </View>

      {/* ── Today at a glance (always shown when there's data or shift is active) ── */}
      {(shiftActive || completedJobs.length > 0) && (
        <View style={[styles.todayStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.todayItem}>
            <Text style={[styles.todayValue, { color: colors.primary }]}>${todayEarnings.toFixed(2)}</Text>
            <Text style={[styles.todayLabel, { color: colors.mutedForeground }]}>Today's Earnings</Text>
          </View>
          <View style={[styles.todayDivider, { backgroundColor: colors.border }]} />
          <View style={styles.todayItem}>
            <Text style={[styles.todayValue, { color: colors.foreground }]}>{completedJobs.length}</Text>
            <Text style={[styles.todayLabel, { color: colors.mutedForeground }]}>Jobs Done</Text>
          </View>
          <View style={[styles.todayDivider, { backgroundColor: colors.border }]} />
          <View style={styles.todayItem}>
            {shiftActive ? (
              <>
                <View style={[styles.todayStatusDot, { backgroundColor:
                  status === 'Available' ? '#22c55e' : status === 'Busy' ? '#f59e0b' : '#94a3b8'
                }]} />
                <Text style={[styles.todayValue, { color: colors.foreground, fontSize: 14 }]}>{status}</Text>
                <Text style={[styles.todayLabel, { color: colors.mutedForeground }]}>Status</Text>
              </>
            ) : (
              <>
                <Ionicons name="moon-outline" size={18} color={colors.mutedForeground} style={{ marginBottom: 2 }} />
                <Text style={[styles.todayValue, { color: colors.mutedForeground, fontSize: 14 }]}>Off Shift</Text>
                <Text style={[styles.todayLabel, { color: colors.mutedForeground }]}>Today</Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* ── Setup banners ── */}
      {(missingVehicle || missingDriverId) && (
        <View style={{ gap: 8, marginHorizontal: 16, marginBottom: 16 }}>
          {missingVehicle && (
            <View style={[styles.setupBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}>
              <View style={[styles.bannerIconWrap, { backgroundColor: colors.warning + '22' }]}>
                <Ionicons name="car-outline" size={18} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bannerTitle, { color: colors.warning }]}>No Vehicle Assigned</Text>
                <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>
                  Ask admin to allocate a vehicle to your account
                </Text>
              </View>
            </View>
          )}
          {missingDriverId && (
            <TouchableOpacity
              style={[styles.setupBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}
              onPress={() => openEdit('driverId')}
              activeOpacity={0.8}
            >
              <View style={[styles.bannerIconWrap, { backgroundColor: colors.warning + '22' }]}>
                <Ionicons name="id-card-outline" size={18} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bannerTitle, { color: colors.warning }]}>Set your Driver ID</Text>
                <Text style={[styles.bannerSub, { color: colors.mutedForeground }]}>
                  Required to receive jobs from dispatch
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.warning} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Allowed Services ── */}
      {driver?.allowedServices && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>AUTHORISED SERVICES</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {driver.allowedServices.taxi && (
              <View style={[styles.svcBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}>
                <Ionicons name="car-outline" size={13} color={colors.primary} />
                <Text style={[styles.svcBadgeText, { color: colors.primary }]}>Taxi</Text>
              </View>
            )}
            {driver.allowedServices.food && (
              <View style={[styles.svcBadge, { backgroundColor: '#10b98118', borderColor: '#10b98144' }]}>
                <Ionicons name="fast-food-outline" size={13} color="#10b981" />
                <Text style={[styles.svcBadgeText, { color: '#10b981' }]}>Food Delivery</Text>
              </View>
            )}
            {driver.allowedServices.freight && (
              <View style={[styles.svcBadge, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b44' }]}>
                <Ionicons name="cube-outline" size={13} color="#f59e0b" />
                <Text style={[styles.svcBadgeText, { color: '#f59e0b' }]}>Freight</Text>
              </View>
            )}
            {driver.allowedServices.tm && (
              <View style={[styles.svcBadge, { backgroundColor: '#7c3aed18', borderColor: '#7c3aed44' }]}>
                <Ionicons name="accessibility" size={13} color="#7c3aed" />
                <Text style={[styles.svcBadgeText, { color: '#7c3aed' }]}>Total Mobility</Text>
              </View>
            )}
            {(driver.allowedServices as any).acc && (
              <View style={[styles.svcBadge, { backgroundColor: '#e0f2fe', borderColor: '#bae6fd' }]}>
                <Ionicons name="shield-checkmark" size={13} color="#0369a1" />
                <Text style={[styles.svcBadgeText, { color: '#0369a1' }]}>ACC Funded</Text>
              </View>
            )}
            {(driver.allowedServices as any).wav && (
              <View style={[styles.svcBadge, { backgroundColor: '#7c3aed18', borderColor: '#7c3aed44' }]}>
                <Ionicons name="accessibility" size={13} color="#7c3aed" />
                <Text style={[styles.svcBadgeText, { color: '#7c3aed' }]}>WAV</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Shared-driver companies ── */}
      {driver?.sharedWith && driver.sharedWith.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SHARED DRIVER — ALSO RECEIVES JOBS FROM</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {driver.sharedWith.map((cid) => (
              <View key={cid} style={[styles.svcBadge, { backgroundColor: colors.info + '18', borderColor: colors.info + '44' }]}>
                <Ionicons name="business-outline" size={13} color={colors.info} />
                <Text style={[styles.svcBadgeText, { color: colors.info }]}>Company {cid}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── Connection card ── */}
      <View style={[styles.connectionCard, {
        backgroundColor: colors.card,
        borderColor: isConnected ? colors.success + '66' : colors.border,
      }]}>
        <View style={[styles.connIconWrap, { backgroundColor: isConnected ? colors.success + '22' : colors.surface }]}>
          <Ionicons
            name={isConnected ? 'radio-outline' : 'cloud-offline-outline'}
            size={20}
            color={isConnected ? colors.success : colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.connTitle, { color: isConnected ? colors.success : colors.foreground }]}>
            {isConnected ? 'Connected to Dispatch' : 'Not Connected'}
          </Text>
          <Text style={[styles.connSub, { color: colors.mutedForeground }]}>
            {isConnected
              ? `Live job notifications · Company ${driver?.companyId ?? ''}`
              : 'Sign in to connect to dispatch'}
          </Text>
        </View>
        <View style={[styles.connDot, { backgroundColor: isConnected ? colors.success : colors.mutedForeground }]} />
      </View>

      {/* ── Driver info card ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, paddingHorizontal: 20, marginBottom: 8 }]}>ACCOUNT DETAILS</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

        {/* Email */}
        <View style={styles.infoRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
            <Ionicons name="mail-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Login Email</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={1}>
              {driver?.email ?? '—'}
            </Text>
          </View>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Phone */}
        {driver?.phone ? (
          <>
            <View style={styles.infoRow}>
              <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
                <Ionicons name="call-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.infoContent}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Phone</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{driver.phone}</Text>
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </>
        ) : null}

        {/* Company */}
        <View style={styles.infoRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
            <Ionicons name="business-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Company ID</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{driver?.companyId || '—'}</Text>
          </View>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Editable Name */}
        <TouchableOpacity style={styles.infoRow} onPress={() => openEdit('name')} activeOpacity={0.7}>
          <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
            <Ionicons name="person-outline" size={18} color={displayName ? colors.primary : '#f59e0b'} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Display Name</Text>
            <Text style={[styles.infoValue, { color: displayName ? colors.foreground : '#f59e0b' }]}>
              {displayName ?? 'Tap to set your name'}
            </Text>
          </View>
          <Ionicons name="pencil-outline" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
        {!displayName && (
          <TouchableOpacity
            onPress={() => openEdit('name')}
            style={{ marginHorizontal: 16, marginBottom: 10, backgroundColor: '#f59e0b18', borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b44', padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
            activeOpacity={0.8}
          >
            <Ionicons name="warning-outline" size={16} color="#f59e0b" style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 13, color: '#f59e0b', lineHeight: 18 }}>
              Dispatchers see your name on every job and message. Tap here to set your real name — your login email is not shown to them.
            </Text>
          </TouchableOpacity>
        )}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Editable Driver ID */}
        <TouchableOpacity style={styles.infoRow} onPress={() => openEdit('driverId')} activeOpacity={0.7}>
          <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
            <Ionicons name="id-card-outline" size={18} color={missingDriverId ? colors.warning : colors.primary} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Driver ID</Text>
            {missingDriverId
              ? <Text style={[styles.infoValue, { color: colors.warning }]}>Tap to set</Text>
              : (
                <View style={styles.idRow}>
                  <View style={[styles.idBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '33' }]}>
                    <Text style={[styles.idBadgeText, { color: colors.primary }]}>#{driver?.id}</Text>
                  </View>
                </View>
              )
            }
          </View>
          <Ionicons name="pencil-outline" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Vehicle (read-only, shows active) */}
        <View style={styles.infoRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
            <Ionicons name="car-outline" size={18} color={missingVehicle ? colors.warning : colors.primary} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Active Vehicle</Text>
            <Text style={[styles.infoValue, { color: missingVehicle ? colors.warning : colors.foreground }]}>
              {driver?.vehicleId || 'Not assigned — contact admin'}
            </Text>
          </View>
          {!!driver?.vehicleId && (
            <View style={[styles.assignedPill, { backgroundColor: colors.success + '22', borderColor: colors.success + '44' }]}>
              <Text style={[styles.assignedText, { color: colors.success }]}>Active</Text>
            </View>
          )}
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Last login */}
        <View style={styles.infoRow}>
          <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
            <Ionicons name="log-in-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Last Login</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{lastLoginStr}</Text>
          </View>
        </View>
      </View>

      {/* ── Quick actions ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, paddingHorizontal: 20, marginBottom: 8 }]}>QUICK ACTIONS</Text>
      <View style={{ gap: 8, marginHorizontal: 16, marginBottom: 16 }}>
        <TouchableOpacity
          style={[styles.quickAction, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}
          onPress={() => router.push('/chat/thread-dispatch')}
          activeOpacity={0.8}
        >
          <View style={[styles.quickActionIcon, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="chatbubble-ellipses" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.quickActionTitle, { color: colors.primary }]}>Message Dispatch</Text>
            <Text style={[styles.quickActionSub, { color: colors.mutedForeground }]}>Send a message to your dispatch control</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAction, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push('/(tabs)/shift')}
          activeOpacity={0.8}
        >
          <View style={[styles.quickActionIcon, { backgroundColor: colors.surface }]}>
            <Ionicons name="time-outline" size={18} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.quickActionTitle, { color: colors.foreground }]}>Shift History</Text>
            <Text style={[styles.quickActionSub, { color: colors.mutedForeground }]}>View past shifts and earnings</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

      </View>

      {/* ── Settings card ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, paddingHorizontal: 20, marginBottom: 8 }]}>SUPPORT</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {([
          { icon: 'shield-checkmark-outline' as const, label: 'Privacy Policy',    msg: 'Privacy Policy is not yet available. Contact your fleet administrator.' },
          { icon: 'document-text-outline' as const,   label: 'Terms of Service',  msg: 'Terms of Service is not yet available. Contact your fleet administrator.' },
          { icon: 'help-circle-outline' as const,     label: 'Help & Support',    msg: 'For support, contact your fleet dispatcher or administrator directly.' },
          { icon: 'bug-outline' as const,             label: 'Report an Issue',   msg: 'To report a technical issue, please contact your fleet administrator or dispatcher.' },
        ]).map((item, i, arr) => (
          <View key={item.label}>
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => Alert.alert(item.label, item.msg)}
            >
              <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
                <Ionicons name={item.icon} size={18} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          </View>
        ))}
      </View>

      {/* ── v12-ota22k: review stuck uploads (replaces dangerous bulk-clear) ── */}
      {pendingUploadCount > 0 && (
        <TouchableOpacity
          style={[styles.signOutBtn, {
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b22',
            marginBottom: 8,
          }]}
          activeOpacity={0.8}
          onPress={openStuckModal}
        >
          <Ionicons name="cloud-upload-outline" size={20} color="#f59e0b" />
          <Text style={[styles.signOutText, { color: '#f59e0b' }]}>
            Review {pendingUploadCount} Pending Upload{pendingUploadCount === 1 ? '' : 's'}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Sign out ── */}
      <TouchableOpacity
        style={[styles.signOutBtn, { borderColor: colors.error, backgroundColor: colors.error + '11' }]}
        onPress={instrumentTap('profile.signOut', handleSignOut)}
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>
        Bookawaka Driver · v{APP_VERSION}
      </Text>
      <Text style={[styles.version, { color: '#FFC107', marginTop: -4, fontFamily: 'Inter_700Bold' }]}>
        {'BUILD: sentry-v12-ota22c-cutover-c (long-resume socket rebuild — after Android doze ≥2min the AppState foreground handler now force-cycles the Firebase websocket (goOffline+goOnline) so the existing .info/connected reconnect path refires and reconciles via /api/driver/active-bookings. Surfaces "Reconnecting" to UI immediately so a doze-resume zombie-listener state cannot accept offers / start hail trips over a dead pipe. Hail Bug A FIX — startHailTrip now writes TOP-LEVEL vehiclestatus=Busy (writeOnlinePresence only touched nested /current/ — dispatch board fast-path reads top-level). Hail Bug B FIX — removed silent 404 → TEMP-id fallback that masked every server-side rejection as a harmless "endpoint not deployed" condition. Hail PRE-FLIGHT GUARD — refuse to start hail trip while a dispatch booking is still active locally. Sentry breadcrumbs added for every AppState transition + .info/connected transition so future zombie-listener incidents can be traced. Bug #2 fix — notification handler now branches on data.source/data.Source. A dispatcher UNASSIGN of a specific booking (numeric bookingId + source=Dispatcher) is treated as a silent job-pull (clears the offered row + dismisses the modal) instead of flipping the driver to Away. isAwayNotif tightened to require bookingId=="Taxi Time" / empty / "0" — system-level Away signals only. Legacy fast-path preserved for bookingId="Taxi Time" so genuine timeout Aways still trigger. full 22c cutover — every lifecycle action (accept/cancel/recall/complete) now goes through POST /api/job/command with X-User-Key + clientRequestId UUID. Driver app stopped writing booking state to Firebase: jobs/ DriverAccepted/Active/DriverDeclined writes deleted, allbookings Status updates deleted, completedJobs push deleted, rideStatus mirrors deleted, postSyncOfflineTrip POST deleted, driverQueue/queued direct write deleted, Passengerjobs status writes deleted, shift-start/end jobs/ remove deleted. Hail jobpickup/jobdropoff online-presence mirror KEPT (server-dev Q3 — hail trips have no dispatcher record). vehiclestatus translates Assigned→Picking at FB write boundary (buildPresenceRecord) since server reads Picking for accepted-in-progress. startMeter writes meterOnAt to online/.../current — server stamps MeterOnAt + flips BookingStatus automatically. ota22c4-f phantom-offer defense-in-depth — driver reported the empty-offer-modal-after-hail bug STILL reproduced after 22c4-e shipped, so we added three independent guards that together make it impossible for an offer modal to ever render with no real data: (1) GlobalJobAlert mount-time failsafe in app/_layout.tsx — checks incomingJob for meaningful passengerName / pickupAddress / dropAddress, treating "Passenger" / "Street Pickup" / "See dispatch for…" / "Unknown pickup" as placeholders, and silently dismisses + suppresses the beep + pulse if all three are placeholders, so regardless of WHICH upstream listener fired setIncomingJob with bad data the modal can never render empty; (2) G2 handleNewOffer phantom-record guard in DriverContext — bails out if the jobs/ path record has NO passenger AND NO pickup AND NO drop address (catches leftover DriverAccepted/DriverDeclined driver-status-only writes from prior sessions, malformed dispatcher stubs, and partially-cleared hail residue); (3) notification listener phantom guard — bails out if neither the jobs/ fetch nor the allbookings fallback yielded data AND the notification payload itself has no passenger/pickup/drop/phone fields, preventing the placeholder-filled newJob from being surfaced.) ota22c4-e empty-offer-modal-after-hail fix — driver reported that after completing a hail trip they got a beep, the offer badge incremented, and an offer modal appeared with no passenger name / no pickup / no dropoff but still had Accept and Reject buttons. Two race-condition bugs were causing this: (1) inside completeHailTrip the mark-completed call lived inside the async saveTripSummary().then() callback, but hailTripMetaRef was cleared a few lines earlier — leaving a window where the G2 child listener could fire on an echo of the driver\'s own hail record with no protection in place; (2) the G2 handleNewOffer path had no Source==="hail" early-return (the legacy onValue listener had one, the G2 listener did not), so a stale self-written hail record from a previous offline session could replay as a new offer on next cold start before the async boot-hydration of locally-completed IDs had populated the dedup set. Fix: mark-completed now fires SYNCHRONOUSLY at the top of completeHailTrip before any ref teardown, and the G2 handleNewOffer now does a hard early-return on Source==="hail" — the driver\'s own hail self-writes can never render an empty offer modal regardless of timing or app-restart state.) ota22c4-d code-review fixes on top of 22c4-c — (1) the 800ms "Trip resumed" alert that fires after cold-start meter recovery is now cancellable, so if the driver signs out within that window the alert no longer pops over the login screen; (2) the locally-completed booking guard set is now cleared on sign-out, so a new driver on the same phone (or the same driver after a fresh session) starts with a clean slate.) ota22c4-c don\'t reopen a locally-completed booking — when we complete a trip on this phone (dispatch or hail) the bookingId is added to a local "already done" set, and that set is also rehydrated from the trip-journal pending list on app start. Any future offer or re-broadcast for that bookingId is silently suppressed by the existing offer-dedup path, and a dispatch recall/cancel for it can no longer un-block it either. Stops the classic "ghost Active trip in dispatch HQ" scenario where the driver completed the trip but the server hadn\'t seen the sync yet and tried to re-assign the same bookingId.) ota22c4-b durable meter — the live meter (seconds, distance, waiting cost, tariff and trip identity) is now saved to the phone every 5 seconds while a trip is running. If the app force-closes, the phone reboots, or Android kills the bridge in the background, the next time the driver opens the app it automatically resumes the meter where it left off (with a drift adjustment capped at 30 minutes) and shows a "Trip resumed" alert with the current fare, distance and time. Works for both hail trips and dispatch trips, including TM / ACC / account / website / passenger-app sources. The snapshot is cleared automatically when the meter stops cleanly (complete, cancel, sign-out) so a stale resume can never fire.) ota22c4 sign-out guard — driver can no longer sign out while a trip is Active, Assigned or a hail meter is running, as long as the phone is online. Offline sign-out is still allowed because the trip cannot be completed without network anyway and the offline queue + cold-start resume will reconcile state on next login. Applies to ALL trip sources (hail, dispatch, website, passenger app) and ALL job types (taxi, TM, ACC, food, freight) — the guard reads job.status, not Source. Prevents stuck Active records in dispatch HQ and lost fares from premature sign-outs.) ota22c3 URGENT hail-self-write guard — driver reported same hail booking re-popping as a new offer, meter freezing after start, stuck job card, and being logged out after a few seconds. Root cause: the new G2 per-booking listener AND the legacy onValue listener on jobs/{cid}/{vid}/{did} were both treating the driver app\'s own startHailTrip flat-write — which sets Status:Active + Source:hail so the dispatcher console can see the trip is live — as if it were an incoming dispatcher offer. The offer modal popped, paused the meter, dismissed, then any next write to the same path re-popped it, and the modal storm on Samsung One UI starved the JS thread → force-close → driver lands on login. Fix: five new guards across the legacy onValue listener, all three G2 child callbacks (added/changed/removed) and the notification listener that all skip any bookingId matching the driver\'s active hailTripMetaRef. The legacy guard ALSO checks Source==="hail" so stale hail records from a previous app session are ignored on listener attach. ota22c2 retained URGENT hail-complete cutover — server §FIX-HAIL: hail bookings now land in BookingStatus:Active at version 1 the moment /api/job/create is called with source:hail + driverId + vehicleId. The driver app was still calling the legacy /api/job/sync-offline-trip on hail completion which expects Pending, so completes were silently failing — symptoms: app hangs on Complete, force-close, ghost-offer popup on relaunch. Fix: hail completes now go ONLY through /api/job/command with ifVersion:1 and the dispatch-contract schema (paymentMethod, paymentSplit, tariffId, waitingCost, extras, endTime, finalDropAddress, distance, duration) plus our existing SA-portal parity fields. Dispatch trips untouched.) ota22c1 patch — code review fixes: account/ACC fields (accClientRef/accClientId/accClaimNo), gift card code, driver note, trip issue, fixed-fare override and per-trip extras now included in the dispatch complete command so account and ACC dispatch trips are no longer missing fields post-cutover. Offline command queue now also drains on app foreground resume and on Firebase websocket reconnect — previously only the expo-network offline→online edge would drain it, so brief websocket flaps could strand queued commands.) Dispatch lifecycle hookup G2 child-event listener + /api/job/command: the app now listens on a per-booking child path so dispatch can push accept/cancel/complete/reassign events for each booking independently without stepping on the others — fewer ghost popups, no missed cancellations after a reassignment, and out-of-order events are silently dropped. Accept, decline, recall and complete now ALSO send a structured command to dispatch via /api/job/command alongside the existing Firebase writes; pre-cutover dispatch keeps reading the old writes and post-cutover it reads commands, so the changeover is seamless. Every command carries a one-time clientRequestId so retries can never double-charge or double-cancel. When the phone reconnects after a signal drop, any commands that failed during the offline window are replayed automatically. Earlier G4+G5+G6 retained: every job offer and update from dispatch now carries a version stamp and a server-clock timestamp, so the app can drop duplicate or out-of-order events that used to cause ghost popups — like an offer reappearing after you accepted it. Cancellations and reassignments now arrive with a clear event tag so the offer popup closes silently the moment dispatch pulls a job back, no more stuck cancellation alerts. When the phone reconnects after a signal drop the app now asks dispatch for the live list of your active bookings and quietly fixes up any jobs that changed while you were offline — no more orphan jobs or missed cancellations after a tunnel/poor-coverage moment. Split payment + Account auto-split: on the Complete Trip screen there is a new Split option in the payment picker. Tap Split and you can enter as many payment rows as you want — Cash, EFTPOS, Card, Account, TM, ACC or Gift Card in any combination — and the app checks the amounts add up to the fare. A green bar means ready, an orange bar tells you how much short or over. If the passenger pays partly by account, type the client reference as normal — when the system finds the client and they pay only a percentage (say 70 percent), a yellow Auto-split banner appears: tap it and the rows are set up for you (70 percent account + 30 percent remainder, you pick the remainder method). v22bn retained: Call and Text the passenger from anywhere in the app — every job offer popup, the silent offer alert, the job details sheet and the active trip card on the Meter tab show a green Call and yellow Text button right under the passenger name. Tap Text and a quick-pick sheet opens with ready-made messages — I have arrived, I am on the way, Running 5 minutes late, Outside and cannot see you, Please call me back — your phone opens with the message pre-filled. Works on every booking source the same way. Every contact attempt is logged so HQ has a record on no-show disputes. v22bm retained: Extras on the Complete Trip screen — Airport pickup, Bike carrier, Extra bag, EFTPOS surcharge (5 percent), Cleaning fee, Other (any amount). Tap a chip to add, tap again to remove. Extras add to the fare automatically so card payments charge the new combined total, and they go into the trip audit. v22bl retained: job offer screen shows a Source chip (Dispatch / Hail / Website / Passenger App / Account) and a Job Type chip (Taxi / Food / Freight / Total Mobility), plus distance and duration pills. Dispatch board now sees the full trip lifecycle: On The Way / Arrived / On Board. Hail trip no longer interrupted by a dispatch offer — queued silently into the offers list.)'}
      </Text>

      {/* Diagnostic: send a test crash to Sentry to verify reporting works */}
      <TouchableOpacity
        onPress={() => {
          try {
            const Sentry = require('@sentry/react-native');
            Sentry.captureMessage('Test message from Profile screen — Sentry is working', 'info');
            Alert.alert('Sentry Test', 'A test message was sent. Check sentry.io in 30s.');
          } catch (e: any) {
            Alert.alert('Sentry not loaded', String(e?.message ?? e));
          }
        }}
        style={{ alignSelf: 'center', marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
      >
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>Send Sentry Test</Text>
      </TouchableOpacity>

      {/* Diagnostic: Firebase Health — checks auth, write, read, and SA portal */}
      <TouchableOpacity
        onPress={async () => {
          const lines: string[] = [];
          const cid = driver?.companyId || '620611';
          const vid = driver?.vehicleId || 'unknown';
          const did = driver?.id || 'unknown';
          const uid = auth.currentUser?.uid;
          lines.push(uid ? `1. AUTH: OK  uid=${uid.slice(0, 10)}…` : `1. AUTH: NOT SIGNED IN  (Firebase has no user)`);
          lines.push(`   driverId=${did}  vehicle=${vid}  company=${cid}`);
          try {
            await fbSet(fbRef(database, `online/${cid}/${vid}/diagnostic`), {
              at: serverTimestamp(),
              from: 'health-check',
            });
            lines.push(`2. WRITE online/${cid}/${vid}/diagnostic: OK`);
          } catch (e: any) {
            lines.push(`2. WRITE FAILED: ${String(e?.code || e?.message || e).slice(0, 60)}`);
          }
          try {
            const snap = await fbGet(fbRef(database, `allbookings/${cid}`));
            const n = snap.exists() ? Object.keys(snap.val() || {}).length : 0;
            lines.push(`3. READ allbookings/${cid}: OK  (${n} keys)`);
          } catch (e: any) {
            lines.push(`3. READ FAILED: ${String(e?.code || e?.message || e).slice(0, 60)}`);
          }
          try {
            const t0 = Date.now();
            const res = await fetch(`${getServerUrl()}/api/job/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyId: cid, source: 'hail', driverId: did, vehicleId: vid,
                tariffId: '1', passenger: { name: 'health-check', phone: '' },
                pickup: { address: 'health-check' }, dropoff: { address: '' },
              }),
            });
            const ms = Date.now() - t0;
            const body = await res.text();
            const m = body.match(/"jobId"\s*:\s*"([^"]+)"/);
            lines.push(`4. SERVER /api/job/create: HTTP ${res.status} in ${ms}ms`);
            if (m) lines.push(`   server-issued jobId: ${m[1]}`);
            else lines.push(`   body: ${body.slice(0, 80)}`);
          } catch (e: any) {
            lines.push(`4. SERVER FAILED: ${String(e?.message || e).slice(0, 60)}`);
          }
          lines.push('— Meter / GPS live state —');
          lines.push(`5. shift=${shiftActive ? 'ON' : 'off'}  status=${status}  meter=${meterRunning ? (meterPaused ? 'PAUSED' : 'RUNNING') : 'stopped'}${meterIsWaiting ? '  (WAITING)' : ''}`);
          lines.push(`6. km=${typeof meterDistance === 'number' ? meterDistance.toFixed(3) : 'n/a'}  speed=${typeof currentSpeedKmh === 'number' ? currentSpeedKmh : 'n/a'} km/h`);
          lines.push(`7. GPS=${currentGps ? `${currentGps.lat.toFixed(5)},${currentGps.lng.toFixed(5)}` : 'no fix'}`);
          Alert.alert('Firebase Health Check', lines.join('\n'));
        }}
        style={{ alignSelf: 'center', marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#FFC107' }}
      >
        <Text style={{ color: '#FFC107', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>Run Firebase Health Check</Text>
      </TouchableOpacity>
      {driver?.companyId && (
        <Text style={[styles.version, { color: colors.mutedForeground, marginTop: -4 }]}>
          Company {driver.companyId} · Driver #{driver.id || '—'}
        </Text>
      )}

      <View style={{ height: Platform.OS === 'web' ? 34 : insets.bottom + 32 }} />

      {/* ── Edit modal ── */}
      <Modal
        visible={editField !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditField(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>{editLabel}</Text>
              <TouchableOpacity onPress={() => setEditField(null)}>
                <Ionicons name="close" size={24} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>{editHint}</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder={editPlaceholder}
              placeholderTextColor={colors.mutedForeground}
              keyboardType={editKeyboard}
              autoCapitalize={editField === 'name' ? 'words' : 'none'}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveField}
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: saving ? colors.primary + '88' : colors.primary }]}
              onPress={saveField}
              activeOpacity={0.8}
              disabled={saving}
            >
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
                {saving ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Status picker modal ── */}
      <Modal
        visible={showStatusPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatusPicker(false)}
      >
        <TouchableOpacity
          style={styles.statusOverlay}
          activeOpacity={1}
          onPress={() => setShowStatusPicker(false)}
        >
          <View style={[styles.statusSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statusSheetTitle, { color: colors.foreground }]}>Set Status</Text>
            {STATUS_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.label}
                style={[
                  styles.statusOption,
                  i < STATUS_OPTIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  opt.label === status && { backgroundColor: opt.color + '12' },
                ]}
                onPress={() => handleStatusChange(opt.label)}
                activeOpacity={0.7}
              >
                <View style={[styles.statusOptIconWrap, { backgroundColor: opt.color + '22' }]}>
                  <Ionicons name={opt.icon as any} size={20} color={opt.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statusOptLabel, { color: opt.label === status ? opt.color : colors.foreground }]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.statusOptDesc, { color: colors.mutedForeground }]}>{opt.desc}</Text>
                </View>
                {opt.label === status && <Ionicons name="checkmark-circle" size={20} color={opt.color} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── v12-ota22k: Review Stuck Uploads modal ── */}
      <Modal
        visible={showStuckModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStuckModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Pending Uploads ({stuckTrips.length})
              </Text>
              <TouchableOpacity onPress={() => setShowStuckModal(false)}>
                <Ionicons name="close" size={24} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              These trips are saved on your phone and will keep retrying automatically. Do NOT delete unless dispatch confirms the trip isn't needed — the driver won't be paid for deleted trips.
            </Text>

            <ScrollView style={{ maxHeight: 460, marginTop: 8 }}>
              {loadingStuck && stuckTrips.length === 0 && (
                <Text style={{ color: colors.mutedForeground, textAlign: 'center', padding: 16 }}>Loading…</Text>
              )}
              {!loadingStuck && stuckTrips.length === 0 && (
                <Text style={{ color: colors.mutedForeground, textAlign: 'center', padding: 16 }}>
                  No pending uploads. All trips are synced.
                </Text>
              )}
              {stuckTrips.map((t) => {
                const dateStr = t.savedAt ? new Date(t.savedAt).toLocaleString() : '—';
                return (
                  <View
                    key={t.jobId}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 14 }}>
                        Job {t.jobId}
                      </Text>
                      <Text style={{ color: '#16a34a', fontFamily: 'Inter_700Bold', fontSize: 16 }}>
                        {t.currency} {Number(t.fare).toFixed(2)}
                      </Text>
                    </View>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 2 }}>
                      Payment: <Text style={{ color: colors.foreground }}>{t.paymentMethod}</Text>
                    </Text>
                    {!!t.passengerName && (
                      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 2 }}>
                        Passenger: <Text style={{ color: colors.foreground }}>{t.passengerName}</Text>
                      </Text>
                    )}
                    {!!t.dropoffAddress && (
                      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 2 }} numberOfLines={2}>
                        Drop: <Text style={{ color: colors.foreground }}>{t.dropoffAddress}</Text>
                      </Text>
                    )}
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 2 }}>
                      Saved: <Text style={{ color: colors.foreground }}>{dateStr}</Text>
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>
                      Upload attempts: <Text style={{ color: t.attempts > 5 ? '#f59e0b' : colors.foreground, fontFamily: 'Inter_700Bold' }}>{t.attempts}</Text>
                    </Text>
                    {t.lastError && (
                      <View style={{ backgroundColor: '#dc262622', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                        <Text style={{ color: '#dc2626', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                          Last error{t.lastError.status ? ` (HTTP ${t.lastError.status})` : ''}:
                        </Text>
                        <Text style={{ color: '#dc2626', fontSize: 11, marginTop: 2 }} numberOfLines={3}>
                          {t.lastError.message}
                          {t.lastError.body ? ` — ${t.lastError.body}` : ''}
                        </Text>
                      </View>
                    )}
                    {!t.hasSummary && (
                      <Text style={{ color: '#f59e0b', fontSize: 11, marginBottom: 6 }}>
                        ⚠️ No summary stored — partial trip data only. Safe to delete if dispatch confirms.
                      </Text>
                    )}
                    <TouchableOpacity
                      onPress={() => handleClearOne(t.jobId, t.fare, t.currency)}
                      style={{
                        borderWidth: 1,
                        borderColor: '#dc2626',
                        backgroundColor: '#dc262611',
                        borderRadius: 8,
                        paddingVertical: 8,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: '#dc2626', fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>
                        Delete this trip permanently
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                onPress={handleRetry}
                disabled={isSyncing || loadingStuck}
                style={{
                  flex: 1,
                  backgroundColor: (isSyncing || loadingStuck) ? colors.primary + '88' : colors.primary,
                  borderRadius: 10,
                  paddingVertical: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 14 }}>
                  {isSyncing ? 'Uploading…' : 'Retry Now'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowStuckModal(false)}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  paddingVertical: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heading: { fontSize: 28, fontWeight: '800', fontFamily: 'Inter_700Bold' },

  activeJobBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 4, borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  activeJobIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  activeJobLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginBottom: 2 },
  activeJobAddr: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  avatarSection: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  avatarOuter: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarInner: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 34, fontFamily: 'Inter_700Bold' },
  nameBlock: { alignItems: 'center', gap: 6 },
  driverName: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  driverBadgeRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  driverIdBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1,
  },
  driverIdBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1,
  },
  verifiedBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  todayStrip: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 16,
    borderRadius: 16, borderWidth: 1, paddingVertical: 16,
  },
  todayItem: { flex: 1, alignItems: 'center', gap: 3 },
  todayValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  todayLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  todayDivider: { width: 1 },
  todayStatusDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },

  vehicleRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: -2 },
  vehicleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  vehicleBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  statusHint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: -4 },

  setupBanner: {
    borderRadius: 14, borderWidth: 1.5, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  bannerIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  bannerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  connectionCard: {
    marginHorizontal: 16, borderRadius: 14, borderWidth: 1, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16,
  },
  connIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  connTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  connSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  connDot: { width: 10, height: 10, borderRadius: 5 },

  card: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 2 },
  infoValue: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  idRow: { flexDirection: 'row' },
  idBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, borderWidth: 1, marginTop: 2,
  },
  idBadgeText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
  assignedPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  assignedText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  svcBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1,
  },
  svcBadgeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  quickAction: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  quickActionIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  quickActionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  quickActionSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  menuRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium' },

  signOutBtn: {
    marginHorizontal: 16, borderRadius: 14, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 15, gap: 10, marginBottom: 12,
  },
  signOutText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  version: { textAlign: 'center', fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 8 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, paddingBottom: 40, gap: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  modalHint: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  input: {
    borderWidth: 1.5, borderRadius: 12, padding: 14,
    fontSize: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center',
  },
  saveBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },

  statusOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', padding: 32 },
  statusSheet: { width: '100%', borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  statusSheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', padding: 16, paddingBottom: 8 },
  statusOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  statusOptIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statusOptLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  statusOptDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});
