// v12-ota14: Leaf components that subscribe to high-frequency contexts.
// v12-ota17: Split — meter-tick consumers stay on useDriverTick;
//            GPS/map consumers moved to useDriverGps so the native map
//            does NOT reconcile on every meter tick. Added useIsFocused
//            gate on <LiveDriverMap> so background tabs (Home while user
//            is on Profile/Chat) don't burn the JS thread on map work.
//
// For callbacks (Alert.alert message strings, completion modals, etc.)
// that need the *current* meter values at the moment of click, use
// getMeterSnapshot() from the main DriverContext — it reads from refs
// (no subscription, stable function reference, never re-renders).

import React, { useEffect } from 'react';
import { View, Text, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useDriverTick, useDriverGps } from '@/context/DriverContext';
import { NativeMap } from '@/components/NativeMap';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// v12-ota14/17: WebView GPS injector leaf — subscribes to currentGps via the
// dedicated GPS context so it does NOT re-render on meter ticks.
export const WebViewGpsInjector = React.memo(function WebViewGpsInjector({
  webViewRef, enabled,
}: {
  webViewRef: React.MutableRefObject<any>;
  enabled: boolean;
}) {
  const { currentGps } = useDriverGps();
  useEffect(() => {
    if (!enabled || !currentGps) return;
    webViewRef.current?.injectJavaScript(
      `window.postMessage(${JSON.stringify({ type: 'updateDriver', lat: currentGps.lat, lng: currentGps.lng })}, '*'); true;`
    );
  }, [enabled, currentGps?.lat, currentGps?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
});

// ── Live fare/time/dist row used in Home ActiveJobPanel ─────────────────────
export const HomeActiveJobMeterRow = React.memo(function HomeActiveJobMeterRow({
  containerStyle, statStyle, dividerStyle, valueStyle, labelStyle,
  fareColor, foregroundColor, mutedColor, borderColor,
}: {
  containerStyle: StyleProp<ViewStyle>;
  statStyle: StyleProp<ViewStyle>;
  dividerStyle: StyleProp<ViewStyle>;
  valueStyle: StyleProp<TextStyle>;
  labelStyle: StyleProp<TextStyle>;
  fareColor: string;
  foregroundColor: string;
  mutedColor: string;
  borderColor: string;
}) {
  const { meterSeconds, meterDistance, meterFare } = useDriverTick();
  return (
    <View style={containerStyle}>
      <View style={statStyle}>
        <Text style={[valueStyle, { color: fareColor }]}>${meterFare.toFixed(2)}</Text>
        <Text style={[labelStyle, { color: mutedColor }]}>FARE</Text>
      </View>
      <View style={[dividerStyle, { backgroundColor: borderColor }]} />
      <View style={statStyle}>
        <Text style={[valueStyle, { color: foregroundColor }]}>{formatTime(meterSeconds)}</Text>
        <Text style={[labelStyle, { color: mutedColor }]}>TIME</Text>
      </View>
      <View style={[dividerStyle, { backgroundColor: borderColor }]} />
      <View style={statStyle}>
        <Text style={[valueStyle, { color: foregroundColor }]}>{meterDistance.toFixed(2)} km</Text>
        <Text style={[labelStyle, { color: mutedColor }]}>DIST</Text>
      </View>
    </View>
  );
});

// ── Live fare card used in Meter screen (dispatch trip view) ────────────────
export const MeterScreenLiveFareCard = React.memo(function MeterScreenLiveFareCard({
  cardStyle, fareLabelStyle, fareValueStyle, rowStyle, statStyle, statValStyle,
  dividerStyle, waitDotStyle,
  cardBg, borderColor, mutedColor, primaryColor, foregroundColor, successColor,
  meterIsWaiting,
}: {
  cardStyle: StyleProp<ViewStyle>;
  fareLabelStyle: StyleProp<TextStyle>;
  fareValueStyle: StyleProp<TextStyle>;
  rowStyle: StyleProp<ViewStyle>;
  statStyle: StyleProp<ViewStyle>;
  statValStyle: StyleProp<TextStyle>;
  dividerStyle: StyleProp<ViewStyle>;
  waitDotStyle: StyleProp<ViewStyle>;
  cardBg: string;
  borderColor: string;
  mutedColor: string;
  primaryColor: string;
  foregroundColor: string;
  successColor: string;
  meterIsWaiting: boolean;
}) {
  const { meterSeconds, meterDistance, meterFare } = useDriverTick();
  return (
    <View style={[cardStyle, { backgroundColor: cardBg, borderColor }]}>
      <Text style={[fareLabelStyle, { color: mutedColor }]}>FARE</Text>
      <Text style={[fareValueStyle, { color: primaryColor }]}>${meterFare.toFixed(2)}</Text>
      <View style={rowStyle}>
        <View style={statStyle}>
          <Ionicons name="time-outline" size={18} color={mutedColor} />
          <Text style={[statValStyle, { color: foregroundColor }]}>{formatTime(meterSeconds)}</Text>
        </View>
        <View style={[dividerStyle, { backgroundColor: borderColor }]} />
        <View style={statStyle}>
          <Ionicons name="navigate-outline" size={18} color={mutedColor} />
          <Text style={[statValStyle, { color: foregroundColor }]}>{meterDistance.toFixed(2)} km</Text>
        </View>
        <View style={[dividerStyle, { backgroundColor: borderColor }]} />
        <View style={statStyle}>
          <View style={[waitDotStyle, { backgroundColor: meterIsWaiting ? '#f97316' : successColor }]} />
          <Text style={[statValStyle, { color: meterIsWaiting ? '#f97316' : successColor }]}>
            {meterIsWaiting ? 'Waiting' : 'Moving'}
          </Text>
        </View>
      </View>
    </View>
  );
});

// ── Live fare/time/dist/rate display used in MeterPanel (hail) ───────────────
export const MeterPanelLiveStats = React.memo(function MeterPanelLiveStats({
  fareLabelStyle, fareValueStyle, statsRowStyle, statItemStyle, statValStyle, statLabelStyle, dividerStyle,
  mutedColor, primaryColor, foregroundColor, borderColor,
  ratePerKm,
}: {
  fareLabelStyle: StyleProp<TextStyle>;
  fareValueStyle: StyleProp<TextStyle>;
  statsRowStyle: StyleProp<ViewStyle>;
  statItemStyle: StyleProp<ViewStyle>;
  statValStyle: StyleProp<TextStyle>;
  statLabelStyle: StyleProp<TextStyle>;
  dividerStyle: StyleProp<ViewStyle>;
  mutedColor: string;
  primaryColor: string;
  foregroundColor: string;
  borderColor: string;
  ratePerKm: number;
}) {
  const { meterSeconds, meterDistance, meterFare } = useDriverTick();
  return (
    <>
      <Text style={[fareLabelStyle, { color: mutedColor }]}>FARE</Text>
      <Text style={[fareValueStyle, { color: primaryColor }]}>${meterFare.toFixed(2)}</Text>
      <View style={statsRowStyle}>
        <View style={statItemStyle}>
          <Ionicons name="time-outline" size={22} color={mutedColor} />
          <Text style={[statValStyle, { color: foregroundColor }]}>{formatTime(meterSeconds)}</Text>
          <Text style={[statLabelStyle, { color: mutedColor }]}>Time</Text>
        </View>
        <View style={[dividerStyle, { backgroundColor: borderColor }]} />
        <View style={statItemStyle}>
          <Ionicons name="navigate-outline" size={22} color={mutedColor} />
          <Text style={[statValStyle, { color: foregroundColor }]}>{meterDistance.toFixed(2)}</Text>
          <Text style={[statLabelStyle, { color: mutedColor }]}>km</Text>
        </View>
        <View style={[dividerStyle, { backgroundColor: borderColor }]} />
        <View style={statItemStyle}>
          <Ionicons name="car-outline" size={22} color={mutedColor} />
          <Text style={[statValStyle, { color: foregroundColor }]}>${ratePerKm.toFixed(2)}</Text>
          <Text style={[statLabelStyle, { color: mutedColor }]}>Rate/km</Text>
        </View>
      </View>
    </>
  );
});

// ── Speed pill (MeterPanel) ──────────────────────────────────────────────────
// v12-ota17: now subscribes to GPS context only (was tick context).
export const MeterPanelSpeedPill = React.memo(function MeterPanelSpeedPill({
  pillStyle, textStyle,
  surfaceColor, borderColor, successColor, mutedColor,
}: {
  pillStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  surfaceColor: string;
  borderColor: string;
  successColor: string;
  mutedColor: string;
}) {
  const { currentSpeedKmh } = useDriverGps();
  const isMoving = currentSpeedKmh > 0;
  return (
    <View style={[pillStyle, {
      backgroundColor: isMoving ? successColor + '18' : surfaceColor,
      borderColor: isMoving ? successColor + '66' : borderColor,
    }]}>
      <Ionicons name="speedometer-outline" size={13} color={isMoving ? successColor : mutedColor} />
      <Text style={[textStyle, { color: isMoving ? successColor : mutedColor }]}>
        {currentSpeedKmh} km/h
      </Text>
    </View>
  );
});

// ── Hail map fare overlay (MeterPanel hail map modal) ───────────────────────
export const HailMapFareOverlay = React.memo(function HailMapFareOverlay({
  fareTextStyle, subTextStyle,
}: {
  fareTextStyle: StyleProp<TextStyle>;
  subTextStyle: StyleProp<TextStyle>;
}) {
  const { meterSeconds, meterDistance, meterFare } = useDriverTick();
  return (
    <>
      <Text style={fareTextStyle}>${meterFare.toFixed(2)}</Text>
      <Text style={subTextStyle}>{formatTime(meterSeconds)} · {meterDistance.toFixed(2)} km</Text>
    </>
  );
});

// ── Live driver-dot map: subscribes to GPS so parent doesn't have to ────────
// v12-ota17: now subscribes to GPS context (not tick) AND skips rendering
// when its tab/screen is NOT focused. Previously the Home map kept calling
// react-native-maps bridge methods every second even while the user was on
// the Profile tab — that's why sign-out needed ~20 taps.
export const LiveDriverMap = React.memo(function LiveDriverMap({
  fallbackPos,
  phase,
  pickup,
  drop,
}: {
  fallbackPos: { lat: number; lng: number } | null;
  phase?: 'pickup' | 'drop' | 'none';
  pickup?: { lat: number; lng: number } | null;
  drop?: { lat: number; lng: number } | null;
}) {
  const { currentGps } = useDriverGps();
  const isFocused = useIsFocused();
  const driverPos = currentGps ?? fallbackPos;
  if (!isFocused) return null;
  if (!driverPos) return null;
  return <NativeMap driver={driverPos} phase={phase} pickup={pickup ?? undefined} drop={drop ?? undefined} />;
});

// ── GPS sync helper: keeps a ref in sync with currentGps without making the
//    parent re-render. Render <GpsRefSyncer onGps={(p) => ref.current = p} />
//    inside the parent — the parent's render is independent of GPS updates.
// v12-ota17: subscribes to GPS context only.
export const GpsRefSyncer = React.memo(function GpsRefSyncer({ onGps }: { onGps: (pos: { lat: number; lng: number }) => void }) {
  const { currentGps } = useDriverGps();
  useEffect(() => {
    if (currentGps) onGps(currentGps);
  }, [currentGps?.lat, currentGps?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
});
