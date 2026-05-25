# Taxi360 Driver — Expo Mobile App

## Project Overview

**Taxi360 Driver** is a cross-platform mobile application (iOS + Android) built with Expo/React Native, converted from the original Android Java codebase. Multi-tenant Bookawaka SaaS platform, companyId-isolated, sharing Firebase Realtime Database (taxilatest.firebaseio.com).

## Architecture

- **Framework**: Expo SDK 54 (expo-router file-based routing)
- **Language**: TypeScript
- **State**: React Context (AuthContext, DriverContext) + AsyncStorage for persistence
- **UI**: Custom components with dark taxi-yellow theme, Inter fonts
- **Port**: 5000 (web preview via proxy → Metro :8081)
- **Distribution**: EAS **production** channel → branch `production`, runtime **1.5.0** (matches current app.json `version`), bundle `com.khybertech.taxi360driver`. Test device: Galaxy A04 (Play Store install). Publish command: `EAS_SKIP_AUTO_FINGERPRINT=1 EAS_NO_VCS=1 npx eas-cli update --branch production --message "..." --non-interactive`. DO NOT publish to branch `lovesaf/taxi360-driver` — no channel maps to it. DO NOT change app.json version to publish at a different runtime unless the device's APK runtime is verified first.

## Tab Structure (6 tabs)

| Tab | File | Purpose |
|---|---|---|
| **Dashboard** | `home.tsx` | Shift on/off, stats, live map, job offer modals, compliance hours. Badge shows pending offers. |
| **Book** | `jobs.tsx` | Driver creates passenger bookings → `pendingjobs/{companyId}`. |
| **Meter** | `meter.tsx` | **Single unified meter for ALL trip types** — hail (via MeterPanel) + dispatch/passenger/website (custom UI with Leaflet + OSRM turn-by-turn). |
| **Chat** | `chat.tsx` | Messaging with dispatchers |
| **Shift** | `shift.tsx` | Hours, breaks, compliance, shift history |
| **Profile** | `profile.tsx` | Driver info, settings, vehicles |

## Trip Flow — Single Unified Meter

All trip types flow through the **Meter tab** — no separate meters elsewhere:

1. **Dispatch / Passenger App / Website** → Offer modal on Dashboard → Accept → Meter tab shows job card + Leaflet nav (driver→pickup) + "I've Arrived" → arrived → map switches to pickup→dropoff + "Start Meter" (TariffPicker) → live fare → "Complete Trip" → completion modal (drop address + PaymentCapture) → `completeJob()` writes to Firebase.
2. **Hail trip** → "Hail a Passenger" on Dashboard or Meter tab → MeterPanel handles pickup/zone/tariff/start → "End Trip" → completion modal → `completedJobs/{companyId}`.
3. **Dashboard active-job card** shows live meter preview + single "Open Meter" button. No duplicate controls on Dashboard.

## Key Files

```
app/
  _layout.tsx         # Root layout (providers, fonts, auth guard)
  index.tsx           # Auth redirect
  login.tsx           # Sign in screen
  (tabs)/
    _layout.tsx       # Bottom tab bar (Dashboard·Book·Meter·Chat·Shift·Profile)
    home.tsx          # Dashboard (shift, stats, offers, live map)
    jobs.tsx          # Book a Ride (create booking → dispatch)
    meter.tsx         # Unified trip hub (ALL meter control lives here)
    chat.tsx          # Chat inbox
    shift.tsx         # Shift management
    profile.tsx       # Driver profile/settings
  job/[id].tsx        # Job detail page (info only — controls in Meter tab)
  chat/[id].tsx       # Chat conversation thread
context/
  DriverContext.tsx   # All driver state: jobs, meter, hail, shifts, chat, presence
  AuthContext.tsx     # Auth state, sign in/out
components/
  MeterPanel.tsx      # Hail trip UI (used by Meter tab when no dispatch job active)
  PaymentCapture.tsx  # Cash / Card (Stripe) / TM / Account / ACC / Gift Card
  TariffPicker.tsx    # Bottom-sheet tariff selector
  AddressInput.tsx    # Geocoded address input (Nominatim)
  JobCard.tsx         # Job list item (React.memo)
  HailJobCard.tsx     # Hail job list item (React.memo)
lib/
  firebase.ts         # Firebase RTDB connection
  stripeCharge.ts     # Stripe card charge helper
  tripJournal.ts      # Non-blocking trip event journal (Firebase)
  haptics.ts          # Expo Haptics wrapper
  shiftCompliance.ts  # NZ work-time compliance helpers
  offlineQueue.ts     # AsyncStorage write queue (flushQueue / rewriteQueue)
  centralJobId.ts     # POST /api/job/create with 3-retry server ID enforcement
  backgroundLocation.ts # expo-task-manager background GPS (dev build only)
  perf.ts             # instrumentTap + Sentry slow-tap reporter
```

## Firebase Paths

| Path | Purpose |
|---|---|
| `online/{companyId}/{vehicleId}/current` | Driver presence & vehicle status |
| `online/{companyId}/{vehicleId}/vehiclestatus` | Top-level status (dispatch board reads this) |
| `notification/{driverId}` | Incoming job offers (primary) |
| `notification/{vehicleId}` | Backward-compat relay path |
| `allbookings/{companyId}/{jobId}` | Accepted/active jobs |
| `completedJobs/{companyId}` | Completed trips (hail + dispatch) |
| `pendingjobs/{companyId}/{key}` | Driver-created bookings → unassigned tab |
| `messages/{companyId}` + `driverMsg/{companyId}` | Driver ↔ dispatcher chat |
| `tariffs/{companyId}` | Company tariff definitions |
| `trips/{companyId}/{tripId}` | Total Mobility trip records |
| `rideStatus/{companyId}/{bookingId}` | Lifecycle status (Assigned/Queued/OnTrip/Completed/Declined/Cancelled) |
| `passengerRatings/{companyId}/{phone}/{bookingId}` | Trip ratings |
| `stripeConfig/{companyId}` | Per-company Stripe keys |

## Tech Stack

- Expo SDK 54 (expo-router, react-native 0.81.5)
- Firebase RTDB — taxilatest.firebaseio.com, companyId 620611
- Leaflet + OpenStreetMap — maps via WebView (react-native-webview)
- OSRM — routing (free, OSS)
- Nominatim — geocoding (free)
- Stripe — card payments via stripeServer.js on :5002
- expo-location (foreground) + expo-task-manager (background — dev build only)
- Sentry (@sentry/react-native) — perf monitoring + crash reporting
- Inter font family

## Behaviour Notes (Active Invariants — DO NOT REGRESS)

These are non-obvious correctness guarantees baked in over many iterations. Touch with care.

### Identity & presence
- `AuthContext` reads BOTH `assignedVehicles` (array) AND `allocatedVehicles` (Owner Portal object `{"Taxi02":true}`) in login + live profile listener.
- `online/{cid}/{vid}/current` heartbeat MUST include `vehicletype` + `PlayerId` (Firebase auth UID) — dispatch zone-queue listener silently drops records lacking these.
- Top-level `online/{cid}/{vid}/vehiclestatus` is the field dispatch board checks for fast-path Offline removal. `acceptJob` sets it to `Assigned`; `completeJob` and `_freeDriver` reset to `Available`. `writeOnlinePresence` only touches `/current/`.
- Sign-out sequence: (1) write top-level `vehiclestatus: 'Offline'` first; (2) cancel `onDisconnect` on `/current` and parent; (3) `setTimeout(50ms)` to `remove(online/{cid}/{vid})` whole node.
- Stale presence cleared on driver load; connection state driven by Firebase `.info/connected` only.

### Job offers
- Primary notification listener is `notification/{vehicleId}` (dispatch writes there); backward-compat relay copies `notification/{driverId}` → `notification/{vehicleId}`.
- `seenBookingIdsRef` deduplicates across the notification listener AND the jobs-path listener (dispatch writes both — without dedup the modal double-popped and swallowed taps).
- `isDispatcherJobOffer` catch-all guard surfaces any dispatcher offer with a numeric booking ID that wasn't classified as Away / Auto-dispatch / suspend / kick.
- Brand-new offer on a free driver from `jobs/` listener creates `offered` job + calls `setIncomingJob` + fires `scheduleJobNotification` if backgrounded.
- `acceptJob` writes `online/{cid}/{vid}/current/currentJobId = bookingId` + top-level `vehiclestatus: 'Assigned'` for crash-recovery and dispatch board correctness.

### Cancellation messages
- All 4 paths read `CancelledBy` field: jobs-path deleted, jobs-path Status:Cancelled, Passengerjobs path, allbookings listener. Show "The passenger has cancelled" / "cancelled by dispatch" / generic fallback.

### Hail trip
- `requestCentralJobId` returns `JobIdResult` (`{ok, jobId} | {ok, networkError, serverError}`). 3 retries.
- `startHailTrip` BLOCKS (Alert + early return) if all retries fail — NO local fallback ID (SA portal requirement to prevent ID collisions).
- `openHailModal` resets `hailBookingType = 'taxi'` (no food/freight selector) AND resets `activeTariffRef` to first non-TM tariff.
- `completeHailTrip` snapshots fare/dist/secs synchronously BEFORE `stopMeter()` zeros refs. Calls `saveTripSummary` with full fare breakdown. Resets tariff to first non-TM after completion. Writes `currentJobId: null` in cleanup.

### Meter accuracy
- Meter `setInterval` has zero network calls in the tick. Offline indicator never tears down the interval.
- `completeJob` snapshots `meterDistanceRef`/`meterSecondsRef` BEFORE `stopMeter()` — used by `saveTripSummary` so `fare.total` is never zero.
- AppState tracker: `backgroundedAtRef = Date.now()` on background; on foreground resume computes elapsed seconds and injects into `meterSecondsRef` + waiting-cost refs, then restarts interval. Handles screen-off / lock perfectly. (True background execution requires dev build + `expo-task-manager`.)
- `meter.tsx handleOpenComplete` calls `pauseMeter()` immediately after snapshotting, before opening payment modal. Resumes on modal close. `completionPausedRef` tracks state.

### Payments
- Payment types: `cash` · `eftpos` · `card` · `account` · `acc` · `total_mobility` · `gift_card`. ACC ≠ Account; `parsePaymentType` updated. ACC → `accountPayment: true`. Gift Card → `cashPayment: true`. `isAccTrip` triggers for both `account` and `acc`.
- `stripeServer.js` exposes `GET /api/payment-config?cid` (reads `stripeConfig/{cid}`) + `POST /api/stripe/charge` prefers company-specific keys.
- TM subsidy = `fare − tmPassengerPays` (was always 0 before fix).

### Writes & sync
- `completeJob` (dispatch trips) writes `completedJobs/{cid}` AND `allbookings` AND fires `POST /api/job/sync-offline-trip` with full fare breakdown. Calls `runPendingUpload()` immediately after `saveTripSummary`.
- `completeHailTrip` mirrors the same sync POST for hail trips.
- `rideStatus/{cid}/{bookingId}` written at: acceptJob (Assigned), acceptJobToQueue (Queued), startMeter (OnTrip), `_freeDriver` (Declined/Cancelled), completeJob (Completed). All best-effort `.catch(() => {})`.
- `flushQueue` preserves failed items via `rewriteQueue(failed)` — no longer drops writes that throw during replay.
- `completeJob` enqueues to AsyncStorage if offline (`type: 'jobComplete'`); replays on reconnect.
- `sendChatMessage` writes ONLY to `driverMsg/{cid}` + `messages/{cid}` (all `notification/` and `chat/` writes removed — was causing dispatch double-display).
- `passengerRatings` write includes both `ratedAt` (ISO) and `timestamp` (ms epoch) for Owner Panel / SA portal flexibility.
- Driver app does NOT write `driverEarnings` directly — SA portal `syncOfflineTrip` handles that.

### Idempotency
- `completionInFlightRef` (in `meter.tsx handleConfirmComplete`) prevents duplicate completeJob calls on rapid taps.
- Optimistic-close: completion modal closes FIRST, then `completeJob` runs in background via `setTimeout(0)` — UI bounces instantly.

### Background GPS (dev build only — silent no-op in Expo Go / web)
- `expo-task-manager` task `taxi360-background-location` registered. Started by `startShift`, stopped by `endShift` / `clearOnlinePresence` / driver=null safety effect.
- Pushes `{lat, lng, hasGps, time, lastSeen, online, bgUpdate:true}` to `online/{cid}/{vid}/current` every 15s or 25m of movement. `Accuracy.High`.
- Context (`{companyId, vehicleId, driverId}`) persisted to AsyncStorage `taxi360.bgLocationCtx.v1` to survive Android task wake-up after JS engine teardown.
- Foreground service notification on Android keeps OS from killing task. iOS `UIBackgroundModes: ["location","fetch"]`. `app.json` permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `WAKE_LOCK`.

## Recent OTA Builds

| OTA | Focus |
|---|---|
| 22e | Offer-modal double-pop fix — jobs-path listener checks `seenBookingIdsRef` (shared with notification listener); enriches existing offer in-place instead of remounting. |
| 22f | Memoized aggregations in home/shift/profile (todayEarnings, unreadChats, weekly stats, recentShifts, etc.) via `useMemo`. |
| 22g | `JobCard` + `HailJobCard` wrapped in `React.memo` with custom equality. |
| 22h | Sign-out skips `Alert.alert` confirmation (Samsung One UI was dropping the native dialog under JS load — driver had to tap 20×). `JobOfferModal` wrapped in `React.memo`; `handleAcceptOffer`/`handleRejectOffer` are `useCallback`'d; modal receives `job` as handler arg so closures are stable across parent re-renders (meter ticks no longer cause modal re-mount + animation restart that was eating first tap). |

## Known Outstanding

- **App self-closes after a few minutes** in Expo Go — Android OS reclaiming background memory. Only fixable with a custom EAS dev build (foreground-service notification keeps process alive). Same dev build unlocks true background-meter / background-GPS.
- **Single-screen redesign** considered but rejected by user (option 3: keep patching 6-tab layout, prioritise speed/bug fixes first).
