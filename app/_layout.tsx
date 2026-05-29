import * as Sentry from '@sentry/react-native';

// v12-ota9: module-level diagnostics + breadcrumb dedup helpers.
// State is stored on globalThis so it survives even if the module is
// re-evaluated more than once (which is exactly what the v12-ota7/8
// experiments suggested was happening — Sentry.getClient() guard alone
// did not stop the second init from registering integrations).
type BootState = {
  rootLayoutMounts: number;
  moduleEvalId: string;          // first module-eval wins
  moduleEvalCount: number;       // total module evaluations seen
  initAttempts: number;          // how many times Sentry.init was attempted
  initActualRuns: number;        // how many actually ran (should be 1)
  lastKeys: string[];            // ring buffer for dedup (last 4 bc keys)
  lastAts: number[];             // matching timestamps for ring buffer
};
const g = globalThis as any;
if (!g.__taxi360BootState__) {
  g.__taxi360BootState__ = {
    rootLayoutMounts: 0,
    moduleEvalId: Math.random().toString(36).slice(2, 8),
    moduleEvalCount: 0,
    initAttempts: 0,
    initActualRuns: 0,
    lastKeys: [],
    lastAts: [],
  } as BootState;
}
const bootState: BootState = g.__taxi360BootState__;
bootState.moduleEvalCount += 1;
// eslint-disable-next-line no-console
console.log(
  '[Boot] _layout module evaluated — evalId:', bootState.moduleEvalId,
  'evalCount:', bootState.moduleEvalCount
);

// ── Sentry crash reporting ───────────────────────────────────────────────────
// Initialised at module load (before any component renders) so even crashes
// during React mount are captured.
// DSN is hardcoded because EAS cloud builds do NOT inherit Replit env vars,
// and a Sentry DSN is a public identifier (already embedded in the APK either
// way — there is nothing sensitive about it).
const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  'https://8382d794d4c133e564da455e157587a0@o4511372138119168.ingest.us.sentry.io/4511372142968832';
try {
  // v12-ota9: globalThis-based init guard. Survives module re-evaluation
  // (the Sentry.getClient() check from v12-ota7 was not enough — evidence
  // from v12-ota8 events showed the dedup filter never ran on duplicates,
  // proving that a second Sentry.init() did register a second client which
  // overwrote the first one's filter).
  bootState.initAttempts += 1;
  // State-machine guard: only skip when init has actually COMPLETED (or is
  // currently running on the same call stack — JS is single-threaded so the
  // 'initializing' branch is mostly defensive). If a previous init() threw,
  // the state is reset to 'idle' in the catch block below so we retry.
  const initState: 'idle' | 'initializing' | 'initialized' =
    g.__taxi360SentryInitState__ || 'idle';
  if (initState === 'initialized') {
    // eslint-disable-next-line no-console
    console.log(
      '[Sentry] init SKIPPED via globalThis guard — initAttempts:',
      bootState.initAttempts
    );
  } else {
    g.__taxi360SentryInitState__ = 'initializing';
    Sentry.init({
      dsn: SENTRY_DSN,
      enableAutoSessionTracking: true,
      sessionTrackingIntervalMillis: 30_000,
      tracesSampleRate: 1.0,
      attachStacktrace: true,
      enableNativeCrashHandling: true,
      enableAutoPerformanceTracing: false,
      debug: false,
      release: 'taxi360-driver@1.5.0',
      dist: '4',
      // v12-ota12: smaller breadcrumb ring + drop the console-breadcrumb
      // integration entirely. Auto-capturing every console.log was costing
      // 3-8ms per call on the Samsung A04 (serialize + ring buffer + native
      // bridge) — that was the actual JS-thread tax that made buttons feel
      // dead during job/presence updates, NOT the React render itself.
      maxBreadcrumbs: 50,
      integrations: (defaults) => defaults.filter(
        (i) => i.name !== 'Console' && i.name !== 'ReactNativeConsole'
      ),
      // v12-ota9: ring-buffer dedup. A v12-ota8 trace showed that adjacent
      // duplicates (1ms apart, same key) still got through, AND interleaved
      // patterns like A,B,A,B were never deduped because we only compared
      // against the immediately-previous key. Ring of last 4 fixes both.
      beforeBreadcrumb(breadcrumb) {
        try {
          const key =
            (breadcrumb.category || '') + '|' +
            (breadcrumb.message || JSON.stringify(breadcrumb.data || {}));
          const now = Date.now();
          for (let i = 0; i < bootState.lastKeys.length; i++) {
            if (bootState.lastKeys[i] === key && now - bootState.lastAts[i] < 25) {
              return null; // duplicate within 25ms of any of last 4 — drop
            }
          }
          bootState.lastKeys.push(key);
          bootState.lastAts.push(now);
          if (bootState.lastKeys.length > 4) {
            bootState.lastKeys.shift();
            bootState.lastAts.shift();
          }
        } catch {
          // Never let dedup logic break breadcrumb capture.
        }
        return breadcrumb;
      },
      beforeSend(event) {
        // Tag every event with the build label + boot diagnostics so we can
        // see mount counts even when the boot breadcrumbs roll out of buffer.
        event.tags = {
          ...(event.tags || {}),
          build: 'sentry-v12-ota22bm (Extras on completion modal: driver can now add per-trip charges before settling payment — Airport pickup, Bike carrier, Extra bag, EFTPOS surcharge (% of fare), Cleaning fee, Other variable. Shown on both dispatch trip completion and hail-trip End Trip modal, above the payment selector. Each preset is a one-tap chip with editable dollar amount; total auto-adds to the fare passed to PaymentCapture (so card/Stripe charges include extras) and is included in the sync POST payload as ExtrasItems[] + ExtrasTotal + fare.extras for HQ audit. Reset on every modal open. v22bl retained: job offer modal now shows Booking Source (Dispatch/Hail/Website/Passenger App/Account) + Job Type (Taxi/Food/Freight/Total Mobility) chips at the top, plus distance + duration estimate pills, so the driver always sees where the job came from and what type before accepting. Adds parallel tripStage lifecycle field (OnTheWay → Arrived → OnBoard → cleared) written to online/{cid}/{vid}/current at acceptJob, handleArrived, startMeter, _freeDriver, completeJob — kept separate from vehiclestatus so existing dispatch contract (Assigned/Busy/Available/Away/Offline) is untouched, HQ audit panel can read tripStage for the granular lifecycle. Closes the hail-silent gap: the jobs-path offer listener now mirrors the notification listener busy-guard — when meterRunning OR a dispatch job is current, new offers enter the offers list silently (no modal popup, no sound, no push notification, no haptic) so a hail trip in progress is never interrupted by an incoming dispatch offer. Driver still sees the offer in the dashboard queue badge and can accept/reject when safe. v22bk retained: HQ-requested WaitingMinutes (number) + WaitingWindows (array of {start,end} ISO pairs) added to both /api/job/sync-offline-trip POST payloads (dispatch completeJob + completeHailTrip). Derived from a new per-trip waitingWindowsRef that records every wait-mode entry/exit transition from the three existing detectors (dispatch GPS hysteresis handler, dispatch tick force-exit, hail tick force-exit). waitingMinutes = sum of (end-start) seconds / 60 to 1dp. Ref reset in startMeter, any open window closed in stopMeter + pauseMeter so audit reflects reality. Also fixes the on-screen "Waiting Rate" pill staying lit after the driver taps Complete: pauseMeter now flips meterIsWaiting off + closes the open wait window the moment the modal opens, so the meter visibly freezes. If the driver dismisses the modal the GPS detector re-evaluates from scratch on resume. v22bj retained: AsyncStorage retry queue for /api/job/sync-offline-trip — high-priority fix for todays silent-window incident. New lib/syncPostQueue.ts persists failed POSTs to AsyncStorage (de-duped by bookingId, capped at 500 entries, 50 attempt cap per entry). Drained on (a) every successful sync POST (chain-drain), (b) AppState foreground resume, (c) network online transition, (d) periodic 60s while shift active. Combined with 22bi Sentry breadcrumb: either the POST lands, or HQ knows within seconds why it did not, or it survives in the retry queue. Also splits MeterOnAt/MeterOffAt timestamps from PickupTime/DropoffTime — meter charging window now derives from meterOnAtRef/meterOffAtRef captured in startMeter/stopMeter, so dispute panel sees both wheels-rolling-with-customer (pickup→dropoff) AND meter-was-charging (MeterOnAt→MeterOffAt) as separate numbers. Includes 22bh + 22bi.) (was: HQ reported missing /api/job/sync-offline-trip POSTs since 12:45pm NZ on May 17 — root cause was silent .catch(()=>{}) on the fetch hiding network/HTTP failures. Replaced both POST sites (dispatch + hail) with shared postSyncOfflineTrip() helper that: (a) checks res.ok and fires Sentry breadcrumb + captureMessage("warning") with {bookingId, driverId, serviceType, httpStatus, errorMsg, tripCloseTime} on non-2xx; (b) catches network/AbortError throws with httpStatus="timeout"/"network_error". Also added lifecycle timestamps + canonical duration to every closed-trip payload per HQ contract: PickupTime, DropoffTime, MeterOnAt, MeterOffAt (ISO 8601 UTC with Z suffix), TotalTime (mm:ss or hh:mm:ss), JobDuration (decimal mins). Applies to both dispatch trips (completeJob) and hail trips (completeHailTrip). Includes 22bh: Sentry breadcrumb on QueueJob POST catch — surfaces silent-failure rate as food/freight volume ramps. Breadcrumb data: {bookingId, driverId, serviceType, httpStatus, errorMsg}. httpStatus parsed from "HTTP {nnn}" in dispatchPost error message, or "timeout"/"network_error" for AbortError/network failures. Includes 22bf + 22bg.) (was: multi-queue for food/freight: acceptJobToQueue now skips the single-slot cap + transaction when job.serviceType is food or freight — those write to driverQueue/{cid}/{did}/queuedMulti/{bookingId} so many can coexist. Taxi/TM/unknown remain at 1 (single /queued slot). Inbound aliases restaurant→food and delivery→freight are also normalised locally. Plus: every /api/job/sync-offline-trip POST now carries runtimeVersion / groupId / channel / platform / appVersion at the root so HQ can answer "which OTA was this trip on" automatically. Includes 22be + 22bf.) (was: false "Queue Full" alert fixed: acceptJobToQueue transaction now allows re-accepting the SAME bookingId (idempotent) instead of aborting, AND only shows the Queue Full alert if a DIFFERENT job is actually held locally — otherwise the stale Firebase slot is cleared and the accept proceeds. Stale slot cleanup also runs on driver login. The kicked + cancel notification handlers now clear driverQueue when a queued/offered job is removed (was leaking the slot). Active job (status:current) never counts as "queued" — only status:queued does. Includes everything from 22bd + 22be.) (was: dispatch-console audit spec: /api/job/sync-offline-trip POST now sends payment-method breakdown (cash/card/eftpos/account/TM/ACC/gift_card incl. TM voucher / ACC claim / gift card code / Stripe intent), settled-in-car flag, waiting minutes + intervals + dollars, tariff change log + pause log, active tariff ID/name, booking type, source (hail/dispatch). Live tariff ID written to online/current on every tariff switch. Fixed-fare override / driver note / trip-issue fields included in wire format with null defaults — UI follows. Hail trips now send the full payload (previously only dispatch trips did).)',
          evalId: bootState.moduleEvalId,
          evalCount: String(bootState.moduleEvalCount),
          rootMounts: String(bootState.rootLayoutMounts),
          initAttempts: String(bootState.initAttempts),
          initActualRuns: String(bootState.initActualRuns),
        };
        return event;
      },
    });
    // Only flip to 'initialized' AFTER Sentry.init returns successfully, so
    // that a throw doesn't permanently disable crash reporting.
    g.__taxi360SentryInitState__ = 'initialized';
    bootState.initActualRuns += 1;
  }
} catch (e) {
  // Reset the guard so a future module-eval can retry init.
  g.__taxi360SentryInitState__ = 'idle';
  // eslint-disable-next-line no-console
  console.warn('[Sentry] init failed — guard reset to idle for retry', e);
}

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert, Animated, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import * as Updates from 'expo-updates';
import { initRemoteConfig, isUpdateRequired } from '@/lib/remoteConfig';
import { APP_VERSION, APP_BUILD } from '@/lib/config';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
// expo-notifications loaded lazily — crashes Expo Go (SDK 53+) on static import
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { queryClient } from '@/lib/query-client';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { DriverProvider, useDriver } from '@/context/DriverContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { IncomingJobAlert } from '@/components/IncomingJobAlert';
import { OfflineBanner } from '@/components/OfflineBanner';
import { TripRatingModal } from '@/components/TripRatingModal';
import { Ionicons } from '@expo/vector-icons';
import { registerForPushNotifications } from '@/lib/pushNotifications';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const KEEP_AWAKE_TAG = 'taxi360-on-shift';

// Keep screen on while driver is on shift OR meter is running.
// Standard requirement for taxi-driver apps so the meter / map stays visible.
function GlobalKeepAwake() {
  const { shiftActive, meterRunning } = useDriver();
  useEffect(() => {
    const shouldStay = shiftActive || meterRunning;
    const safeDeactivate = () => {
      try { deactivateKeepAwake(KEEP_AWAKE_TAG); } catch { /* not yet activated */ }
    };
    if (shouldStay) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      safeDeactivate();
    }
    return safeDeactivate;
  }, [shiftActive, meterRunning]);
  return null;
}

// ── System kick / suspension handler ─────────────────────────────────────────
// When dispatch kicks or suspends a driver, DriverContext sets systemAlert.
// This component shows the alert then ends the shift + signs the driver out.
function GlobalSystemKickHandler() {
  const { systemAlert, clearSystemAlert, endShift, shiftActive } = useDriver();
  const { signOut } = useAuth();

  useEffect(() => {
    if (!systemAlert) return;
    Alert.alert(
      systemAlert.title,
      systemAlert.message,
      [{
        text: 'OK',
        onPress: async () => {
          clearSystemAlert();
          if (shiftActive) await endShift().catch(() => {});
          await signOut().catch(() => {});
        },
      }],
      { cancelable: false },
    );
  }, [systemAlert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

SplashScreen.preventAutoHideAsync();

// ── Cancelled-job handler ─────────────────────────────────────────────────────
function GlobalCancelHandler() {
  const router = useRouter();
  const { cancelledJobAlert, clearCancelledJobAlert } = useDriver();

  useEffect(() => {
    if (!cancelledJobAlert) return;
    Alert.alert(
      cancelledJobAlert.title,
      cancelledJobAlert.message,
      [{
        text: 'OK',
        onPress: () => {
          clearCancelledJobAlert();
          router.push('/(tabs)/home');
        },
      }]
    );
  }, [cancelledJobAlert?.id]);

  return null;
}

// ── Incoming job modal — suppressed while driver is on an active trip ──────────
// When on a trip, the offer is kept in offeredJobs and PendingJobBanner handles it.
function GlobalJobAlert() {
  const router = useRouter();
  const { incomingJob, currentJob, meterRunning, acceptJob, rejectJob, dismissIncoming } = useDriver();

  const onTrip = !!(currentJob || meterRunning);

  // Auto-dismiss modal silently when driver is mid-trip — job stays in offeredJobs
  useEffect(() => {
    if (incomingJob && onTrip) {
      dismissIncoming();
    }
  }, [incomingJob?.id, onTrip]);

  // v12-ota22c4-f: PHANTOM-OFFER FAILSAFE.  A defense-in-depth check that
  // prevents an offer modal from ever rendering with no real data.  Symptoms
  // (reported repeatedly after hail completion): beep + offer badge + modal
  // with empty passenger / pickup / drop-off and just Accept/Reject buttons.
  // Regardless of which upstream listener fired setIncomingJob with bad data,
  // this guard catches it at the mount layer — silently dismissing without
  // playing the beep.  An offer is considered "real" if it has at least one
  // meaningful field: a non-placeholder passenger name, a non-placeholder
  // pickup address, or a non-placeholder drop address.
  const isPhantom = !!incomingJob && (() => {
    const name = (incomingJob.passengerName ?? '').trim().toLowerCase();
    const pick = (incomingJob.pickupAddress ?? '').trim().toLowerCase();
    const drop = (incomingJob.dropAddress  ?? '').trim().toLowerCase();
    const namePlaceholder = !name || name === 'passenger' || name === 'street pickup';
    const pickPlaceholder = !pick || pick.startsWith('see dispatch') || pick === 'unknown pickup';
    const dropPlaceholder = !drop || drop.startsWith('see dispatch');
    return namePlaceholder && pickPlaceholder && dropPlaceholder;
  })();

  useEffect(() => {
    if (incomingJob && isPhantom && !onTrip) {
      console.warn('[GlobalJobAlert] Phantom offer suppressed — bookingId:', incomingJob.bookingId, 'id:', incomingJob.id);
      dismissIncoming();
    }
  }, [incomingJob?.id, isPhantom, onTrip]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!incomingJob || onTrip || isPhantom) return null;

  return (
    <IncomingJobAlert
      job={incomingJob}
      onAccept={() => {
        const jobId = incomingJob.id;
        const jobSnapshot = incomingJob;
        acceptJob(jobSnapshot)
          .then(() => {
            dismissIncoming();
            router.push(`/job/${jobId}`);
          })
          .catch((err) => {
            console.error('[GlobalJobAlert] acceptJob failed:', err?.message ?? err);
          });
      }}
      onReject={() => {
        rejectJob(incomingJob.id);
        dismissIncoming();
      }}
    />
  );
}

// ── Pulsing "PENDING JOB" banner — shown while driver is on a trip ─────────────
function PendingJobBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { offeredJobs, currentJob, meterRunning } = useDriver();

  const onTrip = !!(currentJob || meterRunning);
  const hasPending = onTrip && offeredJobs.length > 0;

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!hasPending) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hasPending]);

  if (!hasPending) return null;

  const firstJob = offeredJobs[0];
  const count    = offeredJobs.length;

  return (
    <Animated.View
      style={[
        styles.pendingWrap,
        { top: insets.top + 8, opacity: pulseAnim, pointerEvents: 'box-none' },
      ]}
    >
      <TouchableOpacity
        style={styles.pendingInner}
        onPress={() => router.push('/(tabs)/home')}
        activeOpacity={0.85}
      >
        <Ionicons name="alert-circle" size={20} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={styles.pendingTitle}>
            PENDING JOB{count > 1 ? `S (${count})` : ''}
          </Text>
          <Text style={styles.pendingAddr} numberOfLines={1}>
            {firstJob.pickupAddress || 'Tap to view'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#fff" />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Push notification setup ───────────────────────────────────────────────────
// Registers for push notifications once, stores the token in Firebase via
// DriverContext, and routes the user to the Jobs tab when they tap a
// "New Job" push notification while the app was backgrounded / killed.
function PushNotificationSetup() {
  const router = useRouter();
  const { storePushToken } = useDriver();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifResponseRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    registerForPushNotifications().then(token => {
      if (token) storePushToken(token);
    });

    // Skip in Expo Go — push notifications removed from SDK 53+
    const Constants = require('expo-constants').default;
    const isExpoGo =
      Constants.executionEnvironment === 'storeClient' ||
      Constants.appOwnership === 'expo';
    if (isExpoGo) return;

    // Lazy-load so any remaining issues don't crash the app
    let Notif: any = null;
    try { Notif = require('expo-notifications'); } catch { return; }
    if (!Notif?.addNotificationResponseReceivedListener) return;

    notifResponseRef.current = Notif.addNotificationResponseReceivedListener(
      (response: any) => {
        const data = response?.notification?.request?.content?.data as Record<string, any>;
        if (data?.screen === 'jobs') router.push('/(tabs)/home');
      },
    );

    return () => {
      notifResponseRef.current?.remove?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ── Auth routing ───────────────────────────────────────────────────────────────
function AuthGate() {
  const { driver, isLoading, justSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const onAuthScreen  = segments[0] === 'login' || segments[0] === 'register' || segments[0] === undefined;
    const onOnboarding  = segments[0] === 'onboarding';
    const onDispatch    = segments[0] === 'dispatch';
    const onPending     = segments[0] === 'pending';

    if (onDispatch) return;

    if (!driver && !onAuthScreen) {
      router.replace('/login');
    } else if (driver && driver.approved === false && !onPending) {
      // Registered but not yet approved by dispatcher
      router.replace('/pending');
    } else if (driver && driver.approved !== false && onPending) {
      // Approved — get them off the pending screen
      router.replace('/onboarding');
    } else if (driver && driver.approved !== false && justSignedIn && !onOnboarding) {
      router.replace('/onboarding');
    } else if (driver && driver.approved !== false && !justSignedIn && (onAuthScreen || onOnboarding)) {
      router.replace('/(tabs)/home');
    }
  }, [driver, driver?.approved, isLoading, segments, justSignedIn]);

  return null;
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [updateRequired, setUpdateRequired] = useState(false);

  // v12-ota22j: cold-start OTA update gate. Driver feedback: "very hard,
  // every time you have to login to see ota updates". Now we check BEFORE
  // showing the login screen so updates apply on app open, not after sign-in.
  // States: 'checking' → 'downloading' → reload (or → 'ready' if no update)
  const [otaState, setOtaState] = useState<'checking' | 'downloading' | 'ready'>(
    Platform.OS === 'web' ? 'ready' : 'checking'
  );
  const [otaError, setOtaError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Skip in Expo Go — Updates is a no-op there and would just delay startup
    let isExpoGo = false;
    try {
      const Constants = require('expo-constants').default;
      isExpoGo = Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';
    } catch {}
    if (isExpoGo || !Updates.isEnabled) {
      setOtaState('ready');
      return;
    }

    let cancelled = false;
    // Hard cap: never block app boot more than 8 seconds for the update check.
    // If the network is slow, just let the driver in and the update will apply
    // on next launch as usual.
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        console.warn('[OTA] Update check timed out — proceeding with cached app');
        setOtaState('ready');
      }
    }, 8000);

    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (cancelled) return;
        if (!result.isAvailable) {
          clearTimeout(timeoutId);
          setOtaState('ready');
          return;
        }
        setOtaState('downloading');
        await Updates.fetchUpdateAsync();
        if (cancelled) return;
        clearTimeout(timeoutId);
        // v22an: DO NOT call Updates.reloadAsync() here. Force-reloading the
        // app mid-session closes the driver's logged-in state and looks
        // exactly like a crash from the driver's point of view — they have
        // to sign in and Start Shift again, mid-shift. The downloaded bundle
        // is staged on disk; it will be applied automatically on the very
        // next cold start of the app. So the driver simply gets the new
        // version next time they open the app naturally — no interruption.
        console.log('[OTA] Update downloaded — will apply on next cold start');
        setOtaState('ready');
      } catch (e: any) {
        if (cancelled) return;
        clearTimeout(timeoutId);
        console.warn('[OTA] Update check failed:', e?.message);
        setOtaError(e?.message ?? 'unknown error');
        setOtaState('ready');
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // v12-ota9 diagnostic: counts persist on globalThis so they survive
  // module re-evaluation. Counts are tagged onto every Sentry event via
  // beforeSend, so we no longer depend on the boot breadcrumbs surviving
  // the 100-entry ring buffer.
  useEffect(() => {
    bootState.rootLayoutMounts += 1;
    // eslint-disable-next-line no-console
    console.log(
      '[Boot] RootLayout MOUNTED #' + bootState.rootLayoutMounts +
      ' (evalId:', bootState.moduleEvalId,
      'evalCount:', bootState.moduleEvalCount + ')'
    );
    return () => {
      // eslint-disable-next-line no-console
      console.log('[Boot] RootLayout UNMOUNTED');
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Diagnostic JS thread monitor — reports to Sentry whenever the JS thread
  // is blocked >200ms, which is the root cause of unresponsive buttons.
  useEffect(() => {
    const { startJsThreadMonitor } = require('@/lib/perf');
    startJsThreadMonitor();
  }, []);

  // Load remote config (bwConfig/appSettings) and check forced-upgrade gate
  useEffect(() => {
    initRemoteConfig().then(() => {
      if (isUpdateRequired(APP_BUILD, APP_VERSION)) {
        setUpdateRequired(true);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Suppress Firebase RTDB connection timeouts on web — they are non-fatal
  // (RTDB retries automatically) but show as "crash" in the Replit preview pane.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: PromiseRejectionEvent) => {
      const msg = event?.reason?.message ?? String(event?.reason ?? '');
      if (msg.includes('timeout exceeded') || msg.includes('transport errored')) {
        event.preventDefault();
        console.warn('[Firebase] Suppressed non-fatal rejection:', msg);
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  if (!fontsLoaded && !fontError) return null;

  // v12-ota22j: show update splash BEFORE login screen, before AuthGate
  if (otaState !== 'ready') {
    const isDownloading = otaState === 'downloading';
    return (
      <View style={styles.updateRoot}>
        <View style={styles.updateCard}>
          <View style={styles.updateIconWrap}>
            <Ionicons
              name={isDownloading ? 'cloud-download' : 'sync'}
              size={52}
              color="#facc15"
            />
          </View>
          <Text style={styles.updateTitle}>
            {isDownloading ? 'Updating App…' : 'Checking for Updates…'}
          </Text>
          <Text style={styles.updateBody}>
            {isDownloading
              ? 'A new version is downloading. The app will restart automatically when ready — usually 5–15 seconds.'
              : 'Looking for the latest version. This only takes a moment.'}
          </Text>
          <ActivityIndicator size="small" color="#facc15" style={{ marginTop: 4 }} />
        </View>
        <Text style={styles.updateVersion}>v{APP_VERSION} · loading…</Text>
      </View>
    );
  }

  if (updateRequired) {
    return (
      <View style={styles.updateRoot}>
        <View style={styles.updateCard}>
          <View style={styles.updateIconWrap}>
            <Ionicons name="arrow-up-circle" size={52} color="#facc15" />
          </View>
          <Text style={styles.updateTitle}>Update Required</Text>
          <Text style={styles.updateBody}>
            This version of the Bookawaka Driver app ({APP_VERSION}) is no longer
            supported. Please update to the latest version to continue.
          </Text>
          <Text style={styles.updateContact}>
            Contact your fleet administrator or dispatcher for the latest install link.
          </Text>
        </View>
        <Text style={styles.updateVersion}>v{APP_VERSION}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <AuthProvider>
              <DriverProvider>
                <ErrorBoundary>
                  <AuthGate />
                  <PushNotificationSetup />
                  <GlobalCancelHandler />
                  <GlobalSystemKickHandler />
                  <GlobalKeepAwake />
                  <ErrorBoundary>
                    <GlobalJobAlert />
                  </ErrorBoundary>
                  <ErrorBoundary>
                    <PendingJobBanner />
                  </ErrorBoundary>
                  <OfflineBanner />
                  <TripRatingModal />
                  <StatusBar style="light" />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0A0A0F' } }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="login" />
                    <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
                    <Stack.Screen name="pending" options={{ animation: 'fade' }} />
                    <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="job/[id]" options={{ presentation: 'card' }} />
                    <Stack.Screen name="chat/[id]" options={{ presentation: 'card' }} />
                    <Stack.Screen name="dispatch" options={{ headerShown: false }} />
                  </Stack>
                </ErrorBoundary>
              </DriverProvider>
            </AuthProvider>
          </ErrorBoundary>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  updateRoot: {
    flex: 1, backgroundColor: '#0A0A0F',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  updateCard: {
    backgroundColor: '#18181f', borderRadius: 24, borderWidth: 1,
    borderColor: '#facc1533', padding: 32, alignItems: 'center', gap: 16,
    maxWidth: 360, width: '100%',
  },
  updateIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#facc1514', borderWidth: 1, borderColor: '#facc1533',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  updateTitle: {
    fontSize: 24, fontWeight: '800', color: '#facc15', textAlign: 'center',
  },
  updateBody: {
    fontSize: 15, color: '#e2e8f0', textAlign: 'center', lineHeight: 23,
  },
  updateContact: {
    fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 20,
    marginTop: 4,
  },
  updateVersion: {
    fontSize: 12, color: '#334155', marginTop: 24,
  },

  pendingWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 999,
  },
  pendingInner: {
    backgroundColor: '#d97706',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    boxShadow: '0px 4px 8px rgba(0,0,0,0.35)',
    elevation: 8,
  },
  pendingTitle: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
  pendingAddr: {
    color: '#fef3c7',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginTop: 1,
  },
});

export default Sentry.wrap(RootLayout);
