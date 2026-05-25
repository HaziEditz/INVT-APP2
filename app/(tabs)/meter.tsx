import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Alert,
  ScrollView, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useDriver, useDriverFleet, useDriverSync, PaymentData, JobCompletionExtras, Job, isJobPrepaid } from '@/context/DriverContext';
import { MeterScreenLiveFareCard, LiveDriverMap } from '@/components/LiveMeterTick';
import { useAuth } from '@/context/AuthContext';
import { MeterPanel } from '@/components/MeterPanel';
import { TariffPicker } from '@/components/TariffPicker';
import { PaymentCapture } from '@/components/PaymentCapture';
import { ExtrasPicker, type ExtraItem } from '@/components/ExtrasPicker';
import { PassengerContactBar } from '@/components/PassengerContactBar';
import { ref, update } from 'firebase/database';
import { database } from '@/lib/firebase';
import { appendJournalEntry } from '@/lib/tripJournal';
import { fmtMs, DAILY_LIMIT_MS } from '@/lib/shiftCompliance';
import { NativeMap } from '@/components/NativeMap';
import { instrumentTap } from '@/lib/perf';

let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch {}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

async function geocode(addr: string): Promise<{ lat: number; lng: number } | null> {
  if (!addr || addr === '—') return null;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'Taxi360DriverApp/1.0' } },
    );
    const j = await r.json();
    if (j.length) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  } catch {}
  return null;
}

function haversinKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const r = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (r.length) {
      const p = [r[0].streetNumber, r[0].street, r[0].city ?? r[0].subregion].filter(Boolean);
      return p.join(' ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  } catch {}
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// ── Home (idle) map HTML ──────────────────────────────────────────────────────
function buildHomeMapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body,#map{width:100%;height:100%;background:#0f172a}</style>
</head><body><div id="map"></div><script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${lat},${lng}],15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var icon=L.divIcon({html:'<div style="width:40px;height:40px;background:#3b82f6;border:4px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 16px rgba(59,130,246,.7)">🚕</div>',className:'',iconAnchor:[20,20]});
var marker=L.marker([${lat},${lng}],{icon}).addTo(map);
window.addEventListener('message',function(e){try{var d=typeof e.data==='string'?JSON.parse(e.data):e.data;if(d.type==='updateDriver'){marker.setLatLng([d.lat,d.lng]);map.setView([d.lat,d.lng],map.getZoom(),{animate:true});}}catch{}});
document.addEventListener('message',function(e){try{var d=typeof e.data==='string'?JSON.parse(e.data):e.data;if(d.type==='updateDriver'){marker.setLatLng([d.lat,d.lng]);map.setView([d.lat,d.lng],map.getZoom(),{animate:true});}}catch{}});
</script></body></html>`;
}

// ── Navigation Map HTML ───────────────────────────────────────────────────────
function buildTripMapHtml(
  driverLat: number, driverLng: number,
  pickupLat: number, pickupLng: number,
  drop: { lat: number; lng: number } | null,
  phase: 'pickup' | 'drop',
): string {
  const dropJs    = drop ? `[${drop.lat},${drop.lng}]` : 'null';
  const targetLat = phase === 'drop' && drop ? drop.lat : pickupLat;
  const targetLng = phase === 'drop' && drop ? drop.lng : pickupLng;
  return `<!DOCTYPE html><html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#0f172a;overflow:hidden}
#map{width:100%;height:100%}
#banner{position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(15,23,42,.96);
  border-bottom:3px solid #3b82f6;display:flex;align-items:center;gap:12px;
  padding:14px 16px 12px;min-height:78px}
#b-arrow{font-size:46px;line-height:1;min-width:52px;text-align:center;filter:drop-shadow(0 0 8px rgba(59,130,246,.6))}
#b-text{flex:1;min-width:0}
#b-street{font-size:20px;font-weight:700;color:#f8fafc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#b-sub{font-size:14px;color:#94a3b8;margin-top:3px}
#b-dist{font-size:24px;font-weight:800;color:#3b82f6;min-width:70px;text-align:right}
#phase-pill{position:fixed;top:84px;left:12px;z-index:9998;padding:5px 12px;border-radius:20px;
  font-size:12px;font-weight:700;background:rgba(15,23,42,.9);letter-spacing:.5px}
#recenter{position:fixed;right:12px;bottom:24px;z-index:9998;width:48px;height:48px;border-radius:14px;
  background:rgba(15,23,42,.95);border:2px solid #334155;display:flex;align-items:center;
  justify-content:center;font-size:22px;cursor:pointer}
</style>
</head><body>
<div id="banner">
  <div id="b-arrow">⬆</div>
  <div id="b-text"><div id="b-street">Getting route…</div><div id="b-sub">Calculating</div></div>
  <div id="b-dist">—</div>
</div>
<div id="phase-pill" style="color:${phase==='pickup'?'#22c55e':'#ef4444'};border:2px solid ${phase==='pickup'?'#22c55e':'#ef4444'}">
  ${phase==='pickup'?'📍 TO PICKUP':'🏁 TO DROP-OFF'}
</div>
<div id="map"></div>
<div id="recenter" onclick="recentre()">🎯</div>
<script>
var DRIVER=[${driverLat},${driverLng}],PICKUP=[${pickupLat},${pickupLng}],DROP=${dropJs};
var TARGET=[${targetLat},${targetLng}];
var PHASE='${phase}';
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView(DRIVER,16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
function mkIcon(bg,lbl,sz){sz=sz||28;return L.divIcon({html:'<div style="width:'+sz+'px;height:'+sz+'px;background:'+bg+';border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:'+(sz*.45)+'px;color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.5)">'+lbl+'</div>',className:'',iconAnchor:[sz/2,sz/2]})}
function mkCar(){return L.divIcon({html:'<div style="width:32px;height:32px;background:#3b82f6;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 3px 16px rgba(59,130,246,.7)">🚕</div>',className:'',iconAnchor:[16,16]})}
var driverM=L.marker(DRIVER,{icon:mkCar(),zIndexOffset:1000}).addTo(map);
var pickupM=L.marker(PICKUP,{icon:mkIcon('#22c55e','P',34)}).addTo(map).bindTooltip('<b>Pickup</b>',{permanent:false,direction:'top'});
if(DROP){L.marker(DROP,{icon:mkIcon('#ef4444','D',28),opacity:.6}).addTo(map).bindTooltip('<b>Drop-off</b>',{permanent:false,direction:'top'});}
var routeLine=null;
var steps=[],stepIdx=0;
function fmtD(m){return m>=1000?(m/1000).toFixed(1)+' km':Math.round(m)+' m';}
function fmtT(s){var m=Math.round(s/60);return m<1?'<1 min':m<60?m+' min':Math.floor(m/60)+'h '+(m%60)+'m';}
function arrow(t,mod){
  if(t==='arrive')return'🏁';if(t==='depart')return'⬆';if(t==='roundabout'||t==='rotary')return'🔄';
  if(!mod||mod==='straight')return'⬆';if(mod==='sharp right')return'↪';if(mod==='right')return'➡';
  if(mod==='slight right')return'↗';if(mod==='slight left')return'↖';if(mod==='left')return'⬅';
  if(mod==='sharp left')return'↩';if(mod==='uturn')return'🔃';return'⬆';}
function sub(t,mod){
  if(t==='arrive')return'You have arrived';if(t==='depart')return'Head out';
  if(!mod||mod==='straight')return'Continue straight';if(mod==='right')return'Turn right';
  if(mod==='left')return'Turn left';if(mod==='sharp right')return'Turn sharp right';
  if(mod==='sharp left')return'Turn sharp left';if(mod==='uturn')return'Make a U-turn';return'Continue';}
function updateBanner(){
  if(!steps.length)return;
  var s=steps[stepIdx]||steps[steps.length-1];
  var m=s.maneuver||{};
  document.getElementById('b-arrow').textContent=arrow(m.type,m.modifier);
  document.getElementById('b-street').textContent=s.name||(m.type==='arrive'?(PHASE==='pickup'?'Pickup Point':'Drop-off'):'Unnamed road');
  document.getElementById('b-sub').textContent=sub(m.type,m.modifier);
  document.getElementById('b-dist').textContent=fmtD(s.distance||0);}
function distM(a,b,c,d){var R=6371000,dLa=(c-a)*Math.PI/180,dLo=(d-b)*Math.PI/180;
  var x=Math.sin(dLa/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function advanceStep(lat,lng){
  if(!steps.length)return;
  while(stepIdx<steps.length-1){
    var s=steps[stepIdx];var m=s.maneuver||{};var loc=m.location||[lng,lat];
    if(distM(lat,lng,loc[1],loc[0])<40){stepIdx++;updateBanner();}else break;}}
async function fetchRoute(){
  try{
    var from=DRIVER[1]+','+DRIVER[0];
    var to=TARGET[1]+','+TARGET[0];
    var r=await fetch('https://router.project-osrm.org/route/v1/driving/'+from+';'+to+'?steps=true&geometries=geojson&overview=full');
    var j=await r.json();
    if(!j.routes||!j.routes.length)return;
    var route=j.routes[0];
    var coords=route.geometry.coordinates.map(function(c){return[c[1],c[0]];});
    if(routeLine)map.removeLayer(routeLine);
    routeLine=L.polyline(coords,{color:'#3b82f6',weight:5,opacity:.85}).addTo(map);
    steps=[];
    route.legs.forEach(function(l){l.steps.forEach(function(s){steps.push(s);});});
    updateBanner();
    var bounds=L.latLngBounds([DRIVER,TARGET]);
    if(DROP&&PHASE==='pickup')bounds.extend(DROP);
    map.fitBounds(bounds,{padding:[60,60]});}
  catch(e){
    if(routeLine)map.removeLayer(routeLine);
    routeLine=L.polyline([DRIVER,TARGET],{color:'#3b82f6',weight:4,opacity:.6,dashArray:'10,8'}).addTo(map);
    document.getElementById('b-street').textContent='Route unavailable — follow dashes';
    document.getElementById('b-sub').textContent='GPS tracking active';}}
fetchRoute();
function recentre(){map.setView(driverM.getLatLng(),16);}
function handleMsg(e){
  try{var d=typeof e.data==='string'?JSON.parse(e.data):e.data;
  if(d.type==='updateDriver'){
    var ll=L.latLng(d.lat,d.lng);
    driverM.setLatLng(ll);
    if(document._autoFollow!==false)map.panTo(ll,{animate:true});
    advanceStep(d.lat,d.lng);}}catch{}}
window.addEventListener('message',handleMsg);
document.addEventListener('message',handleMsg);
map.on('dragstart',function(){document._autoFollow=false;});
</script></body></html>`;
}

// ── Job Offer Modal ───────────────────────────────────────────────────────────
function JobOfferModal({
  job, onAccept, onReject, colors, queueMode, botPad,
}: {
  job: Job; onAccept: () => void; onReject: () => void;
  colors: any; queueMode: boolean; botPad: number;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const payType = (job.jobPaymentMethod ?? job.paymentType ?? '').toLowerCase();
  const hasFare = job.fare > 0;
  const hasPhone = !!job.passengerPhone;
  const hasNotes = !!job.notes;
  const isWheelchair = !!(job as any).wheelchair;
  const isAcc = !!(job as any).acc_client_id || payType === 'acc';

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onReject}>
      <View style={offerStyles.backdrop}>
        <View style={[offerStyles.sheet, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[offerStyles.header, { borderBottomColor: colors.border }]}>
            <Animated.View style={[
              offerStyles.pulseRing,
              { borderColor: colors.warning, transform: [{ scale: pulse }] },
            ]}>
              <Ionicons name="car" size={26} color={colors.warning} />
            </Animated.View>
            <View style={{ flex: 1 }}>
              <Text style={[offerStyles.headerTitle, { color: colors.foreground }]}>
                {queueMode ? 'Job Offer (Queue)' : 'Job Offer'}
              </Text>
              <Text style={[offerStyles.headerSub, { color: colors.mutedForeground }]}>
                {queueMode ? 'Added to your queue' : 'New booking from dispatch'}
              </Text>
            </View>
            {hasFare && (
              <View style={[offerStyles.farePill, { borderColor: colors.primary + '55', backgroundColor: colors.primary + '12' }]}>
                <Ionicons name="cash-outline" size={15} color={colors.primary} />
                <Text style={[offerStyles.farePillText, { color: colors.primary }]}>
                  ${job.fare.toFixed(2)}
                </Text>
              </View>
            )}
          </View>

          {/* Passenger */}
          <View style={[offerStyles.section, { borderBottomColor: colors.border }]}>
            <View style={offerStyles.row}>
              <Ionicons name="person" size={14} color={colors.mutedForeground} />
              <Text style={[offerStyles.label, { color: colors.mutedForeground }]}>Passenger</Text>
            </View>
            <Text style={[offerStyles.value, { color: colors.foreground }]}>
              {job.passengerName || 'Passenger'}
            </Text>
            {hasPhone && (
              <Text style={[offerStyles.sub, { color: colors.mutedForeground }]}>{job.passengerPhone}</Text>
            )}
          </View>

          {/* Route */}
          <View style={[offerStyles.section, { borderBottomColor: colors.border }]}>
            <View style={offerStyles.row}>
              <View style={[offerStyles.pinDot, { backgroundColor: '#22c55e' }]} />
              <Text style={[offerStyles.label, { color: colors.mutedForeground }]}>Pickup</Text>
            </View>
            <Text style={[offerStyles.value, { color: colors.foreground }]} numberOfLines={2}>
              {job.pickupAddress || '—'}
            </Text>
            <View style={[offerStyles.row, { marginTop: 10 }]}>
              <View style={[offerStyles.pinDot, { backgroundColor: colors.primary }]} />
              <Text style={[offerStyles.label, { color: colors.mutedForeground }]}>Drop-off</Text>
            </View>
            <Text style={[offerStyles.value, { color: colors.foreground }]} numberOfLines={2}>
              {job.dropAddress || '—'}
            </Text>
          </View>

          {/* Badges */}
          {(isWheelchair || isAcc || payType || isJobPrepaid(job)) && (
            <View style={[offerStyles.badgeRow, { borderBottomColor: colors.border }]}>
              {isWheelchair && (
                <View style={offerStyles.wavBadge}>
                  <Ionicons name="accessibility" size={14} color="#fff" />
                  <Text style={offerStyles.wavBadgeText}>WAV</Text>
                </View>
              )}
              {isAcc && (
                <View style={offerStyles.accBadge}>
                  <Ionicons name="medical" size={13} color="#0369a1" />
                  <Text style={offerStyles.accBadgeText}>ACC</Text>
                </View>
              )}
              {isJobPrepaid(job) ? (
                <View style={[offerStyles.payBadge, { borderColor: '#22c55e88', backgroundColor: '#22c55e18' }]}>
                  <Ionicons name="checkmark-circle" size={13} color="#22c55e" />
                  <Text style={[offerStyles.payBadgeText, { color: '#22c55e' }]}>
                    PAID{payType && payType !== 'cash' ? ` • ${payType.charAt(0).toUpperCase()}${payType.slice(1)}` : ''}
                  </Text>
                </View>
              ) : payType ? (
                <View style={[offerStyles.payBadge, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[offerStyles.payBadgeText, { color: colors.mutedForeground }]}>
                    {payType.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Notes */}
          {hasNotes && (
            <View style={[offerStyles.notesBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Ionicons name="document-text-outline" size={15} color={colors.mutedForeground} />
              <Text style={[offerStyles.notesText, { color: colors.foreground }]}>{job.notes}</Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={[offerStyles.btnRow, { paddingBottom: botPad + 4 }]}>
            <TouchableOpacity
              style={[offerStyles.rejectBtn, { borderColor: colors.error }]}
              onPress={onReject}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle" size={20} color={colors.error} />
              <Text style={[offerStyles.rejectText, { color: colors.error }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[offerStyles.acceptBtn, { backgroundColor: queueMode ? colors.primary : '#22c55e' }]}
              onPress={onAccept}
              activeOpacity={0.85}
            >
              <Ionicons name={queueMode ? 'time' : 'checkmark-circle'} size={20} color="#fff" />
              <Text style={offerStyles.acceptText}>
                {queueMode ? 'Add to Queue' : 'Accept Job'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Sub-tab bar ───────────────────────────────────────────────────────────────
type SubTab = 'current' | 'offers' | 'queue' | 'hail';

function SubTabBar({
  activeTab, onChange, offersCount, queueCount, hailRunning, dispatchRunning, colors,
}: {
  activeTab: SubTab; onChange: (t: SubTab) => void;
  offersCount: number; queueCount: number;
  hailRunning: boolean; dispatchRunning: boolean;
  colors: any;
}) {
  const tabs: { key: SubTab; label: string; icon: string; badge?: number; dot?: boolean }[] = [
    { key: 'current', label: 'Current', icon: 'navigate-outline', dot: dispatchRunning },
    { key: 'offers',  label: 'Offers',  icon: 'radio-outline',    badge: offersCount },
    { key: 'queue',   label: 'Queue',   icon: 'time-outline',     badge: queueCount },
    { key: 'hail',    label: 'Hail',    icon: 'hand-left-outline', dot: hailRunning },
  ];
  return (
    <View style={[subTabStyles.bar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {tabs.map(t => {
        const active = activeTab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[subTabStyles.tab, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.7}
          >
            <View style={subTabStyles.tabInner}>
              <Ionicons
                name={t.icon as any}
                size={16}
                color={active ? colors.primary : colors.mutedForeground}
              />
              <Text style={[subTabStyles.tabText, { color: active ? colors.primary : colors.mutedForeground }]}>
                {t.label}
              </Text>
              {(t.badge ?? 0) > 0 && (
                <View style={[subTabStyles.badge, { backgroundColor: colors.warning }]}>
                  <Text style={subTabStyles.badgeText}>{t.badge}</Text>
                </View>
              )}
              {t.dot && !(t.badge && t.badge > 0) && (
                <View style={[subTabStyles.dot, { backgroundColor: '#ef4444' }]} />
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function MeterScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const botPad  = Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16);
  const router  = useRouter();
  const { driver } = useAuth();

  const {
    shiftActive, currentShift, startShift, endShift,
    currentJob, hailTripMeta,
    meterRunning, meterPaused,
    meterIsWaiting,
    startMeter, pauseMeter, cancelTrip,
    completeJob, recallJob,
    availableTariffs, activeTariff, setActiveTariff,
    getLastGpsPosition,
    offeredJobs, queuedJobs,
    acceptJob, acceptJobToQueue, rejectJob,
    status, setStatus,
    completedJobs,
    todayBreakMs,
    shiftBlocked,
    getMeterSnapshot,
  } = useDriver();
  // v12-ota18: sync state in dedicated context.
  const { pendingUploadCount } = useDriverSync();
  // v12-ota16: fleet/zone moved to dedicated context — see home.tsx for rationale.
  const { onlineDrivers, myZoneInfo } = useDriverFleet();
  // v12-ota14: NO useDriverTick here — leaf components subscribe instead so
  // this screen (and all its buttons: accept / start meter / complete / sign-out)
  // stops re-rendering every second. Snapshot getter is for click-time captures.

  // ── Sub-tab state ────────────────────────────────────────────────────────────
  // v22x: lazy-init based on state so we land on Hail only when there's no
  // active dispatch job / hail trip. Avoids 22w's regression where defaulting
  // to 'hail' mounted MeterPanel before driver data was ready (suspected
  // cause of the "tap anywhere crashes" report).
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(() => {
    if (currentJob) return 'current';
    if (hailTripMeta) return 'hail';
    return 'current';
  });

  // OTA20: Dashboard "Hail a Passenger" button routes here with ?openHail=1
  // Land directly on the Hail sub-tab AND auto-open the start modal so the
  // driver only needs ONE tap (not three) to start a hail trip.
  // v12-ota22: ALSO auto-route to Hail sub-tab + auto-open the start modal
  // whenever the Meter tab is opened with no active dispatch job and no
  // active hail trip — previously a fresh tap on the Meter bottom-bar tab
  // landed on the Current sub-tab (empty state) requiring 3 more taps to
  // start a hail. Now: tap Meter tab → modal opens directly.
  const params = useLocalSearchParams<{ openHail?: string }>();
  const [autoOpenHail, setAutoOpenHail] = useState(false);
  useEffect(() => {
    if (params.openHail === '1') {
      setActiveSubTab('hail');
      setAutoOpenHail(true);
      router.setParams({ openHail: undefined });
    }
  }, [params.openHail]); // eslint-disable-line
  // v12-ota22d: REVERTED the broad auto-open useEffect from ota22 — it was
  // popping the hail modal every time a dispatch trip completed (currentJob
  // clears → effect fires → modal opens). The Dashboard "Hail a Passenger"
  // button still routes here with ?openHail=1 for the 1-tap path. From the
  // Meter tab itself, the driver explicitly chooses Hail sub-tab if they want.

  // ── Offer dismiss (so modal doesn't re-show after reject) ───────────────────
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const activeOffer = offeredJobs.find(j => !dismissedIds.has(j.id)) ?? null;

  // ── Geocoded pickup coords for distance-to-driver display in Offers tab ──────
  const [offerPickupCoords, setOfferPickupCoords] = useState<Record<string, { lat: number; lng: number } | null>>({});
  useEffect(() => {
    const newIds = offeredJobs.map(j => j.id).filter(id => !(id in offerPickupCoords));
    if (!newIds.length) return;
    newIds.forEach(id => {
      const job = offeredJobs.find(j => j.id === id);
      if (!job?.pickupAddress) {
        setOfferPickupCoords(prev => ({ ...prev, [id]: null }));
        return;
      }
      geocode(job.pickupAddress).then(coords => {
        setOfferPickupCoords(prev => ({ ...prev, [id]: coords }));
      });
    });
  }, [offeredJobs.map(j => j.id).join(',')]); // eslint-disable-line

  // ── Dispatch trip state ──────────────────────────────────────────────────────
  const [arrivedAtPickup, setArrivedAtPickup] = useState(
    () => (myZoneInfo?.vehicleStatus ?? '') === 'Arrived',
  );
  // v12-ota22i: explicit "Passenger On Board" step between Arrived and meter
  // start. Driver-requested flow: Accept → On the way → Arrived → Passenger
  // On Board → THEN meter starts (or fixed-price Complete shows). Previously
  // Arrived went straight to a combo "Passenger On Board — Start Meter"
  // button, so the meter could start before the passenger was actually in.
  const [passengerOnBoard, setPassengerOnBoard] = useState(false);
  const arrivedAtMsRef   = useRef<number | null>(null);
  const meterStartMsRef  = useRef<number | null>(null);
  const [pickupCoords,   setPickupCoords]   = useState<{ lat: number; lng: number } | null>(null);
  const [dropCoords,     setDropCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [fallbackPos,    setFallbackPos]    = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding,      setGeocoding]      = useState(false);
  const lastGpsRef  = useRef<{ lat: number; lng: number } | null>(null);
  // v12-ota14: driver dot rendered by <LiveDriverMap> leaf which subscribes
  // to GPS internally; this screen no longer re-renders on GPS updates.

  // ── Tariff picker ────────────────────────────────────────────────────────────
  const [tariffPickerVisible, setTariffPickerVisible] = useState(false);
  const [pendingTariff, setPendingTariff] = useState(activeTariff);

  // ── Completion modal ─────────────────────────────────────────────────────────
  const [completeModalVisible, setCompleteModalVisible] = useState(false);
  const [completing,   setCompleting]   = useState(false);
  // v12-ota22b: jobId-keyed idempotency guard so a tap can never schedule
  // completeJob twice (architect-flagged race in the dispatch path).
  const completionInFlightRef = useRef<string | null>(null);
  const [paymentData,  setPaymentData]  = useState<PaymentData>({ type: 'cash' });
  // v22c-d4: hydrate paymentData.type from AsyncStorage on mount so the
  // completion modal pre-selects whatever payment type the driver used last.
  // Only restores cash/eftpos/card/gift_card (TM/ACC/Account need per-trip data
  // so they stay opt-in). Persists on every user change via the effect below.
  const paymentHydratedRef = useRef(false);
  useEffect(() => {
    if (paymentHydratedRef.current) return;
    paymentHydratedRef.current = true;
    (async () => {
      try {
        const { getLastPaymentType } = await import('@/lib/lastPickerDefaults');
        const last = await getLastPaymentType('cash');
        if (last && last !== 'cash') {
          setPaymentData(prev => prev.type === 'cash' ? { ...prev, type: last } : prev);
        }
      } catch {}
    })();
  }, []);
  useEffect(() => {
    if (!paymentHydratedRef.current) return;
    (async () => {
      try {
        const { saveLastPaymentType } = await import('@/lib/lastPickerDefaults');
        await saveLastPaymentType(paymentData.type);
      } catch {}
    })();
  }, [paymentData.type]);
  const [dropAddress,  setDropAddress]  = useState('');
  // v22bm: per-trip extras picked on completion modal (airport / bike / bag / EFTPOS / etc.)
  const [tripExtras,   setTripExtras]   = useState<ExtraItem[]>([]);
  const [extrasTotal,  setExtrasTotal]  = useState(0);
  const [dropGpsLoad,  setDropGpsLoad]  = useState(false);
  const snapRef = useRef({ fare: 0, dist: 0, secs: 0 });
  const finalWaitingCostRef = useRef(0);
  const completionPausedRef = useRef(false);

  // ── Home (idle) map state ────────────────────────────────────────────────────
  // v12-ota14: driver dot rendered by <LiveDriverMap> leaf.
  const [homeFallbackPos, setHomeFallbackPos] = useState<{ lat: number; lng: number } | null>(null);
  const homeLatLngRef  = useRef<{ lat: number; lng: number } | null>(null);

  // ── Zone wait timer ──────────────────────────────────────────────────────────
  const [zoneWaitSecs, setZoneWaitSecs] = useState(0);
  const zoneWaitIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const isHailTrip     = !!hailTripMeta;
  const isDispatchTrip = !!currentJob && !isHailTrip;
  // Driver is busy from job acceptance through to trip completion — suppress popup
  // modal so offers land silently in the Offers tab with a badge instead.
  // Uses Firebase-backed state (currentJob / hailTripMeta) so the guard survives
  // app restarts and Metro reloads — unlike the in-memory meterRunning flag.
  const isBusyOnTrip = isHailTrip || isDispatchTrip;
  const missingVehicle = !driver?.vehicleId;
  const todayEarnings  = completedJobs.reduce((s, j) => s + j.fare, 0);
  const driverName     = driver?.name && !driver.name.includes('@')
    ? driver.name.split(' ')[0]
    : driver?.email?.split('@')[0] ?? 'Driver';

  // ── Dispatch trip derived values ─────────────────────────────────────────────
  // Meterless = fare is pre-determined and payment is already arranged (no meter needed).
  // Must meter = driver collects payment at destination (cash, eftpos, gift_card) or card
  // without a pre-quoted fare (driver needs the meter to know what to charge).
  const _pm         = (currentJob?.jobPaymentMethod ?? '').toLowerCase();
  const _isMeterlessType = (pm: string) =>
    ['online', 'stripe', 'account', 'total_mobility', 'acc'].includes(pm) ||
    (pm === 'card' && (currentJob?.fare ?? 0) > 0);
  const isMeterless   = !!currentJob && _isMeterlessType(_pm);
  const isCashOrBlank = !_pm || _pm === 'cash';
  const hasFare       = currentJob ? currentJob.fare > 0 : false;
  const meterlessLabel = isMeterless && !meterRunning
    ? (_pm === 'account'         ? 'Account job — no meter required'
     : _pm === 'total_mobility'  ? 'Total Mobility — no meter required'
     : _pm === 'acc'             ? 'ACC claim — no meter required'
     : (_pm === 'online' || _pm === 'stripe') ? 'Pre-paid online — no meter required'
     : 'Fixed price — no meter required')
    : '';
  const isCurrentJobPrepaid = isJobPrepaid(currentJob);

  // ── Auto-switch sub-tabs ─────────────────────────────────────────────────────
  useEffect(() => {
    if (currentJob) setActiveSubTab('current');
  }, [currentJob?.id]); // eslint-disable-line

  useEffect(() => {
    if (hailTripMeta) setActiveSubTab('hail');
  }, [!!hailTripMeta]); // eslint-disable-line

  // ── Sync arrivedAtPickup from Firebase presence ──────────────────────────────
  useEffect(() => {
    if ((myZoneInfo?.vehicleStatus ?? '') === 'Arrived' && !meterRunning) {
      setArrivedAtPickup(true);
    }
  }, [myZoneInfo?.vehicleStatus]); // eslint-disable-line

  // ── Reset when dispatch job changes ─────────────────────────────────────────
  useEffect(() => {
    if (!currentJob) {
      setPassengerOnBoard(false);
      setArrivedAtPickup(false);
      arrivedAtMsRef.current  = null;
      meterStartMsRef.current = null;
      setPickupCoords(null);
      setDropCoords(null);
      setFallbackPos(null);
      return;
    }
    let cancelled = false;
    setGeocoding(true);
    (async () => {
      const [pickup, drop] = await Promise.all([
        geocode(currentJob.pickupAddress),
        geocode(currentJob.dropAddress),
      ]);
      if (cancelled) return;
      setPickupCoords(pickup);
      setDropCoords(drop);
      // Seed driver dot from cached fix for instant first paint (no GPS-lock wait).
      // Live updates handled by <LiveDriverMap> leaf subscribing to currentGps.
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
        if (!cancelled && last) {
          const lat = last.coords.latitude, lng = last.coords.longitude;
          lastGpsRef.current = { lat, lng };
          setFallbackPos({ lat, lng });
        }
      } catch {}
      if (!cancelled) setGeocoding(false);
    })();
    return () => { cancelled = true; };
  }, [currentJob?.id]); // eslint-disable-line

  // ── (NativeMap auto-switches via the `phase` prop — no rebuild needed) ──────

  // ── Home (idle) map seed (cached fix only — live updates via leaf) ──────────
  useEffect(() => {
    if (!shiftActive || isDispatchTrip) { setHomeFallbackPos(null); return; }
    if (getLastGpsPosition()) return;
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
  }, [shiftActive, isDispatchTrip]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zone wait timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (zoneWaitIntervalRef.current) { clearInterval(zoneWaitIntervalRef.current); zoneWaitIntervalRef.current = null; }
    const assignedAt = myZoneInfo?.zoneAssignedAt;
    if (!assignedAt) { setZoneWaitSecs(0); return; }
    setZoneWaitSecs(Math.floor((Date.now() - assignedAt) / 1000));
    zoneWaitIntervalRef.current = setInterval(
      () => setZoneWaitSecs(Math.floor((Date.now() - assignedAt) / 1000)), 1000,
    );
    return () => { if (zoneWaitIntervalRef.current) clearInterval(zoneWaitIntervalRef.current); };
  }, [myZoneInfo?.zoneAssignedAt]); // eslint-disable-line

  // ── Shift handlers ───────────────────────────────────────────────────────────
  const handleShiftToggle = () => {
    if (shiftActive) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        'End Shift',
        `Jobs: ${completedJobs.length}  ·  Earnings: $${todayEarnings.toFixed(2)}\n\nAre you sure you want to end your shift?`,
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

  // ── Offer handlers ───────────────────────────────────────────────────────────
  const handleAcceptOffer = (job: Job) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (meterRunning) acceptJobToQueue(job);
    else acceptJob(job);
    setDismissedIds(prev => new Set([...prev, job.id]));
  };

  const handleRejectOffer = (job: Job) => {
    Alert.alert('Reject Job', 'Are you sure you want to reject this job offer?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive', onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          rejectJob(job.id);
          setDismissedIds(prev => new Set([...prev, job.id]));
        },
      },
    ]);
  };

  // ── Dispatch trip handlers ───────────────────────────────────────────────────
  const handleArrived = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    arrivedAtMsRef.current = Date.now();
    setArrivedAtPickup(true);
    const cid = driver?.companyId ?? '';
    const vid = driver?.vehicleId ?? '';
    if (cid && vid) {
      update(ref(database, `online/${cid}/${vid}/current`), { vehiclestatus: 'Arrived' }).catch(() => {});
    }
    const jobKey = currentJob?.bookingId ?? currentJob?.id ?? '';
    if (jobKey && driver?.companyId && driver?.id) {
      try {
        // OTA21: use shared GPS instead of awaiting a one-shot fix.
        // The shared GPS watcher always has a recent position; getCurrentPositionAsync
        // can take 5-10s on Android with the screen warming up the radio.
        const gps = getLastGpsPosition();
        if (gps) setPickupCoords({ lat: gps.lat, lng: gps.lng });
        appendJournalEntry({
          jobId: jobKey, companyId: driver.companyId, driverId: driver.id,
          vehicleId: driver.vehicleId ?? '', eventType: 'Arrived',
          timestamp: new Date().toISOString(),
          lat: gps?.lat ?? 0, lng: gps?.lng ?? 0,
          meta: { pickupAddress: currentJob?.pickupAddress },
        }).catch(() => {});
      } catch {}
    }
  };

  // v12-ota22i: explicit "Passenger On Board" step. Just sets local state +
  // best-effort Firebase status. Meter does NOT start here — driver still
  // taps "Start Meter" (or "Complete Trip" for fixed-price jobs) after this.
  const handlePassengerOnBoard = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPassengerOnBoard(true);
    const cid = driver?.companyId ?? '';
    const vid = driver?.vehicleId ?? '';
    if (cid && vid) {
      update(ref(database, `online/${cid}/${vid}/current`), { vehiclestatus: 'OnBoard' }).catch(() => {});
    }
    const jobKey = currentJob?.bookingId ?? currentJob?.id ?? '';
    if (jobKey && driver?.companyId && driver?.id) {
      const gps = getLastGpsPosition();
      appendJournalEntry({
        jobId: jobKey, companyId: driver.companyId, driverId: driver.id,
        vehicleId: driver.vehicleId ?? '', eventType: 'PassengerOnBoard',
        timestamp: new Date().toISOString(),
        lat: gps?.lat ?? 0, lng: gps?.lng ?? 0,
      }).catch(() => {});
    }
  };

  const handleStartMeter = () => {
    setPendingTariff(activeTariff);
    setTariffPickerVisible(true);
  };

  const handleTariffConfirm = () => {
    setActiveTariff(pendingTariff);
    setTariffPickerVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    meterStartMsRef.current = Date.now();
    startMeter();
  };

  const handleOpenComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const _pm2 = (currentJob?.jobPaymentMethod ?? '').toLowerCase();
    const _isMeterless2 =
      !!currentJob && (
        ['online', 'stripe', 'account', 'total_mobility', 'acc'].includes(_pm2) ||
        (_pm2 === 'card' && (currentJob?.fare ?? 0) > 0)
      );

    // Auto-select payment type from the job's declared payment method
    const _autoPayment = () => {
      if (['card', 'stripe', 'online'].includes(_pm2))  setPaymentData({ type: 'card' });
      else if (_pm2 === 'account')                       setPaymentData({ type: 'account' });
      else if (_pm2 === 'total_mobility')                setPaymentData({ type: 'total_mobility' });
      else if (_pm2 === 'acc')                           setPaymentData({ type: 'acc' });
      else                                               setPaymentData({ type: 'card' }); // prepaid fallback
    };

    // Open the complete modal + background reverse-geocode for drop address.
    // OTA21: prefer shared GPS (instant); only fall back to a one-shot fix if
    // the shared watcher hasn't produced a position yet.
    const _openModal = () => {
      setDropAddress('');
      // v22bm: reset extras for each new completion
      setTripExtras([]);
      setExtrasTotal(0);
      setCompleteModalVisible(true);
      setDropGpsLoad(true);
      (async () => {
        try {
          const shared = getLastGpsPosition();
          if (shared) {
            setDropAddress(await reverseGeocode(shared.lat, shared.lng));
          } else {
            const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
            if (last) {
              setDropAddress(await reverseGeocode(last.coords.latitude, last.coords.longitude));
            }
          }
        } catch {}
        setDropGpsLoad(false);
      })();
    };

    // Path 1: Meterless (account/stripe/TM etc.) — fixed fare, no meter needed
    if (_isMeterless2 && currentJob) {
      snapRef.current = { fare: currentJob.fare, dist: 0, secs: 0 };
      finalWaitingCostRef.current = 0;
      _autoPayment();
      _openModal();
      return;
    }

    // Path 2: Prepaid metered job — meter ran but passenger already paid online
    // Skip the confirmation Alert and go straight to the complete modal
    if (isCurrentJobPrepaid && currentJob) {
      const snap = getMeterSnapshot();
      snapRef.current = { fare: snap.fare, dist: snap.dist, secs: snap.secs };
      finalWaitingCostRef.current = snap.waitingCost;
      if (!meterPaused) { pauseMeter(); completionPausedRef.current = true; }
      _autoPayment();
      _openModal();
      return;
    }

    // Path 3: Normal metered job — go straight to the complete modal.
    // v12-ota22d: removed redundant native Alert. Tapping Complete used to
    // require 3 taps (Complete → Yes Complete alert → Confirm & Complete in
    // modal). The complete modal already shows the fare and has its own
    // confirm button — the alert was duplicate confirmation.
    const snap = getMeterSnapshot();
    snapRef.current = { fare: snap.fare, dist: snap.dist, secs: snap.secs };
    finalWaitingCostRef.current = snap.waitingCost;
    if (!meterPaused) { pauseMeter(); completionPausedRef.current = true; }
    _autoPayment();
    _openModal();
  };

  const handleConfirmComplete = async () => {
    if (completing || !currentJob) return;
    // v12-ota22b idempotency: hard-block re-entry for THIS jobId so a stuck
    // tap can never schedule completeJob twice (architect-flagged race).
    if (completionInFlightRef.current === currentJob.id) return;
    // v22bo: split-payment validation gate — block confirm when the parts
    // don't add up to the fare. Architect-flagged: silent UI text only is
    // not enough; we must hard-stop submission of malformed totals.
    if (paymentData.type === 'split') {
      const _parts = paymentData.splitParts ?? [];
      const _sum   = _parts.reduce((a, p) => a + (Number.isFinite(p.amount) ? p.amount : 0), 0);
      const _fare  = snapRef.current.fare;
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
    completionInFlightRef.current = currentJob.id;
    setCompleting(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const fare   = snapRef.current.fare;
      const dist   = snapRef.current.dist;
      const secs   = snapRef.current.secs;
      const arrivedMs  = arrivedAtMsRef.current;
      const pickedUpMs = meterStartMsRef.current ?? Date.now();
      const waitingMins = arrivedMs
        ? parseFloat((Math.max(0, pickedUpMs - arrivedMs) / 60000).toFixed(1)) : 0;
      const waitingCost = parseFloat(finalWaitingCostRef.current.toFixed(2));
      // For meterless (pre-paid) jobs the fare is a fixed quote — there is no flagFall or
      // distance breakdown to subtract.  Use 0 / fare so SA portal doesn't get wrong numbers.
      const _pmFin   = (currentJob?.jobPaymentMethod ?? '').toLowerCase();
      const _isMeterlessFin =
        ['online', 'stripe', 'account', 'total_mobility', 'acc'].includes(_pmFin) ||
        (_pmFin === 'card' && (currentJob?.fare ?? 0) > 0);
      const flagFall = _isMeterlessFin ? 0 : activeTariff.flagFall;
      const rideCost = _isMeterlessFin
        ? parseFloat(fare.toFixed(2))
        : parseFloat(Math.max(0, fare - waitingCost - flagFall).toFixed(2));
      const dropPos     = getLastGpsPosition();
      const extras: JobCompletionExtras = {
        tariffName: activeTariff.name, waitingMins, waitingCost, rideCost, flagFall,
        arrivedAt:  arrivedMs ? new Date(arrivedMs).toISOString() : undefined,
        pickedUpAt: meterStartMsRef.current ? new Date(meterStartMsRef.current).toISOString() : undefined,
        dropLatLng: dropPos ? `${dropPos.lat.toFixed(6)},${dropPos.lng.toFixed(6)}` : undefined,
        distanceKm: parseFloat(dist.toFixed(3)),
        pickupLat: pickupCoords?.lat, pickupLng: pickupCoords?.lng,
        dropLat: dropPos?.lat, dropLng: dropPos?.lng,
        dropAddress: dropAddress.trim() || undefined,
        driverCost: parseFloat(fare.toFixed(2)),
        ...(paymentData.type === 'total_mobility' ? {
          tmVoucherNo: paymentData.tmVoucherNo, tmPassengerName: paymentData.tmPassengerName,
          tmTripCategory: paymentData.tmTripCategory, tmPassengerPays: paymentData.tmPassengerPays,
        } : {}),
        ...(paymentData.type === 'card' ? {
          cardLastFour: paymentData.cardLastFour, cardHolder: paymentData.cardHolder,
          cardExpiry: paymentData.cardExpiry, cardBrand: paymentData.cardBrand,
          stripePaymentIntentId: paymentData.stripePaymentIntentId,
          stripeCharged: paymentData.stripeCharged,
        } : {}),
        ...(paymentData.type === 'account' ? {
          accClientRef: paymentData.accClientRef, accClientId: paymentData.accClientId,
          accResolvedName: paymentData.accResolvedName, accClaimNo: paymentData.accClaimNo,
          accPoNumber: paymentData.accPoNumber,
        } : {}),
        // v22bm: driver-picked extras on completion modal — must reference
        // STATE `tripExtras`, not the local `extras` const being initialized
        // (architect-flagged TDZ self-reference would crash on completion).
        extrasItems: tripExtras,
        extrasTotal,
        // v22bo: split-payment parts (when passenger pays across methods).
        paymentSplits: paymentData.type === 'split' ? paymentData.splitParts : undefined,
        accPercentPaid: paymentData.accPercentPaid,
        // v22bo fix (architect): completion-time chosen payment method must
        // override the offer-time job.paymentType so PaymentType on the
        // dispatch record + sync POST matches what the driver actually took.
        paymentType: paymentData.type as any,
      };
      // v12-ota22 OPTIMISTIC-CLOSE: close modal FIRST so the UI bounces
      // instantly. Run completeJob in the background and swallow any rejection
      // so an unhandled promise rejection can't crash the app.
      // v12-ota22b: setCompleting(false) MOVED into the deferred .finally so
      // the button stays disabled until the completion call has actually been
      // dispatched and settled — fixes architect-flagged duplicate-submit race.
      setCompleteModalVisible(false);
      const _id = currentJob.id;
      // v22bm: add extras to fare total before sending to completeJob — keeps
      // fare.total = base + distance + waiting + extras for the audit POST.
      const _fareWithExtras = parseFloat((fare + extrasTotal).toFixed(2));
      setTimeout(() => {
        Promise.resolve()
          .then(() => completeJob(_id, _fareWithExtras, extras))
          .catch((err: any) => {
            console.error('[Meter] completeJob failed (background):', err);
          })
          .finally(() => {
            setCompleting(false);
            // Clear idempotency guard once the call has settled so a NEW job
            // (different ID) can complete normally later in the session.
            if (completionInFlightRef.current === _id) {
              completionInFlightRef.current = null;
            }
          });
      }, 0);
    } catch (err) {
      // Synchronous throw before defer — release guards immediately.
      setCompleting(false);
      completionInFlightRef.current = null;
      throw err;
    }
  };

  const handleRecall = () => {
    Alert.alert(
      'Release Job',
      `Release "${currentJob?.passengerName}" back to dispatch?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Release', style: 'destructive', onPress: () => recallJob(currentJob!.id) },
      ],
    );
  };

  const handleCancelTrip = () => {
    Alert.alert('Cancel Trip', 'Stop the meter and cancel? The job will stay open.', [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'Cancel Trip', style: 'destructive', onPress: cancelTrip },
    ]);
  };

  // ── OFF SHIFT SCREEN ─────────────────────────────────────────────────────────
  if (!shiftActive) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={styles.topHeader}>
          <View style={styles.topHeaderLeft}>
            {!!driver?.vehicleId && (
              <View style={[styles.vehicleBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}>
                <Ionicons name="car" size={12} color={colors.primary} />
                <Text style={[styles.vehicleBadgeText, { color: colors.primary }]}>{driver.vehicleId}</Text>
              </View>
            )}
            <Text style={[styles.driverName, { color: colors.foreground }]}>Hi, {driverName}</Text>
          </View>
        </View>

        {/* Alert banners */}
        {driver?.active === false && (
          <View style={[styles.alertBanner, { backgroundColor: '#dc262618', borderColor: '#dc2626' }]}>
            <Ionicons name="ban-outline" size={16} color="#dc2626" />
            <Text style={[styles.alertText, { color: '#dc2626', flex: 1 }]}>Account deactivated — contact your fleet admin</Text>
          </View>
        )}
        {missingVehicle && driver?.active !== false && (
          <TouchableOpacity
            style={[styles.alertBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}
            onPress={() => router.push('/(tabs)/profile')}
            activeOpacity={0.8}
          >
            <Ionicons name="warning-outline" size={16} color={colors.warning} />
            <Text style={[styles.alertText, { color: colors.warning, flex: 1 }]}>No vehicle set — tap to fix in Profile</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.warning} />
          </TouchableOpacity>
        )}

        {/* Off-shift card */}
        <View style={[styles.offShiftBox, { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: botPad + 16 }]}>
          <View style={[styles.offShiftIcon, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
            <Ionicons name="car-outline" size={48} color={colors.primary} />
          </View>
          <Text style={[styles.offShiftTitle, { color: colors.foreground }]}>You're Off Shift</Text>
          <Text style={[styles.offShiftSub, { color: colors.mutedForeground }]}>
            {driver?.active === false
              ? 'Your account is deactivated. Contact your fleet administrator.'
              : shiftBlocked
              ? (shiftBlocked as any).reason
              : 'Start a shift to go online and receive job offers from dispatch.'}
          </Text>

          {/* Start shift button */}
          {driver?.active !== false && (
            <TouchableOpacity
              style={[
                styles.startShiftBtn,
                {
                  backgroundColor: shiftBlocked ? colors.mutedForeground : colors.success,
                  opacity: shiftBlocked ? 0.6 : 1,
                },
              ]}
              onPress={shiftBlocked
                ? () => Alert.alert('Cannot Start Shift', (shiftBlocked as any).reason)
                : handleShiftToggle}
              activeOpacity={0.85}
            >
              <Ionicons name="play-circle" size={28} color="#fff" />
              <Text style={styles.startShiftBtnText}>Start Shift</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── ON SHIFT: compliance strip value ────────────────────────────────────────
  const workMs = currentShift?.startMs
    ? Math.max(0, Date.now() - currentShift.startMs - (todayBreakMs ?? 0))
    : 0;
  const compliancePct  = Math.min(1, workMs / DAILY_LIMIT_MS);
  const complianceWarn = compliancePct > 0.85;

  // ── ON SHIFT RENDER ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>

      {/* 22bo-fix4: per-screen JobOfferModal REMOVED — was double-popping
          alongside the global IncomingJobAlert. Single source of truth =
          GlobalJobAlert in app/_layout.tsx. */}

      {/* ── Tariff Picker ── */}
      <TariffPicker
        visible={tariffPickerVisible}
        tariffs={availableTariffs}
        selected={pendingTariff}
        onSelect={setPendingTariff}
        onConfirm={handleTariffConfirm}
        onClose={() => setTariffPickerVisible(false)}
        title="Select Tariff"
        confirmLabel="Start Meter"
      />

      {/* ── Completion Modal ── */}
      <Modal
        visible={completeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (completionPausedRef.current) { pauseMeter(); completionPausedRef.current = false; }
          setCompleteModalVisible(false);
        }}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: botPad + 8 }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: '#22c55e22' }]}>
                <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
              </View>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Complete Trip</Text>
              <TouchableOpacity
                onPress={() => {
                  if (completionPausedRef.current) { pauseMeter(); completionPausedRef.current = false; }
                  setCompleteModalVisible(false);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {/* v22x: STICKY fare summary above the ScrollView. Previously this
                lived inside the ScrollView so on TM trips (which have a long
                payment section) the fare/distance/time scrolled out of view
                and the driver couldn't see the trip totals while filling in
                the TM passenger details. */}
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
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>DROP-OFF LOCATION</Text>
              <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="flag" size={18} color={colors.error} />
                {dropGpsLoad ? (
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Getting location…</Text>
                  </View>
                ) : (
                  <TextInput
                    style={[styles.textInput, { color: colors.foreground }]}
                    placeholder="Drop-off address"
                    placeholderTextColor={colors.mutedForeground}
                    value={dropAddress}
                    onChangeText={setDropAddress}
                    multiline
                  />
                )}
              </View>
              {/* v22bm: Extras section — shown for every non-prepaid trip so
                  the driver can add airport / bike / bag / EFTPOS surcharge /
                  cleaning / other amounts before settling payment. */}
              {!isCurrentJobPrepaid && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>EXTRAS (OPTIONAL)</Text>
                  <ExtrasPicker
                    value={tripExtras}
                    onChange={(items, total) => { setTripExtras(items); setExtrasTotal(total); }}
                    fare={snapRef.current.fare}
                  />
                  {extrasTotal > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      marginTop: 6, marginBottom: 4, paddingVertical: 8, paddingHorizontal: 12,
                      backgroundColor: colors.primary + '14', borderColor: colors.primary + '44',
                      borderWidth: 1, borderRadius: 10 }}>
                      <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 12 }}>
                        Fare ${snapRef.current.fare.toFixed(2)} + Extras ${extrasTotal.toFixed(2)}
                      </Text>
                      <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold', fontSize: 16 }}>
                        ${(snapRef.current.fare + extrasTotal).toFixed(2)}
                      </Text>
                    </View>
                  )}
                </>
              )}
              {isCurrentJobPrepaid ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8,
                  backgroundColor: '#22c55e18', borderColor: '#22c55e55', borderWidth: 1,
                  borderRadius: 12, padding: 14 }}>
                  <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#22c55e', fontFamily: 'Inter_700Bold', fontSize: 15 }}>
                      Already Paid
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 }}>
                      {currentJob?.jobPaymentMethod
                        ? `Via ${currentJob.jobPaymentMethod.charAt(0).toUpperCase()}${currentJob.jobPaymentMethod.slice(1)}`
                        : 'Pre-paid — no collection needed'}
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PAYMENT TYPE</Text>
                  <PaymentCapture
                    value={paymentData}
                    onChange={setPaymentData}
                    fare={parseFloat((snapRef.current.fare + extrasTotal).toFixed(2))}
                    companyId={driver?.companyId}
                  />
                </>
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.backBtn, { borderColor: colors.border }]}
                onPress={() => {
                  if (completionPausedRef.current) { pauseMeter(); completionPausedRef.current = false; }
                  setCompleteModalVisible(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.backBtnText, { color: colors.mutedForeground }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: '#22c55e' }]}
                onPress={instrumentTap('confirmComplete', handleConfirmComplete)}
                disabled={completing}
                activeOpacity={0.85}
              >
                {completing ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={22} color="#fff" />
                    <Text style={styles.confirmBtnText}>Confirm & Complete</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Top Header ── */}
      <View style={styles.topHeader}>
        <View style={styles.topHeaderLeft}>
          {!!driver?.vehicleId && (
            <View style={[styles.vehicleBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}>
              <Ionicons name="car" size={12} color={colors.primary} />
              <Text style={[styles.vehicleBadgeText, { color: colors.primary }]}>{driver.vehicleId}</Text>
            </View>
          )}
          <Text style={[styles.driverName, { color: colors.foreground }]}>{driverName}</Text>
          {currentShift?.startTime && (
            <Text style={[styles.shiftSince, { color: colors.mutedForeground }]}>since {currentShift.startTime}</Text>
          )}
        </View>
        <View style={styles.topHeaderRight}>
          {/* Available / Away toggle */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setStatus(status === 'Away' ? 'Available' : 'Away');
            }}
            activeOpacity={0.75}
          >
            <View style={[
              styles.statusPill,
              {
                backgroundColor: status === 'Away' ? '#f59e0b18' : '#22c55e18',
                borderColor:     status === 'Away' ? '#f59e0b'   : '#22c55e',
              },
            ]}>
              <View style={[styles.statusDot, { backgroundColor: status === 'Away' ? '#f59e0b' : '#22c55e' }]} />
              <Text style={[styles.statusText, { color: status === 'Away' ? '#f59e0b' : '#22c55e' }]}>
                {status === 'Away' ? 'Away' : 'Available'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* End shift */}
          <TouchableOpacity
            style={[styles.endShiftBtn, { borderColor: colors.error + '55', backgroundColor: colors.error + '10' }]}
            onPress={handleShiftToggle}
            activeOpacity={0.8}
          >
            <Ionicons name="stop-circle" size={16} color={colors.error} />
            <Text style={[styles.endShiftText, { color: colors.error }]}>End</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Alert banners ── */}
      {driver?.active === false && (
        <View style={[styles.alertBanner, { backgroundColor: '#dc262618', borderColor: '#dc2626' }]}>
          <Ionicons name="ban-outline" size={15} color="#dc2626" />
          <Text style={[styles.alertText, { color: '#dc2626', flex: 1 }]}>Account deactivated — contact admin</Text>
        </View>
      )}
      {missingVehicle && driver?.active !== false && (
        <TouchableOpacity
          style={[styles.alertBanner, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.8}
        >
          <Ionicons name="warning-outline" size={15} color={colors.warning} />
          <Text style={[styles.alertText, { color: colors.warning, flex: 1 }]}>No vehicle set — tap to fix</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.warning} />
        </TouchableOpacity>
      )}
      {status === 'Away' && (
        <View style={[styles.alertBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
          <Ionicons name="pause-circle-outline" size={15} color="#f59e0b" />
          <Text style={[styles.alertText, { color: '#f59e0b', flex: 1 }]}>You're Away — not visible to dispatch</Text>
          <TouchableOpacity
            style={[styles.makeAvailBtn, { backgroundColor: '#22c55e' }]}
            onPress={() => setStatus('Available')}
          >
            <Text style={styles.makeAvailText}>Go Available</Text>
          </TouchableOpacity>
        </View>
      )}
      {pendingUploadCount > 0 && (
        <View style={[styles.alertBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b' }]}>
          <Ionicons name="cloud-upload-outline" size={15} color="#f59e0b" />
          <Text style={[styles.alertText, { color: '#f59e0b', flex: 1 }]}>
            {pendingUploadCount} trip{pendingUploadCount !== 1 ? 's' : ''} pending upload
          </Text>
        </View>
      )}

      {/* ── Stats strip ── */}
      <View style={[styles.statsStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.primary }]}>${todayEarnings.toFixed(0)}</Text>
          <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Earnings</Text>
        </View>
        <View style={[styles.statSep, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>{completedJobs.length}</Text>
          <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Jobs Done</Text>
        </View>
        <View style={[styles.statSep, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>{onlineDrivers.length}</Text>
          <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Online</Text>
        </View>
        {workMs > 0 && (
          <>
            <View style={[styles.statSep, { backgroundColor: colors.border }]} />
            <View style={[styles.statItem, { flex: 1.5, gap: 4 }]}>
              <View style={[styles.complianceBar, { backgroundColor: colors.border }]}>
                <View style={[
                  styles.complianceBarFill,
                  {
                    width: `${compliancePct * 100}%` as any,
                    backgroundColor: complianceWarn ? '#ef4444' : colors.primary,
                  },
                ]} />
              </View>
              <Text style={[styles.statLbl, { color: complianceWarn ? '#ef4444' : colors.mutedForeground }]}>
                {fmtMs(Math.max(0, DAILY_LIMIT_MS - workMs))} left
              </Text>
            </View>
          </>
        )}
      </View>

      {/* ── Sub-tab bar ── */}
      <SubTabBar
        activeTab={activeSubTab}
        onChange={setActiveSubTab}
        offersCount={offeredJobs.length}
        queueCount={queuedJobs.length}
        hailRunning={isHailTrip && meterRunning}
        dispatchRunning={isDispatchTrip && meterRunning}
        colors={colors}
      />

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* HAIL sub-tab → MeterPanel handles everything                          */}
      {activeSubTab === 'hail' && (
        <MeterPanel
          autoOpenHail={autoOpenHail}
          onHailModalOpened={() => setAutoOpenHail(false)}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* OFFERS sub-tab                                                         */}
      {activeSubTab === 'offers' && (
        offeredJobs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="radio-outline" size={56} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Pending Offers</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              New job offers from dispatch will appear here automatically.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: botPad + 16 }} showsVerticalScrollIndicator={false}>
            {offeredJobs.map(job => {
              const pickupCoords = offerPickupCoords[job.id];
              const driverGps   = getLastGpsPosition();
              const distKm = (pickupCoords && driverGps)
                ? haversinKm(driverGps.lat, driverGps.lng, pickupCoords.lat, pickupCoords.lng)
                : null;
              const distLabel = distKm != null
                ? distKm < 1 ? `${Math.round(distKm * 1000)} m away` : `${distKm.toFixed(1)} km away`
                : null;
              return (
                <View key={job.id} style={[styles.offerCard, { backgroundColor: colors.card, borderColor: colors.primary + '55' }]}>
                  {/* ── Header row: name + fare + distance pill ── */}
                  <View style={styles.offerCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.offerPassenger, { color: colors.foreground }]}>
                        {job.passengerName || 'Passenger'}
                      </Text>
                      {!!job.passengerPhone && (
                        <Text style={[styles.offerSub, { color: colors.mutedForeground }]}>{job.passengerPhone}</Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {job.fare > 0 && (
                        <Text style={[styles.offerFare, { color: colors.primary }]}>${job.fare.toFixed(2)}</Text>
                      )}
                      {distLabel != null && (
                        <View style={[styles.distPill, { backgroundColor: colors.primary + '18' }]}>
                          <Ionicons name="navigate" size={11} color={colors.primary} />
                          <Text style={[styles.distPillText, { color: colors.primary }]}>{distLabel}</Text>
                        </View>
                      )}
                      {distLabel == null && pickupCoords === undefined && (
                        <Text style={[styles.distPillText, { color: colors.mutedForeground }]}>locating…</Text>
                      )}
                    </View>
                  </View>
                  {/* ── Route box ── */}
                  <View style={[styles.offerRouteBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.routeRow}>
                      <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
                      <Text style={[styles.offerAddr, { color: colors.foreground }]} numberOfLines={1}>
                        {job.pickupAddress || '—'}
                      </Text>
                    </View>
                    <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
                    <View style={styles.routeRow}>
                      <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
                      <Text style={[styles.offerAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {job.dropAddress || '—'}
                      </Text>
                    </View>
                  </View>
                  {/* ── Prepaid badge ── */}
                  {isJobPrepaid(job) && (
                    <View style={[styles.offerMetaRow, { marginTop: 4 }]}>
                      <View style={[styles.offerMetaChip, { backgroundColor: '#22c55e18', borderColor: '#22c55e55', borderWidth: 1 }]}>
                        <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
                        <Text style={[styles.offerMetaText, { color: '#22c55e', fontFamily: 'Inter_600SemiBold' }]}>
                          PAID{job.jobPaymentMethod ? ` • ${job.jobPaymentMethod.charAt(0).toUpperCase()}${job.jobPaymentMethod.slice(1)}` : ''}
                        </Text>
                      </View>
                    </View>
                  )}
                  {/* ── Trip distance / duration from dispatcher ── */}
                  {(!!job.distance || !!job.duration) && (
                    <View style={styles.offerMetaRow}>
                      {!!job.distance && (
                        <View style={styles.offerMetaChip}>
                          <Ionicons name="map-outline" size={12} color={colors.mutedForeground} />
                          <Text style={[styles.offerMetaText, { color: colors.mutedForeground }]}>{job.distance}</Text>
                        </View>
                      )}
                      {!!job.duration && (
                        <View style={styles.offerMetaChip}>
                          <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
                          <Text style={[styles.offerMetaText, { color: colors.mutedForeground }]}>{job.duration}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {!!job.notes && (
                    <Text style={[styles.offerNotes, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {job.notes}
                    </Text>
                  )}
                  {/* ── Accept / Reject buttons ── */}
                  <View style={styles.offerBtnRow}>
                    <TouchableOpacity
                      style={[styles.offerRejectBtn, { borderColor: colors.error }]}
                      onPress={() => handleRejectOffer(job)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close-circle" size={17} color={colors.error} />
                      <Text style={[styles.offerRejectText, { color: colors.error }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.offerAcceptBtn, { backgroundColor: isBusyOnTrip ? colors.primary : '#22c55e' }]}
                      onPress={() => handleAcceptOffer(job)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={isBusyOnTrip ? 'time' : 'checkmark-circle'} size={17} color="#fff" />
                      <Text style={styles.offerAcceptText}>
                        {isBusyOnTrip ? 'Queue' : 'Accept'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* QUEUE sub-tab                                                          */}
      {activeSubTab === 'queue' && (
        queuedJobs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="time-outline" size={56} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Queue Empty</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Jobs you accept while on a trip appear here.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: botPad + 16 }} showsVerticalScrollIndicator={false}>
            {queuedJobs.map((job, i) => (
              <View
                key={job.id}
                style={[styles.queueCard, { backgroundColor: colors.card, borderColor: colors.primary + '55' }]}
              >
                {/* ── Left: position number + job info (tappable → detail) ── */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                  onPress={() => router.push(`/job/${job.id}` as any)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.queueNum, { backgroundColor: colors.primary + '22' }]}>
                    <Text style={[styles.queueNumText, { color: colors.primary }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.queueName, { color: colors.foreground }]} numberOfLines={1}>
                      {job.passengerName || 'Passenger'}
                    </Text>
                    <Text style={[styles.queueAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {job.pickupAddress || '—'}
                    </Text>
                    {job.dropAddress ? (
                      <Text style={[styles.queueAddr, { color: colors.mutedForeground, fontSize: 11 }]} numberOfLines={1}>
                        → {job.dropAddress}
                      </Text>
                    ) : null}
                  </View>
                  {job.fare > 0 && (
                    <Text style={[styles.queueFare, { color: colors.primary, marginRight: 8 }]}>${job.fare.toFixed(2)}</Text>
                  )}
                </TouchableOpacity>
                {/* ── Right: Release Back button ── */}
                <TouchableOpacity
                  style={[styles.releaseBtn, { borderColor: colors.error + '88' }]}
                  onPress={() =>
                    Alert.alert(
                      'Release Job',
                      `Release "${job.passengerName || 'Passenger'}" back to dispatch?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Release', style: 'destructive', onPress: () => recallJob(job.id, 'Recalled by driver') },
                      ],
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons name="arrow-undo" size={14} color={colors.error} />
                  <Text style={[styles.releaseBtnText, { color: colors.error }]}>Release</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* CURRENT sub-tab                                                        */}
      {activeSubTab === 'current' && (
        <>
          {/* ── Hail trip active but on Current tab → redirect ── */}
          {isHailTrip && (
            <View style={styles.emptyBox}>
              <Ionicons name="speedometer" size={56} color={colors.primary} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Hail Trip In Progress</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Your meter is running in the Hail tab.
              </Text>
              <TouchableOpacity
                style={[styles.startShiftBtn, { backgroundColor: colors.primary, marginTop: 8 }]}
                onPress={() => setActiveSubTab('hail')}
                activeOpacity={0.85}
              >
                <Ionicons name="speedometer" size={22} color="#fff" />
                <Text style={styles.startShiftBtnText}>View Meter</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Dispatch trip ── */}
          {isDispatchTrip && (
            <>
              {/* Navigation Map */}
              <View style={[styles.mapContainer, { height: meterRunning ? 220 : 240 }]}>
                {(getLastGpsPosition() || fallbackPos) && pickupCoords ? (
                  <LiveDriverMap
                    fallbackPos={fallbackPos}
                    pickup={pickupCoords}
                    drop={dropCoords}
                    phase={arrivedAtPickup ? 'drop' : 'pickup'}
                  />
                ) : (
                  <View style={[styles.mapPlaceholder, { backgroundColor: colors.surface }]}>
                    {geocoding ? (
                      <>
                        <ActivityIndicator color={colors.primary} size="large" />
                        <Text style={[styles.mapPlaceholderText, { color: colors.mutedForeground }]}>Loading map…</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="map-outline" size={40} color={colors.border} />
                        <Text style={[styles.mapPlaceholderText, { color: colors.mutedForeground }]}>Locating…</Text>
                      </>
                    )}
                  </View>
                )}
              </View>

              <ScrollView contentContainerStyle={{ paddingBottom: botPad + 24 }} showsVerticalScrollIndicator={false}>

                {/* Fixed / pre-paid fare card */}
                {isMeterless && !meterRunning && (
                  <View style={[styles.fareCard, { backgroundColor: colors.card, borderColor: isCashOrBlank ? '#f59e0b55' : colors.primary + '55' }]}>
                    <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>
                      {isCashOrBlank ? 'FIXED PRICE' : 'PRE-PAID'}
                    </Text>
                    {hasFare && (
                      <Text style={[styles.fareValue, { color: isCashOrBlank ? '#f59e0b' : colors.primary }]}>
                        ${currentJob!.fare.toFixed(2)}
                      </Text>
                    )}
                    <Text style={[styles.meterlessNote, { color: colors.mutedForeground }]}>{meterlessLabel}</Text>
                  </View>
                )}

                {/* Live fare when running — leaf component subscribes to tick */}
                {meterRunning && (
                  <MeterScreenLiveFareCard
                    cardStyle={styles.fareCard}
                    fareLabelStyle={styles.fareLabel}
                    fareValueStyle={styles.fareValue}
                    rowStyle={styles.fareRow}
                    statStyle={styles.fareStat}
                    statValStyle={styles.fareStatVal}
                    dividerStyle={styles.fareStatDiv}
                    waitDotStyle={styles.waitDot}
                    cardBg={colors.card}
                    borderColor={colors.border}
                    mutedColor={colors.mutedForeground}
                    primaryColor={colors.primary}
                    foregroundColor={colors.foreground}
                    successColor={colors.success}
                    meterIsWaiting={meterIsWaiting}
                  />
                )}

                {/* Job detail card */}
                <View style={[styles.jobCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.jobRow}>
                    <View style={[styles.jobIconBox, { backgroundColor: colors.primary + '18' }]}>
                      <Ionicons name="person" size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.jobName, { color: colors.foreground }]}>{currentJob!.passengerName}</Text>
                      {!!currentJob!.passengerPhone && (
                        <Text style={[styles.jobSub, { color: colors.mutedForeground }]}>{currentJob!.passengerPhone}</Text>
                      )}
                      {/* v22bn: easiest place for the driver to reach the
                          passenger after On The Way / Arrived. Works for
                          every source (dispatch / hail / website / passenger
                          app / account) because passengerPhone lives on the
                          Job uniformly. Logs to driverContactLog/ so HQ has
                          a record on no-show disputes. */}
                      <PassengerContactBar
                        phone={currentJob!.passengerPhone}
                        passengerName={currentJob!.passengerName}
                        bookingId={(currentJob as any)?.bookingId ?? currentJob!.id}
                        source={(currentJob as any)?.source ?? currentJob!.bookingType ?? null}
                        companyId={driver?.companyId}
                        driverId={driver?.id ?? driver?.vehicleId}
                        driverName={driver?.name}
                      />
                    </View>
                    {isCurrentJobPrepaid && (
                      <View style={[styles.payTag, { backgroundColor: '#22c55e18', borderColor: '#22c55e44' }]}>
                        <Text style={[styles.payTagText, { color: '#22c55e' }]}>PAID</Text>
                      </View>
                    )}
                    {!isCurrentJobPrepaid && !!currentJob!.paymentType && (
                      <View style={[styles.payTag, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}>
                        <Text style={[styles.payTagText, { color: colors.primary }]}>
                          {currentJob!.paymentType.toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.routeBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.routeRow}>
                      <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>PICKUP</Text>
                        <Text style={[styles.routeAddr, { color: colors.foreground }]} numberOfLines={2}>
                          {currentJob!.pickupAddress}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
                    <View style={styles.routeRow}>
                      <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>DROP-OFF</Text>
                        <Text style={[styles.routeAddr, { color: colors.foreground }]} numberOfLines={2}>
                          {currentJob!.dropAddress || '—'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {!!currentJob!.stops && (
                    <View style={[styles.notesBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.notesLabel, { color: colors.mutedForeground }]}>STOPS</Text>
                      <Text style={[styles.notesText, { color: colors.foreground }]}>{currentJob!.stops}</Text>
                    </View>
                  )}
                  {!!currentJob!.notes && (
                    <View style={[styles.notesBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.notesLabel, { color: colors.mutedForeground }]}>NOTES</Text>
                      <Text style={[styles.notesText, { color: colors.foreground }]}>{currentJob!.notes}</Text>
                    </View>
                  )}
                </View>

                {/* Controls */}
                <View style={styles.controls}>

                  {/* Phase 1: En route to pickup */}
                  {!arrivedAtPickup && !meterRunning && (
                    <>
                      <TouchableOpacity
                        style={[styles.primaryBtn, { backgroundColor: '#22c55e' }]}
                        onPress={handleArrived}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="checkmark-circle" size={24} color="#fff" />
                        <Text style={[styles.primaryBtnText, { color: '#fff' }]}>I've Arrived at Pickup</Text>
                      </TouchableOpacity>
                      <View style={styles.secondaryRow}>
                        <TouchableOpacity
                          style={[styles.secondaryBtn, { borderColor: '#f59e0b', backgroundColor: '#f59e0b18' }]}
                          onPress={handleRecall}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="refresh-circle" size={18} color="#f59e0b" />
                          <Text style={[styles.secondaryBtnText, { color: '#f59e0b' }]}>Release Job</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.secondaryBtn, { borderColor: colors.error, backgroundColor: colors.error + '18' }]}
                          onPress={() => Alert.alert('Cancel Job', 'Return this job to dispatch?', [
                            { text: 'Keep', style: 'cancel' },
                            { text: 'Cancel Job', style: 'destructive', onPress: cancelTrip },
                          ])}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="close-circle" size={18} color={colors.error} />
                          <Text style={[styles.secondaryBtnText, { color: colors.error }]}>Cancel Job</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}

                  {/* Phase 2a: Arrived, waiting for passenger to board */}
                  {arrivedAtPickup && !passengerOnBoard && !meterRunning && (
                    <>
                      <View style={[styles.arrivedBadge, { backgroundColor: '#22c55e18', borderColor: '#22c55e' }]}>
                        <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                        <Text style={[styles.arrivedText, { color: '#22c55e' }]}>Arrived at pickup</Text>
                      </View>
                      {(() => {
                        const bt = String(currentJob?.bookingType ?? '').toLowerCase();
                        const isFood    = bt.includes('food') || bt.includes('meal') || bt.includes('restaurant') || bt.includes('deliver');
                        const isFreight = bt.includes('freight') || bt.includes('parcel') || bt.includes('cargo');
                        const isTow     = bt.includes('tow') || bt.includes('recovery');
                        const label = isFood    ? 'Picked Up Order'
                                    : isFreight ? 'Parcel Loaded'
                                    : isTow     ? 'Vehicle Loaded'
                                    :             'Passenger On Board';
                        const icon: any = isFood    ? 'fast-food'
                                        : isFreight ? 'cube'
                                        : isTow     ? 'car-sport'
                                        :             'person-add';
                        return (
                          <TouchableOpacity
                            style={[styles.primaryBtn, { backgroundColor: '#22c55e' }]}
                            onPress={handlePassengerOnBoard}
                            activeOpacity={0.85}
                          >
                            <Ionicons name={icon} size={24} color="#fff" />
                            <Text style={[styles.primaryBtnText, { color: '#fff' }]}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })()}
                      <TouchableOpacity
                        style={[styles.secondaryBtn, { borderColor: colors.error, backgroundColor: colors.error + '18', alignSelf: 'stretch', justifyContent: 'center' }]}
                        onPress={cancelTrip}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="close-circle" size={18} color={colors.error} />
                        <Text style={[styles.secondaryBtnText, { color: colors.error }]}>Cancel Job</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Phase 2b: Passenger on board — show meter start (or fixed-price complete) */}
                  {arrivedAtPickup && passengerOnBoard && !meterRunning && (
                    <>
                      <View style={[styles.arrivedBadge, { backgroundColor: '#22c55e18', borderColor: '#22c55e' }]}>
                        <Ionicons name="people" size={20} color="#22c55e" />
                        <Text style={[styles.arrivedText, { color: '#22c55e' }]}>Passenger on board</Text>
                      </View>
                      {isMeterless ? (
                        <TouchableOpacity
                          style={[styles.primaryBtn, { backgroundColor: '#22c55e' }]}
                          onPress={instrumentTap('completeTrip:meterless', handleOpenComplete)}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="checkmark-circle" size={24} color="#fff" />
                          <Text style={[styles.primaryBtnText, { color: '#fff' }]}>Complete Trip</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                          onPress={handleStartMeter}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="play-circle" size={24} color="#fff" />
                          <Text style={[styles.primaryBtnText, { color: '#fff' }]}>Start Meter</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.secondaryBtn, { borderColor: colors.error, backgroundColor: colors.error + '18', alignSelf: 'stretch', justifyContent: 'center' }]}
                        onPress={cancelTrip}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="close-circle" size={18} color={colors.error} />
                        <Text style={[styles.secondaryBtnText, { color: colors.error }]}>Cancel Job</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Phase 3: Meter running — passenger is on board, no cancel option.
                      Driver can only Complete or Pause/Wait while a passenger is in the car. */}
                  {meterRunning && (
                    <>
                      <TouchableOpacity
                        style={[styles.primaryBtn, { backgroundColor: '#22c55e' }]}
                        onPress={instrumentTap('completeTrip:metered', handleOpenComplete)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="checkmark-circle" size={24} color="#fff" />
                        <Text style={[styles.primaryBtnText, { color: '#fff' }]}>Complete Trip</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.secondaryBtn, { borderColor: '#f59e0b', backgroundColor: '#f59e0b18', alignSelf: 'stretch', justifyContent: 'center' }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); pauseMeter(); }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name={meterPaused ? 'play' : 'pause'} size={18} color="#f59e0b" />
                        <Text style={[styles.secondaryBtnText, { color: '#f59e0b' }]}>{meterPaused ? 'Resume' : 'Pause / Wait'}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </ScrollView>
            </>
          )}

          {/* ── Idle (no active job, no hail) ── */}
          {!isDispatchTrip && !isHailTrip && (
            <ScrollView contentContainerStyle={{ paddingBottom: botPad + 24 }} showsVerticalScrollIndicator={false}>

              {/* Live home map */}
              <View style={[styles.homeMapCard, { borderColor: colors.border }]}>
                {(getLastGpsPosition() || homeFallbackPos) ? (
                  <LiveDriverMap fallbackPos={homeFallbackPos} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 10 }]}>
                    <Ionicons name="map-outline" size={44} color={colors.border} />
                    <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', paddingHorizontal: 24 }}>
                      Getting your location…
                    </Text>
                  </View>
                )}
              </View>

              {/* Zone info */}
              {myZoneInfo?.zoneName ? (
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
                        <Text style={[styles.zoneVal, { color: zoneWaitSecs >= 3600 ? colors.error : colors.foreground }]}>
                          {formatTime(zoneWaitSecs)}
                        </Text>
                        <Text style={[styles.zoneLbl, { color: colors.mutedForeground }]}>Waited</Text>
                      </View>
                    </View>
                  </View>
                </>
              ) : null}

              {/* Hail shortcut */}
              <TouchableOpacity
                style={[styles.hailBtn, { backgroundColor: '#f59e0b' }]}
                onPress={() => setActiveSubTab('hail')}
                activeOpacity={0.8}
              >
                <Ionicons name="hand-left" size={22} color="#fff" />
                <Text style={styles.hailBtnText}>Hail a Passenger</Text>
              </TouchableOpacity>

            </ScrollView>
          )}
        </>
      )}

    </SafeAreaView>
  );
}

// ── StyleSheet ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  topHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
  },
  topHeaderLeft: { gap: 3, flex: 1 },
  topHeaderRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  vehicleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', borderRadius: 20, borderWidth: 1.5,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  vehicleBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  driverName:  { fontSize: 22, fontFamily: 'Inter_700Bold' },
  shiftSince:  { fontSize: 12, fontFamily: 'Inter_400Regular' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 5,
  },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  endShiftBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 6,
  },
  endShiftText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  // Alerts
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginBottom: 4, borderRadius: 12, borderWidth: 1.5,
    paddingVertical: 9, paddingHorizontal: 12,
  },
  alertText:    { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  makeAvailBtn: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  makeAvailText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Stats strip
  statsStrip: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderBottomWidth: 1,
    paddingVertical: 8, paddingHorizontal: 4,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 1 },
  statVal:  { fontSize: 17, fontFamily: 'Inter_700Bold' },
  statLbl:  { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  statSep:  { width: 1, height: 28 },
  complianceBar:     { width: '80%', height: 5, borderRadius: 3, overflow: 'hidden' },
  complianceBarFill: { height: '100%', borderRadius: 3 },

  // Off-shift screen
  offShiftBox:   { paddingHorizontal: 40, gap: 12, alignItems: 'center' },
  offShiftIcon:  { width: 96, height: 96, borderRadius: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  offShiftTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  offShiftSub:   { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
  startShiftBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 18, paddingHorizontal: 40, borderRadius: 18, marginTop: 8,
  },
  startShiftBtnText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Map
  mapContainer:      { marginHorizontal: 12, borderRadius: 18, overflow: 'hidden', marginBottom: 4 },
  mapPlaceholder:    { height: '100%', alignItems: 'center', justifyContent: 'center', gap: 12 },
  mapPlaceholderText:{ fontSize: 14, fontFamily: 'Inter_400Regular' },

  // Home map
  homeMapCard: { marginHorizontal: 12, height: 230, borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginBottom: 8 },

  // Fare
  fareCard:  { marginHorizontal: 12, borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginTop: 8 },
  fareLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 2, textAlign: 'center', paddingTop: 14 },
  fareValue: { fontSize: 52, fontWeight: '800', fontFamily: 'Inter_700Bold', textAlign: 'center', letterSpacing: -2, paddingBottom: 6 },
  fareRow:   { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'transparent' },
  fareStat:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  fareStatDiv: { width: 1, height: 24 },
  fareStatVal: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  waitDot:   { width: 8, height: 8, borderRadius: 4 },
  meterlessNote: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', paddingHorizontal: 12, paddingBottom: 4, color: 'transparent' },

  // Job card
  jobCard: { marginHorizontal: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginTop: 8, gap: 10 },
  jobRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jobIconBox: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  jobName: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  jobSub:  { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  payTag:  { borderRadius: 8, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  payTagText: { fontSize: 10, fontFamily: 'Inter_700Bold' },

  routeBox:  { borderRadius: 12, borderWidth: 1, padding: 10, gap: 2 },
  routeRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  routeDot:  { width: 9, height: 9, borderRadius: 5, marginTop: 14 },
  routeLine: { width: 2, height: 14, marginLeft: 3, marginVertical: 2 },
  routeLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, marginTop: 2 },
  routeAddr:  { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, marginTop: 2 },

  notesBox:   { borderRadius: 10, borderWidth: 1, padding: 10 },
  notesLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, marginBottom: 4 },
  notesText:  { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  // Controls
  controls: { paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  primaryBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 17, gap: 10 },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  secondaryRow:   { flexDirection: 'row', gap: 8 },
  secondaryBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingVertical: 13, borderWidth: 1.5, gap: 6, paddingHorizontal: 10 },
  secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  arrivedBadge:  { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1.5, padding: 11, gap: 8 },
  arrivedText:   { fontSize: 13, fontFamily: 'Inter_700Bold' },

  // Zone info
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.2, marginHorizontal: 16, marginTop: 14, marginBottom: 6 },
  zoneCard:   { marginHorizontal: 12, borderRadius: 14, borderWidth: 1.5, overflow: 'hidden', marginBottom: 8 },
  zoneGrid:   { flexDirection: 'row' },
  zoneItem:   { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 3 },
  zoneVal:    { fontSize: 15, fontFamily: 'Inter_700Bold' },
  zoneLbl:    { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  zoneDivider:{ width: 1, marginVertical: 8 },

  // Hail button
  hailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, marginHorizontal: 12, marginTop: 8, borderRadius: 16, paddingVertical: 15,
  },
  hailBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  // Empty states
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  emptySub:   { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },

  // Offers list
  offerCard: {
    marginHorizontal: 12, marginTop: 10, borderRadius: 16, borderWidth: 1.5,
    padding: 14, gap: 10,
  },
  offerCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  offerPassenger: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  offerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  offerFare:  { fontSize: 18, fontFamily: 'Inter_700Bold' },
  offerRouteBox: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 6 },
  offerAddr:  { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  offerNotes: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  offerBtnRow:{ flexDirection: 'row', gap: 10 },
  offerRejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1.5, paddingVertical: 12 },
  offerRejectText:{ fontSize: 14, fontFamily: 'Inter_700Bold' },
  offerAcceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 12 },
  offerAcceptText:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  // Distance pill shown in offer card header
  distPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  distPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  // Trip meta chips (distance / duration from dispatcher)
  offerMetaRow: { flexDirection: 'row', gap: 8 },
  offerMetaChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  offerMetaText: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  // Queue list
  queueCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginTop: 8, borderRadius: 14, borderWidth: 1.5,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  queueNum:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  queueNumText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  queueName:    { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  queueAddr:    { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  queueFare:    { fontSize: 15, fontFamily: 'Inter_700Bold', marginRight: 4 },
  // Release Back button on queue cards
  releaseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 10, borderWidth: 1.5,
    paddingVertical: 8, paddingHorizontal: 10, marginLeft: 6,
  },
  releaseBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  // Completion modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet:   { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, paddingTop: 20, paddingHorizontal: 20, gap: 16, maxHeight: '92%' },
  modalHeader:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  modalIcon:    { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modalTitle:   { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold' },
  summaryBox:   { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  summaryRow:   { flexDirection: 'row', paddingVertical: 16 },
  summaryItem:  { flex: 1, alignItems: 'center' },
  summaryVal:   { fontSize: 18, fontFamily: 'Inter_700Bold' },
  summaryLbl:   { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1, marginTop: 3 },
  summaryDiv:   { width: 1 },
  fieldLabel:   { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.2, marginBottom: 6, marginTop: 4 },
  inputRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  textInput:    { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', minHeight: 22 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  backBtn:      { flex: 1, borderRadius: 14, borderWidth: 1.5, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  backBtnText:  { fontSize: 15, fontFamily: 'Inter_700Bold' },
  confirmBtn:   { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 16, gap: 8 },
  confirmBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});

// ── Sub-tab stylesheet ────────────────────────────────────────────────────────
const subTabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', borderBottomWidth: 1,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  badge: { minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  dot: { width: 7, height: 7, borderRadius: 4 },
});

// ── Offer modal stylesheet ────────────────────────────────────────────────────
const offerStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 20,
    boxShadow: '0px -4px 16px rgba(0,0,0,0.3)',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: 1,
  },
  pulseRing: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  section:     { paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  label:       { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, textTransform: 'uppercase' },
  value:       { fontSize: 15, fontFamily: 'Inter_700Bold' },
  sub:         { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  pinDot:      { width: 9, height: 9, borderRadius: 5 },
  farePill:    { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  farePillText:{ fontSize: 16, fontFamily: 'Inter_700Bold' },
  badgeRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1 },
  wavBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  wavBadgeText:{ fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  accBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#e0f2fe', borderRadius: 8, borderWidth: 1, borderColor: '#bae6fd', paddingHorizontal: 10, paddingVertical: 5 },
  accBadgeText:{ fontSize: 12, fontFamily: 'Inter_700Bold', color: '#0369a1' },
  payBadge:    { flexDirection: 'row', alignItems: 'center', borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  payBadgeText:{ fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  notesBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 18, marginVertical: 10, borderRadius: 10, borderWidth: 1, padding: 10 },
  notesText:   { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 18 },
  btnRow:      { flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingTop: 10 },
  rejectBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, borderWidth: 1.5, paddingVertical: 15 },
  rejectText:  { fontSize: 15, fontFamily: 'Inter_700Bold' },
  acceptBtn:   { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, paddingVertical: 15 },
  acceptText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
});
