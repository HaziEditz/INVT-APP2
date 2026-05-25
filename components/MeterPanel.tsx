import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Alert,
  ScrollView, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Linking,
} from 'react-native';

let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch { /* Expo Go */ }
import { NativeMap } from '@/components/NativeMap';

// True if react-native-maps is available (i.e. running in a dev build, not Expo Go)
function MapViewIsAvailable(): boolean {
  try { require('react-native-maps'); return true; } catch { return false; }
}
import { fmtTime as tzFmtTime } from '@/lib/timezone';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Sentry from '@sentry/react-native';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useDriver, useDriverSync, Tariff, PaymentType, PaymentData } from '@/context/DriverContext';
import { MeterPanelLiveStats, MeterPanelSpeedPill, HailMapFareOverlay, LiveDriverMap } from '@/components/LiveMeterTick';
import { useAuth } from '@/context/AuthContext';
import { TariffPicker } from '@/components/TariffPicker';
import { PaymentCapture } from '@/components/PaymentCapture';
import { ExtrasPicker, type ExtraItem } from '@/components/ExtrasPicker';

// Fast GPS helper: returns the cached last-known position INSTANTLY if it's
// less than 5 minutes old. Only blocks for a fresh fix when we have nothing
// recent — and even then, gives up after 3 s so the UI never feels stuck.
// Returns null only when permission is denied or the device has truly never
// had a GPS fix.
// v22p (Fold 7): Samsung's getCurrentPositionAsync can silently hang for 10+ s
// AND return null. watchPositionAsync is far more reliable on Samsung — it
// fires a callback the moment the GPS chip has ANY fix (even cached) and we
// can resolve on the first callback. Up to 6 s timeout, then null.
async function getGpsViaWatcher(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    let done = false;
    let sub: { remove: () => void } | null = null;
    const finish = (v: { lat: number; lng: number } | null) => {
      if (done) return;
      done = true;
      try { sub?.remove(); } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 6000);
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 1000, distanceInterval: 0 },
      (pos) => {
        clearTimeout(timer);
        finish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
    ).then(s => {
      if (done) { try { s.remove(); } catch {} return; }
      sub = s;
    }).catch(() => finish(null));
  });
}

async function getFastGpsFix(): Promise<{ lat: number; lng: number } | null> {
  try {
    // BUG FIX (Fold 7): getLastKnownPositionAsync has NO built-in timeout and on
    // some Samsung devices (Fold 7 with newer OneUI) it can hang for 10+ s
    // waiting for Google Play Services. Wrap it with a 1.5 s ceiling so the UI
    // never freezes — fall through to fresh fix if cache is slow.
    const lastPromise = Location.getLastKnownPositionAsync({ maxAge: 300_000 }).catch(() => null);
    const lastTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 1500));
    const last = await Promise.race([lastPromise, lastTimeout]);
    if (last) {
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      return { lat: last.coords.latitude, lng: last.coords.longitude };
    }
    // No cached fix — race a fresh fix against a 3 s ceiling.
    const freshPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
      .then(p => ({ lat: p.coords.latitude, lng: p.coords.longitude }))
      .catch(() => null);
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 3000));
    return await Promise.race([freshPromise, timeoutPromise]);
  } catch {
    return null;
  }
}

function buildHailMapHtml(driverLat: number, driverLng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#0f172a; overflow:hidden; }
  #map { width:100%; height:100%; }
  #recenter { position:fixed; right:12px; bottom:12px; z-index:999;
    width:44px; height:44px; border-radius:12px;
    background:rgba(15,23,42,0.95); border:2px solid #334155;
    display:flex; align-items:center; justify-content:center;
    font-size:20px; cursor:pointer; }
</style>
</head>
<body>
<div id="map"></div>
<div id="recenter" onclick="recentre()">🎯</div>
<script>
  var DRIVER = [${driverLat}, ${driverLng}];
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView(DRIVER, 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(map);

  var driverIcon = L.divIcon({
    className: '',
    html: '<div style="width:22px;height:22px;background:#3b82f6;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,0.4)"></div>',
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
  var driverMarker = L.marker(DRIVER, { icon: driverIcon }).addTo(map);

  function recentre() { map.setView(driverMarker.getLatLng(), 16); }

  window.addEventListener('message', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.type === 'updateDriver') {
        var ll = L.latLng(d.lat, d.lng);
        driverMarker.setLatLng(ll);
        map.panTo(ll);
      }
    } catch {}
  });
  document.addEventListener('message', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.type === 'updateDriver') {
        var ll = L.latLng(d.lat, d.lng);
        driverMarker.setLatLng(ll);
        map.panTo(ll);
      }
    } catch {}
  });
</script>
</body>
</html>`;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  // v22o: Samsung's native geocoder is unreliable on Fold 7 / newer OneUI.
  // Strategy:
  //   1. Try native reverseGeocodeAsync (2 s ceiling) — fastest when it works
  //   2. Fall back to Nominatim HTTP geocoder (OpenStreetMap, free, 4 s ceiling)
  //   3. Final fallback: coordinates string
  try {
    const geoPromise = Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 2000));
    const results = await Promise.race([geoPromise, timeoutPromise]);
    if (results && results.length > 0) {
      const r = results[0];
      const parts = [r.streetNumber, r.street, r.city ?? r.subregion].filter(Boolean);
      const formatted = parts.join(' ').trim();
      if (formatted) return formatted;
    }
  } catch {}
  // Fallback: Nominatim — free OSM-backed geocoder, works on any network
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'User-Agent': 'BookawakaDriver/1.5.0' }, signal: ac.signal },
    );
    clearTimeout(t);
    const json: any = await res.json();
    const a = json?.address ?? {};
    const parts = [
      a.house_number,
      a.road ?? a.pedestrian ?? a.footway,
      a.suburb ?? a.neighbourhood,
      a.city ?? a.town ?? a.village,
    ].filter(Boolean);
    const formatted = parts.join(', ').trim();
    if (formatted) return formatted;
    if (json?.display_name) return String(json.display_name).split(',').slice(0, 3).join(',').trim();
  } catch {}
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

const DEFAULT_PAYMENT: PaymentData = { type: 'cash' };

interface MeterPanelProps {
  onJobClaimed?: (jobId: string) => void;
  autoOpenHail?: boolean;
  onHailModalOpened?: () => void;
}

export function MeterPanel({ onJobClaimed, autoOpenHail, onHailModalOpened }: MeterPanelProps = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const botPad = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16);
  const router = useRouter();

  const {
    meterRunning, meterPaused,
    meterIsWaiting,
    startMeter, pauseMeter, stopMeter, cancelTrip,
    currentJob, hailTripMeta,
    startHailTrip, completeHailTrip,
    availableTariffs, activeTariff, setActiveTariff,
    hailJobs, claimHailJob, shiftActive,
    isConnected,
    getMeterSnapshot, getLastGpsPosition,
  } = useDriver();
  // v12-ota18: sync state in dedicated context — queue drains during trip
  // completion no longer churn the whole MeterPanel JSX.
  const { isOnline, isSyncing, pendingQueueCount } = useDriverSync();
  // v12-ota14: NO useDriverTick here — leaf components subscribe instead so
  // this panel's buttons (Hail Passenger, End Trip, Yes Complete) stop being
  // blocked by per-second re-renders of the entire panel JSX.
  const { driver: authDriver } = useAuth();
  const companyId = authDriver?.companyId;

  const [tariffPickerVisible, setTariffPickerVisible] = useState(false);
  const [pendingTariff, setPendingTariff] = useState(activeTariff);
  const [changingMidTrip, setChangingMidTrip] = useState(false);

  // ─── Hail Live Map ──────────────────────────────────────────────────────────
  // v12-ota14: driver dot rendered by <LiveDriverMap> leaf which subscribes
  // to currentGps internally; this panel no longer re-renders on GPS updates.
  const [hailMapVisible, setHailMapVisible] = useState(false);
  const [hailFallbackPos, setHailFallbackPos] = useState<{ lat: number; lng: number } | null>(null);
  const lastHailGpsRef  = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const active = !!hailTripMeta && meterRunning;
    if (!active) {
      setHailFallbackPos(null);
      setHailMapVisible(false);
      return;
    }
    if (getLastGpsPosition()) return;
    let cancelled = false;
    (async () => {
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
        if (cancelled || !last) return;
        const lat = last.coords.latitude, lng = last.coords.longitude;
        lastHailGpsRef.current = { lat, lng };
        setHailFallbackPos({ lat, lng });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [!!hailTripMeta, meterRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  const openStartPicker = () => {
    setPendingTariff(activeTariff);
    setChangingMidTrip(false);
    setTariffPickerVisible(true);
  };
  const openChangePicker = () => {
    setPendingTariff(activeTariff);
    setChangingMidTrip(true);
    setTariffPickerVisible(true);
  };
  const onPickerConfirm = () => {
    setActiveTariff(pendingTariff);
    setTariffPickerVisible(false);
    if (!changingMidTrip) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      startMeter();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleStop = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const snap = getMeterSnapshot();
    Alert.alert(
      'Complete Trip',
      `Fare: $${snap.fare.toFixed(2)}\nDistance: ${snap.dist.toFixed(2)} km\nTime: ${formatTime(snap.secs)}\n\nComplete this trip?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Complete', style: 'default', onPress: stopMeter },
      ]
    );
  };

  const handleCancel = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Cancel Trip',
      'Stop the meter without completing this trip? The job will stay open.',
      [
        { text: 'Keep Going', style: 'cancel' },
        { text: 'Cancel Trip', style: 'destructive', onPress: cancelTrip },
      ]
    );
  };

  // ─── Hail Start Modal ──────────────────────────────────────────────────────
  const [hailModalVisible, setHailModalVisible] = useState(false);
  const [hailZone, setHailZone] = useState('');
  const [hailPaymentData, setHailPaymentData] = useState<PaymentData>(DEFAULT_PAYMENT);
  // v22bm: per-trip extras picked on hail completion modal
  const [hailExtras, setHailExtras] = useState<ExtraItem[]>([]);
  const [hailExtrasTotal, setHailExtrasTotal] = useState(0);
  const [hailTariff, setHailTariff] = useState<Tariff>(activeTariff);
  const [hailPickup, setHailPickup] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [hailTariffPickerVisible, setHailTariffPickerVisible] = useState(false);
  const [hailPendingTariff, setHailPendingTariff] = useState<Tariff>(activeTariff);
  const [hailBookingType, setHailBookingType] = useState<'taxi' | 'food' | 'freight' | 'tow'>('taxi');

  // OTA20: auto-open the hail modal when the Dashboard "Hail a Passenger"
  // button routed here with ?openHail=1.  Fires once per request; parent
  // clears the flag immediately so a tab switch later doesn't re-open it.
  useEffect(() => {
    if (autoOpenHail && !currentJob && !hailTripMeta && !hailModalVisible) {
      openHailModal();
      onHailModalOpened?.();
    }
  }, [autoOpenHail]); // eslint-disable-line

  const openHailModal = () => {
    // v22s: wrap the whole open-modal sequence so a single throw (e.g. a missing
    // tariff field on a malformed Owner Portal record) can never crash the app
    // mid-hail. Errors get logged to Sentry but the driver keeps going.
    try {
      // Block hail trips when a dispatched job is active.
      // v22u: log this so we can diagnose "tap hail does nothing" reports —
      // if currentJob is stale from a previous trip the first tap silently
      // returns and the driver has to tap a second time.
      if (currentJob) {
        console.log('[openHailModal] blocked — currentJob present:', currentJob?.id);
        try { Sentry.addBreadcrumb({ category: 'hail', message: 'openHailModal blocked by currentJob', data: { jobId: currentJob?.id, status: currentJob?.status } }); } catch {}
        return;
      }
      setHailZone('');
      setHailPaymentData(DEFAULT_PAYMENT);
      // BUG-6 FIX: Always reset to the first non-TM tariff so a previous Total Mobility
      // trip never carries its tariff into the next cash/hail trip.
      const defaultHailTariff = availableTariffs.find(t => {
        const n = (t.name ?? '').toLowerCase();
        return !n.includes('total') && !n.includes('mobility');
      }) ?? availableTariffs[0] ?? activeTariff;
      setHailTariff(defaultHailTariff);
      setHailPendingTariff(defaultHailTariff);
      setHailPickup('');
      setHailBookingType('taxi');
      setHailModalVisible(true);
      // Don't await — fetchGpsPickup runs in the background and updates the
      // field when GPS resolves. Its own try/catch handles all failure modes.
      fetchGpsPickup().catch((e: unknown) => {
        try { Sentry.captureException(e); } catch {}
      });
    } catch (e) {
      try { Sentry.captureException(e); } catch {}
      Alert.alert('Could not open hail screen', 'Please try again, or restart the app if this keeps happening.');
    }
  };

  const fetchGpsPickup = async () => {
    setGpsLoading(true);
    // v22o: FIRST use the live GPS already maintained by DriverContext's
    // watchPositionAsync — it's been updating since the shift started, so
    // there's always a fresh position available. This bypasses Fold 7's
    // unreliable Location.getLastKnownPositionAsync / getCurrentPositionAsync
    // entirely. Then upgrade with reverse-geocode in the background.
    try {
      const live = getLastGpsPosition();
      let loc: { lat: number; lng: number } | null = live;
      // v22ay: never display raw coords in the input. Previously we filled the
      // field with "lat, lng" then upgraded to a real address in the
      // background — if the driver tapped Start before that upgrade landed,
      // coords got sent to dispatch (shown as "Hail Pickup (-46.39624,...)").
      // Now we show "Locating address…" as a placeholder until reverse-geocode
      // succeeds; if it never succeeds, the field stays placeholder and
      // resolveCoordsToAddress writes "Street pickup" instead of coords.
      if (loc) {
        setHailPickup('Locating address…');
      }
      // v22q (Fold 7 ROOT CAUSE): the old code gated GPS calls behind a 3-second
      // permission-check race. Samsung's OneUI sometimes takes >3s to validate
      // an already-granted permission, the race fires `false`, and we returned
      // WITHOUT ever calling the GPS APIs — leaving the field empty. Now we
      // skip the gate entirely. Permission was already requested when the
      // driver started their shift; if it's denied, the GPS calls below return
      // null naturally. No silent early-exits.
      if (!loc) {
        loc = await Promise.race([getGpsViaWatcher(), getFastGpsFix()]);
        if (!loc) loc = await getGpsViaWatcher();
        if (!loc) {
          // Last resort: try the cached fix one more time. If still nothing,
          // surface a helpful placeholder by leaving hailPickup empty (driver
          // can type the address manually).
          setGpsLoading(false);
          return;
        }
        setHailPickup('Locating address…');
      }
      setGpsLoading(false);
      // Upgrade coords → real address in the background. Use Nominatim
      // (HTTP) as a fallback when Samsung's native geocoder is dead.
      // v22ay: if reverse-geocode comes back with coords (or fails), CLEAR the
      // field rather than show coords. Driver can type the address manually if
      // GPS area has no nearby road name.
      reverseGeocode(loc.lat, loc.lng).then(addr => {
        if (addr && !addr.match(/^-?\d+\.\d+,/)) {
          setHailPickup(addr);
        } else {
          setHailPickup('');
        }
      }).catch(() => setHailPickup(''));
    } catch {
      setGpsLoading(false);
    }
  };

  // v22aw: if the address field still holds raw coords (because the background
  // reverse-geocode hadn't finished by the time the driver tapped Start / End),
  // do one final blocking reverse-geocode with a 4s ceiling. Otherwise dispatch
  // HQ shows "Hail Pickup (-46.39622, 168.35129)" / "Street Pickup (no
  // destination)" placeholders instead of the real address.
  const looksLikeCoords = (s: string): boolean =>
    /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test((s ?? '').trim());

  const resolveCoordsToAddress = async (s: string, fallbackLabel: string): Promise<string> => {
    const trimmed = (s ?? '').trim();
    if (!trimmed) return fallbackLabel;
    // v22ay: treat the placeholder text the same as empty — never leak it to dispatch.
    if (trimmed === 'Locating address…' || trimmed === 'Locating address...') return fallbackLabel;
    if (!looksLikeCoords(trimmed)) return trimmed;
    const [latStr, lngStr] = trimmed.split(',').map(p => p.trim());
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fallbackLabel;
    try {
      const addr = await Promise.race<string | null>([
        reverseGeocode(lat, lng),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
      ]);
      // v22ax: reverseGeocode's OWN final fallback returns a coord-string
      // ("-46.39624, 168.35131") when both native + Nominatim fail. That
      // bypassed my 22aw check and got written to dispatch as the address.
      // Now: if the result still looks like coords, use the fallback label so
      // dispatch never receives raw coords as a pickup/drop address.
      if (addr && !looksLikeCoords(addr)) return addr;
    } catch {}
    return fallbackLabel;
  };

  const handleStartHail = async () => {
    // v22s: defensive wrapper. User reports the app crashes on hail start after
    // each OTA update. Catching here at the top of the call chain prevents an
    // unexpected throw inside startHailTrip from killing the JS engine. Real
    // failures (e.g. server unreachable) are still surfaced by startHailTrip's
    // own Alert() — this only catches unexpected exceptions.
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setHailModalVisible(false);
      // v22aw: resolve coord-string to real address before sending. Falls back
      // to "Street pickup" if reverse-geocode times out (4s) or returns nothing.
      const finalPickup = await resolveCoordsToAddress(hailPickup, 'Street pickup');
      await startHailTrip(hailTariff, hailZone.trim(), hailPaymentData, finalPickup, hailBookingType);
    } catch (e) {
      try { Sentry.captureException(e); } catch {}
      Alert.alert('Could not start hail trip', 'Something unexpected went wrong. Please try again.');
    }
  };

  // ─── Hail Complete Modal ───────────────────────────────────────────────────
  const [completeModalVisible, setCompleteModalVisible] = useState(false);
  const [dropAddress, setDropAddress] = useState('');
  const [dropGpsLoading, setDropGpsLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [finalPaymentData, setFinalPaymentData] = useState<PaymentData>(DEFAULT_PAYMENT);
  const snapRef = useRef({ fare: 0, dist: 0, secs: 0 });

  const openCompleteHailModal = () => {
    // v12-ota22d: removed redundant native Alert confirmation. Tapping
    // "End Trip" used to require 3 taps total (End Trip → Yes Complete alert
    // → Confirm & Complete modal). Now goes straight to the drop-off modal
    // which already has its own Back / Confirm & Complete buttons.
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    const snap = getMeterSnapshot();
    snapRef.current = { fare: snap.fare, dist: snap.dist, secs: snap.secs };
    setFinalPaymentData(hailTripMeta?.paymentData ?? { type: hailTripMeta?.paymentType ?? 'cash' });
    setDropAddress('');
    // v22bm: reset extras for each completion
    setHailExtras([]);
    setHailExtrasTotal(0);
    setCompleteModalVisible(true);
    fetchGpsDropoff();
  };

  const fetchGpsDropoff = async () => {
    setDropGpsLoading(true);
    // v22o: live-GPS-first (same pattern as pickup) — bypass Fold 7's
    // flaky native location APIs.
    try {
      const live = getLastGpsPosition();
      let loc: { lat: number; lng: number } | null = live;
      // v22ay: never display raw coords in the drop input (same fix as pickup).
      if (loc) setDropAddress('Locating address…');
      if (!loc) {
        // v22q: same Fold 7 fix as pickup — no permission gate.
        loc = await Promise.race([getGpsViaWatcher(), getFastGpsFix()]);
        if (!loc) loc = await getGpsViaWatcher();
        if (!loc) { setDropGpsLoading(false); return; }
        setDropAddress('Locating address…');
      }
      setDropGpsLoading(false);
      reverseGeocode(loc.lat, loc.lng).then(addr => {
        if (addr && !addr.match(/^-?\d+\.\d+,/)) {
          setDropAddress(addr);
        } else {
          setDropAddress('');
        }
      }).catch(() => setDropAddress(''));
    } catch {
      setDropGpsLoading(false);
    }
  };

  // Rating prompt is fired by `completeHailTrip` in DriverContext via `requestRating()`.
  // The shared <TripRatingModal /> mounted in app/_layout.tsx surfaces it globally.
  const handleConfirmComplete = () => {
    if (completing) return;
    // v22bo fix (architect): block confirm on invalid split totals — hail
    // path was previously letting malformed sums through.
    if (finalPaymentData.type === 'split') {
      const _parts = finalPaymentData.splitParts ?? [];
      const _sum   = _parts.reduce((a, p) => a + (Number.isFinite(p.amount) ? p.amount : 0), 0);
      const _fare  = parseFloat((snapRef.current.fare + hailExtrasTotal).toFixed(2));
      const _ok    = _parts.length >= 2 && _parts.every(p => Number.isFinite(p.amount) && p.amount > 0)
                     && Math.abs(_sum - _fare) < 0.01;
      if (!_ok) {
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
        Alert.alert(
          'Split totals don\u2019t match',
          `Parts add to $${_sum.toFixed(2)} but the fare is $${_fare.toFixed(2)}. Please adjust the amounts so they match.`,
        );
        return;
      }
    }
    setCompleting(true);
    // v12-ota22 OPTIMISTIC-CLOSE: close modal IMMEDIATELY and run completion
    // in the background. Awaiting completeHailTrip kept the modal open for
    // 2-5s on slow networks, making the button look frozen and inviting
    // double-taps that the `completing` guard then silently dropped.
    setCompleteModalVisible(false);
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    const _dropRaw = dropAddress.trim();
    // v22bm: include extras in final hail fare
    const _fare = parseFloat((snapRef.current.fare + hailExtrasTotal).toFixed(2));
    const _dist = snapRef.current.dist;
    const _secs = snapRef.current.secs;
    const _pay  = finalPaymentData;
    const _extras = hailExtras;
    const _extrasTotal = hailExtrasTotal;
    // v22aw: resolve coord-string drop to a real address before completing. The
    // modal is already closed so this doesn't affect UX. Falls back to "Street
    // drop-off" if reverse-geocode fails — dispatch HQ no longer renders
    // "Street Pickup (no destination)" placeholder for empty drops.
    setTimeout(() => {
      Promise.resolve()
        .then(async () => {
          const finalDrop = await resolveCoordsToAddress(_dropRaw, 'Street drop-off');
          return completeHailTrip(finalDrop, _fare, _dist, _secs, _pay, _extras, _extrasTotal);
        })
        .catch((err: any) => {
          console.error('[MeterPanel] completeHailTrip failed (background):', err);
          // Never crash — completeHailTrip already alerts on its own catch.
        })
        .finally(() => setCompleting(false));
    }, 0);
  };

  const handleCancelHail = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Cancel Hail Trip',
      'Stop and cancel this hail trip? No record will be saved.',
      [
        { text: 'Keep Going', style: 'cancel' },
        { text: 'Cancel Trip', style: 'destructive', onPress: () => { setCompleteModalVisible(false); cancelTrip(); } },
      ]
    );
  };

  const isHailTrip = !!hailTripMeta;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

        {/* ── Network status banner ───────────────────────────────────── */}
        {((!isOnline && !isConnected) || isSyncing) && (
          <View style={[
            styles.netBanner,
            { backgroundColor: isSyncing ? colors.primary + '18' : '#ef444418',
              borderColor:     isSyncing ? colors.primary         : '#ef4444' }
          ]}>
            <Ionicons
              name={isSyncing ? 'cloud-upload-outline' : 'wifi-outline'}
              size={16}
              color={isSyncing ? colors.primary : '#ef4444'}
            />
            <Text style={[styles.netBannerText, { color: isSyncing ? colors.primary : '#ef4444' }]}>
              {isSyncing
                ? `Syncing ${pendingQueueCount > 0 ? `(${pendingQueueCount} pending)` : ''}…`
                : 'No connection — meter running offline. Data will sync when reconnected.'}
            </Text>
          </View>
        )}

        {/* Busy / hail banner */}
        {meterRunning && (
          <View style={[
            styles.busyBanner,
            { backgroundColor: isHailTrip ? colors.primary + '18' : colors.warning + '18',
              borderColor: isHailTrip ? colors.primary : colors.warning }
          ]}>
            <View style={[styles.busyDot, { backgroundColor: isHailTrip ? colors.primary : colors.warning }]} />
            <Text style={[styles.busyText, { color: isHailTrip ? colors.primary : colors.warning }]}>
              {isHailTrip
                ? `Hail Trip Active — Dispatch Sees You Busy${hailTripMeta?.zone ? ' · Zone: ' + hailTripMeta.zone : ''}`
                : 'Dispatch Job Active — You Are Busy'}
            </Text>
          </View>
        )}

        {/* Subheading when trip active */}
        {(isHailTrip || currentJob) && (
          <Text style={[styles.subheading, { color: colors.mutedForeground, paddingHorizontal: 16, marginBottom: 8 }]} numberOfLines={1}>
            {isHailTrip ? `🚖 Hail · ${hailTripMeta.pickupAddress}` : `${currentJob!.passengerName} → ${currentJob!.dropAddress}`}
          </Text>
        )}

        {/* Fare display — v12-ota14: leaf component subscribes to tick */}
        <View style={[styles.meterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.fareBox, { borderBottomColor: colors.border }]}>
            <MeterPanelLiveStats
              fareLabelStyle={styles.fareLabel}
              fareValueStyle={styles.fareValue}
              statsRowStyle={styles.statsRow}
              statItemStyle={styles.statItem}
              statValStyle={styles.statValue}
              statLabelStyle={styles.statLabel}
              dividerStyle={styles.statDivider}
              mutedColor={colors.mutedForeground}
              primaryColor={colors.primary}
              foregroundColor={colors.foreground}
              borderColor={colors.border}
              ratePerKm={activeTariff.ratePerMile}
            />
          </View>

          <View style={[styles.statusRow, { borderTopColor: colors.border }]}>
            {/* Mode pill: Paused / Waiting (rate) / Moving (rate) */}
            {(() => {
              const pillColor = meterPaused
                ? colors.warning
                : meterIsWaiting
                  ? '#f97316' // orange — waiting rate active
                  : colors.success; // green — distance rate active
              const pillLabel = meterPaused
                ? 'Paused'
                : meterIsWaiting
                  ? 'Waiting Rate'
                  : 'Moving — $/km';
              const pillIcon = meterPaused ? '⏸' : meterIsWaiting ? '⏱' : '▶';
              return (
                <View style={[styles.statusPill, {
                  backgroundColor: meterRunning ? pillColor + '22' : colors.surface,
                  borderColor: meterRunning ? pillColor : colors.border,
                }]}>
                  <View style={[styles.statusDot, { backgroundColor: meterRunning ? pillColor : colors.mutedForeground }]} />
                  <Text style={[styles.statusText, { color: meterRunning ? pillColor : colors.mutedForeground }]}>
                    {meterRunning ? `${pillIcon} ${pillLabel}` : 'Stopped'}
                  </Text>
                </View>
              );
            })()}

            {/* Speed pill — v12-ota14: leaf subscribes to GPS tick */}
            <MeterPanelSpeedPill
              pillStyle={styles.speedPill}
              textStyle={styles.speedPillText}
              surfaceColor={colors.surface}
              borderColor={colors.border}
              successColor={colors.success}
              mutedColor={colors.mutedForeground}
            />

            <TouchableOpacity
              style={[styles.tariffPill, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}
              onPress={meterRunning ? openChangePicker : openStartPicker}
              activeOpacity={0.75}
            >
              <Ionicons name="pricetag-outline" size={14} color={colors.primary} />
              <Text style={[styles.tariffPillText, { color: colors.primary }]} numberOfLines={1}>{activeTariff.name}</Text>
              <Ionicons name="chevron-down" size={12} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          {!meterRunning ? (
            currentJob ? (
              /* ── Dispatch job active — block hail meter ── */
              <View style={[styles.dispatchBlockBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning + '55' }]}>
                <Ionicons name="lock-closed" size={20} color={colors.warning} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.dispatchBlockTitle, { color: colors.warning }]}>Dispatch Job Active</Text>
                  <Text style={[styles.dispatchBlockSub, { color: colors.mutedForeground }]}>
                    Complete, recall or cancel your current dispatch job before starting a hail trip.
                  </Text>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.hailBtn, { backgroundColor: '#f59e0b' }]}
                onPress={openHailModal}
                activeOpacity={0.8}
              >
                <Ionicons name="hand-left" size={22} color="#fff" />
                <Text style={[styles.btnText, { color: '#fff' }]}>Hail Passenger</Text>
              </TouchableOpacity>
            )
          ) : (
            <View style={styles.runningControls}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); pauseMeter(); }}
                activeOpacity={0.8}
              >
                <Ionicons name={meterPaused ? 'play' : 'pause'} size={22} color={colors.foreground} />
                <Text style={[styles.btnText, { color: colors.foreground }]}>{meterPaused ? 'Resume' : 'Wait'}</Text>
              </TouchableOpacity>
              {isHailTrip ? (
                <TouchableOpacity style={[styles.stopBtn, { backgroundColor: '#22c55e' }]} onPress={openCompleteHailModal} activeOpacity={0.8}>
                  <Ionicons name="checkmark-circle" size={22} color="#fff" />
                  <Text style={[styles.btnText, { color: '#fff' }]}>End Trip</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.stopBtn, { backgroundColor: '#22c55e' }]}
                  onPress={() => {
                    if (currentJob) {
                      router.push(`/job/${currentJob.id}` as any);
                    } else {
                      handleStop();
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="checkmark-circle" size={22} color="#fff" />
                  <Text style={[styles.btnText, { color: '#fff' }]}>Go to Job</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Cancel Trip — hidden for hail trips once 50m has been driven */}
          {meterRunning && !(isHailTrip && getMeterSnapshot().dist >= 0.05) && (
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.error + '55', backgroundColor: colors.error + '11' }]}
              onPress={isHailTrip ? handleCancelHail : handleCancel}
              activeOpacity={0.75}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.cancelBtnText, { color: colors.error }]}>Cancel Trip</Text>
            </TouchableOpacity>
          )}

          {/* Live Map button — hail trips only */}
          {isHailTrip && meterRunning && (
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.primary + '55', backgroundColor: colors.primary + '11', marginTop: 4 }]}
              onPress={() => {
                if (WebView) {
                  setHailMapVisible(true);
                } else {
                  // Expo Go: open native maps at pickup location
                  const addr = hailTripMeta?.pickupAddress ?? '';
                  const lat = hailTripMeta?.pickupLat;
                  const lng = hailTripMeta?.pickupLng;
                  if (lat != null && lng != null) {
                    const url = Platform.OS === 'ios'
                      ? `http://maps.apple.com/?ll=${lat},${lng}&z=15`
                      : `geo:${lat},${lng}?z=15`;
                    Linking.openURL(url).catch(() =>
                      Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`)
                    );
                  } else if (addr) {
                    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`);
                  }
                }
              }}
              activeOpacity={0.75}
            >
              <Ionicons name={WebView ? 'map-outline' : 'navigate-outline'} size={18} color={colors.primary} />
              <Text style={[styles.cancelBtnText, { color: colors.primary }]}>
                {WebView ? 'Open Live Map' : 'Open Pickup in Maps'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tariff info card */}
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoCardHeader}>
            <Text style={[styles.infoTitle, { color: colors.mutedForeground }]}>ACTIVE TARIFF</Text>
            <TouchableOpacity onPress={meterRunning ? openChangePicker : openStartPicker} style={styles.changeTariffBtn}>
              <Text style={[styles.changeTariffText, { color: colors.primary }]}>Change</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.infoRows}>
            {[
              { k: 'Tariff',            v: activeTariff.name },
              { k: 'Flag Fall',         v: `$${activeTariff.flagFall.toFixed(2)}` },
              { k: 'Per km',            v: `$${activeTariff.ratePerMile.toFixed(2)}` },
              { k: 'Waiting (per min)', v: `$${activeTariff.waitingPerMin.toFixed(2)}` },
            ].map(row => (
              <View key={row.k} style={styles.infoRow}>
                <Text style={[styles.infoKey, { color: colors.foreground }]}>{row.k}</Text>
                <Text style={[styles.infoVal, { color: colors.mutedForeground }]}>{row.v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Hail trip details card */}
        {isHailTrip && (
          <View style={[styles.infoCard, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b55' }]}>
            <Text style={[styles.infoTitle, { color: '#f59e0b' }]}>HAIL TRIP DETAILS</Text>
            <View style={[styles.infoRows, { marginTop: 10 }]}>
              {[
                { k: 'Pickup',  v: hailTripMeta.pickupAddress },
                { k: 'Zone',    v: hailTripMeta.zone || '—' },
                { k: 'Payment', v: hailTripMeta.paymentType.toUpperCase() },
                { k: 'Started', v: tzFmtTime(hailTripMeta.startedAt) },
              ].map(row => (
                <View key={row.k} style={styles.infoRow}>
                  <Text style={[styles.infoKey, { color: colors.foreground }]}>{row.k}</Text>
                  <Text style={[styles.infoVal, { color: colors.mutedForeground }]} numberOfLines={2}>{row.v}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

      </ScrollView>

      {/* ── Hail Live Map Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={hailMapVisible}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setHailMapVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
          {/* Compact fare bar — v12-ota14: leaf subscribes to tick */}
          <View style={styles.hailMapBar}>
            <View style={{ flex: 1 }}>
              <HailMapFareOverlay
                fareTextStyle={styles.hailMapFare}
                subTextStyle={styles.hailMapSub}
              />
            </View>
            <TouchableOpacity
              style={styles.hailMapCloseBtn}
              onPress={() => setHailMapVisible(false)}
              activeOpacity={0.75}
            >
              <Ionicons name="chevron-down" size={22} color="#94a3b8" />
              <Text style={{ fontSize: 11, color: '#64748b', fontFamily: 'Inter_600SemiBold' }}>Hide Map</Text>
            </TouchableOpacity>
          </View>

          {/* Map */}
          {(getLastGpsPosition() || hailFallbackPos) ? (
            <View style={{ flex: 1 }}>
              <LiveDriverMap fallbackPos={hailFallbackPos} />
            </View>
          ) : MapViewIsAvailable() ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <ActivityIndicator color="#3b82f6" size="large" />
              <Text style={{ color: '#64748b', fontFamily: 'Inter_400Regular' }}>Loading map…</Text>
            </View>
          ) : (
            /* Expo Go fallback — no WebView available */
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 }}>
              <Ionicons name="map-outline" size={52} color="#334155" />
              <Text style={{ color: '#94a3b8', fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'center' }}>
                Live Map · Expo Go
              </Text>
              {hailTripMeta?.pickupAddress ? (
                <View style={{ backgroundColor: '#1e293b', borderRadius: 12, borderWidth: 1, borderColor: '#334155', padding: 14, width: '100%', gap: 4 }}>
                  <Text style={{ color: '#64748b', fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                    Pickup
                  </Text>
                  <Text style={{ color: '#e2e8f0', fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 20 }}>
                    {hailTripMeta.pickupAddress}
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1e40af', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 }}
                onPress={() => {
                  const lat = hailTripMeta?.pickupLat;
                  const lng = hailTripMeta?.pickupLng;
                  const addr = hailTripMeta?.pickupAddress ?? '';
                  if (lat != null && lng != null) {
                    const url = Platform.OS === 'ios'
                      ? `http://maps.apple.com/?ll=${lat},${lng}&z=15`
                      : `geo:${lat},${lng}?z=15`;
                    Linking.openURL(url).catch(() =>
                      Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`)
                    );
                  } else if (addr) {
                    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`);
                  }
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="navigate-circle" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>Open Pickup in Maps</Text>
              </TouchableOpacity>
              <Text style={{ color: '#475569', fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                Live map is available in a development build.{'\n'}Expo Go uses the native Maps app instead.
              </Text>
            </View>
          )}

          {/* Bottom controls */}
          <View style={[styles.hailMapControls, { paddingBottom: botPad + 8 }]}>
            <TouchableOpacity
              style={[styles.hailMapBtn, { backgroundColor: '#f59e0b22', borderColor: '#f59e0b' }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); pauseMeter(); }}
              activeOpacity={0.8}
            >
              <Ionicons name={meterPaused ? 'play' : 'pause'} size={20} color="#f59e0b" />
              <Text style={[styles.hailMapBtnText, { color: '#f59e0b' }]}>{meterPaused ? 'Resume' : 'Wait'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.hailMapBtn, { backgroundColor: '#22c55e', borderColor: '#22c55e', flex: 2 }]}
              onPress={() => { setHailMapVisible(false); openCompleteHailModal(); }}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={[styles.hailMapBtnText, { color: '#fff' }]}>End Trip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Standard tariff picker */}
      <TariffPicker
        visible={tariffPickerVisible}
        tariffs={availableTariffs}
        selected={pendingTariff}
        onSelect={setPendingTariff}
        onConfirm={onPickerConfirm}
        onClose={() => setTariffPickerVisible(false)}
        title={changingMidTrip ? 'Change Tariff' : 'Confirm Tariff'}
        confirmLabel={changingMidTrip ? 'Apply' : 'Start Meter'}
      />

      {/* Hail tariff picker */}
      <TariffPicker
        visible={hailTariffPickerVisible}
        tariffs={availableTariffs}
        selected={hailPendingTariff}
        onSelect={setHailPendingTariff}
        onConfirm={() => {
          setHailTariff(hailPendingTariff);
          // v22r: auto-set payment type from tariff. TM tariff → total_mobility
          // payment (passenger pays half, dispatcher covers subsidy). Any other
          // tariff defaults back to cash — driver picks the actual method at
          // trip end via the complete-modal PaymentCapture.
          const tn = (hailPendingTariff.name ?? '').toLowerCase();
          const isTM = tn.includes('total') || tn.includes('mobility');
          setHailPaymentData(isTM ? { type: 'total_mobility' } : { type: 'cash' });
          setHailTariffPickerVisible(false);
        }}
        onClose={() => setHailTariffPickerVisible(false)}
        title="Select Tariff"
        confirmLabel="Use This Tariff"
      />

      {/* Hail Start Modal */}
      <Modal visible={hailModalVisible} transparent animationType="slide" onRequestClose={() => setHailModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: botPad + 8 }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconBox, { backgroundColor: '#f59e0b22' }]}>
                <Ionicons name="hand-left" size={24} color="#f59e0b" />
              </View>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Hail Trip</Text>
              <TouchableOpacity onPress={() => setHailModalVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={24} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PICKUP LOCATION</Text>
              <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="location" size={18} color={colors.success} />
                <TextInput
                  style={[styles.textInput, { color: colors.foreground }]}
                  placeholder={gpsLoading ? 'Locating you… (you can type or just tap Start)' : 'Pickup address'}
                  placeholderTextColor={colors.mutedForeground}
                  value={hailPickup}
                  onChangeText={setHailPickup}
                  multiline
                />
                <TouchableOpacity onPress={fetchGpsPickup} style={styles.refreshBtn} disabled={gpsLoading}>
                  {gpsLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="refresh" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>ZONE / STAND (OPTIONAL)</Text>
              <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="map-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.textInput, { color: colors.foreground }]}
                  placeholder="e.g. Zone A, Airport, City Centre"
                  placeholderTextColor={colors.mutedForeground}
                  value={hailZone}
                  onChangeText={setHailZone}
                />
              </View>

              {/* v22r: PAYMENT TYPE moved to the complete-trip modal — driver
                  picks how the passenger actually paid at trip end. The only
                  exception is Total Mobility, which is selected up-front via
                  the tariff (TM uses a different fare structure). */}

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>TARIFF</Text>
              <TouchableOpacity
                style={[styles.tariffSelectBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => { setHailPendingTariff(hailTariff); setHailTariffPickerVisible(true); }}
                activeOpacity={0.8}
              >
                <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tariffSelectName, { color: colors.foreground }]}>{hailTariff.name}</Text>
                  <Text style={[styles.tariffSelectRates, { color: colors.mutedForeground }]}>
                    Flag ${hailTariff.flagFall.toFixed(2)}  ·  ${hailTariff.ratePerMile.toFixed(2)}/km  ·  ${hailTariff.waitingPerMin.toFixed(2)}/min
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity
              style={[styles.startHailBtn, { backgroundColor: '#f59e0b' }]}
              onPress={handleStartHail}
              activeOpacity={0.85}
            >
              <Ionicons name="play-circle" size={24} color="#fff" />
              <Text style={styles.startHailBtnText}>Start Hail Trip</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Hail Complete Modal */}
      <Modal visible={completeModalVisible} transparent animationType="slide" onRequestClose={() => setCompleteModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: botPad + 8 }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconBox, { backgroundColor: '#22c55e22' }]}>
                <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
              </View>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>End Hail Trip</Text>
              <TouchableOpacity onPress={() => setCompleteModalVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={24} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* v22u: STICKY summary above the ScrollView so the driver can always
                see the fare while scrolling through PaymentCapture (especially
                the long TM section which forces scrolling on the Galaxy A04). */}
            <View style={[styles.summaryBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryVal, { color: colors.primary }]}>${snapRef.current.fare.toFixed(2)}</Text>
                  <Text style={[styles.summaryLbl, { color: colors.mutedForeground }]}>FARE</Text>
                </View>
                <View style={[styles.summaryDiv, { backgroundColor: colors.border }]} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryVal, { color: colors.foreground }]}>{snapRef.current.dist.toFixed(2)} km</Text>
                  <Text style={[styles.summaryLbl, { color: colors.mutedForeground }]}>DISTANCE</Text>
                </View>
                <View style={[styles.summaryDiv, { backgroundColor: colors.border }]} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryVal, { color: colors.foreground }]}>{formatTime(snapRef.current.secs)}</Text>
                  <Text style={[styles.summaryLbl, { color: colors.mutedForeground }]}>TIME</Text>
                </View>
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
              <View style={[styles.summaryDetails, { borderTopColor: colors.border, borderTopWidth: 0, paddingTop: 0, marginBottom: 8 }]}>
                {[
                  { k: 'Tariff', v: activeTariff.name },
                  { k: 'Pickup', v: hailTripMeta?.pickupAddress ?? '—' },
                  { k: 'Zone',   v: hailTripMeta?.zone || '—' },
                ].map(row => (
                  <View key={row.k} style={styles.infoRow}>
                    <Text style={[styles.infoKey, { color: colors.foreground }]}>{row.k}</Text>
                    <Text style={[styles.infoVal, { color: colors.mutedForeground }]} numberOfLines={2}>{row.v}</Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>DROP-OFF LOCATION</Text>
              <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="flag" size={18} color={colors.error} />
                <TextInput
                  style={[styles.textInput, { color: colors.foreground }]}
                  placeholder={dropGpsLoading ? 'Locating drop-off… (you can type or just tap Confirm)' : 'Drop-off address'}
                  placeholderTextColor={colors.mutedForeground}
                  value={dropAddress}
                  onChangeText={setDropAddress}
                  multiline
                />
                <TouchableOpacity onPress={fetchGpsDropoff} style={styles.refreshBtn} disabled={dropGpsLoading}>
                  {dropGpsLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="refresh" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              </View>

              {/* v22bm: Extras section for hail trips — same picker as dispatch completion modal. */}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>EXTRAS (OPTIONAL)</Text>
              <ExtrasPicker
                value={hailExtras}
                onChange={(items, total) => { setHailExtras(items); setHailExtrasTotal(total); }}
                fare={snapRef.current.fare}
              />
              {hailExtrasTotal > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  marginTop: 6, marginBottom: 4, paddingVertical: 8, paddingHorizontal: 12,
                  backgroundColor: colors.primary + '14', borderColor: colors.primary + '44',
                  borderWidth: 1, borderRadius: 10 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 12 }}>
                    Fare ${snapRef.current.fare.toFixed(2)} + Extras ${hailExtrasTotal.toFixed(2)}
                  </Text>
                  <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold', fontSize: 16 }}>
                    ${(snapRef.current.fare + hailExtrasTotal).toFixed(2)}
                  </Text>
                </View>
              )}

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PAYMENT TYPE</Text>
              <PaymentCapture
                value={finalPaymentData}
                onChange={setFinalPaymentData}
                fare={parseFloat((snapRef.current.fare + hailExtrasTotal).toFixed(2))}
                companyId={companyId}
              />
            </ScrollView>

            <View style={styles.completeActions}>
              <TouchableOpacity
                style={[styles.cancelHailBtn, { borderColor: colors.border }]}
                onPress={() => setCompleteModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.cancelHailText, { color: colors.mutedForeground }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmCompleteBtn, { backgroundColor: '#22c55e' }]}
                onPress={handleConfirmComplete}
                disabled={completing}
                activeOpacity={0.85}
              >
                {completing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={22} color="#fff" />
                    <Text style={styles.confirmCompleteText}>Confirm & Complete</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  subheading: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 4 },
  netBanner: {
    marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10,
  },
  netBannerText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', flex: 1 },
  speedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  speedPillText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  busyBanner: {
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 12, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
  },
  busyDot: { width: 8, height: 8, borderRadius: 4 },
  busyText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1 },
  meterCard: { marginHorizontal: 16, borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  fareBox: { alignItems: 'center', paddingVertical: 32, borderBottomWidth: 1 },
  fareLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 2, marginBottom: 8 },
  fareValue: { fontSize: 56, fontWeight: '800', fontFamily: 'Inter_700Bold', letterSpacing: -2 },
  statsRow: { flexDirection: 'row', padding: 20 },
  statItem: { flex: 1, alignItems: 'center', gap: 6 },
  statValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  statDivider: { width: 1, height: '100%' },
  statusRow: { borderTopWidth: 1, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingHorizontal: 16, gap: 6 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, gap: 6, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  tariffPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, maxWidth: 160 },
  tariffPillText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', flex: 1 },
  controls: { padding: 20, gap: 12 },
  hailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 18, gap: 10 },
  dispatchBlockBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 16, gap: 4 },
  dispatchBlockTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 3 },
  dispatchBlockSub: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  runningControls: { flexDirection: 'row', gap: 12 },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 18, borderWidth: 1, gap: 8 },
  stopBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 18, gap: 8 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 12, borderWidth: 1, gap: 6 },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  btnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  infoCard: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 16 },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  infoTitle: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5 },
  changeTariffBtn: { paddingHorizontal: 4 },
  changeTariffText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  infoRows: { gap: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoKey: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  infoVal: { fontSize: 14, fontFamily: 'Inter_600SemiBold', maxWidth: '55%', textAlign: 'right' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, paddingTop: 20, paddingHorizontal: 20, gap: 16, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  modalIconBox: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold' },
  fieldLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.2, marginBottom: 6, marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  textInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', minHeight: 22 },
  refreshBtn: { padding: 2, marginTop: 2 },
  paymentRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  paymentBtn: { flex: 1, minWidth: 70, flexDirection: 'column', alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  paymentLabel: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  tariffSelectBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  tariffSelectName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  tariffSelectRates: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  startHailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 17, gap: 10, marginTop: 8 },
  startHailBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  summaryBox: { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  summaryRow: { flexDirection: 'row', paddingVertical: 16 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryVal: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  summaryLbl: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginTop: 3 },
  summaryDiv: { width: 1 },
  summaryDetails: { borderTopWidth: 1, padding: 14, gap: 8 },
  completeActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelHailBtn: { flex: 1, borderRadius: 14, borderWidth: 1.5, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  cancelHailText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  confirmCompleteBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 16, gap: 8 },
  confirmCompleteText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, marginHorizontal: 16 },
  sectionTitle: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, flex: 1 },
  sectionBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  sectionBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  emptySection: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptySectionText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 32 },

  // ── Hail Live Map Modal ────────────────────────────────────────────────────
  hailMapBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.97)',
    borderBottomWidth: 1, borderBottomColor: '#1e293b',
    paddingHorizontal: 20, paddingTop: 52, paddingBottom: 14,
    gap: 12,
  },
  hailMapFare: { fontSize: 32, fontFamily: 'Inter_700Bold', color: '#3b82f6' },
  hailMapSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#64748b', marginTop: 2 },
  hailMapCloseBtn: { alignItems: 'center', gap: 2, padding: 8 },
  hailMapControls: {
    flexDirection: 'row', gap: 12, padding: 16,
    backgroundColor: 'rgba(15,23,42,0.97)',
    borderTopWidth: 1, borderTopColor: '#1e293b',
  },
  hailMapBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 14, borderWidth: 1.5,
  },
  hailMapBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
});
