import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Alert, ScrollView, Modal, Animated, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import * as Location from 'expo-location';
import { useColors } from '@/hooks/useColors';
import { useDriver, useDriverChat, useDriverFleet, useDriverSync, Job, isJobPrepaid } from '@/context/DriverContext';
import { HomeActiveJobMeterRow, LiveDriverMap, GpsRefSyncer } from '@/components/LiveMeterTick';
import { PassengerContactBar } from '@/components/PassengerContactBar';
import { useAuth } from '@/context/AuthContext';
import { fmtMs, fmtMins, DAILY_LIMIT_MS, WEEKLY_LIMIT_MIN } from '@/lib/shiftCompliance';
import { TariffPicker } from '@/components/TariffPicker';
import { ref, update } from 'firebase/database';
import { database } from '@/lib/firebase';
import { NativeMap } from '@/components/NativeMap';

let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch {}

function buildHomeMapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html><html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body,#map{width:100%;height:100%;background:#0f172a}</style>
</head><body><div id="map"></div><script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${lat},${lng}],15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var icon=L.divIcon({html:'<div style="width:40px;height:40px;background:#3b82f6;border:4px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 16px rgba(59,130,246,.7)">🚕</div>',className:'',iconAnchor:[20,20]});
var marker=L.marker([${lat},${lng}],{icon}).addTo(map);
window.addEventListener('message',function(e){
  try{var d=typeof e.data==='string'?JSON.parse(e.data):e.data;
  if(d.type==='updateDriver'){marker.setLatLng([d.lat,d.lng]);map.setView([d.lat,d.lng],map.getZoom(),{animate:true});}}catch{}
});
</script></body></html>`;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Job Offer Modal ────────────────────────────────────────────────────────────
// v12-ota22h: handlers now receive `job` as an argument so the parent can pass
// stable useCallback'd refs (no inline arrow closures). Wrapped in React.memo
// so meter ticks on the parent screen don't re-mount the modal and re-trigger
// the slide-in animation (which was eating the first tap).
const JobOfferModal = React.memo(function JobOfferModal({
  job,
  onAccept,
  onReject,
  colors,
  queueMode = false,
}: {
  job: Job;
  onAccept: (job: Job) => void;
  onReject: (job: Job) => void;
  colors: ReturnType<typeof useColors>;
  queueMode?: boolean;
}) {
  // v22bo-fix2 (Sentry 70052493): JobOfferModal is defined OUTSIDE HomeScreen
  // so `driver` from useDriver() isn't in scope. Pull it here instead, so the
  // PassengerContactBar below has the companyId/driverId/driverName it needs
  // to write driverContactLog entries. Without this the modal threw
  // "ReferenceError: Property 'driver' doesn't exist" the moment it rendered.
  const { driver } = useDriver();
  const handleAccept = React.useCallback(() => onAccept(job), [onAccept, job]);
  const handleReject = React.useCallback(() => onReject(job), [onReject, job]);
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 11,
    }).start();
  }, []);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleReject}>
      <View style={offerStyles.backdrop}>
        <Animated.View
          style={[
            offerStyles.sheet,
            { backgroundColor: colors.card, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Header */}
          <View style={[offerStyles.header, { backgroundColor: (queueMode ? colors.primary : colors.warning) + '18', borderBottomColor: colors.border }]}>
            <View style={[offerStyles.pulseRing, { borderColor: queueMode ? colors.primary : colors.warning }]}>
              <Ionicons name={queueMode ? 'list' : 'radio'} size={28} color={queueMode ? colors.primary : colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[offerStyles.headerTitle, { color: colors.foreground }]}>{queueMode ? 'New Job — Add to Queue?' : 'New Job Offer!'}</Text>
              <Text style={[offerStyles.headerSub, { color: colors.mutedForeground }]}>{queueMode ? 'You\'re on a trip — accept to queue this job' : 'Tap Accept to take this job'}</Text>
            </View>
          </View>

          {/* v22bl: Source + Job Type chips — driver always sees where the
              job came from (Dispatch / Hail / Website / Passenger app) and
              what kind of job it is (Taxi / Food / Freight / TM) so they can
              make an informed accept decision. */}
          {(() => {
            const _src = String((job as any).source ?? 'dispatch').toLowerCase();
            const _srcLabel =
              _src === 'hail'      ? 'Hail' :
              _src === 'website'   ? 'Website' :
              _src === 'passenger' ? 'Passenger App' :
              _src === 'account'   ? 'Account' :
                                     'Dispatch';
            const _srcIcon =
              _src === 'hail'      ? 'hand-left-outline' :
              _src === 'website'   ? 'globe-outline' :
              _src === 'passenger' ? 'phone-portrait-outline' :
              _src === 'account'   ? 'briefcase-outline' :
                                     'business-outline';
            const _svc = String(job.serviceType ?? '').toLowerCase();
            const _bt  = String(job.bookingType  ?? '').toLowerCase();
            const _type =
              _svc.includes('food')    || _bt.includes('food')    || _bt.includes('meal')    || _bt.includes('restaurant') ? 'food' :
              _svc.includes('freight') || _bt.includes('freight') || _bt.includes('parcel')  || _bt.includes('cargo')      ? 'freight' :
              _svc === 'tm'            || _bt.includes('tm')                                                                ? 'tm' :
                                                                                                                              'taxi';
            const _typeLabel = _type === 'food' ? 'Food' : _type === 'freight' ? 'Freight' : _type === 'tm' ? 'Total Mobility' : 'Taxi';
            const _typeIcon  = _type === 'food' ? 'fast-food-outline' : _type === 'freight' ? 'cube-outline' : _type === 'tm' ? 'accessibility-outline' : 'car-outline';
            return (
              <View style={[offerStyles.section, { borderBottomColor: colors.border, flexDirection: 'row', gap: 8, paddingVertical: 10 }]}>
                <View style={[offerStyles.metaPill, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '55' }]}>
                  <Ionicons name={_srcIcon as any} size={13} color={colors.primary} />
                  <Text style={[offerStyles.metaText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>{_srcLabel}</Text>
                </View>
                <View style={[offerStyles.metaPill, { backgroundColor: colors.foreground + '11', borderColor: colors.border }]}>
                  <Ionicons name={_typeIcon as any} size={13} color={colors.foreground} />
                  <Text style={[offerStyles.metaText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{_typeLabel}</Text>
                </View>
              </View>
            );
          })()}

          {/* Passenger */}
          <View style={[offerStyles.section, { borderBottomColor: colors.border }]}>
            <View style={offerStyles.row}>
              <Ionicons name="person-outline" size={16} color={colors.mutedForeground} />
              <Text style={[offerStyles.label, { color: colors.mutedForeground }]}>Passenger</Text>
            </View>
            <Text style={[offerStyles.value, { color: colors.foreground }]}>{job.passengerName || 'Unknown'}</Text>
            {!!job.passengerPhone && (
              <Text style={[offerStyles.sub, { color: colors.mutedForeground }]}>{job.passengerPhone}</Text>
            )}
            {/* v22bn: tap-to-call / tap-to-text right on the offer modal so
                a driver who can't find pickup can ring the passenger before
                even accepting. Falls silently to null if no phone on file. */}
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
          </View>

          {/* Pickup */}
          <View style={[offerStyles.section, { borderBottomColor: colors.border }]}>
            <View style={offerStyles.row}>
              <View style={[offerStyles.pinDot, { backgroundColor: '#22c55e' }]} />
              <Text style={[offerStyles.label, { color: colors.mutedForeground }]}>Pickup</Text>
            </View>
            <Text style={[offerStyles.value, { color: colors.foreground }]}>{job.pickupAddress || '—'}</Text>
          </View>

          {/* Drop-off */}
          {!!job.dropAddress && (
            <View style={[offerStyles.section, { borderBottomColor: colors.border }]}>
              <View style={offerStyles.row}>
                <View style={[offerStyles.pinDot, { backgroundColor: '#ef4444' }]} />
                <Text style={[offerStyles.label, { color: colors.mutedForeground }]}>Drop-off</Text>
              </View>
              <Text style={[offerStyles.value, { color: colors.foreground }]}>{job.dropAddress}</Text>
            </View>
          )}

          {/* Fixed / pre-paid / PAID fare indicator */}
          {(() => {
            const _pm = (job.jobPaymentMethod ?? '').toLowerCase();
            const _isCash = !_pm || _pm === 'cash';
            const _hasFare = job.fare > 0;
            const _isPrepaid = isJobPrepaid(job);
            if (!_hasFare && _isCash && !_isPrepaid) return null;
            let _label: string;
            let _color: string;
            let _icon: string;
            if (_isPrepaid) {
              const _ml = (_pm && _pm !== 'cash')
                ? (_pm.charAt(0).toUpperCase() + _pm.slice(1))
                : 'Card';
              _label = `PAID • ${_ml}${_hasFare ? ` — $${job.fare.toFixed(2)}` : ''}`;
              _color = _pm === 'account' ? '#0369a1' : '#22c55e';
              _icon = _pm === 'account' ? 'briefcase-outline' : 'checkmark-circle-outline';
            } else if (_isCash) {
              _label = `Fixed: $${job.fare.toFixed(2)} — collect cash`;
              _color = '#f59e0b';
              _icon = 'cash-outline';
            } else {
              _label = _hasFare
                ? `Pre-paid: $${job.fare.toFixed(2)} — ${_pm.charAt(0).toUpperCase() + _pm.slice(1)}`
                : `Pre-paid — ${_pm.charAt(0).toUpperCase() + _pm.slice(1)}`;
              _color = colors.primary;
              _icon = 'card-outline';
            }
            return (
              <View style={[offerStyles.section, { borderBottomColor: colors.border }]}>
                <View style={[offerStyles.farePill, { backgroundColor: _color + '18', borderColor: _color + '55' }]}>
                  <Ionicons name={_icon as any} size={14} color={_color} />
                  <Text style={[offerStyles.farePillText, { color: _color }]}>{_label}</Text>
                </View>
              </View>
            );
          })()}

          {/* WAV / ACC badges — prominent, above meta pills */}
          {(job.wheelchair || job.acc_client_id) && (
            <View style={[offerStyles.badgeRow, { borderBottomColor: colors.border }]}>
              {job.wheelchair && (
                <View style={offerStyles.wavBadge}>
                  <Ionicons name="accessibility" size={15} color="#fff" />
                  <Text style={offerStyles.wavBadgeText}>WAV Required</Text>
                </View>
              )}
              {!!job.acc_client_id && (
                <View style={offerStyles.accBadge}>
                  <Ionicons name="shield-checkmark" size={13} color="#0369a1" />
                  <Text style={offerStyles.accBadgeText}>ACC Funded</Text>
                </View>
              )}
            </View>
          )}

          {/* Meta pills */}
          <View style={offerStyles.metaRow}>
            {!!job.passengers && (
              <View style={[offerStyles.metaPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="people-outline" size={12} color={colors.mutedForeground} />
                <Text style={[offerStyles.metaText, { color: colors.mutedForeground }]}>{job.passengers} pax</Text>
              </View>
            )}
            {!!job.vehicleType && job.vehicleType !== 'Not Specified' && (
              <View style={[offerStyles.metaPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="car-outline" size={12} color={colors.mutedForeground} />
                <Text style={[offerStyles.metaText, { color: colors.mutedForeground }]}>{job.vehicleType}</Text>
              </View>
            )}
            {!!job.createdAt && (
              <View style={[offerStyles.metaPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
                <Text style={[offerStyles.metaText, { color: colors.mutedForeground }]}>{job.createdAt}</Text>
              </View>
            )}
            {/* v22bl: distance estimate from dispatch — useful for accept/reject decision */}
            {!!job.distance && job.distance !== '0 km' && (
              <View style={[offerStyles.metaPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="navigate-outline" size={12} color={colors.mutedForeground} />
                <Text style={[offerStyles.metaText, { color: colors.mutedForeground }]}>{job.distance}</Text>
              </View>
            )}
            {!!job.duration && job.duration !== '0 min' && (
              <View style={[offerStyles.metaPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="hourglass-outline" size={12} color={colors.mutedForeground} />
                <Text style={[offerStyles.metaText, { color: colors.mutedForeground }]}>{job.duration}</Text>
              </View>
            )}
          </View>

          {/* Notes */}
          {!!job.notes && (
            <View style={[offerStyles.notesBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="document-text-outline" size={14} color={colors.mutedForeground} />
              <Text style={[offerStyles.notesText, { color: colors.mutedForeground }]}>{job.notes}</Text>
            </View>
          )}

          {/* Buttons */}
          <View style={offerStyles.btnRow}>
            <TouchableOpacity
              style={[offerStyles.rejectBtn, { borderColor: colors.error + '66', backgroundColor: colors.error + '11' }]}
              onPress={handleReject}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={22} color={colors.error} />
              <Text style={[offerStyles.rejectText, { color: colors.error }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[offerStyles.acceptBtn, { backgroundColor: queueMode ? colors.primary : '#22c55e' }]}
              onPress={handleAccept}
              activeOpacity={0.85}
            >
              <Ionicons name={queueMode ? 'time' : 'checkmark-circle'} size={22} color="#fff" />
              <Text style={offerStyles.acceptText}>{queueMode ? 'Queue Job' : 'Accept'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
});

// ── Active Job Panel (inline on Home) ─────────────────────────────────────────
function ActiveJobPanel({
  job,
  arrivedAtPickup,
  onOnMyWay,
  onArrived,
  onStartMeter,
  onComplete,
  onCancel,
  onPause,
  onViewDetails,
  meterRunning,
  meterPaused,
  colors,
}: {
  job: Job;
  arrivedAtPickup: boolean;
  onOnMyWay: () => void;
  onArrived: () => void;
  onStartMeter: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onPause: () => void;
  onViewDetails: () => void;
  meterRunning: boolean;
  meterPaused: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const phase = meterRunning ? 'inTrip' : arrivedAtPickup ? 'arrived' : 'onMyWay';

  const phaseColor = phase === 'inTrip' ? '#ef4444' : phase === 'arrived' ? '#f59e0b' : '#3b82f6';
  const phaseLabel = phase === 'inTrip' ? 'In Trip' : phase === 'arrived' ? 'Arrived at Pickup' : 'On My Way';
  const phaseIcon: any = phase === 'inTrip' ? 'speedometer' : phase === 'arrived' ? 'location' : 'navigate';

  return (
    <View style={[activeJobStyles.card, { backgroundColor: colors.card, borderColor: phaseColor + '55' }]}>
      {/* Phase header */}
      <View style={[activeJobStyles.phaseHeader, { backgroundColor: phaseColor + '18', borderBottomColor: colors.border }]}>
        <View style={[activeJobStyles.phaseIconWrap, { backgroundColor: phaseColor }]}>
          <Ionicons name={phaseIcon} size={18} color="#fff" />
        </View>
        <Text style={[activeJobStyles.phaseLabel, { color: phaseColor }]}>{phaseLabel}</Text>
        <TouchableOpacity onPress={onViewDetails} activeOpacity={0.7} style={activeJobStyles.detailsBtn}>
          <Text style={[activeJobStyles.detailsBtnText, { color: colors.mutedForeground }]}>Details</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Passenger + addresses */}
      <View style={activeJobStyles.infoBlock}>
        <Text style={[activeJobStyles.passengerName, { color: colors.foreground }]} numberOfLines={1}>
          {job.passengerName || 'Passenger'}
        </Text>
        <View style={activeJobStyles.addrRow}>
          <View style={[activeJobStyles.addrDot, { backgroundColor: '#22c55e' }]} />
          <Text style={[activeJobStyles.addrText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {job.pickupAddress || '—'}
          </Text>
        </View>
        {!!job.dropAddress && (
          <View style={activeJobStyles.addrRow}>
            <View style={[activeJobStyles.addrDot, { backgroundColor: '#ef4444' }]} />
            <Text style={[activeJobStyles.addrText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {job.dropAddress}
            </Text>
          </View>
        )}
      </View>

      {/* Single action: go to Meter tab for all controls */}
      <View style={[activeJobStyles.actionArea, { borderTopColor: colors.border }]}>
        {phase === 'inTrip' && (
          <HomeActiveJobMeterRow
            containerStyle={activeJobStyles.meterRow}
            statStyle={activeJobStyles.meterStat}
            dividerStyle={activeJobStyles.meterDiv}
            valueStyle={activeJobStyles.meterVal}
            labelStyle={activeJobStyles.meterLbl}
            fareColor={colors.primary}
            foregroundColor={colors.foreground}
            mutedColor={colors.mutedForeground}
            borderColor={colors.border}
          />
        )}
        <TouchableOpacity
          style={[activeJobStyles.primaryBtn, { backgroundColor: phaseColor }]}
          onPress={onViewDetails}
          activeOpacity={0.85}
        >
          <Ionicons name="speedometer-outline" size={20} color="#fff" />
          <Text style={activeJobStyles.primaryBtnText}>
            {phase === 'inTrip' ? 'Open Meter — Complete Trip' : phase === 'arrived' ? 'Open Meter — Start Meter' : 'Open Meter — Arrived & Controls'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main Home Screen ──────────────────────────────────────────────────────────
export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { driver } = useAuth();
  const {
    shiftActive, currentShift, startShift, endShift,
    completedJobs, offeredJobs, currentJob, queuedJobs,
    meterRunning, meterPaused,
    startMeter, pauseMeter, cancelTrip,
    availableTariffs, activeTariff, setActiveTariff,
    acceptJob, acceptJobToQueue, rejectJob,
    status, setStatus,
    resumedJob, clearResumedJob,
    breakActive, breakStartMs, todayBreakMs, weeklyWorkMinutes, shiftBlocked,
    getLastGpsPosition,
  } = useDriver();
  // v12-ota16: fleet/zone moved to dedicated context so heartbeat churn from
  // OTHER drivers doesn't re-render this screen's buttons.
  const { onlineDrivers, myZoneInfo } = useDriverFleet();
  // v12-ota18: chat + sync moved to dedicated contexts.
  const { chatThreads } = useDriverChat();
  const { pendingUploadCount } = useDriverSync();
  // v12-ota14: NO useDriverTick here — this screen now stays still even when
  // the meter ticks. Live values are rendered by leaf components (HomeActiveJobMeterRow,
  // LiveDriverMap) that subscribe themselves. Buttons on this screen now respond
  // on the first tap because the JS thread isn't burning on per-second renders.

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const missingVehicle = !driver?.vehicleId;
  // v12-ota22f: memoize aggregations — Dashboard re-renders on every job,
  // every meter tick, every offer modal change. Without memo these reduces
  // ran 1–10 times per second on the Samsung A04.
  const todayEarnings = useMemo(
    () => completedJobs.reduce((sum, j) => sum + j.fare, 0),
    [completedJobs]
  );
  const unreadChats = useMemo(
    () => chatThreads.reduce((sum, t) => sum + t.unread, 0),
    [chatThreads]
  );

  // ── Offer modal state ──────────────────────────────────────────────────────
  const [dismissedOfferIds, setDismissedOfferIds] = useState<Set<string>>(new Set());
  const activeOffer = offeredJobs.find(j => !dismissedOfferIds.has(j.id)) ?? null;

  // ── Resumed job alert (crash recovery) ────────────────────────────────────
  // When the server reports an unfinished trip from before a crash, prompt
  // the driver to continue. Fires whenever resumedJob is set.
  useEffect(() => {
    if (!resumedJob) return;
    Alert.alert(
      'Unfinished Trip Found',
      `You have an incomplete trip for ${resumedJob.passengerName || 'a passenger'}.\n\nPickup: ${resumedJob.pickAddress}\nDrop-off: ${resumedJob.dropAddress}`,
      [
        {
          text: 'View Trip',
          onPress: () => {
            clearResumedJob();
            router.push(`/job/${resumedJob.jobId}`);
          },
        },
        {
          text: 'Dismiss',
          style: 'cancel',
          onPress: clearResumedJob,
        },
      ],
    );
  }, [resumedJob?.jobId]);

  // ── Arrived at pickup state ────────────────────────────────────────────────
  // Initialise from Firebase presence so the phase is correct even if the
  // driver tapped Arrived in job/[id].tsx before switching to the dashboard.
  const [arrivedAtPickup, setArrivedAtPickup] = useState(
    () => (myZoneInfo?.vehicleStatus ?? '') === 'Arrived',
  );
  // Keep in sync as Firebase presence updates
  useEffect(() => {
    if ((myZoneInfo?.vehicleStatus ?? '') === 'Arrived' && !meterRunning) {
      setArrivedAtPickup(true);
    }
  }, [myZoneInfo?.vehicleStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reset when the job clears
  useEffect(() => {
    if (!currentJob) setArrivedAtPickup(false);
  }, [currentJob?.id]);

  // ── Tariff picker ──────────────────────────────────────────────────────────
  const [tariffPickerVisible, setTariffPickerVisible] = useState(false);
  const [pendingTariff, setPendingTariff] = useState(activeTariff);
  const [changingMidTrip, setChangingMidTrip] = useState(false);

  const openStartPicker = () => { setPendingTariff(activeTariff); setChangingMidTrip(false); setTariffPickerVisible(true); };
  const onPickerConfirm = () => {
    setActiveTariff(pendingTariff);
    setTariffPickerVisible(false);
    if (!changingMidTrip) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); startMeter(); }
  };

  // ── Home map ───────────────────────────────────────────────────────────────
  // v12-ota14: Map driver dot is now rendered by <LiveDriverMap> leaf which
  // subscribes to currentGps internally. This screen no longer re-renders on
  // every GPS update.
  const [homeFallbackPos, setHomeFallbackPos] = useState<{ lat: number; lng: number } | null>(null);
  const homeLatLngRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!shiftActive) { setHomeFallbackPos(null); return; }
    if (getLastGpsPosition()) return; // already have a live fix
    let cancelled = false;
    (async () => {
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
        if (cancelled || !last) return;
        const lat = last.coords.latitude, lng = last.coords.longitude;
        homeLatLngRef.current = { lat, lng };
        setHomeFallbackPos({ lat, lng });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [shiftActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zone wait timer ────────────────────────────────────────────────────────
  const [zoneWaitSecs, setZoneWaitSecs] = useState(0);
  const zoneWaitRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (zoneWaitRef.current) { clearInterval(zoneWaitRef.current); zoneWaitRef.current = null; }
    const assignedAt = myZoneInfo?.zoneAssignedAt;
    if (!assignedAt) { setZoneWaitSecs(0); return; }
    setZoneWaitSecs(Math.floor((Date.now() - assignedAt) / 1000));
    zoneWaitRef.current = setInterval(() => setZoneWaitSecs(Math.floor((Date.now() - assignedAt) / 1000)), 1000);
    return () => { if (zoneWaitRef.current) clearInterval(zoneWaitRef.current); };
  }, [myZoneInfo?.zoneAssignedAt]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleShiftToggle = () => {
    if (shiftActive) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('End Shift', 'Are you sure you want to end your shift?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Shift', style: 'destructive', onPress: endShift },
      ]);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      startShift();
    }
  };

  // v12-ota22h: useCallback so JobOfferModal doesn't re-mount on every parent
  // render (meter ticks, GPS updates, fleet heartbeats all re-render this
  // screen). Re-mounting was restarting the slide-in animation and stealing
  // the first tap on Accept — driver had to tap multiple times.
  const handleAcceptOffer = React.useCallback((job: Job) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (meterRunning) {
      acceptJobToQueue(job);
    } else {
      acceptJob(job);
    }
    setDismissedOfferIds(prev => new Set([...prev, job.id]));
  }, [meterRunning, acceptJob, acceptJobToQueue]);

  const handleRejectOffer = React.useCallback((job: Job) => {
    Alert.alert('Reject Job', 'Are you sure you want to reject this job?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive', onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          rejectJob(job.id);
          setDismissedOfferIds(prev => new Set([...prev, job.id]));
        }
      },
    ]);
  }, [rejectJob]);

  const handleArrived = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setArrivedAtPickup(true);
    try {
      const companyId = driver?.companyId ?? '';
      const vehicleId = driver?.vehicleId ?? '';
      if (companyId && vehicleId) {
        await update(ref(database, `online/${companyId}/${vehicleId}/current`), {
          vehiclestatus: 'Arrived',
        });
      }
    } catch (err) {
      console.warn('[Home] Failed to write arrived status:', err);
    }
  };

  const handleStartMeter = () => {
    openStartPicker();
  };

  const handleMeterComplete = () => {
    router.push('/(tabs)/meter');
  };

  const handleMeterCancel = () => {
    Alert.alert('Cancel Trip', 'Stop meter without completing? Job stays open.', [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'Cancel Trip', style: 'destructive', onPress: cancelTrip },
    ]);
  };

  const driverName = driver?.name && !driver.name.includes('@')
    ? driver.name.split(' ')[0]
    : driver?.email?.split('@')[0] ?? 'Driver';

  const shiftColor = shiftActive ? colors.success : colors.mutedForeground;

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>

      {/* 22bo-fix4: per-screen JobOfferModal REMOVED — was double-popping
          alongside the global IncomingJobAlert (rendered by GlobalJobAlert in
          app/_layout.tsx). Single source of truth = the global overlay, which
          already has PassengerContactBar (Call/Text) and works on every tab. */}

      {/* ── Silent-offer banner — visible while busy so the driver knows ── */}
      {activeOffer && shiftActive && (currentJob || meterRunning) && (
        <View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
            paddingTop: 44, paddingBottom: 10, paddingHorizontal: 16,
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: colors.primary + 'EE',
          }}
        >
          <Ionicons name="notifications" size={16} color="#000" />
          <Text style={{ color: '#000', fontFamily: 'Inter_600SemiBold', fontSize: 13, flex: 1 }} numberOfLines={1}>
            New job offer — open Offers tab when ready
          </Text>
          <Text style={{ color: '#000', fontFamily: 'Inter_700Bold', fontSize: 12 }}>
            {offeredJobs.length}
          </Text>
        </View>
      )}

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {driver?.vehicleId ? (
            <View style={[styles.vehicleBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}>
              <Ionicons name="car" size={13} color={colors.primary} />
              <Text style={[styles.vehicleBadgeText, { color: colors.primary }]}>{driver.vehicleId}</Text>
            </View>
          ) : null}
          <Text style={[styles.driverName, { color: colors.foreground }]}>Hi, {driverName}</Text>
        </View>
        <View style={styles.headerRight}>
          {unreadChats > 0 && (
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push('/(tabs)/chat')}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubbles-outline" size={20} color={colors.foreground} />
              <View style={[styles.notifBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.notifBadgeText}>{unreadChats > 99 ? '99+' : unreadChats}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: botPad + 32 }} showsVerticalScrollIndicator={false}>

        {/* ── Alerts ── */}
        {driver?.active === false && (
          <View style={[styles.alertBanner, { backgroundColor: '#dc262618', borderColor: '#dc2626' }]}>
            <Ionicons name="ban-outline" size={18} color="#dc2626" />
            <Text style={[styles.alertText, { color: '#dc2626', flex: 1 }]}>
              Your account has been deactivated. Contact your fleet administrator.
            </Text>
          </View>
        )}

        {missingVehicle && driver?.active !== false && (
          <View style={[styles.alertBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}>
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text style={[styles.alertText, { color: colors.warning }]}>No vehicle assigned — contact your admin</Text>
          </View>
        )}

        {shiftActive && status === 'Away' && (
          <TouchableOpacity
            style={[styles.alertBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}
            onPress={() => setStatus('Available')}
            activeOpacity={0.75}
          >
            <Ionicons name="pause-circle-outline" size={18} color="#f59e0b" />
            <Text style={[styles.alertText, { color: '#f59e0b', flex: 1 }]}>You're Away — tap to go Available</Text>
            <View style={[styles.makeAvailBtn, { backgroundColor: '#f59e0b' }]}>
              <Text style={styles.makeAvailText}>Go Available</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Pending offline-trip upload indicator ── */}
        {pendingUploadCount > 0 && (
          <View style={[styles.alertBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
            <Ionicons name="cloud-upload-outline" size={18} color="#f59e0b" />
            <Text style={[styles.alertText, { color: '#f59e0b', flex: 1 }]}>
              {pendingUploadCount} trip{pendingUploadCount > 1 ? 's' : ''} pending upload — will retry automatically
            </Text>
          </View>
        )}

        {/* ── Pending offer count (if more than one) ── */}
        {offeredJobs.length > 1 && (
          <View style={[styles.alertBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}>
            <View style={[styles.pulseDot, { backgroundColor: colors.warning }]} />
            <Text style={[styles.alertText, { color: colors.warning, flex: 1 }]}>
              {offeredJobs.length} job offers incoming — accept or reject below
            </Text>
          </View>
        )}

        {/* ── Shift Control Card ── */}
        <View style={[styles.shiftCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.shiftTopRow}>
            <View style={styles.shiftStatusRow}>
              <View style={[styles.statusDot, { backgroundColor: shiftColor }]} />
              <Text style={[styles.shiftStatusText, { color: shiftColor }]}>
                {shiftActive ? 'On Shift' : 'Off Shift'}
              </Text>
              {shiftActive && currentShift && (
                <Text style={[styles.shiftSince, { color: colors.mutedForeground }]}>
                  · since {currentShift.startTime}
                </Text>
              )}
            </View>
          </View>

          <View style={[styles.statsRow, { borderColor: colors.border }]}>
            <View style={styles.statBlock}>
              <Text style={[styles.statVal, { color: colors.primary }]}>${todayEarnings.toFixed(2)}</Text>
              <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Earnings</Text>
            </View>
            <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
            <View style={styles.statBlock}>
              <Text style={[styles.statVal, { color: colors.foreground }]}>{completedJobs.length}</Text>
              <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Jobs Done</Text>
            </View>
            <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
            <View style={styles.statBlock}>
              <Text style={[styles.statVal, { color: colors.foreground }]}>{onlineDrivers.length}</Text>
              <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Cabs Online</Text>
            </View>
          </View>

          {/* ── NZ compliance hours row (on shift only) ── */}
          {shiftActive && currentShift?.startMs && (() => {
            const elapsed = Date.now() - currentShift.startMs!;
            const currentBreakMs = breakActive && breakStartMs ? Date.now() - breakStartMs : 0;
            const workMs = Math.max(0, elapsed - todayBreakMs - currentBreakMs);
            const weeklyNow = weeklyWorkMinutes + Math.floor(workMs / 60000);
            const dailyRemaining = Math.max(0, DAILY_LIMIT_MS - workMs);
            const weeklyRemaining = Math.max(0, WEEKLY_LIMIT_MIN - weeklyNow);
            const dailyWarn = dailyRemaining <= 60 * 60 * 1000;
            const weeklyWarn = weeklyRemaining <= 5 * 60;
            const dailyPct = Math.min(1, workMs / DAILY_LIMIT_MS);
            const weeklyPct = Math.min(1, weeklyNow / WEEKLY_LIMIT_MIN);
            return (
              <View style={[styles.complianceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.complianceCol}>
                  <View style={styles.complianceColHeader}>
                    <Ionicons name="sunny-outline" size={11} color={dailyWarn ? '#f59e0b' : colors.mutedForeground} />
                    <Text style={[styles.complianceColLabel, { color: colors.mutedForeground }]}>Today</Text>
                  </View>
                  <Text style={[styles.complianceColValue, { color: dailyWarn ? '#f59e0b' : colors.foreground }]}>{fmtMs(workMs)}</Text>
                  <View style={[styles.complianceMiniBar, { backgroundColor: colors.border }]}>
                    <View style={[styles.complianceMiniBarFill, { width: `${dailyPct * 100}%` as any, backgroundColor: dailyWarn ? '#f59e0b' : colors.primary }]} />
                  </View>
                  <Text style={[styles.complianceColSub, { color: colors.mutedForeground }]}>{fmtMs(dailyRemaining)} left</Text>
                </View>
                <View style={[styles.complianceDivider, { backgroundColor: colors.border }]} />
                <View style={styles.complianceCol}>
                  <View style={styles.complianceColHeader}>
                    <Ionicons name="calendar-outline" size={11} color={weeklyWarn ? '#ef4444' : colors.mutedForeground} />
                    <Text style={[styles.complianceColLabel, { color: colors.mutedForeground }]}>This Week</Text>
                  </View>
                  <Text style={[styles.complianceColValue, { color: weeklyWarn ? '#ef4444' : colors.foreground }]}>{fmtMins(weeklyNow)}</Text>
                  <View style={[styles.complianceMiniBar, { backgroundColor: colors.border }]}>
                    <View style={[styles.complianceMiniBarFill, { width: `${weeklyPct * 100}%` as any, backgroundColor: weeklyWarn ? '#ef4444' : colors.primary }]} />
                  </View>
                  <Text style={[styles.complianceColSub, { color: colors.mutedForeground }]}>{fmtMins(weeklyRemaining)} left</Text>
                </View>
                {breakActive && (
                  <>
                    <View style={[styles.complianceDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.complianceCol}>
                      <View style={styles.complianceColHeader}>
                        <Ionicons name="cafe-outline" size={11} color="#f59e0b" />
                        <Text style={[styles.complianceColLabel, { color: '#f59e0b' }]}>On Break</Text>
                      </View>
                      <Text style={[styles.complianceColValue, { color: '#f59e0b' }]}>
                        {breakStartMs ? fmtMs(Date.now() - breakStartMs) : '—'}
                      </Text>
                      <View style={[styles.complianceMiniBar, { backgroundColor: 'transparent' }]} />
                      <Text style={[styles.complianceColSub, { color: '#f59e0b' }]}>paused</Text>
                    </View>
                  </>
                )}
              </View>
            );
          })()}

          <TouchableOpacity
            style={[styles.shiftBtn, {
              backgroundColor: shiftActive ? colors.error : (shiftBlocked ? colors.mutedForeground : colors.success),
              opacity: !shiftActive && shiftBlocked ? 0.6 : 1,
            }]}
            onPress={!shiftActive && shiftBlocked
              ? () => Alert.alert('Cannot Start Shift', shiftBlocked.reason)
              : handleShiftToggle}
            activeOpacity={0.85}
          >
            <Ionicons name={shiftActive ? 'stop-circle' : 'play-circle'} size={28} color="#fff" />
            <Text style={styles.shiftBtnText}>
              {shiftActive ? 'End Shift' : 'Start Shift'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Active Job Panel ── */}
        {shiftActive && currentJob && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACTIVE JOB</Text>
            <ActiveJobPanel
              job={currentJob}
              arrivedAtPickup={arrivedAtPickup}
              onOnMyWay={() => {}}
              onArrived={handleArrived}
              onStartMeter={handleStartMeter}
              onComplete={handleMeterComplete}
              onCancel={handleMeterCancel}
              onPause={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); pauseMeter(); }}
              onViewDetails={() => router.push('/(tabs)/meter')}
              meterRunning={meterRunning}
              meterPaused={meterPaused}
              colors={colors}
            />
          </>
        )}

        {/* ── Queued Jobs ── */}
        {shiftActive && queuedJobs.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              QUEUED JOBS · {queuedJobs.length}
            </Text>
            <View style={{ marginHorizontal: 16, gap: 8 }}>
              {queuedJobs.map(job => (
                <TouchableOpacity
                  key={job.id}
                  style={[styles.queuedJobCard, { backgroundColor: colors.card, borderColor: colors.primary + '55' }]}
                  onPress={() => router.push(`/job/${job.id}` as any)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.queuedJobIconWrap, { backgroundColor: colors.primary + '22' }]}>
                    <Ionicons name="time" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.queuedJobName, { color: colors.foreground }]} numberOfLines={1}>
                      {job.passengerName || 'Passenger'}
                    </Text>
                    <Text style={[styles.queuedJobAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {job.pickupAddress || '—'}
                    </Text>
                  </View>
                  {job.fare > 0 && (
                    <Text style={[styles.queuedJobFare, { color: colors.primary }]}>${job.fare.toFixed(2)}</Text>
                  )}
                  <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ── On shift, no active job: live map + hail button ── */}
        {shiftActive && !currentJob && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LIVE MAP</Text>
            <View style={[styles.homeMapCard, { borderColor: colors.border }]}>
              {(getLastGpsPosition() || homeFallbackPos) ? (
                <LiveDriverMap fallbackPos={homeFallbackPos} />
              ) : (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', gap: 10 }]}>
                  <Ionicons name="map-outline" size={44} color="#334155" />
                  <Text style={{ color: '#64748b', fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', paddingHorizontal: 24 }}>
                    Getting your location…
                  </Text>
                  {homeLatLngRef.current && false && (
                    <TouchableOpacity
                      style={styles.openMapsBtn}
                      onPress={() => {
                        const { lat, lng } = homeLatLngRef.current!;
                        const url = Platform.OS === 'ios'
                          ? `http://maps.apple.com/?ll=${lat},${lng}&z=15`
                          : `geo:${lat},${lng}?z=15`;
                        Linking.openURL(url).catch(() =>
                          Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`)
                        );
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="navigate-circle" size={16} color="#3b82f6" />
                      <Text style={styles.openMapsBtnText}>Open in Maps</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.hailBtn, { backgroundColor: '#f59e0b' }]}
              onPress={() => router.push('/(tabs)/meter?openHail=1')}
              activeOpacity={0.8}
            >
              <Ionicons name="hand-left" size={22} color="#fff" />
              <Text style={styles.hailBtnText}>Hail a Passenger</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Zone info ── */}
        {shiftActive && myZoneInfo && myZoneInfo.zoneName ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MY ZONE</Text>
            <View style={[styles.zoneCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.zoneGrid}>
                <View style={styles.zoneItem}>
                  <Text style={[styles.zoneVal, { color: colors.foreground }]} numberOfLines={1}>{myZoneInfo.zoneName}</Text>
                  <Text style={[styles.zoneLbl, { color: colors.mutedForeground }]}>Zone</Text>
                </View>
                <View style={[styles.zoneDivider, { backgroundColor: colors.border }]} />
                <View style={styles.zoneItem}>
                  <Text style={[styles.zoneVal, { color: colors.primary }]}>#{myZoneInfo.zoneId > 0 ? myZoneInfo.zoneId : '—'}</Text>
                  <Text style={[styles.zoneLbl, { color: colors.mutedForeground }]}>Zone #</Text>
                </View>
                <View style={[styles.zoneDivider, { backgroundColor: colors.border }]} />
                <View style={styles.zoneItem}>
                  <Text style={[styles.zoneVal, { color: colors.foreground }]}>#{myZoneInfo.zoneQueue}</Text>
                  <Text style={[styles.zoneLbl, { color: colors.mutedForeground }]}>Queue</Text>
                </View>
                <View style={[styles.zoneDivider, { backgroundColor: colors.border }]} />
                <View style={styles.zoneItem}>
                  <Text style={[styles.zoneVal, { color: zoneWaitSecs >= 3600 ? colors.error : colors.foreground }]}>{formatTime(zoneWaitSecs)}</Text>
                  <Text style={[styles.zoneLbl, { color: colors.mutedForeground }]}>Waited</Text>
                </View>
              </View>
            </View>
          </>
        ) : null}

        {/* ── Off shift placeholder ── */}
        {!shiftActive && (
          <View style={[styles.offShiftBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="moon-outline" size={44} color={colors.mutedForeground} />
            <Text style={[styles.offShiftTitle, { color: colors.foreground }]}>You're off shift</Text>
            <Text style={[styles.offShiftSub, { color: colors.mutedForeground }]}>
              Tap Start Shift above to go online and start receiving jobs
            </Text>
          </View>
        )}

      </ScrollView>

      <TariffPicker
        visible={tariffPickerVisible}
        tariffs={availableTariffs}
        selected={pendingTariff}
        onSelect={setPendingTariff}
        onConfirm={onPickerConfirm}
        onClose={() => setTariffPickerVisible(false)}
        title={changingMidTrip ? 'Change Tariff' : 'Select Tariff'}
        confirmLabel={changingMidTrip ? 'Apply' : 'Start Meter'}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14,
  },
  headerLeft: { gap: 4 },
  headerRight: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  vehicleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', borderRadius: 20, borderWidth: 1.5,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  vehicleBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  driverName: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  iconBtn: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute', top: -3, right: -3,
    minWidth: 17, height: 17, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  notifBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.2,
    marginHorizontal: 20, marginTop: 20, marginBottom: 8,
  },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 8, borderRadius: 14, borderWidth: 1.5,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  alertText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1 },
  makeAvailBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  makeAvailText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  pulseDot: { width: 8, height: 8, borderRadius: 4 },
  shiftCard: {
    marginHorizontal: 16, borderRadius: 20, borderWidth: 1.5,
    overflow: 'hidden', marginTop: 4,
  },
  shiftTopRow: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12 },
  shiftStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  shiftStatusText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  shiftSince: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  statsRow: {
    flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 14,
  },
  statBlock: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLbl: { fontSize: 11, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  statDiv: { width: 1, marginVertical: 4 },
  shiftBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 18, margin: 14, borderRadius: 16,
  },
  shiftBtnText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },
  homeMapCard: {
    marginHorizontal: 16, height: 200, borderRadius: 18, borderWidth: 1, overflow: 'hidden',
  },
  hailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, marginHorizontal: 16, marginTop: 12, borderRadius: 16, paddingVertical: 16,
  },
  hailBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  zoneCard: {
    marginHorizontal: 16, borderRadius: 16, borderWidth: 1.5, overflow: 'hidden',
  },
  zoneGrid: { flexDirection: 'row' },
  zoneItem: { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },
  zoneVal: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  zoneLbl: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  zoneDivider: { width: 1, marginVertical: 8 },
  offShiftBox: {
    marginHorizontal: 16, marginTop: 8, borderRadius: 20, borderWidth: 1.5,
    alignItems: 'center', padding: 40, gap: 12,
  },
  offShiftTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  offShiftSub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
  queuedJobCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, paddingVertical: 12, paddingHorizontal: 14,
  },
  queuedJobIconWrap: {
    width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  queuedJobName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  queuedJobAddr: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  queuedJobFare: { fontSize: 15, fontFamily: 'Inter_700Bold', marginRight: 4 },
  openMapsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1,
    borderColor: '#334155', paddingHorizontal: 16, paddingVertical: 9,
  },
  openMapsBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#3b82f6' },

  complianceRow: {
    flexDirection: 'row', alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
  },
  complianceCol: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 3 },
  complianceDivider: { width: 1, marginVertical: 8 },
  complianceColHeader: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  complianceColLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, textTransform: 'uppercase' },
  complianceColValue: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  complianceMiniBar: { width: '80%', height: 4, borderRadius: 2, overflow: 'hidden' },
  complianceMiniBarFill: { height: '100%', borderRadius: 2 },
  complianceColSub: { fontSize: 10, fontFamily: 'Inter_400Regular' },
});

const offerStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingBottom: 34,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 20,
    boxShadow: '0px -4px 16px rgba(0,0,0,0.3)',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 18, borderBottomWidth: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  pulseRing: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  section: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, textTransform: 'uppercase' },
  value: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  sub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  pinDot: { width: 10, height: 10, borderRadius: 5 },
  badgeRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1,
  },
  wavBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#7c3aed', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  wavBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  accBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#e0f2fe', borderRadius: 10, borderWidth: 1, borderColor: '#bae6fd',
    paddingHorizontal: 12, paddingVertical: 7,
  },
  accBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#0369a1' },
  farePill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  farePillText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5,
  },
  metaText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  notesBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 20, marginBottom: 12, borderRadius: 12, borderWidth: 1, padding: 12,
  },
  notesText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 20 },
  btnRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 16, borderWidth: 1.5, paddingVertical: 16,
  },
  rejectText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  acceptBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 16, paddingVertical: 16,
  },
  acceptText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});

const activeJobStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16, borderRadius: 20, borderWidth: 2, overflow: 'hidden',
  },
  phaseHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1,
  },
  phaseIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  phaseLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold' },
  detailsBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  detailsBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  infoBlock: { paddingHorizontal: 16, paddingVertical: 14, gap: 6 },
  passengerName: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addrDot: { width: 8, height: 8, borderRadius: 4 },
  addrText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  actionArea: { borderTopWidth: 1, padding: 16, gap: 12 },
  actionHint: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: 16, paddingVertical: 16,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  meterRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 14, padding: 14,
  },
  meterStat: { flex: 1, alignItems: 'center', gap: 2 },
  meterVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  meterLbl: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },
  meterDiv: { width: 1, height: 36, marginHorizontal: 4 },
  tripBtnRow: { flexDirection: 'row', gap: 10 },
  halfBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, borderWidth: 1.5, paddingVertical: 14,
  },
  halfBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  cancelLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cancelLinkText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
