import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Animated, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import { playAlertBeep, stopAlertBeep } from '@/lib/alertSound';
import { useColors } from '@/hooks/useColors';
import { Job, useDriver } from '@/context/DriverContext';
import { PassengerContactBar } from '@/components/PassengerContactBar';

interface Props {
  job: Job;
  onAccept: () => void;
  onReject: () => void;
}

const DEFAULT_COUNTDOWN = 30;

function calcRemaining(job: Job): number {
  const timeoutSecs = job.offerTimeoutSecs ?? DEFAULT_COUNTDOWN;
  if (job.offerSentAt) {
    const expiresAt = job.offerSentAt + timeoutSecs * 1000;
    return Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  }
  return timeoutSecs;
}

// ── Special-requirement badge data ────────────────────────────────────────────
interface BadgeDef {
  label: string;
  icon: string;
  bg: string;
  text: string;
  border: string;
}

function buildBadges(job: Job): BadgeDef[] {
  const badges: BadgeDef[] = [];

  if (job.wheelchair) {
    badges.push({ label: 'WAV REQUIRED', icon: 'accessibility', bg: '#7c3aed22', text: '#7c3aed', border: '#7c3aed55' });
  }
  if (job.tmHoistRequired) {
    badges.push({ label: 'HOIST REQUIRED', icon: 'arrow-up-circle', bg: '#ef444422', text: '#ef4444', border: '#ef444455' });
  }
  if (job.paymentType === 'total_mobility') {
    badges.push({ label: 'TOTAL MOBILITY', icon: 'card', bg: '#7c3aed22', text: '#7c3aed', border: '#7c3aed55' });
  }
  if (job.acc_client_id) {
    badges.push({ label: 'ACC FUNDED', icon: 'shield-checkmark', bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' });
  }

  const bt = (job.bookingType ?? '').toLowerCase();
  if (bt.includes('tow') || bt.includes('recovery')) {
    badges.push({ label: 'TOW / RECOVERY', icon: 'car-sport', bg: '#ef444422', text: '#ef4444', border: '#ef444455' });
  } else if (bt.includes('freight') || bt.includes('parcel') || bt.includes('cargo')) {
    badges.push({ label: 'FREIGHT / PARCEL', icon: 'cube-outline', bg: '#f59e0b22', text: '#f59e0b', border: '#f59e0b55' });
  } else if (bt.includes('food') || bt.includes('meal') || bt.includes('restaurant') || bt.includes('deliver')) {
    badges.push({ label: 'FOOD DELIVERY', icon: 'fast-food-outline', bg: '#10b98122', text: '#10b981', border: '#10b98155' });
  }

  const vt = (job.vehicleType ?? '').toLowerCase();
  if (vt && vt !== 'car' && vt !== 'not specified' && vt !== 'normal') {
    badges.push({ label: job.vehicleType!.toUpperCase(), icon: 'car-sport-outline', bg: '#f97316', text: '#fff', border: '#f97316' });
  }

  if ((job.passengers ?? 0) > 1) {
    badges.push({ label: `${job.passengers} PAX`, icon: 'people', bg: '#3b82f622', text: '#3b82f6', border: '#3b82f655' });
  }

  // 22bo-fix8: HQ asked for the booking source on the offer popup so drivers
  // can tell a fresh dispatcher offer apart from a website/passenger-app/re-offer
  // at a glance. Reads jobBookingSrc/BookingSource/source — first present wins.
  const srcRaw = String(
    (job as any).jobBookingSrc ??
    (job as any).BookingSource  ??
    (job as any).bookingSource  ??
    (job as any).source         ?? ''
  ).trim();
  if (srcRaw) {
    const s = srcRaw.toLowerCase();
    let label = srcRaw.toUpperCase();
    let icon: any = 'radio-outline';
    if (s.includes('re-offer') || s.includes('reoffer') || s.includes('redispatch') || s.includes('re-dispatch')) {
      label = 'RE-OFFER'; icon = 'refresh-circle';
    } else if (s.includes('phone') || s.includes('dispatch') || s.includes('console')) {
      label = 'DISPATCH'; icon = 'headset';
    } else if (s.includes('web')) {
      label = 'WEBSITE'; icon = 'globe-outline';
    } else if (s.includes('app') || s.includes('passenger')) {
      label = 'PASSENGER APP'; icon = 'phone-portrait';
    } else if (s.includes('hail')) {
      label = 'HAIL'; icon = 'hand-left';
    } else if (s.includes('account')) {
      label = 'ACCOUNT'; icon = 'briefcase-outline';
    }
    badges.push({ label, icon, bg: '#0ea5e922', text: '#0ea5e9', border: '#0ea5e955' });
  }

  return badges;
}

export function IncomingJobAlert({ job, onAccept, onReject }: Props) {
  // v22bo fix (architect): pull driver identity here so the contact-bar can
  // log Call/SMS attempts even when the offer hasn't been accepted yet.
  const { driver } = useDriver();
  const colors = useColors();
  const totalSecs = job.offerTimeoutSecs ?? DEFAULT_COUNTDOWN;
  const [countdown, setCountdown] = useState(() => calcRemaining(job));
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const onRejectRef = useRef(onReject);
  useEffect(() => { onRejectRef.current = onReject; });

  // Countdown tick
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Auto-reject when time runs out — uses ref to avoid stale closure
  useEffect(() => {
    if (countdown <= 0) onRejectRef.current();
  }, [countdown]);

  // Pulse animation + repeating sound + haptic
  useEffect(() => {
    let cancelled = false;

    const alertOnce = () => {
      if (cancelled) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      playAlertBeep();
    };

    alertOnce();
    const interval = setInterval(() => { if (!cancelled) alertOnce(); }, 3000);

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 400, useNativeDriver: true }),
      ])
    );
    pulse.start();

    return () => {
      cancelled = true;
      clearInterval(interval);
      pulse.stop();
      stopAlertBeep();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = totalSecs > 0 ? countdown / totalSecs : 0;
  const progressColor =
    progress > 0.5 ? colors.success :
    progress > 0.25 ? colors.warning : colors.error;

  const badges = buildBadges(job);
  const hasSpecialReqs = job.wheelchair || job.tmHoistRequired || job.paymentType === 'total_mobility' || job.acc_client_id;

  const payLabel =
    job.paymentType === 'eftpos'         ? 'EFTPOS' :
    job.paymentType === 'card'           ? 'CARD' :
    job.paymentType === 'account'        ? 'ACCT' :
    job.paymentType === 'total_mobility' ? 'TM' : 'CASH';
  const payColor =
    job.paymentType === 'account' || job.paymentType === 'total_mobility' ? colors.warning :
    job.paymentType === 'cash'    ? colors.success : colors.primary;

  const infoText = job.orderDetails || job.notes;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: hasSpecialReqs ? '#7c3aed' : colors.warning,
            },
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <View style={[styles.alertHeader, { backgroundColor: (hasSpecialReqs ? '#7c3aed' : colors.warning) + '22' }]}>
            <View style={[styles.alertIconBox, { backgroundColor: hasSpecialReqs ? '#7c3aed' : colors.warning }]}>
              <Ionicons
                name={hasSpecialReqs ? 'accessibility' : 'car'}
                size={24}
                color="#fff"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.alertTitle, { color: colors.foreground }]}>
                {hasSpecialReqs ? 'Special Requirements Job' : 'New Job Offer'}
              </Text>
              <Text style={[styles.alertSub, { color: colors.mutedForeground }]}>
                Respond within {countdown}s
              </Text>
            </View>
            <View style={[styles.countdownCircle, { borderColor: progressColor }]}>
              <Text style={[styles.countdownText, { color: progressColor }]}>{countdown}</Text>
            </View>
          </View>

          {/* ── Progress bar ───────────────────────────────────────────────── */}
          <View style={[styles.progressTrack, { backgroundColor: colors.surface }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(0, progress * 100)}%` as any,
                  backgroundColor: progressColor,
                },
              ]}
            />
          </View>

          {/* ── Special-requirement badge row ──────────────────────────────── */}
          {badges.length > 0 && (
            <View style={[styles.badgeRow, { borderBottomColor: colors.border }]}>
              {badges.map(b => (
                <View
                  key={b.label}
                  style={[styles.badge, { backgroundColor: b.bg, borderColor: b.border }]}
                >
                  <Ionicons name={b.icon as any} size={12} color={b.text} />
                  <Text style={[styles.badgeText, { color: b.text }]}>{b.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Body ───────────────────────────────────────────────────────── */}
          <View style={styles.body}>
            <View style={styles.passengerRow}>
              <Ionicons name="person-circle" size={40} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.passengerName, { color: colors.foreground }]} numberOfLines={1}>
                  {job.passengerName}
                </Text>
                {!!job.passengerPhone && (
                  <Text style={[styles.passengerPhone, { color: colors.mutedForeground }]}>
                    {job.passengerPhone}
                  </Text>
                )}
              </View>
            </View>
            {/* v22bn: tap-to-call / tap-to-text right inside the alert. */}
            <PassengerContactBar
              phone={job.passengerPhone}
              passengerName={job.passengerName}
              bookingId={(job as any).bookingId ?? job.id}
              source={(job as any).source ?? job.bookingType ?? null}
              companyId={driver?.companyId}
              driverId={driver?.id ?? driver?.vehicleId}
              driverName={driver?.name}
              compact
            />

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.routeBlock}>
              <View style={styles.routeRow}>
                <Ionicons name="location" size={16} color={colors.success} />
                <Text style={[styles.routeAddr, { color: colors.foreground }]} numberOfLines={2}>
                  {job.pickupAddress}
                </Text>
              </View>
              <View style={styles.routeConnector}>
                <View style={[styles.connLine, { backgroundColor: colors.border }]} />
              </View>
              <View style={styles.routeRow}>
                <Ionicons name="flag" size={16} color={colors.error} />
                <Text style={[styles.routeAddr, { color: colors.foreground }]} numberOfLines={2}>
                  {job.dropAddress}
                </Text>
              </View>
            </View>

            {/* Order details / notes */}
            {!!infoText && (
              <View style={[styles.notesBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="document-text-outline" size={14} color={colors.mutedForeground} style={{ marginTop: 1 }} />
                <Text style={[styles.notesText, { color: colors.foreground }]} numberOfLines={4}>
                  {infoText}
                </Text>
              </View>
            )}

            {/* Total Mobility details */}
            {job.paymentType === 'total_mobility' && (job.tmVoucherNo || job.tmPassengerName) && (
              <View style={[styles.notesBox, { backgroundColor: '#7c3aed18', borderColor: '#7c3aed55' }]}>
                <Ionicons name="card-outline" size={14} color="#7c3aed" style={{ marginTop: 1 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  {job.tmPassengerName ? (
                    <Text style={[styles.notesText, { color: '#7c3aed', fontFamily: 'Inter_600SemiBold' }]}>
                      {job.tmPassengerName}
                    </Text>
                  ) : null}
                  {job.tmVoucherNo ? (
                    <Text style={[styles.notesText, { color: colors.foreground }]}>
                      Voucher: {job.tmVoucherNo}{job.tmCardExpiry ? ` · Exp ${job.tmCardExpiry}` : ''}
                    </Text>
                  ) : null}
                  {job.tmSubsidy != null ? (
                    <Text style={[styles.notesText, { color: colors.mutedForeground }]}>
                      Subsidy: ${job.tmSubsidy.toFixed(2)} · Pax pays: ${(job.tmPassengerPays ?? 0).toFixed(2)}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}

            <View style={[styles.statsRow, { backgroundColor: colors.surface, borderRadius: 12 }]}>
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: colors.primary }]}>
                  {job.fare > 0 ? `$${job.fare.toFixed(2)}` : '—'}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Est. Fare</Text>
              </View>
              <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: payColor }]}>{payLabel}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Payment</Text>
              </View>
              <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{job.distance || '—'}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Distance</Text>
              </View>
            </View>
          </View>

          {/* ── Actions ────────────────────────────────────────────────────── */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.rejectBtn, { borderColor: colors.error }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onReject(); }}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={20} color={colors.error} />
              <Text style={[styles.rejectText, { color: colors.error }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptBtn, { backgroundColor: hasSpecialReqs ? '#7c3aed' : colors.primary }]}
              onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onAccept(); }}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={[styles.acceptText, { color: '#fff' }]}>Accept</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  card: {
    width: '100%', maxWidth: 420, borderRadius: 24, borderWidth: 2, overflow: 'hidden',
  },
  alertHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
  },
  alertIconBox: {
    width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  alertTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  alertSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  countdownCircle: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  countdownText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  progressTrack: {
    height: 4, width: '100%',
  },
  progressFill: {
    height: 4,
  },
  badgeRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  body: { padding: 14, gap: 10 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  passengerName: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  passengerPhone: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  divider: { height: 1 },
  routeBlock: { gap: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  routeAddr: { fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1 },
  routeConnector: { paddingLeft: 7, height: 10 },
  connLine: { width: 1, flex: 1 },
  notesBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 10, borderWidth: 1, padding: 10,
  },
  notesText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 19 },
  statsRow: { flexDirection: 'row', padding: 12 },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statVal: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  statDiv: { width: 1, marginVertical: 4 },
  actions: { flexDirection: 'row', gap: 12, padding: 14, paddingTop: 6 },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, gap: 8,
  },
  rejectText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  acceptBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 15, gap: 8,
  },
  acceptText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
});
