import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform,
  ActivityIndicator, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch { /* Expo Go */ }
type WebViewMessageEvent = { nativeEvent: { data: string } };
import * as Location from 'expo-location';
import { fmtTime, fmtDateTime } from '@/lib/timezone';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useDriver, useDriverFleet, JobCompletionExtras } from '@/context/DriverContext';
import { WebViewGpsInjector } from '@/components/LiveMeterTick';
import { useAuth } from '@/context/AuthContext';
import { ref, update } from 'firebase/database';
import { push } from 'firebase/database';
import { database } from '@/lib/firebase';
import { appendJournalEntry } from '@/lib/tripJournal';

function fmtDist(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
}

interface LatLng { lat: number; lng: number }

async function geocode(address: string): Promise<LatLng | null> {
  if (!address || address === '—') return null;
  try {
    const q = encodeURIComponent(address);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'Taxi360DriverApp/1.0' } }
    );
    const json = await res.json();
    if (json.length > 0) {
      return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

function buildMapHtml(
  driverLat: number, driverLng: number,
  pickupLat: number, pickupLng: number,
  dropLat: number | null, dropLng: number | null,
): string {
  const dropCoord = dropLat != null && dropLng != null ? `[${dropLat},${dropLng}]` : 'null';

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, Arial, sans-serif; }
  html, body { width:100%; height:100%; background:#0f172a; overflow:hidden; }
  #map { width:100%; height:100%; }

  /* ── Instruction Banner ── */
  #nav-banner {
    position:fixed; top:0; left:0; right:0; z-index:9999;
    background: rgba(15,23,42,0.96);
    border-bottom: 3px solid #3b82f6;
    padding: 10px 14px 8px;
    display: flex; flex-direction: column; gap: 4px;
  }
  #phase-badge {
    font-size:10px; font-weight:700; letter-spacing:1.2px;
    color:#22c55e; border:1.5px solid #22c55e;
    display:inline-block; padding:3px 10px; border-radius:20px;
    align-self:flex-start; margin-bottom:2px;
  }
  #nav-street {
    font-size:18px; font-weight:700; color:#f1f5f9;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  #nav-sub {
    font-size:13px; color:#94a3b8; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis;
  }
  #eta-row {
    display:flex; gap:16px; margin-top:4px;
  }
  .eta-item { display:flex; align-items:center; gap:4px; }
  .eta-label { font-size:10px; font-weight:700; color:#64748b; letter-spacing:0.8px; }
  .eta-val   { font-size:13px; font-weight:600; color:#e2e8f0; }

  /* ── Recenter button ── */
  #recenter-btn {
    position:fixed; bottom:50%; right:14px; z-index:9998;
    width:40px; height:40px; border-radius:12px;
    background:rgba(15,23,42,0.92); border:1px solid #334155;
    display:flex; align-items:center; justify-content:center;
    cursor:pointer; font-size:20px;
  }
  #recenter-btn:active { opacity:0.7; }

  /* ── Driver marker ── */
  .driver-icon {
    width:36px; height:36px; border-radius:50%;
    background:#3b82f6; border:3px solid #fff;
    display:flex; align-items:center; justify-content:center;
    font-size:18px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  }
  .pickup-icon {
    background:#22c55e; border:3px solid #fff;
    width:32px; height:32px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    font-size:16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .drop-icon {
    background:#ef4444; border:3px solid #fff;
    width:32px; height:32px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    font-size:16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
</style>
</head>
<body>
<div id="nav-banner">
  <span id="phase-badge">📍 TO PICKUP</span>
  <div id="nav-street">Loading route…</div>
  <div id="nav-sub"></div>
  <div id="eta-row">
    <div class="eta-item">
      <span class="eta-label">ETA</span>
      <span class="eta-val" id="eta-time">—</span>
    </div>
    <div class="eta-item">
      <span class="eta-label">LEFT</span>
      <span class="eta-val" id="eta-dist">—</span>
    </div>
    <div class="eta-item">
      <span class="eta-label">STEPS</span>
      <span class="eta-val" id="eta-steps">—</span>
    </div>
  </div>
</div>
<div id="recenter-btn" onclick="recentreDriver()">⊕</div>
<div id="map"></div>
<script>
  var DRIVER = [${driverLat}, ${driverLng}];
  var PICKUP = [${pickupLat}, ${pickupLng}];
  var DROP   = ${dropCoord};

  var map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
  }).setView(DRIVER, 15);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
  }).addTo(map);

  // ── Driver marker ──────────────────────────────────────────────────────────
  var driverEl = document.createElement('div');
  driverEl.className = 'driver-icon';
  driverEl.innerHTML = '🚖';
  var driverMarker = L.marker(DRIVER, {
    icon: L.divIcon({ className:'', html: driverEl.outerHTML, iconSize:[36,36], iconAnchor:[18,18] }),
    zIndexOffset: 1000,
  }).addTo(map);

  // ── Pickup marker ──────────────────────────────────────────────────────────
  var puEl = document.createElement('div');
  puEl.className = 'pickup-icon';
  puEl.innerHTML = '📍';
  L.marker(PICKUP, {
    icon: L.divIcon({ className:'', html: puEl.outerHTML, iconSize:[32,32], iconAnchor:[16,32] }),
  }).addTo(map).bindPopup('Pickup');

  // ── Drop marker ────────────────────────────────────────────────────────────
  if (DROP) {
    var drEl = document.createElement('div');
    drEl.className = 'drop-icon';
    drEl.innerHTML = '🏁';
    L.marker(DROP, {
      icon: L.divIcon({ className:'', html: drEl.outerHTML, iconSize:[32,32], iconAnchor:[16,32] }),
    }).addTo(map).bindPopup('Drop-off');
  }

  var activeRoute = null;
  var bgRoute     = null;
  var steps       = [];
  var stepIdx     = 0;
  var totalDuration = 0;
  var totalDistance = 0;
  var phase       = 1;
  var autoFollow  = true;

  // ── ETA helpers ───────────────────────────────────────────────────────────
  function fmtEta(secs) {
    var m = Math.ceil(secs / 60);
    if (m < 1) return '< 1 min';
    if (m < 60) return m + ' min';
    return Math.floor(m/60) + 'h ' + (m%60) + 'm';
  }
  function fmtDist(m) {
    return m >= 1000 ? (m/1000).toFixed(1)+' km' : Math.round(m)+' m';
  }
  function distM(lat1,lng1,lat2,lng2) {
    var R=6371000, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
    var a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  function updateBanner() {
    if (steps.length === 0 || stepIdx >= steps.length) return;
    var step = steps[stepIdx];
    var man  = step.maneuver || {};
    var mod  = man.modifier || '';
    var type = man.type || '';
    var name = step.name || '';
    var dist = step.distance || 0;
    var distStr = fmtDist(dist);

    var instruction = '';
    if (type === 'depart')            instruction = 'Head ' + mod;
    else if (type === 'arrive')       instruction = 'You have arrived';
    else if (type === 'turn')         instruction = 'Turn ' + mod;
    else if (type === 'new name')     instruction = 'Continue';
    else if (type === 'merge')        instruction = 'Merge ' + mod;
    else if (type === 'on ramp')      instruction = 'Take ramp ' + mod;
    else if (type === 'off ramp')     instruction = 'Take exit ' + mod;
    else if (type === 'fork')         instruction = 'Keep ' + mod;
    else if (type === 'end of road')  instruction = 'Turn ' + mod + ' at end';
    else if (type === 'roundabout')   instruction = 'Enter roundabout';
    else if (type === 'rotary')       instruction = 'Enter roundabout';
    else                              instruction = type || 'Continue';

    var main = instruction + (mod && !instruction.includes(mod) ? '' : '');
    var sub  = name ? 'onto ' + name : '';
    document.getElementById('nav-street').textContent   = main;
    document.getElementById('nav-sub').textContent    = sub;
    document.getElementById('nav-dist').textContent   = distStr;

    var stepsLeft = steps.length - stepIdx - 1;
    document.getElementById('eta-steps').textContent = stepsLeft > 0 ? stepsLeft : '—';
  }

  function updateEta() {
    if (steps.length === 0) return;
    var remDur=0, remDist=0;
    for (var i=stepIdx; i<steps.length; i++) {
      remDur  += steps[i].duration || 0;
      remDist += steps[i].distance || 0;
    }
    document.getElementById('eta-time').textContent = fmtEta(remDur);
    document.getElementById('eta-dist').textContent = fmtDist(remDist);
  }

  function advanceStep(driverLat, driverLng) {
    if (steps.length === 0 || stepIdx >= steps.length-1) return;
    var next = steps[stepIdx+1];
    if (!next || !next.maneuver || !next.maneuver.location) return;
    var loc = next.maneuver.location;
    var d = distM(driverLat, driverLng, loc[1], loc[0]);
    if (d < 40) {
      stepIdx++;
      updateBanner();
      updateEta();
    }
  }

  function fetchOsrm(fromLat, fromLng, toLat, toLng, color, callback) {
    var url = 'https://router.project-osrm.org/route/v1/driving/'
      + fromLng+','+fromLat+';'+toLng+','+toLat
      + '?steps=true&overview=full&geometries=geojson';
    fetch(url)
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (!data.routes || data.routes.length === 0) return;
        var route = data.routes[0];
        if (activeRoute) map.removeLayer(activeRoute);
        activeRoute = L.geoJSON(route.geometry, {
          style: { color: color, weight: 8, opacity: 0.92, lineCap:'round', lineJoin:'round' }
        }).addTo(map);
        if (callback) callback(route);
      })
      .catch(function(e){ document.getElementById('nav-street').textContent = 'Route unavailable'; });
  }

  function fetchBgRoute() {
    if (!DROP) return;
    var url = 'https://router.project-osrm.org/route/v1/driving/'
      + PICKUP[1]+','+PICKUP[0]+';'+DROP[1]+','+DROP[0]
      + '?overview=full&geometries=geojson';
    fetch(url)
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (!data.routes || data.routes.length === 0) return;
        if (bgRoute) map.removeLayer(bgRoute);
        bgRoute = L.geoJSON(data.routes[0].geometry, {
          style: { color:'#6b7280', weight:5, opacity:0.4, dashArray:'8,8', lineCap:'round' }
        }).addTo(map);
        activeRoute && activeRoute.bringToFront();
      }).catch(function(){});
  }

  function startPhase1() {
    phase = 1;
    document.getElementById('phase-badge').textContent = '📍 TO PICKUP';
    document.getElementById('phase-badge').style.borderColor = '#22c55e';
    document.getElementById('phase-badge').style.color = '#22c55e';
    document.getElementById('nav-banner').style.borderBottomColor = '#3b82f6';

    fetchOsrm(DRIVER[0], DRIVER[1], PICKUP[0], PICKUP[1], '#3b82f6', function(route) {
      steps = [];
      var legs = route.legs || [];
      for (var i=0; i<legs.length; i++) {
        var lsteps = legs[i].steps || [];
        for (var j=0; j<lsteps.length; j++) steps.push(lsteps[j]);
      }
      stepIdx = 0;
      totalDuration = route.duration;
      totalDistance = route.distance;
      updateBanner();
      updateEta();
      map.fitBounds([DRIVER, PICKUP], { paddingTopLeft:[20,100], paddingBottomRight:[20,80] });
    });
    fetchBgRoute();
  }

  function startPhase2() {
    if (!DROP) return;
    phase = 2;
    stepIdx = 0;
    document.getElementById('phase-badge').textContent = '🏁 TO DROP-OFF';
    document.getElementById('phase-badge').style.borderColor = '#f59e0b';
    document.getElementById('phase-badge').style.color = '#f59e0b';
    document.getElementById('nav-banner').style.borderBottomColor = '#22c55e';
    if (bgRoute) { map.removeLayer(bgRoute); bgRoute = null; }
    fetchOsrm(PICKUP[0], PICKUP[1], DROP[0], DROP[1], '#22c55e', function(route) {
      steps = [];
      var legs = route.legs || [];
      for (var i=0; i<legs.length; i++) {
        var lsteps = legs[i].steps || [];
        for (var j=0; j<lsteps.length; j++) steps.push(lsteps[j]);
      }
      stepIdx = 0;
      updateBanner();
      updateEta();
      map.fitBounds([PICKUP, DROP], { paddingTopLeft:[20,100], paddingBottomRight:[20,80] });
    });
  }

  function onDriverMoved(lat, lng) {
    DRIVER = [lat, lng];
    driverMarker.setLatLng([lat, lng]);
    if (autoFollow) map.panTo([lat, lng], { animate:true, duration:0.5 });
    advanceStep(lat, lng);
  }

  function recentreDriver() {
    autoFollow = true;
    map.panTo(DRIVER, { animate:true });
  }

  function handleMsg(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'updateDriver') onDriverMoved(msg.lat, msg.lng);
      if (msg.type === 'startPhase2')  startPhase2();
      if (msg.type === 'refetchRoute') startPhase1();
    } catch(err){}
  }
  window.addEventListener('message', handleMsg);
  document.addEventListener('message', handleMsg);

  var followResumeTimer = null;
  map.on('dragstart', function(){
    autoFollow = false;
    if (followResumeTimer) clearTimeout(followResumeTimer);
    followResumeTimer = setTimeout(function(){
      autoFollow = true;
      map.panTo(DRIVER, { animate: true, duration: 0.6 });
    }, 10000);
  });

  startPhase1();
</script>
</body>
</html>`;
}

export default function JobDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { driver } = useAuth();
  const {
    jobs, acceptJob, rejectJob, recallJob, completeJob,
    cancelTrip,
    meterRunning,
    getLastGpsPosition,
  } = useDriver();
  // v12-ota16: fleet/zone moved to dedicated context — see home.tsx for rationale.
  const { myZoneInfo } = useDriverFleet();
  // v12-ota14: NO useDriverTick here — <WebViewGpsInjector> leaf below
  // subscribes to GPS so this screen doesn't re-render every GPS update.

  const [mapMode, setMapMode] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [showJobSheet, setShowJobSheet] = useState(false);
  const [arrivedAtPickup, setArrivedAtPickup] = useState(
    () => (myZoneInfo?.vehicleStatus ?? '') === 'Arrived'
  );
  const [tmCardVerified, setTmCardVerified] = useState(false);
  const [deliveryStarted, setDeliveryStarted] = useState(false);
  const [freightPickupConfirmed, setFreightPickupConfirmed] = useState(false);
  // Rating prompt is now handled globally by <TripRatingModal /> in app/_layout.tsx,
  // fired from `completeJob` in DriverContext via `requestRating()`.

  const arrivedAtMsRef = useRef<number | null>(null);
  const [pickupCoords, setPickupCoords] = useState<LatLng | null>(null);
  const [dropCoords, setDropCoords] = useState<LatLng | null>(null);
  const [driverCoords, setDriverCoords] = useState<LatLng>({ lat: -46.4132, lng: 168.3538 });
  const [mapHtml, setMapHtml] = useState<string | null>(null);
  const webViewRef = useRef<any>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const phase2SentRef = useRef(false);

  const job = jobs.find(j => j.id === id);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const prepareMap = useCallback(async () => {
    if (!job) return;
    setGeocoding(true);
    try {
      // Prefer the shared GPS from DriverContext (single watcher); fall back to
      // last-known fix for instant first paint. No new watchPositionAsync here —
      // multiple high-accuracy watchers were causing OOM crashes on low-RAM Android.
      let dLat = driverCoords.lat;
      let dLng = driverCoords.lng;
      const shared = getLastGpsPosition();
      if (shared) {
        dLat = shared.lat; dLng = shared.lng;
      } else {
        try {
          const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
          if (last) { dLat = last.coords.latitude; dLng = last.coords.longitude; }
        } catch {}
      }
      setDriverCoords({ lat: dLat, lng: dLng });
      const [pu, dr] = await Promise.all([
        geocode(job.pickupAddress),
        geocode(job.dropAddress),
      ]);
      setPickupCoords(pu);
      setDropCoords(dr);
      const puLat = pu?.lat ?? dLat + 0.005;
      const puLng = pu?.lng ?? dLng + 0.005;
      setMapHtml(buildMapHtml(
        dLat, dLng,
        puLat, puLng,
        dr?.lat ?? null, dr?.lng ?? null,
      ));
    } finally {
      setGeocoding(false);
    }
  }, [job, driverCoords.lat, driverCoords.lng]);

  // Auto-launch navigation when job becomes active
  useEffect(() => {
    if (job?.status === 'current' && !mapMode && !geocoding && !mapHtml) {
      handleNavigate();
    }
  }, [job?.status]);

  // v12-ota14: live WebView GPS injection moved to <WebViewGpsInjector> leaf
  // (rendered alongside the WebView). This screen no longer re-renders on GPS.
  useEffect(() => { if (!mapMode) phase2SentRef.current = false; }, [mapMode]);

  // Tell map to switch to Phase 2 when meter starts (passenger on board)
  useEffect(() => {
    if (meterRunning && mapMode && !phase2SentRef.current) {
      phase2SentRef.current = true;
      webViewRef.current?.injectJavaScript(
        `window.postMessage(${JSON.stringify({ type: 'startPhase2' })}, '*'); true;`
      );
    }
  }, [meterRunning, mapMode]);

  // Restore arrivedAtPickup from Firebase presence
  useEffect(() => {
    if ((myZoneInfo?.vehicleStatus ?? '') === 'Arrived' && !arrivedAtPickup) {
      setArrivedAtPickup(true);
    }
  }, [myZoneInfo?.vehicleStatus]);

  // Redirect to jobs tab if job disappears
  const jobGoneRef = useRef(false);
  useEffect(() => {
    if (!job && !jobGoneRef.current) {
      jobGoneRef.current = true;
      router.replace('/(tabs)/home');
    }
  }, [job]);

  const [showRecallModal, setShowRecallModal] = useState(false);

  if (!job) {
    return <View style={[styles.root, { backgroundColor: colors.background }]} />;
  }

  const handleAccept = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    acceptJob(job);
  };

  const handleReject = () => {
    Alert.alert('Reject Job', 'Are you sure you want to reject this job?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive', onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          rejectJob(job.id);
          router.back();
        },
      },
    ]);
  };

  const handleRecall = () => setShowRecallModal(true);

  const handleRecallWithReason = (reason: string) => {
    setShowRecallModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // OTA21: fire-and-forget — UI must navigate back instantly
    recallJob(job.id, reason).catch((err) => console.warn('[Job] recallJob failed:', err));
    setMapMode(false);
    setMapHtml(null);
    router.back();
  };

  const handleArrived = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setArrivedAtPickup(true);
    arrivedAtMsRef.current = Date.now();
    // OTA21: fire-and-forget so the button is instant.
    const companyId = driver?.companyId ?? '';
    const vehicleId = driver?.vehicleId ?? '';
    if (companyId && vehicleId) {
      update(ref(database, `online/${companyId}/${vehicleId}/current`), {
        vehiclestatus: 'Arrived',
        // v22bl: explicit tripStage for the HQ audit panel
        tripStage:     'Arrived',
      }).catch((err) => console.warn('[Job] Failed to write arrived status:', err));
    }
    const jobKey = job?.bookingId ?? job?.id ?? '';
    if (jobKey && driver?.companyId && driver?.id) {
      try {
        // Use shared GPS instead of starting a one-shot watcher
        const gps = getLastGpsPosition();
        if (gps) setPickupCoords({ lat: gps.lat, lng: gps.lng });
        appendJournalEntry({
          jobId:     jobKey,
          companyId: driver.companyId,
          driverId:  driver.id,
          vehicleId: driver.vehicleId ?? '',
          eventType: 'Arrived',
          timestamp: new Date().toISOString(),
          lat: gps?.lat ?? 0,
          lng: gps?.lng ?? 0,
          meta: { pickupAddress: job?.pickupAddress },
        }).catch(() => {});
      } catch { /* non-fatal */ }
    }
  };

  const handleNavigate = async () => {
    Haptics.selectionAsync();
    await prepareMap();
    setMapMode(true);
  };

  const handleOpenMeter = () => {
    router.push('/(tabs)/meter');
  };

  // Job type detection — ota22c-cutover-d: added 'tow' alongside food/freight
  const _bt = (job.bookingType ?? '').toLowerCase();
  const jobType: 'food' | 'freight' | 'tow' | 'taxi' =
    _bt.includes('food') || _bt.includes('meal') || _bt.includes('restaurant') ? 'food' :
    _bt.includes('freight') || _bt.includes('parcel') || _bt.includes('cargo') ? 'freight' :
    _bt.includes('tow')  || _bt.includes('recovery') ? 'tow' :
    'taxi';
  const isDeliveryJob = jobType !== 'taxi';
  const inDelivery = isDeliveryJob && deliveryStarted;
  const onTripActive = meterRunning || inDelivery;
  const pickupLabel    = jobType === 'food' ? 'Restaurant'
                       : jobType === 'tow'  ? 'Vehicle Location'
                       : 'Pickup Point';
  const inTransitLabel = jobType === 'food' ? 'In Delivery'
                       : jobType === 'tow'  ? 'Towing'
                       : 'In Transit';

  const handleStartDelivery = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDeliveryStarted(true);
    // OTA21: fire-and-forget so the button is instant.
    const companyId = driver?.companyId ?? '';
    const vehicleId = driver?.vehicleId ?? '';
    if (companyId && vehicleId) {
      update(ref(database, `online/${companyId}/${vehicleId}/current`), {
        vehiclestatus: jobType === 'food' ? 'InDelivery' : 'InTransit',
      }).catch((err) => console.warn('[Job] Failed to write delivery start status:', err));
    }
  };

  const handleFreightPickupConfirm = () => {
    const companyId = driver?.companyId ?? '';
    const bookingId = job.bookingId ?? '';
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFreightPickupConfirmed(true);
    if (companyId && bookingId) {
      update(ref(database, `freightOrders/${companyId}/${bookingId}`), {
        pickupConfirmed:   true,
        pickupConfirmedAt: new Date().toISOString(),
        driverId:          driver?.id ?? '',
        vehicleId:         driver?.vehicleId ?? '',
      }).catch(() => {});
    }
  };

  const handleCompleteDelivery = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const label = jobType === 'food' ? 'Complete Delivery?' : 'Complete Job?';
    const detail = jobType === 'food'
      ? `Confirm delivery to ${job.dropAddress || 'customer'}.`
      : `Confirm drop-off at ${job.dropAddress || 'destination'}.`;
    Alert.alert(label, detail, [
      { text: 'Not Yet', style: 'cancel' },
      {
        text: 'Complete',
        style: 'default',
        onPress: () => {
          const arrivedMs = arrivedAtMsRef.current;
          const extras: JobCompletionExtras = {
            tariffName:  jobType === 'food' ? 'Food Delivery' : 'Freight',
            waitingMins: 0,
            waitingCost: 0,
            rideCost:    parseFloat((job.fare || 0).toFixed(2)),
            flagFall:    0,
            driverCost:  parseFloat((job.fare || 0).toFixed(2)),
            arrivedAt:   arrivedMs ? new Date(arrivedMs).toISOString() : undefined,
            pickedUpAt:  new Date().toISOString(),
          };
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          completeJob(job.id, job.fare || 0, extras);
          // Write delivery confirmed to freightOrders for freight jobs
          const companyId = driver?.companyId ?? '';
          const bookingId = job.bookingId ?? '';
          if (jobType === 'freight' && companyId && bookingId) {
            update(ref(database, `freightOrders/${companyId}/${bookingId}`), {
              deliveryConfirmed:   true,
              deliveredAt:         new Date().toISOString(),
              driverId:            driver?.id ?? '',
              vehicleId:           driver?.vehicleId ?? '',
            }).catch(() => {});
          }
          setMapMode(false);
          setMapHtml(null);
          // Global TripRatingModal will surface (subject to frequency cap) — just navigate back.
          router.back();
        },
      },
    ]);
  };

  const statusColor =
    job.status === 'offered' ? colors.warning :
    job.status === 'current' ? colors.success :
    job.status === 'queued'  ? colors.info :
    colors.mutedForeground;

  const statusLabel =
    job.status === 'offered' ? 'New Offer' :
    job.status === 'current' ? 'Active' :
    job.status === 'queued'  ? 'Queued' : 'Completed';

  // ─── RECALL MODAL ────────────────────────────────────────────────────────────
  const recallReasons = [
    { icon: 'car-sport-outline',           label: 'Vehicle breakdown',           color: '#ef4444' },
    { icon: 'medical-outline',             label: 'Personal emergency',           color: '#ef4444' },
    ...(jobType === 'taxi'    ? [{ icon: 'person-outline',       label: 'Unable to reach passenger', color: '#f59e0b' }] : []),
    ...(jobType === 'food'    ? [{ icon: 'restaurant-outline',   label: 'Restaurant not ready / order unavailable', color: '#f59e0b' }] : []),
    ...(jobType === 'freight' ? [{ icon: 'cube-outline',         label: 'Cannot load / item oversized', color: '#f59e0b' }] : []),
    { icon: 'navigate-circle-outline',     label: 'Wrong pickup / job details',  color: '#f59e0b' },
    { icon: 'ellipsis-horizontal-outline', label: 'Other reason',                color: colors.mutedForeground },
  ] as { icon: string; label: string; color: string }[];

  const recallModal = (
    <Modal
      visible={showRecallModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowRecallModal(false)}
    >
      <View style={recallStyles.overlay}>
        <TouchableOpacity style={recallStyles.backdrop} activeOpacity={1} onPress={() => setShowRecallModal(false)} />
        <View style={[recallStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[recallStyles.handle, { backgroundColor: colors.border }]} />
          <Text style={[recallStyles.title, { color: colors.foreground }]}>Return Job to Dispatch</Text>
          <Text style={[recallStyles.subtitle, { color: colors.mutedForeground }]}>
            Select a reason — your dispatcher will see this
          </Text>
          <View style={{ gap: 8, marginTop: 4 }}>
            {recallReasons.map(r => (
              <TouchableOpacity
                key={r.label}
                style={[recallStyles.reasonRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => handleRecallWithReason(r.label)}
                activeOpacity={0.75}
              >
                <View style={[recallStyles.reasonIcon, { backgroundColor: r.color + '18' }]}>
                  <Ionicons name={r.icon as any} size={20} color={r.color} />
                </View>
                <Text style={[recallStyles.reasonLabel, { color: colors.foreground }]}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[recallStyles.cancelBtn, { borderColor: colors.border }]}
            onPress={() => setShowRecallModal(false)}
            activeOpacity={0.7}
          >
            <Text style={[recallStyles.cancelText, { color: colors.mutedForeground }]}>Keep Job — Stay On It</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ─── MAP VIEW ────────────────────────────────────────────────────────────────
  if (mapMode && mapHtml) {
    return (
      <View style={styles.root}>
        {WebView ? (
          <WebView
            ref={webViewRef}
            source={{ html: mapHtml }}
            style={StyleSheet.absoluteFill}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            allowUniversalAccessFromFileURLs
            onMessage={(_: WebViewMessageEvent) => {}}
            onLoad={() => {
              if (meterRunning) {
                phase2SentRef.current = true;
                setTimeout(() => {
                  webViewRef.current?.injectJavaScript(
                    `window.postMessage(${JSON.stringify({ type: 'startPhase2' })}, '*'); true;`
                  );
                }, 800);
              }
            }}
          />
        ) : null}
        {/* v12-ota14: leaf subscribes to GPS and injects updateDriver into WebView */}
        {WebView && <WebViewGpsInjector webViewRef={webViewRef} enabled={mapMode} />}
        {!WebView && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' }]}>
            <Ionicons name="map-outline" size={48} color="#555" />
            <Text style={{ color: '#888', marginTop: 12, fontSize: 14 }}>Map navigation needs a development build</Text>
            <Text style={{ color: '#555', marginTop: 6, fontSize: 12 }}>Scan the QR code with Expo Go on your device</Text>
          </View>
        )}

        {/* Back button */}
        <View style={[styles.mapBackRow, { paddingTop: insets.top + 92 }]}>
          <TouchableOpacity
            style={[styles.mapBackBtn, { backgroundColor: colors.card + 'ee', borderColor: colors.border }]}
            onPress={() => setMapMode(false)}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={22} color={colors.foreground} />
            <Text style={[styles.mapBackText, { color: colors.foreground }]}>Back</Text>
          </TouchableOpacity>
        </View>

        {/* Overlay panel */}
        <View style={[styles.meterOverlay, { backgroundColor: colors.card + 'f5', paddingBottom: botPad + 16 }]}>

          {/* Status pill */}
          {(() => {
            const s = onTripActive
              ? isDeliveryJob
                ? { label: `🟢  ${inTransitLabel}`, color: '#22c55e' }
                : { label: '🔴  Busy — Passenger Aboard', color: '#ef4444' }
              : arrivedAtPickup
              ? { label: `📍  Arrived at ${pickupLabel}`, color: '#22c55e' }
              : { label: `🔵  On My Way to ${pickupLabel}`, color: '#3b82f6' };
            return (
              <View style={[styles.autoStatusPill, { backgroundColor: s.color + '20', borderColor: s.color }]}>
                <Text style={[styles.autoStatusText, { color: s.color }]}>{s.label}</Text>
              </View>
            );
          })()}

          {/* Job info strip */}
          <View style={[styles.jobInfoStrip, { borderColor: colors.border }]}>
            <View style={styles.jobInfoRow}>
              <Ionicons name={isDeliveryJob ? 'call-outline' : 'person'} size={14} color={colors.mutedForeground} />
              <Text style={[styles.jobInfoName, { color: colors.foreground }]} numberOfLines={1}>
                {job.passengerName}
                {job.passengerPhone ? <Text style={{ color: colors.mutedForeground }}>  ·  {job.passengerPhone}</Text> : null}
              </Text>
            </View>
            <View style={styles.jobInfoRow}>
              <Ionicons name="location" size={14} color={meterRunning ? colors.mutedForeground : '#22c55e'} />
              <Text style={[styles.jobInfoAddr, { color: meterRunning ? colors.mutedForeground : colors.foreground }]} numberOfLines={1}>
                {job.pickupAddress}
              </Text>
            </View>
            <View style={styles.jobInfoRow}>
              <Ionicons name="flag" size={14} color={meterRunning ? '#ef4444' : colors.mutedForeground} />
              <Text style={[styles.jobInfoAddr, { color: meterRunning ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                {job.dropAddress}
              </Text>
            </View>
            {job.paymentType === 'total_mobility' && (
              <View style={{ flexDirection: 'row', gap: 6, paddingTop: 6, flexWrap: 'wrap' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7c3aed18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#7c3aed44' }}>
                  <Ionicons name="accessibility" size={11} color="#7c3aed" />
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 10, color: '#7c3aed' }}>TOTAL MOBILITY</Text>
                </View>
                {job.tmHoistRequired && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f59e0b18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#f59e0b44' }}>
                    <Ionicons name="accessibility-outline" size={11} color="#f59e0b" />
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 10, color: '#f59e0b' }}>HOIST{job.tmHoistCount ? ` ×${job.tmHoistCount}` : ''}</Text>
                  </View>
                )}
              </View>
            )}
            <TouchableOpacity
              style={[styles.jobInfoShowMore, { borderTopColor: colors.border }]}
              onPress={() => setShowJobSheet(true)}
              activeOpacity={0.7}
            >
              <Text style={[styles.jobInfoShowMoreText, { color: colors.primary }]}>Show full info</Text>
              <Ionicons name="chevron-up" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {/* ── Phase 1: On My Way ── */}
          {!onTripActive && !arrivedAtPickup && (
            <View style={{ width: '100%', gap: 10 }}>
              <TouchableOpacity
                style={[styles.mapBtnPrimary, { backgroundColor: '#22c55e' }]}
                onPress={handleArrived}
                activeOpacity={0.85}
              >
                <Ionicons name="location" size={26} color="#fff" />
                <Text style={[styles.mapBtnText, { color: '#fff' }]}>
                  {isDeliveryJob ? `Arrived at ${pickupLabel}` : "I've Arrived at Pickup"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapBtnSm, { backgroundColor: '#f59e0b22', borderColor: '#f59e0b' }]}
                onPress={handleRecall}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh-circle" size={20} color="#f59e0b" />
                <Text style={[styles.mapBtnSmText, { color: '#f59e0b' }]}>Recall Job</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Phase 2: Arrived ── */}
          {!onTripActive && arrivedAtPickup && (
            <View style={{ width: '100%', gap: 10 }}>
              <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#22c55e18', borderColor: '#22c55e' }]}>
                <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                <Text style={[styles.arrivedConfirmText, { color: '#22c55e' }]}>
                  {isDeliveryJob ? `Arrived at ${pickupLabel} — dispatch notified` : 'Arrived at pickup — dispatch notified'}
                </Text>
              </View>

              {isDeliveryJob && job.orderDetails ? (
                <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>ORDER DETAILS</Text>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.foreground }}>{job.orderDetails}</Text>
                </View>
              ) : null}

              {/* Freight: pickup confirmation */}
              {jobType === 'freight' && !freightPickupConfirmed && (
                <TouchableOpacity
                  style={[styles.mapBtnSm, { backgroundColor: '#f59e0b22', borderColor: '#f59e0b', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}
                  onPress={handleFreightPickupConfirm}
                  activeOpacity={0.85}
                >
                  <Ionicons name="cube" size={18} color="#f59e0b" />
                  <Text style={[styles.mapBtnSmText, { color: '#f59e0b' }]}>Confirm Freight Picked Up</Text>
                </TouchableOpacity>
              )}
              {jobType === 'freight' && freightPickupConfirmed && (
                <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#f59e0b" />
                  <Text style={[styles.arrivedConfirmText, { color: '#f59e0b' }]}>Freight picked up — confirmed</Text>
                </View>
              )}

              {/* TM Card Verification — taxi only */}
              {!isDeliveryJob && job.paymentType === 'total_mobility' && !tmCardVerified && (
                <View style={[styles.tmVerifyPanel, { backgroundColor: '#7c3aed12', borderColor: '#7c3aed44' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="accessibility" size={16} color="#7c3aed" />
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: '#7c3aed', letterSpacing: 0.8 }}>VERIFY TM CARD BEFORE BOARDING</Text>
                  </View>
                  {[
                    { icon: 'barcode-outline',  label: 'Card / Voucher', value: job.tmVoucherNo },
                    { icon: 'person-outline',   label: 'Card Holder',   value: job.tmPassengerName },
                    { icon: 'calendar-outline', label: 'Expiry',        value: job.tmCardExpiry },
                  ].filter(r => r.value).map(r => (
                    <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <Ionicons name={r.icon as any} size={14} color="#7c3aed99" />
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: '#7c3aed99', width: 80 }}>{r.label}</Text>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#7c3aed', flex: 1 }}>{r.value}</Text>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={[styles.tmVerifyBtn, { backgroundColor: '#7c3aed' }]}
                    onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setTmCardVerified(true); }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>Card Verified ✓</Text>
                  </TouchableOpacity>
                </View>
              )}
              {!isDeliveryJob && job.paymentType === 'total_mobility' && tmCardVerified && (
                <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#7c3aed18', borderColor: '#7c3aed' }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#7c3aed" />
                  <Text style={[styles.arrivedConfirmText, { color: '#7c3aed' }]}>TM card verified</Text>
                </View>
              )}

              {isDeliveryJob ? (
                <TouchableOpacity
                  style={[styles.mapBtnPrimary, { backgroundColor: colors.primary }]}
                  onPress={handleStartDelivery}
                  activeOpacity={0.85}
                >
                  <Ionicons name="play-circle" size={26} color={colors.primaryForeground} />
                  <Text style={[styles.mapBtnText, { color: colors.primaryForeground }]}>
                    {jobType === 'food' ? 'Items Collected — Start Delivery' : 'Loaded — Start Transit'}
                  </Text>
                </TouchableOpacity>
              ) : (
                /* Taxi: direct driver to Meter tab */
                <TouchableOpacity
                  style={[styles.mapBtnPrimary, {
                    backgroundColor: job.paymentType === 'total_mobility' && !tmCardVerified ? colors.border : colors.primary,
                    opacity: job.paymentType === 'total_mobility' && !tmCardVerified ? 0.5 : 1,
                  }]}
                  onPress={handleOpenMeter}
                  disabled={job.paymentType === 'total_mobility' && !tmCardVerified}
                  activeOpacity={0.85}
                >
                  <Ionicons name="speedometer" size={26} color={colors.primaryForeground} />
                  <Text style={[styles.mapBtnText, { color: colors.primaryForeground }]}>Open Meter Tab</Text>
                </TouchableOpacity>
              )}
              <View style={styles.mapSecondaryRow}>
                <TouchableOpacity
                  style={[styles.mapBtnSm, { backgroundColor: '#f59e0b22', borderColor: '#f59e0b' }]}
                  onPress={handleRecall}
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh-circle" size={20} color="#f59e0b" />
                  <Text style={[styles.mapBtnSmText, { color: '#f59e0b' }]}>Recall Job</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.mapBtnSm, { backgroundColor: colors.error + '22', borderColor: colors.error }]}
                  onPress={handleReject}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close-circle" size={20} color={colors.error} />
                  <Text style={[styles.mapBtnSmText, { color: colors.error }]}>Cancel Job</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Phase 3: Delivery in progress ── */}
          {inDelivery && (
            <View style={{ width: '100%', gap: 10 }}>
              <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#22c55e18', borderColor: '#22c55e' }]}>
                <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                <Text style={[styles.arrivedConfirmText, { color: '#22c55e' }]}>{inTransitLabel}</Text>
              </View>
              <TouchableOpacity
                style={[styles.mapBtnPrimary, { backgroundColor: '#22c55e' }]}
                onPress={handleCompleteDelivery}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark-circle" size={26} color="#fff" />
                <Text style={[styles.mapBtnText, { color: '#fff' }]}>
                  {jobType === 'food' ? 'Complete Delivery' : 'Complete Drop-off'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapBtnSm, { backgroundColor: colors.error + '22', borderColor: colors.error }]}
                onPress={() => Alert.alert('Cancel Delivery', 'Are you sure? The job will be returned to dispatch.', [
                  { text: 'Keep Going', style: 'cancel' },
                  { text: 'Cancel', style: 'destructive', onPress: cancelTrip },
                ])}
                activeOpacity={0.85}
              >
                <Ionicons name="close-circle" size={20} color={colors.error} />
                <Text style={[styles.mapBtnSmText, { color: colors.error }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Phase 3: Taxi meter running — Open Meter tab ── */}
          {meterRunning && !isDeliveryJob && (
            <View style={{ width: '100%', gap: 10 }}>
              <TouchableOpacity
                style={[styles.mapBtnPrimary, { backgroundColor: colors.primary }]}
                onPress={handleOpenMeter}
                activeOpacity={0.85}
              >
                <Ionicons name="speedometer" size={26} color={colors.primaryForeground} />
                <Text style={[styles.mapBtnText, { color: colors.primaryForeground }]}>Open Meter for Controls</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mapBtnSm, { backgroundColor: '#f59e0b22', borderColor: '#f59e0b' }]}
                onPress={handleRecall}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh-circle" size={20} color="#f59e0b" />
                <Text style={[styles.mapBtnSmText, { color: '#f59e0b' }]}>Recall Job</Text>
              </TouchableOpacity>
            </View>
          )}

        </View>

        {/* Full Job Info Sheet */}
        <Modal
          visible={showJobSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setShowJobSheet(false)}
        >
          <View style={sheetStyles.overlay}>
            <TouchableOpacity style={sheetStyles.backdrop} onPress={() => setShowJobSheet(false)} activeOpacity={1} />
            <View style={[sheetStyles.sheet, { backgroundColor: colors.card }]}>
              <View style={[sheetStyles.handle, { backgroundColor: colors.border }]} />
              <View style={sheetStyles.sheetHeader}>
                <Text style={[sheetStyles.sheetTitle, { color: colors.foreground }]}>Job Details</Text>
                <TouchableOpacity onPress={() => setShowJobSheet(false)} style={sheetStyles.closeBtn}>
                  <Ionicons name="close" size={24} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={sheetStyles.sheetContent}>
                <Text style={[sheetStyles.section, { color: colors.mutedForeground }]}>PASSENGER</Text>
                <View style={[sheetStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={sheetStyles.sheetRow}>
                    <Ionicons name="person" size={18} color={colors.primary} />
                    <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Name</Text>
                    <Text style={[sheetStyles.sheetRowValue, { color: colors.foreground }]}>{job.passengerName}</Text>
                  </View>
                  {!!job.passengerPhone && (
                    <View style={sheetStyles.sheetRow}>
                      <Ionicons name="call" size={18} color={colors.primary} />
                      <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Phone</Text>
                      <Text style={[sheetStyles.sheetRowValue, { color: colors.foreground }]}>{job.passengerPhone}</Text>
                    </View>
                  )}
                  {/* v22bn: tap-to-call / tap-to-text inside the job sheet. */}
                  {!!job.passengerPhone && (
                    <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                      <PassengerContactBar
                        phone={job.passengerPhone}
                        passengerName={job.passengerName}
                        bookingId={(job as any).bookingId ?? job.id}
                        source={(job as any).source ?? job.bookingType ?? null}
                        companyId={driver?.companyId}
                        driverId={driver?.id ?? driver?.vehicleId}
                        driverName={driver?.name}
                      />
                    </View>
                  )}
                </View>
                <Text style={[sheetStyles.section, { color: colors.mutedForeground }]}>ROUTE</Text>
                <View style={[sheetStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={sheetStyles.sheetRow}>
                    <Ionicons name="location" size={18} color="#22c55e" />
                    <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Pickup</Text>
                    <Text style={[sheetStyles.sheetRowValue, { color: colors.foreground }]}>{job.pickupAddress}</Text>
                  </View>
                  <View style={[sheetStyles.sheetRowDivider, { backgroundColor: colors.border }]} />
                  <View style={sheetStyles.sheetRow}>
                    <Ionicons name="flag" size={18} color="#ef4444" />
                    <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Drop-off</Text>
                    <Text style={[sheetStyles.sheetRowValue, { color: colors.foreground }]}>{job.dropAddress}</Text>
                  </View>
                </View>
                <Text style={[sheetStyles.section, { color: colors.mutedForeground }]}>FARE & TRIP</Text>
                <View style={[sheetStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={sheetStyles.sheetRow}>
                    <Ionicons name="cash" size={18} color={colors.primary} />
                    <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Est. Fare</Text>
                    <Text style={[sheetStyles.sheetRowValue, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>${job.fare.toFixed(2)}</Text>
                  </View>
                  <View style={sheetStyles.sheetRow}>
                    <Ionicons name="card-outline" size={18} color={colors.mutedForeground} />
                    <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Payment</Text>
                    <Text style={[sheetStyles.sheetRowValue, { color: colors.foreground }]}>
                      {job.paymentType === 'total_mobility' ? 'Total Mobility' :
                       job.paymentType === 'eftpos'  ? 'EFTPOS' :
                       job.paymentType === 'card'    ? 'Credit Card' :
                       job.paymentType === 'account' ? 'Account' : 'CASH'}
                    </Text>
                  </View>
                </View>
                {!!job.notes && (
                  <>
                    <Text style={[sheetStyles.section, { color: colors.mutedForeground }]}>NOTES</Text>
                    <View style={[sheetStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={[sheetStyles.notesText, { color: colors.foreground }]}>{job.notes}</Text>
                    </View>
                  </>
                )}
                <Text style={[sheetStyles.section, { color: colors.mutedForeground }]}>SYSTEM</Text>
                <View style={[sheetStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  {!!job.bookingId && (
                    <View style={sheetStyles.sheetRow}>
                      <Ionicons name="barcode" size={18} color={colors.mutedForeground} />
                      <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Booking ID</Text>
                      <Text style={[sheetStyles.sheetRowValue, { color: colors.foreground }]}>{job.bookingId}</Text>
                    </View>
                  )}
                  <View style={sheetStyles.sheetRow}>
                    <Ionicons name="calendar" size={18} color={colors.mutedForeground} />
                    <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Received</Text>
                    <Text style={[sheetStyles.sheetRowValue, { color: colors.foreground }]}>
                      {fmtTime(job.createdAt)}
                    </Text>
                  </View>
                  <View style={sheetStyles.sheetRow}>
                    <Ionicons name="ellipse" size={18} color={statusColor} />
                    <Text style={[sheetStyles.sheetRowLabel, { color: colors.mutedForeground }]}>Status</Text>
                    <Text style={[sheetStyles.sheetRowValue, { color: statusColor, fontFamily: 'Inter_700Bold' }]}>{statusLabel}</Text>
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {recallModal}
      </View>
    );
  }

  // ─── DETAIL VIEW ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: colors.foreground }]}>Job Details</Text>
        <View style={[styles.statusPill, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {(job.status === 'offered' || job.status === 'current') && (
        <TouchableOpacity
          style={[styles.navigateBtn, { backgroundColor: colors.primary }]}
          onPress={handleNavigate}
          activeOpacity={0.85}
          disabled={geocoding}
        >
          {geocoding ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Ionicons name="navigate" size={22} color={colors.primaryForeground} />
          )}
          <Text style={[styles.navigateBtnText, { color: colors.primaryForeground }]}>
            {geocoding ? 'Loading Map…' : 'Open Navigation'}
          </Text>
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: botPad + 140 }}>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {isDeliveryJob ? 'CONTACT' : 'PASSENGER'}
          </Text>
          <View style={styles.passengerRow}>
            <View style={[styles.passengerAvatar, { backgroundColor: colors.primary + '22' }]}>
              <Ionicons name={isDeliveryJob ? 'call' : 'person'} size={26} color={colors.primary} />
            </View>
            <View>
              <Text style={[styles.passengerName, { color: colors.foreground }]}>{job.passengerName}</Text>
              <Text style={[styles.passengerPhone, { color: colors.mutedForeground }]}>{job.passengerPhone}</Text>
            </View>
          </View>
        </View>

        {/* Cross-company dispatch banner */}
        {!!job.sourceCompanyId && (
          <View style={[styles.card, { backgroundColor: colors.info + '12', borderColor: colors.info + '44', flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <Ionicons name="business-outline" size={20} color={colors.info} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 11, color: colors.info, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>
                Shared Driver — External Dispatch
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.foreground }}>
                Dispatched by company <Text style={{ fontFamily: 'Inter_600SemiBold' }}>{job.sourceCompanyId}</Text>
              </Text>
            </View>
          </View>
        )}

        {/* Freight / Food order badge */}
        {job.bookingType && (() => {
          const bt = job.bookingType!.toLowerCase();
          const isFreight = bt.includes('freight') || bt.includes('parcel') || bt.includes('cargo');
          const isFood    = bt.includes('food')    || bt.includes('meal')   || bt.includes('restaurant') || bt.includes('deliver');
          if (!isFreight && !isFood) return null;
          const badgeColor = isFreight ? '#f59e0b' : '#10b981';
          const badgeIcon  = isFreight ? 'cube-outline' : 'fast-food-outline';
          const badgeLabel = isFreight ? 'FREIGHT / PARCEL' : 'FOOD DELIVERY';
          return (
            <View style={[styles.card, { backgroundColor: badgeColor + '15', borderColor: badgeColor + '55' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Ionicons name={badgeIcon as any} size={20} color={badgeColor} />
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: badgeColor, letterSpacing: 1 }}>{badgeLabel}</Text>
              </View>
              {job.orderDetails ? (
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.foreground, lineHeight: 20 }}>
                  {job.orderDetails}
                </Text>
              ) : (
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.mutedForeground }}>
                  No order details provided — check with dispatch.
                </Text>
              )}
            </View>
          );
        })()}

        {/* TM Hoist Warning */}
        {job.paymentType === 'total_mobility' && job.tmHoistRequired && (
          <View style={[styles.card, { backgroundColor: '#f59e0b15', borderColor: '#f59e0b55' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="accessibility" size={22} color="#f59e0b" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#f59e0b', letterSpacing: 0.5 }}>
                  ♿ WHEELCHAIR HOIST REQUIRED
                </Text>
                {(job.tmHoistCount ?? 0) > 0 && (
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#f59e0b99', marginTop: 2 }}>
                    {job.tmHoistCount} hoist{job.tmHoistCount === 1 ? '' : 's'} needed
                  </Text>
                )}
              </View>
            </View>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ROUTE</Text>
          <View style={styles.routeRow}>
            <Ionicons name="location" size={22} color={colors.success} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>Pickup</Text>
              <Text style={[styles.routeAddress, { color: colors.foreground }]}>{job.pickupAddress}</Text>
            </View>
          </View>
          <View style={[styles.routeConnector, { borderLeftColor: colors.border }]} />
          <View style={styles.routeRow}>
            <Ionicons name="flag" size={22} color={colors.error} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>Drop-off</Text>
              <Text style={[styles.routeAddress, { color: colors.foreground }]}>{job.dropAddress}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.primary }]}>${job.fare.toFixed(2)}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Est. Fare</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{job.distance}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Distance</Text>
          </View>
          <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{job.duration}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Duration</Text>
          </View>
        </View>

        {job.notes ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTES</Text>
            <Text style={[styles.notes, { color: colors.foreground }]}>{job.notes}</Text>
          </View>
        ) : null}

        {/* Fare breakdown for completed jobs */}
        {job.status === 'completed' && (job.tariffName || job.waitingCost != null || job.rideCost != null) && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>FARE BREAKDOWN</Text>
            {[
              job.tariffName    ? { label: 'Tariff',       value: job.tariffName } : null,
              job.paymentType   ? { label: 'Payment',      value: job.paymentType.charAt(0).toUpperCase() + job.paymentType.slice(1) } : null,
              job.flagFall != null && job.flagFall > 0 ? { label: 'Flag Fall',    value: `$${job.flagFall.toFixed(2)}` } : null,
              job.rideCost != null  ? { label: 'Ride Cost',    value: `$${job.rideCost.toFixed(2)}` } : null,
              job.waitingMins != null && job.waitingMins > 0 ? { label: 'Waiting Time', value: `${job.waitingMins} min` } : null,
              job.waitingCost != null && job.waitingCost > 0 ? { label: 'Waiting Cost', value: `$${job.waitingCost.toFixed(2)}` } : null,
            ].filter(Boolean).map(row => (
              <View key={row!.label} style={styles.detailRow}>
                <Text style={[styles.detailKey, { color: colors.mutedForeground }]}>{row!.label}</Text>
                <Text style={[styles.detailVal, { color: colors.foreground }]}>{row!.value}</Text>
              </View>
            ))}
            <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8, paddingTop: 8 }]}>
              <Text style={[styles.detailKey, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Total Fare</Text>
              <Text style={[styles.detailVal, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>${job.fare.toFixed(2)}</Text>
            </View>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DETAILS</Text>
          {[
            job.bookingId ? { label: 'Booking ID', value: job.bookingId } : null,
            { label: 'Job ID',    value: job.id },
            job.passengers ? { label: 'Passengers', value: `${job.passengers}` } : null,
            job.paymentType && !(job.tariffName || job.rideCost != null)
              ? { label: 'Payment', value: job.paymentType.charAt(0).toUpperCase() + job.paymentType.slice(1) } : null,
            { label: 'Created',   value: fmtDateTime(job.createdAt) },
            ...(job.arrivedAt  ? [{ label: 'Arrived',   value: fmtDateTime(job.arrivedAt) }] : []),
            ...(job.pickedUpAt ? [{ label: 'Picked Up', value: fmtDateTime(job.pickedUpAt) }] : []),
            ...(job.completedAt ? [{ label: 'Completed', value: fmtDateTime(job.completedAt) }] : []),
          ].filter(Boolean).map(row => (
            <View key={row!.label} style={styles.detailRow}>
              <Text style={[styles.detailKey, { color: colors.mutedForeground }]}>{row!.label}</Text>
              <Text style={[styles.detailVal, { color: colors.foreground }]}>{row!.value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Bottom actions ── */}
      {job.status === 'offered' && (
        <View style={[styles.actions, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: botPad + 16 }]}>
          <TouchableOpacity style={[styles.rejectBtn, { borderColor: colors.error }]} onPress={handleReject} activeOpacity={0.8}>
            <Ionicons name="close" size={22} color={colors.error} />
            <Text style={[styles.rejectText, { color: colors.error }]}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.acceptBtn, { backgroundColor: colors.primary }]} onPress={handleAccept} activeOpacity={0.8}>
            <Ionicons name="checkmark" size={22} color={colors.primaryForeground} />
            <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>Accept Job</Text>
          </TouchableOpacity>
        </View>
      )}

      {job.status === 'current' && (
        <View style={[styles.actions, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: botPad + 16, flexDirection: 'column', gap: 10 }]}>

          {/* ── Delivery: in transit ── */}
          {inDelivery ? (
            <View style={{ gap: 10, width: '100%' }}>
              <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#22c55e18', borderColor: '#22c55e' }]}>
                <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                <Text style={[styles.arrivedConfirmText, { color: '#22c55e' }]}>{inTransitLabel}</Text>
              </View>
              <TouchableOpacity style={[styles.acceptBtn, { backgroundColor: '#22c55e' }]} onPress={handleCompleteDelivery} activeOpacity={0.8}>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                <Text style={[styles.acceptText, { color: '#fff' }]}>
                  {jobType === 'food' ? 'Complete Delivery' : 'Complete Drop-off'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.rejectBtn, { borderColor: colors.error }]} onPress={() => Alert.alert('Cancel', 'Cancel this delivery?', [
                { text: 'Keep Going', style: 'cancel' },
                { text: 'Cancel', style: 'destructive', onPress: cancelTrip },
              ])} activeOpacity={0.8}>
                <Ionicons name="close-circle" size={20} color={colors.error} />
                <Text style={[styles.rejectText, { color: colors.error }]}>Cancel Delivery</Text>
              </TouchableOpacity>
            </View>

          /* ── Taxi: meter running → Open Meter ── */
          ) : meterRunning ? (
            <View style={{ gap: 10, width: '100%' }}>
              <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#ef444418', borderColor: '#ef4444' }]}>
                <Ionicons name="radio-button-on" size={18} color="#ef4444" />
                <Text style={[styles.arrivedConfirmText, { color: '#ef4444' }]}>Meter running — Passenger aboard</Text>
              </View>
              <TouchableOpacity style={[styles.acceptBtn, { backgroundColor: colors.primary }]} onPress={handleOpenMeter} activeOpacity={0.8}>
                <Ionicons name="speedometer" size={22} color={colors.primaryForeground} />
                <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>Open Meter for Controls</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.rejectBtn, { borderColor: '#f59e0b' }]} onPress={handleRecall} activeOpacity={0.8}>
                <Ionicons name="refresh-circle" size={20} color="#f59e0b" />
                <Text style={[styles.rejectText, { color: '#f59e0b' }]}>Recall Job</Text>
              </TouchableOpacity>
            </View>

          /* ── Arrived: Phase 2 ── */
          ) : arrivedAtPickup ? (
            <View style={{ gap: 10, width: '100%' }}>
              <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#22c55e18', borderColor: '#22c55e' }]}>
                <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                <Text style={[styles.arrivedConfirmText, { color: '#22c55e' }]}>
                  {isDeliveryJob ? `Arrived at ${pickupLabel} — dispatch notified` : 'Arrived at pickup — dispatch notified'}
                </Text>
              </View>

              {isDeliveryJob && job.orderDetails ? (
                <View style={{ backgroundColor: colors.card, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>ORDER DETAILS</Text>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.foreground }}>{job.orderDetails}</Text>
                </View>
              ) : null}

              {/* Freight: pickup confirmation */}
              {jobType === 'freight' && !freightPickupConfirmed && (
                <TouchableOpacity
                  style={[styles.mapBtnSm, { backgroundColor: '#f59e0b22', borderColor: '#f59e0b', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}
                  onPress={handleFreightPickupConfirm}
                  activeOpacity={0.85}
                >
                  <Ionicons name="cube" size={18} color="#f59e0b" />
                  <Text style={[styles.mapBtnSmText, { color: '#f59e0b' }]}>Confirm Freight Picked Up</Text>
                </TouchableOpacity>
              )}
              {jobType === 'freight' && freightPickupConfirmed && (
                <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#f59e0b" />
                  <Text style={[styles.arrivedConfirmText, { color: '#f59e0b' }]}>Freight picked up — confirmed</Text>
                </View>
              )}

              {/* TM Verification — taxi only */}
              {!isDeliveryJob && job.paymentType === 'total_mobility' && !tmCardVerified && (
                <View style={[styles.tmVerifyPanel, { backgroundColor: '#7c3aed12', borderColor: '#7c3aed44' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="accessibility" size={16} color="#7c3aed" />
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: '#7c3aed', letterSpacing: 0.8 }}>VERIFY TM CARD BEFORE BOARDING</Text>
                  </View>
                  {[
                    { icon: 'barcode-outline',  label: 'Card / Voucher', value: job.tmVoucherNo },
                    { icon: 'person-outline',   label: 'Card Holder',   value: job.tmPassengerName },
                    { icon: 'calendar-outline', label: 'Expiry',        value: job.tmCardExpiry },
                  ].filter(r => r.value).map(r => (
                    <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <Ionicons name={r.icon as any} size={14} color="#7c3aed99" />
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: '#7c3aed99', width: 84 }}>{r.label}</Text>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#7c3aed', flex: 1 }}>{r.value}</Text>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={[styles.tmVerifyBtn, { backgroundColor: '#7c3aed' }]}
                    onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setTmCardVerified(true); }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>Card Verified ✓</Text>
                  </TouchableOpacity>
                </View>
              )}
              {!isDeliveryJob && job.paymentType === 'total_mobility' && tmCardVerified && (
                <View style={[styles.arrivedConfirmBadge, { backgroundColor: '#7c3aed18', borderColor: '#7c3aed' }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#7c3aed" />
                  <Text style={[styles.arrivedConfirmText, { color: '#7c3aed' }]}>TM card verified</Text>
                </View>
              )}

              {isDeliveryJob ? (
                <TouchableOpacity
                  style={[styles.acceptBtn, { backgroundColor: colors.primary }]}
                  onPress={handleStartDelivery}
                  activeOpacity={0.8}
                >
                  <Ionicons name="play-circle" size={22} color={colors.primaryForeground} />
                  <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>
                    {jobType === 'food' ? 'Items Collected — Start Delivery' : 'Loaded — Start Transit'}
                  </Text>
                </TouchableOpacity>
              ) : (
                /* Taxi: go to Meter tab */
                <TouchableOpacity
                  style={[styles.acceptBtn, {
                    backgroundColor: job.paymentType === 'total_mobility' && !tmCardVerified ? colors.border : colors.primary,
                    opacity: job.paymentType === 'total_mobility' && !tmCardVerified ? 0.5 : 1,
                  }]}
                  onPress={handleOpenMeter}
                  disabled={job.paymentType === 'total_mobility' && !tmCardVerified}
                  activeOpacity={0.8}
                >
                  <Ionicons name="speedometer" size={22} color={colors.primaryForeground} />
                  <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>Open Meter Tab</Text>
                </TouchableOpacity>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={[styles.rejectBtn, { borderColor: '#f59e0b', flex: 1 }]} onPress={handleRecall} activeOpacity={0.8}>
                  <Ionicons name="refresh-circle" size={20} color="#f59e0b" />
                  <Text style={[styles.rejectText, { color: '#f59e0b' }]}>Recall</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.rejectBtn, { borderColor: colors.error, flex: 1 }]} onPress={handleReject} activeOpacity={0.8}>
                  <Ionicons name="close-circle" size={20} color={colors.error} />
                  <Text style={[styles.rejectText, { color: colors.error }]}>Cancel Job</Text>
                </TouchableOpacity>
              </View>
            </View>

          ) : (
            /* ── Phase 1: On My Way ── */
            <View style={{ gap: 10, width: '100%' }}>
              <TouchableOpacity style={[styles.acceptBtn, { backgroundColor: '#22c55e' }]} onPress={handleArrived} activeOpacity={0.8}>
                <Ionicons name="location" size={22} color="#fff" />
                <Text style={[styles.acceptText, { color: '#fff' }]}>
                  {isDeliveryJob ? `Arrived at ${pickupLabel}` : "I've Arrived at Pickup"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.rejectBtn, { borderColor: '#f59e0b' }]} onPress={handleRecall} activeOpacity={0.8}>
                <Ionicons name="refresh-circle" size={20} color="#f59e0b" />
                <Text style={[styles.rejectText, { color: '#f59e0b' }]}>Recall Job</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {recallModal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, fontSize: 22, fontFamily: 'Inter_700Bold' },
  statusPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5 },
  statusText: { fontSize: 13, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  navigateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 20, marginBottom: 14, paddingVertical: 18,
    borderRadius: 18, gap: 10,
  },
  navigateBtnText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  card: { borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1 },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginBottom: 12 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  passengerAvatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  passengerName: { fontSize: 20, fontFamily: 'Inter_600SemiBold' },
  passengerPhone: { fontSize: 16, fontFamily: 'Inter_400Regular', marginTop: 3 },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 4 },
  routeConnector: { marginLeft: 10, height: 22, borderLeftWidth: 2, borderStyle: 'dashed' },
  routeLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 2 },
  routeAddress: { fontSize: 17, fontFamily: 'Inter_500Medium' },
  statsCard: { flexDirection: 'row', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 4 },
  statDiv: { width: 1 },
  notes: { fontSize: 16, fontFamily: 'Inter_400Regular', lineHeight: 24 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailKey: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  detailVal: { fontSize: 14, fontFamily: 'Inter_500Medium', maxWidth: '60%', textAlign: 'right' },
  actions: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 12, padding: 16, borderTopWidth: 1 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 18, borderWidth: 2, gap: 8 },
  rejectText: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  acceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 18, gap: 8 },
  acceptText: { fontSize: 17, fontFamily: 'Inter_700Bold' },

  autoStatusPill: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 10, alignItems: 'center' },
  autoStatusText: { fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },

  arrivedConfirmBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1.5, paddingVertical: 10, paddingHorizontal: 14 },
  arrivedConfirmText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },

  tmVerifyPanel: { borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 2 },
  tmVerifyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 8 },

  mapBackRow: { position: 'absolute', top: 0, left: 12, right: 0, zIndex: 999 },
  mapBackBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1,
  },
  mapBackText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  meterOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 14, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 20,
  },
  mapBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, paddingVertical: 20, gap: 10,
  },
  mapBtnText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  mapSecondaryRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  mapBtnSm: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 14, gap: 8, borderWidth: 2,
  },
  mapBtnSmText: { fontSize: 15, fontFamily: 'Inter_700Bold' },

  jobInfoStrip: {
    borderRadius: 12, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12,
    marginBottom: 10, gap: 4,
  },
  jobInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobInfoName: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  jobInfoAddr: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  jobInfoShowMore: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingTop: 8, marginTop: 4, borderTopWidth: 1,
  },
  jobInfoShowMoreText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});

const sheetStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: '85%', paddingTop: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.25, shadowRadius: 16, elevation: 24,
  },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
  sheetTitle: { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold' },
  closeBtn: { padding: 4 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 40 },
  section: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginBottom: 8, marginTop: 16, marginLeft: 4 },
  card: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, gap: 12 },
  sheetRowLabel: { width: 90, fontSize: 14, fontFamily: 'Inter_500Medium', paddingTop: 1 },
  sheetRowValue: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', flexWrap: 'wrap' },
  sheetRowDivider: { height: 1, marginLeft: 30 },
  notesText: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, paddingVertical: 12 },
});

const recallStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.2, shadowRadius: 16, elevation: 24,
  },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 16 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13 },
  reasonIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reasonLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium' },
  cancelBtn: { marginTop: 16, borderRadius: 14, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
