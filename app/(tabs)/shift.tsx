import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Alert, ScrollView, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useDriver, useDriverFleet, ShiftRecord, Job, DriverStatus } from '@/context/DriverContext'; // Job used by helper functions
import { useAuth } from '@/context/AuthContext';
import { fmtMs, fmtMins, DAILY_LIMIT_MS, WEEKLY_LIMIT_MIN } from '@/lib/shiftCompliance';
import { fmtTime as tzFmtTime, fmtTodayHeading, COMPANY_TZ } from '@/lib/timezone';

const STATUS_COLOR: Record<string, string> = {
  Available: '#22c55e',
  Busy:      '#f59e0b',
  Away:      '#94a3b8',
};

function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDuration(rec: ShiftRecord): string {
  if (!rec.startMs) return '—';
  const endMs = rec.endMs ?? null;
  if (!endMs) return '—';
  const ms = endMs - rec.startMs;
  if (ms <= 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function jobCompletedTime(job: Job): string {
  try {
    const iso = job.completedAt ?? job.pickedUpAt ?? job.createdAt;
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return tzFmtTime(d);
  } catch {
    return '';
  }
}

function paymentLabel(pt?: string): string {
  if (!pt) return 'Cash';
  const map: Record<string, string> = {
    cash: 'Cash', card: 'Card', account: 'Acct', eftpos: 'EFTPOS', voucher: 'Voucher', total_mobility: 'TM',
    acc: 'ACC', gift_card: 'Gift',
  };
  return map[pt.toLowerCase()] ?? pt;
}

export default function ShiftScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    shiftActive, currentShift, shiftHistory, startShift, endShift,
    completedJobs, status, setStatus, currentJob,
    breakActive, breakStartMs, todayBreakMs, weeklyWorkMinutes, lastShiftEndMs, shiftBlocked,
    startBreak, endBreak,
  } = useDriver();
  // v12-ota16: fleet/zone moved to dedicated context — see home.tsx for rationale.
  const { onlineDrivers, myZoneInfo } = useDriverFleet();
  const { driver } = useAuth();
  const missingVehicle = !driver?.vehicleId;

  // v12-ota22f: memoize all completedJobs aggregations. Previously these
  // 4 .filter()s + 2 .reduce()s ran on every render — and Shift tab
  // re-renders on every job/state change in DriverContext. With even 50
  // completed trips this cost real CPU on the Samsung A04.
  const { todayJobs, todayEarnings, avgFare, tmJobs, tmEarnings, accJobs, wavJobs } = useMemo(() => {
    const todayE = completedJobs.reduce((sum, j) => sum + j.fare, 0);
    const tmJ    = completedJobs.filter(j => j.paymentType === 'total_mobility');
    return {
      todayJobs:    completedJobs.slice().reverse(),
      todayEarnings: todayE,
      avgFare:      completedJobs.length > 0 ? todayE / completedJobs.length : 0,
      tmJobs:       tmJ,
      tmEarnings:   tmJ.reduce((s, j) => s + j.fare, 0),
      accJobs:      completedJobs.filter(j => !!j.acc_client_id),
      wavJobs:      completedJobs.filter(j => j.wheelchair),
    };
  }, [completedJobs]);

  // Weekly summary from history (last 7 entries) — also memoized
  const { recentShifts, weeklyEarnings, weeklyJobs, weeklyShifts, weeklyAvgPerShift } = useMemo(() => {
    const recent = shiftHistory.slice(0, 7);
    const earn   = recent.reduce((s, r) => s + r.earnings, 0);
    return {
      recentShifts:    recent,
      weeklyEarnings:  earn,
      weeklyJobs:      recent.reduce((s, r) => s + r.jobCount, 0),
      weeklyShifts:    recent.length,
      weeklyAvgPerShift: recent.length > 0 ? earn / recent.length : 0,
    };
  }, [shiftHistory]);

  // Live elapsed — tick every second while on shift
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!shiftActive || !currentShift?.startMs) { setElapsedMs(0); return; }
    const tick = () => setElapsedMs(Date.now() - (currentShift.startMs ?? Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [shiftActive, currentShift?.startMs]);

  // Live break elapsed — tick every second while break is active
  const [breakElapsedMs, setBreakElapsedMs] = useState(0);
  useEffect(() => {
    if (!breakActive || !breakStartMs) { setBreakElapsedMs(0); return; }
    const tick = () => setBreakElapsedMs(Date.now() - breakStartMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [breakActive, breakStartMs]);

  // Pulse animation for active dot
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!shiftActive) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.8, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shiftActive]);

  const handleToggle = () => {
    if (shiftActive) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const elapsed = currentShift?.startMs ? formatElapsed(Date.now() - currentShift.startMs) : '';
      Alert.alert(
        'End Shift',
        `Duration: ${elapsed || 'unknown'}\nJobs: ${completedJobs.length}\nEarnings: $${todayEarnings.toFixed(2)}\n\nAre you sure you want to end your shift?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'End Shift', style: 'destructive', onPress: endShift },
        ],
      );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      startShift();
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.pageHeader}>
        <Text style={[styles.heading, { color: colors.foreground }]}>Shift</Text>
        <Text style={[styles.headingSub, { color: colors.mutedForeground }]}>
          {fmtTodayHeading()}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

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

        {/* ── Deactivated banner ── */}
        {driver?.active === false && (
          <View style={[styles.warningBanner, { backgroundColor: '#dc262618', borderColor: '#dc2626' }]}>
            <Ionicons name="ban-outline" size={22} color="#dc2626" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.warningTitle, { color: '#dc2626' }]}>Account Deactivated</Text>
              <Text style={[styles.warningSub, { color: colors.mutedForeground }]}>
                You cannot start a shift. Contact your fleet administrator.
              </Text>
            </View>
          </View>
        )}

        {/* ── Vehicle warning ── */}
        {missingVehicle && driver?.active !== false && (
          <TouchableOpacity
            style={[styles.warningBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}
            onPress={() => router.push('/(tabs)/profile')}
            activeOpacity={0.8}
          >
            <Ionicons name="warning-outline" size={22} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.warningTitle, { color: colors.warning }]}>Vehicle Not Set</Text>
              <Text style={[styles.warningSub, { color: colors.mutedForeground }]}>
                You won't appear on the dispatch map. Tap to fix.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.warning} />
          </TouchableOpacity>
        )}

        {/* ── Off-shift placeholder ── */}
        {!shiftActive && (
          <View style={[styles.offShiftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.offShiftIconWrap, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
              <Ionicons name="car-outline" size={40} color={colors.primary} />
            </View>
            <Text style={[styles.offShiftTitle, { color: colors.foreground }]}>You're Off Shift</Text>
            <Text style={[styles.offShiftSub, { color: colors.mutedForeground }]}>
              {driver?.active === false
                ? 'Your account has been deactivated. Contact your fleet administrator.'
                : shiftBlocked
                ? shiftBlocked.reason
                : 'Start a shift to go online and receive job offers from dispatch'}
            </Text>
            {lastShiftEndMs != null && lastShiftEndMs > 0 && !shiftBlocked && driver?.active !== false && (
              <View style={[styles.lastShiftPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="time-outline" size={13} color={colors.mutedForeground} />
                <Text style={[styles.lastShiftText, { color: colors.mutedForeground }]}>
                  Last shift ended {formatElapsed(Date.now() - lastShiftEndMs)} ago
                </Text>
              </View>
            )}
            {/* Compliance block banner */}
            {shiftBlocked && driver?.active !== false && (
              <View style={[styles.complianceBlock, { backgroundColor: '#dc262618', borderColor: '#dc2626' }]}>
                <Ionicons name="time-outline" size={16} color="#dc2626" />
                <Text style={[styles.complianceBlockText, { color: '#dc2626' }]}>
                  Available at {new Date(shiftBlocked.availableAt).toLocaleString('en-NZ', {
                    timeZone: COMPANY_TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
                  })}
                </Text>
              </View>
            )}
            {driver?.active !== false && (
              <TouchableOpacity
                style={[styles.bigStartBtn, {
                  backgroundColor: shiftBlocked ? colors.mutedForeground : colors.primary,
                  opacity: shiftBlocked ? 0.6 : 1,
                }]}
                onPress={shiftBlocked ? () => Alert.alert('Cannot Start Shift', shiftBlocked.reason) : handleToggle}
                activeOpacity={0.85}
              >
                <Ionicons name="play-circle" size={22} color={colors.primaryForeground} />
                <Text style={[styles.bigStartBtnText, { color: colors.primaryForeground }]}>Start Shift</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Active shift card ── */}
        {shiftActive && (
          <View style={[styles.shiftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.shiftInfo}>
              <View style={styles.shiftDotWrap}>
                <Animated.View style={[
                  styles.pulseDot,
                  { backgroundColor: colors.success + '44', transform: [{ scale: pulse }] },
                ]} />
                <View style={[styles.shiftStatusDot, { backgroundColor: colors.success }]} />
              </View>
              <Text style={[styles.shiftStatus, { color: colors.success }]}>On Shift</Text>
              {currentShift?.startMs && elapsedMs > 0 && (
                <View style={[styles.elapsedPill, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}>
                  <Ionicons name="time-outline" size={12} color={colors.primary} />
                  <Text style={[styles.elapsedText, { color: colors.primary }]}>{formatElapsed(elapsedMs)}</Text>
                </View>
              )}
            </View>

            {currentShift && (
              <Text style={[styles.shiftStart, { color: colors.mutedForeground }]}>
                Started {currentShift.startTime} · {currentShift.date}
              </Text>
            )}

            <View style={[styles.statsRow, { borderColor: colors.border }]}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.primary }]}>${todayEarnings.toFixed(2)}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Earnings</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{completedJobs.length}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Jobs Done</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {avgFare > 0 ? `$${avgFare.toFixed(0)}` : '—'}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Avg Fare</Text>
              </View>
            </View>

            {/* TM earnings strip — only when there are TM jobs */}
            {tmJobs.length > 0 && (
              <View style={[styles.tmStrip, { backgroundColor: '#7c3aed18', borderColor: '#7c3aed33' }]}>
                <Ionicons name="accessibility" size={13} color="#7c3aed" />
                <Text style={[styles.tmStripText, { color: '#7c3aed' }]}>
                  {tmJobs.length} TM {tmJobs.length === 1 ? 'job' : 'jobs'} · ${tmEarnings.toFixed(2)} collected
                </Text>
              </View>
            )}
            {/* ACC strip */}
            {accJobs.length > 0 && (
              <View style={[styles.tmStrip, { backgroundColor: '#e0f2fe', borderColor: '#bae6fd' }]}>
                <Ionicons name="shield-checkmark" size={13} color="#0369a1" />
                <Text style={[styles.tmStripText, { color: '#0369a1' }]}>
                  {accJobs.length} ACC funded {accJobs.length === 1 ? 'job' : 'jobs'}
                  {wavJobs.length > 0 ? ` · ${wavJobs.length} WAV` : ''}
                </Text>
              </View>
            )}

            {/* ── NZ Compliance Stats ── */}
            {(() => {
              const currentBreakMs = breakActive && breakStartMs ? Date.now() - breakStartMs : 0;
              const workMs = Math.max(0, elapsedMs - todayBreakMs - currentBreakMs);
              const breakMs = todayBreakMs + currentBreakMs;
              const dailyRemaining = Math.max(0, DAILY_LIMIT_MS - workMs);
              const weeklyNow = weeklyWorkMinutes + Math.floor(workMs / 60000);
              const weeklyRemaining = Math.max(0, WEEKLY_LIMIT_MIN - weeklyNow);
              const dailyPct = Math.min(1, workMs / DAILY_LIMIT_MS);
              const weeklyPct = Math.min(1, weeklyNow / WEEKLY_LIMIT_MIN);
              const dailyWarn = dailyRemaining <= 60 * 60 * 1000;
              const weeklyWarn = weeklyRemaining <= 5 * 60;
              return (
                <View style={[styles.complianceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.complianceSectionLabel, { color: colors.mutedForeground }]}>NZ HOURS</Text>
                  {/* Daily row */}
                  <View style={styles.complianceRow}>
                    <View style={styles.complianceLabelCol}>
                      <Ionicons name="sunny-outline" size={13} color={dailyWarn ? '#f59e0b' : colors.mutedForeground} />
                      <Text style={[styles.complianceLabelText, { color: dailyWarn ? '#f59e0b' : colors.mutedForeground }]}>Daily</Text>
                    </View>
                    <View style={styles.complianceBarWrap}>
                      <View style={[styles.complianceBarTrack, { backgroundColor: colors.border }]}>
                        <View style={[styles.complianceBarFill, {
                          width: `${dailyPct * 100}%` as any,
                          backgroundColor: dailyWarn ? '#f59e0b' : colors.primary,
                        }]} />
                      </View>
                    </View>
                    <Text style={[styles.complianceValue, { color: dailyWarn ? '#f59e0b' : colors.foreground }]}>
                      {fmtMs(workMs)} <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>/ 14h</Text>
                    </Text>
                  </View>
                  {/* Weekly row */}
                  <View style={styles.complianceRow}>
                    <View style={styles.complianceLabelCol}>
                      <Ionicons name="calendar-outline" size={13} color={weeklyWarn ? '#ef4444' : colors.mutedForeground} />
                      <Text style={[styles.complianceLabelText, { color: weeklyWarn ? '#ef4444' : colors.mutedForeground }]}>Weekly</Text>
                    </View>
                    <View style={styles.complianceBarWrap}>
                      <View style={[styles.complianceBarTrack, { backgroundColor: colors.border }]}>
                        <View style={[styles.complianceBarFill, {
                          width: `${weeklyPct * 100}%` as any,
                          backgroundColor: weeklyWarn ? '#ef4444' : colors.primary,
                        }]} />
                      </View>
                    </View>
                    <Text style={[styles.complianceValue, { color: weeklyWarn ? '#ef4444' : colors.foreground }]}>
                      {fmtMins(weeklyNow)} <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>/ 70h</Text>
                    </Text>
                  </View>
                  {/* Break row (shown when break time > 0) */}
                  {breakMs > 0 && (
                    <View style={styles.complianceRow}>
                      <View style={styles.complianceLabelCol}>
                        <Ionicons name="cafe-outline" size={13} color={colors.mutedForeground} />
                        <Text style={[styles.complianceLabelText, { color: colors.mutedForeground }]}>Break</Text>
                      </View>
                      <View style={{ flex: 1 }} />
                      <Text style={[styles.complianceValue, { color: colors.mutedForeground }]}>{fmtMs(breakMs)}</Text>
                    </View>
                  )}
                  {/* Remaining callout */}
                  <View style={[styles.complianceFooter, { borderTopColor: colors.border }]}>
                    <Text style={[styles.complianceFooterText, { color: dailyWarn ? '#f59e0b' : colors.mutedForeground }]}>
                      {dailyWarn
                        ? `⚠️ ${fmtMs(dailyRemaining)} left today`
                        : `${fmtMs(dailyRemaining)} left today`}
                    </Text>
                    <Text style={[styles.complianceFooterText, { color: weeklyWarn ? '#ef4444' : colors.mutedForeground }]}>
                      {weeklyWarn
                        ? `⚠️ ${fmtMins(weeklyRemaining)} left this week`
                        : `${fmtMins(weeklyRemaining)} left this week`}
                    </Text>
                  </View>
                </View>
              );
            })()}

            {/* ── 4-hour break nudge (NZ compliance) ── */}
            {(() => {
              const currentBreakMs = breakActive && breakStartMs ? Date.now() - breakStartMs : 0;
              const workMs = Math.max(0, elapsedMs - todayBreakMs - currentBreakMs);
              const fourHoursMs = 4 * 3600 * 1000;
              const needsBreakNudge =
                shiftActive &&
                workMs > fourHoursMs &&
                !breakActive &&
                todayBreakMs < 30 * 60 * 1000 &&
                !currentJob;
              if (!needsBreakNudge) return null;
              return (
                <TouchableOpacity
                  style={[styles.breakNudge, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}
                  onPress={() => Alert.alert(
                    '☕  Break Reminder',
                    `You've been driving ${fmtMs(workMs)} without a break.\n\nNZ regulations require a 30-minute rest in any 5.5-hour driving period. Taking a break now protects your licence and keeps you safe.`,
                    [
                      { text: 'Remind Later', style: 'cancel' },
                      { text: 'Start Break Now', onPress: startBreak },
                    ]
                  )}
                  activeOpacity={0.8}
                >
                  <Ionicons name="cafe" size={18} color="#f59e0b" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.breakNudgeTitle, { color: '#f59e0b' }]}>Break recommended</Text>
                    <Text style={[styles.breakNudgeSub, { color: '#f59e0b99' }]}>
                      {fmtMs(workMs)} driven · NZ regs: 30 min break in 5.5 h
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#f59e0b" />
                </TouchableOpacity>
              );
            })()}

            {/* ── Break button ── */}
            {!currentJob && (
              <TouchableOpacity
                style={[styles.breakBtn, {
                  backgroundColor: breakActive ? '#f59e0b22' : colors.surface,
                  borderColor: breakActive ? '#f59e0b' : colors.border,
                }]}
                onPress={() => {
                  if (breakActive) {
                    endBreak();
                  } else {
                    Alert.alert(
                      'Start Break',
                      'Break time will not count toward your 14-hour daily limit.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Start Break', onPress: startBreak },
                      ],
                    );
                  }
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="cafe-outline" size={18} color={breakActive ? '#f59e0b' : colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.breakBtnText, { color: breakActive ? '#f59e0b' : colors.mutedForeground }]}>
                    {breakActive ? 'On Break — Tap to End' : 'Take a Break'}
                  </Text>
                  {breakActive && breakElapsedMs > 0 && (
                    <Text style={[styles.breakElapsed, { color: '#f59e0b' }]}>
                      {formatElapsed(breakElapsedMs)} elapsed
                    </Text>
                  )}
                </View>
                {breakActive && (
                  <View style={[styles.breakActiveDot, { backgroundColor: '#f59e0b' }]} />
                )}
              </TouchableOpacity>
            )}
            {currentJob && breakActive && (
              <View style={[styles.breakBtn, { backgroundColor: '#f59e0b22', borderColor: '#f59e0b' }]}>
                <Ionicons name="cafe-outline" size={18} color="#f59e0b" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.breakBtnText, { color: '#f59e0b' }]}>On Break · End trip to finish</Text>
                  {breakElapsedMs > 0 && (
                    <Text style={[styles.breakElapsed, { color: '#f59e0b' }]}>{formatElapsed(breakElapsedMs)} elapsed</Text>
                  )}
                </View>
              </View>
            )}

            {/* Quick status toggle */}
            <View style={[styles.quickStatusRow, { borderColor: colors.border }]}>
              {(['Available', 'Away', 'Busy'] as const).map((s) => {
                const dotColor = STATUS_COLOR[s] ?? colors.mutedForeground;
                const isActive = status === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.quickStatusBtn,
                      {
                        backgroundColor: isActive ? dotColor + '22' : colors.surface,
                        borderColor: isActive ? dotColor : colors.border,
                      },
                    ]}
                    onPress={() => {
                      if (!isActive) {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setStatus(s);
                      }
                    }}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.quickStatusDot, { backgroundColor: dotColor }]} />
                    <Text style={[styles.quickStatusText, { color: isActive ? dotColor : colors.mutedForeground }]}>
                      {s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.shiftBtn, { backgroundColor: colors.error + '18', borderColor: colors.error + '44' }]}
              onPress={handleToggle}
              activeOpacity={0.8}
            >
              <Ionicons name="stop-circle" size={20} color={colors.error} />
              <Text style={[styles.shiftBtnText, { color: colors.error }]}>End Shift</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Today's Jobs (always visible) ── */}
        <>
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 0, paddingHorizontal: 0 }]}>
              TODAY'S JOBS
            </Text>
            {todayJobs.length > 0 && (
              <Text style={[styles.sectionBadge, { color: colors.primary, backgroundColor: colors.primary + '18' }]}>
                {todayJobs.length}
              </Text>
            )}
          </View>

          {!shiftActive ? (
            <View style={[styles.fleetEmpty, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 20 }]}>
              <Ionicons name="car-outline" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Start a shift to track today's jobs</Text>
            </View>
          ) : todayJobs.length === 0 ? (
            <View style={[styles.fleetEmpty, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 20 }]}>
              <Ionicons name="checkmark-circle-outline" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No jobs completed yet this shift</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 20 }}>
              {todayJobs.map((job, idx) => {
                const timeStr = jobCompletedTime(job);
                const pmtLabel = paymentLabel(job.paymentType);
                return (
                  <View
                    key={job.id}
                    style={[styles.todayJobRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.todayJobNum, { backgroundColor: colors.primary + '18' }]}>
                      <Text style={[styles.todayJobNumText, { color: colors.primary }]}>
                        {todayJobs.length - idx}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.todayJobAddr, { color: colors.foreground }]} numberOfLines={1}>
                        {job.pickupAddress || 'Pickup address'}
                      </Text>
                      {job.dropAddress ? (
                        <Text style={[styles.todayJobDrop, { color: colors.mutedForeground }]} numberOfLines={1}>
                          ↳ {job.dropAddress}
                        </Text>
                      ) : null}
                      {timeStr ? (
                        <Text style={[styles.todayJobTime, { color: colors.mutedForeground }]}>{timeStr}</Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[styles.todayJobFare, { color: job.paymentType === 'total_mobility' ? '#7c3aed' : colors.primary }]}>
                        ${job.fare.toFixed(2)}
                      </Text>
                      <View style={[
                        styles.todayJobPmtBadge,
                        job.paymentType === 'total_mobility'
                          ? { backgroundColor: '#7c3aed18', borderColor: '#7c3aed44' }
                          : { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}>
                        {job.paymentType === 'total_mobility' && (
                          <Ionicons name="accessibility" size={9} color="#7c3aed" />
                        )}
                        <Text style={[
                          styles.todayJobPmtText,
                          { color: job.paymentType === 'total_mobility' ? '#7c3aed' : colors.mutedForeground },
                        ]}>{pmtLabel}</Text>
                      </View>
                      {/* WAV + ACC micro-badges */}
                      {(job.wheelchair || job.acc_client_id) && (
                        <View style={{ flexDirection: 'row', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {job.wheelchair && (
                            <View style={[styles.todayJobPmtBadge, { backgroundColor: '#7c3aed22', borderColor: '#7c3aed44' }]}>
                              <Ionicons name="accessibility" size={9} color="#7c3aed" />
                              <Text style={[styles.todayJobPmtText, { color: '#7c3aed' }]}>WAV</Text>
                            </View>
                          )}
                          {!!job.acc_client_id && (
                            <View style={[styles.todayJobPmtBadge, { backgroundColor: '#e0f2fe', borderColor: '#bae6fd' }]}>
                              <Ionicons name="shield-checkmark" size={9} color="#0369a1" />
                              <Text style={[styles.todayJobPmtText, { color: '#0369a1' }]}>ACC</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>

        {/* ── My Zone (only on shift) ── */}
        {shiftActive && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MY ZONE</Text>
            <View style={[styles.zoneCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {myZoneInfo?.zoneName ? (
                <View style={styles.zoneGrid}>
                  <View style={styles.zoneItem}>
                    <View style={[styles.zoneIconBg, { backgroundColor: colors.primary + '18' }]}>
                      <Ionicons name="map-outline" size={20} color={colors.primary} />
                    </View>
                    <Text style={[styles.zoneValue, { color: colors.foreground }]}>{myZoneInfo.zoneName}</Text>
                    <Text style={[styles.zoneLabel, { color: colors.mutedForeground }]}>Zone</Text>
                  </View>
                  <View style={[styles.zoneDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.zoneItem}>
                    <View style={[styles.zoneIconBg, { backgroundColor: colors.info + '18' }]}>
                      <Ionicons name="list-outline" size={20} color={colors.info} />
                    </View>
                    <Text style={[styles.zoneValue, { color: colors.foreground }]}>#{myZoneInfo.zoneQueue}</Text>
                    <Text style={[styles.zoneLabel, { color: colors.mutedForeground }]}>Queue</Text>
                  </View>
                  <View style={[styles.zoneDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.zoneItem}>
                    <View style={[styles.zoneIconBg, { backgroundColor: (STATUS_COLOR[status] ?? '#888') + '22' }]}>
                      <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[status] ?? colors.mutedForeground }]} />
                    </View>
                    <Text style={[styles.zoneValue, { color: colors.foreground }]}>{status}</Text>
                    <Text style={[styles.zoneLabel, { color: colors.mutedForeground }]}>Status</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.zoneUnassigned}>
                  <Ionicons name="locate-outline" size={28} color={colors.mutedForeground} />
                  <Text style={[styles.zoneUnassignedText, { color: colors.mutedForeground }]}>Waiting for zone assignment</Text>
                  <Text style={[styles.zoneUnassignedSub, { color: colors.mutedForeground }]}>Dispatch will assign your zone</Text>
                </View>
              )}
            </View>

            {/* ── Fleet online ── */}
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              FLEET ONLINE · {onlineDrivers.length} {onlineDrivers.length === 1 ? 'CAB' : 'CABS'}
            </Text>

            {onlineDrivers.length === 0 ? (
              <View style={[styles.fleetEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="car-outline" size={28} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No other cabs online</Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {onlineDrivers.map(od => {
                  const isMe = od.vehicleNumber === driver?.vehicleId;
                  const dotColor = STATUS_COLOR[od.status] ?? colors.mutedForeground;
                  return (
                    <View
                      key={od.vehicleId}
                      style={[
                        styles.cabRow,
                        {
                          backgroundColor: isMe ? colors.primary + '18' : colors.card,
                          borderColor:     isMe ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <View style={[styles.cabIcon, { backgroundColor: dotColor + '22' }]}>
                        <Ionicons name="car" size={18} color={dotColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.cabTopRow}>
                          <Text style={[styles.cabVehicle, { color: colors.foreground }]}>
                            {od.vehicleNumber}{isMe ? '  (You)' : ''}
                          </Text>
                          <View style={[styles.cabStatusPill, { backgroundColor: dotColor + '22' }]}>
                            <View style={[styles.cabStatusDot, { backgroundColor: dotColor }]} />
                            <Text style={[styles.cabStatusText, { color: dotColor }]}>{od.status}</Text>
                          </View>
                        </View>
                        <View style={styles.cabBottomRow}>
                          {od.zoneName
                            ? <Text style={[styles.cabZone, { color: colors.mutedForeground }]}>{od.zoneName}  ·  #{od.zoneQueue} in queue</Text>
                            : <Text style={[styles.cabZone, { color: colors.mutedForeground }]}>No zone assigned</Text>
                          }
                          {od.jobCount > 0 && (
                            <Text style={[styles.cabJobs, { color: colors.primary }]}>
                              {od.jobCount} job{od.jobCount !== 1 ? 's' : ''}
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* ── Shift History ── */}
        <View style={styles.historyHeader}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 0, paddingHorizontal: 0 }]}>SHIFT HISTORY</Text>
          {shiftHistory.length > 0 && (
            <Text style={[styles.historyCount, { color: colors.mutedForeground }]}>
              {shiftHistory.length} {shiftHistory.length === 1 ? 'shift' : 'shifts'}
            </Text>
          )}
        </View>

        {/* Recent summary card */}
        {weeklyShifts > 0 && (() => {
          const maxE = Math.max(...recentShifts.map(s => s.earnings), 1);
          const CHART_H = 52;
          return (
            <>
              <View style={[styles.weeklySummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.weeklyRow}>
                  <View style={styles.weeklyItem}>
                    <Text style={[styles.weeklyValue, { color: colors.primary }]}>${weeklyEarnings.toFixed(2)}</Text>
                    <Text style={[styles.weeklyLabel, { color: colors.mutedForeground }]}>Earnings</Text>
                  </View>
                  <View style={[styles.weeklyDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.weeklyItem}>
                    <Text style={[styles.weeklyValue, { color: colors.foreground }]}>{weeklyJobs}</Text>
                    <Text style={[styles.weeklyLabel, { color: colors.mutedForeground }]}>Jobs</Text>
                  </View>
                  <View style={[styles.weeklyDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.weeklyItem}>
                    <Text style={[styles.weeklyValue, { color: colors.foreground }]}>{weeklyShifts}</Text>
                    <Text style={[styles.weeklyLabel, { color: colors.mutedForeground }]}>Shifts</Text>
                  </View>
                  <View style={[styles.weeklyDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.weeklyItem}>
                    <Text style={[styles.weeklyValue, { color: colors.foreground }]}>
                      {weeklyAvgPerShift > 0 ? `$${weeklyAvgPerShift.toFixed(0)}` : '—'}
                    </Text>
                    <Text style={[styles.weeklyLabel, { color: colors.mutedForeground }]}>Avg/Shift</Text>
                  </View>
                </View>
                <Text style={[styles.weeklyCaption, { color: colors.mutedForeground }]}>
                  Last {weeklyShifts} {weeklyShifts === 1 ? 'shift' : 'shifts'}
                </Text>

                {/* Mini bar chart */}
                <View style={[styles.barChart, { borderTopColor: colors.border }]}>
                  {recentShifts.slice(0, 7).reverse().map((s, i) => {
                    const pct = maxE > 0 ? s.earnings / maxE : 0;
                    const fillH = Math.max(pct * CHART_H, 3);
                    const barColor = pct >= 0.85 ? colors.success
                      : pct >= 0.5 ? colors.primary
                      : colors.primary + '66';
                    let dayLabel = '';
                    try {
                      if (s.startMs) {
                        dayLabel = new Date(s.startMs).toLocaleDateString('en-NZ', {
                          timeZone: COMPANY_TZ, weekday: 'short',
                        }).slice(0, 3);
                      } else {
                        dayLabel = s.date?.slice(0, 2) ?? '';
                      }
                    } catch { dayLabel = ''; }
                    return (
                      <View key={i} style={styles.barItem}>
                        <Text style={[styles.barAmt, { color: pct >= 0.5 ? colors.primary : colors.mutedForeground }]}>
                          ${s.earnings.toFixed(0)}
                        </Text>
                        <View style={[styles.barTrack, { height: CHART_H, backgroundColor: colors.surface }]}>
                          <View style={[styles.barFill, { height: fillH, backgroundColor: barColor }]} />
                        </View>
                        <Text style={[styles.barDay, { color: colors.mutedForeground }]}>{dayLabel}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </>
          );
        })()}

        {shiftHistory.length === 0 ? (
          <View style={[styles.fleetEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="time-outline" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No shift history yet</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {shiftHistory.map(item => {
              const duration = formatDuration(item);
              return (
                <View key={item.id} style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.historyIconWrap, { backgroundColor: colors.primary + '18' }]}>
                    <Ionicons name="time-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.historyDate, { color: colors.foreground }]}>{item.date}</Text>
                    <Text style={[styles.historyTime, { color: colors.mutedForeground }]}>
                      {item.startTime}{item.endTime ? ` — ${item.endTime}` : ' — ongoing'}
                      {duration !== '—' ? `  ·  ${duration}` : ''}
                    </Text>
                  </View>
                  <View style={styles.historyRight}>
                    <Text style={[styles.historyEarnings, { color: colors.primary }]}>${item.earnings.toFixed(2)}</Text>
                    <Text style={[styles.historyJobs, { color: colors.mutedForeground }]}>
                      {item.jobCount} {item.jobCount === 1 ? 'job' : 'jobs'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  pageHeader: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 12 },
  heading: { fontSize: 28, fontWeight: '800', fontFamily: 'Inter_700Bold' },
  headingSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },

  activeJobBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 10, borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  activeJobIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  activeJobLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginBottom: 2 },
  activeJobAddr: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  warningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 14, borderRadius: 14, borderWidth: 1.5, padding: 14,
  },
  warningTitle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  warningSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  offShiftCard: {
    marginHorizontal: 16, borderRadius: 24, borderWidth: 1, padding: 32,
    alignItems: 'center', gap: 14, marginBottom: 24,
  },
  offShiftIconWrap: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  offShiftTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  offShiftSub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
  bigStartBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 36, paddingVertical: 16, borderRadius: 16, marginTop: 8,
  },
  bigStartBtnText: { fontSize: 17, fontFamily: 'Inter_700Bold' },

  shiftCard: { marginHorizontal: 16, borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 24, gap: 16 },
  shiftInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shiftDotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  pulseDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7 },
  shiftStatusDot: { width: 10, height: 10, borderRadius: 5 },
  shiftStatus: { fontSize: 17, fontFamily: 'Inter_600SemiBold', flex: 1 },
  elapsedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  elapsedText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  shiftStart: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: -8 },

  statsRow: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 16 },
  statItem: { flex: 1, alignItems: 'center', gap: 5 },
  statValue: { fontSize: 26, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  statDivider: { width: 1 },

  shiftBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 13, gap: 8, borderWidth: 1,
  },
  shiftBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },

  sectionLabel: {
    paddingHorizontal: 20, fontSize: 11, fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5, marginBottom: 12, marginTop: 8,
  },

  zoneCard: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 24 },
  zoneGrid: { flexDirection: 'row', alignItems: 'center' },
  zoneItem: { flex: 1, alignItems: 'center', gap: 8 },
  zoneDivider: { width: 1, height: 64, marginHorizontal: 4 },
  zoneIconBg: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  zoneValue: { fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  zoneLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  zoneUnassigned: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  zoneUnassignedText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  zoneUnassignedSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  fleetEmpty: {
    marginHorizontal: 16, borderRadius: 14, borderWidth: 1, padding: 24,
    alignItems: 'center', gap: 8, marginBottom: 8,
  },
  cabRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, padding: 14,
  },
  cabIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cabTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cabVehicle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  cabStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  cabStatusDot: { width: 7, height: 7, borderRadius: 4 },
  cabStatusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  cabBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cabZone: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  cabJobs: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  historyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 12, marginTop: 8,
  },
  historyCount: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  weeklySummary: {
    marginHorizontal: 16, borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 14,
  },
  weeklyRow: { flexDirection: 'row', alignItems: 'center' },
  weeklyItem: { flex: 1, alignItems: 'center', gap: 4 },
  weeklyDivider: { width: 1, height: 44 },
  weeklyValue: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  weeklyLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  weeklyCaption: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 10 },

  barChart: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around',
    marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  barItem: { flex: 1, alignItems: 'center', gap: 4 },
  barAmt: { fontSize: 9, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  barTrack: {
    width: '100%', borderRadius: 4,
    justifyContent: 'flex-end', overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 4 },
  barDay: { fontSize: 9, fontFamily: 'Inter_500Medium', textAlign: 'center' },

  historyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: 1, padding: 16,
  },
  historyIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  historyDate: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  historyTime: { fontSize: 12, marginTop: 2, fontFamily: 'Inter_400Regular' },
  historyRight: { alignItems: 'flex-end' },
  historyEarnings: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  historyJobs: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  tmStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  tmStripText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', flex: 1 },

  complianceCard: {
    borderRadius: 14, borderWidth: 1, padding: 14, gap: 10,
  },
  complianceSectionLabel: {
    fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 2,
  },
  complianceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  complianceLabelCol: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 56 },
  complianceLabelText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  complianceBarWrap: { flex: 1 },
  complianceBarTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  complianceBarFill: { height: '100%', borderRadius: 3 },
  complianceValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold', width: 66, textAlign: 'right' },
  complianceFooter: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2,
  },
  complianceFooterText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  complianceBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, width: '100%',
  },
  complianceBlockText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', flex: 1 },

  breakBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingVertical: 11,
  },
  breakBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  breakElapsed: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  breakActiveDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 4 },

  breakNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 10,
  },
  breakNudgeTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  breakNudgeSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  lastShiftPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1,
  },
  lastShiftText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  quickStatusRow: {
    flexDirection: 'row', gap: 8, paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4,
  },
  quickStatusBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5,
  },
  quickStatusDot: { width: 8, height: 8, borderRadius: 4 },
  quickStatusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 4 },

  sectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, marginTop: 8, marginBottom: 12,
  },
  sectionBadge: {
    fontSize: 11, fontFamily: 'Inter_700Bold',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20,
  },

  todayJobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  todayJobNum: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  todayJobNumText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  todayJobAddr: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  todayJobDrop: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  todayJobTime: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  todayJobFare: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  todayJobPmtBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2,
  },
  todayJobPmtText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
});
