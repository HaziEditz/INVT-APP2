import React, {
  createContext, useContext, useState, useEffect, useRef, useMemo, ReactNode,
  startTransition,
} from 'react';
import * as Sentry from '@sentry/react-native';
import { Alert, AppState, AppStateStatus, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { ref, onValue, off, set, update, remove, get, push, onDisconnect, runTransaction, goOnline, serverTimestamp, DatabaseReference, query, limitToLast, onChildAdded, onChildChanged, onChildRemoved } from 'firebase/database';
import { markSyncBlock } from '@/lib/perf';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import { database } from '@/lib/firebase';
import { APP_VERSION } from '@/lib/config';
import { dispatchPost, notifyDriverBusy } from '@/lib/dispatchApi';
import { fetchActiveBookings } from '@/lib/activeBookings';
import { useAuth, Driver } from './AuthContext';
import { scheduleJobNotification, cancelJobNotifications } from '@/lib/pushNotifications';
import { enqueueWrite, readQueue, clearQueue, rewriteQueue, QueuedWrite } from '@/lib/offlineQueue';
import { enqueueSyncPost, drainSyncPostQueue } from '@/lib/syncPostQueue';
import { sendOrQueueJobCommand, drainJobCommandQueue, newClientRequestId } from '@/lib/jobCommand';
import {
  appendJournalEntry,
  saveTripSummary,
  getPendingCount,
  cleanOldTrips,
  getStuckTripsDetail,
  clearSpecificStuckTrip,
  getPendingTripIds,
  StuckTripDetail,
} from '@/lib/tripJournal';
import { uploadPendingTrips } from '@/lib/syncOfflineTrips';
import { getServerUrl } from '@/lib/remoteConfig';
import { fmtNZDate, fmtNZTime } from '@/lib/timezone';
import * as Haptics from '@/lib/haptics';
import { checkForResumedJob, ResumedJobData } from '@/lib/resumeJob';
import { requestCentralJobId } from '@/lib/centralJobId';
import { checkShiftStartCompliance, DAILY_LIMIT_MS, WEEKLY_LIMIT_MIN, fmtMs, fmtMins, fmtNZDateTime } from '@/lib/shiftCompliance';
import { startBackgroundLocation, stopBackgroundLocation } from '@/lib/backgroundLocation';
// v12-ota22c4: durable meter snapshot for crash / force-close / OS-kill recovery
import { saveMeterSnapshot, loadMeterSnapshot, clearMeterSnapshot } from '@/lib/meterSnapshot';
import {
  parseBookingEvent,
  patchFromChanges,
  extractChanges,
  sortBookingEventsBySeq,
} from '@/lib/bookingEvents';

export type DriverStatus = 'Available' | 'Assigned' | 'Busy' | 'Away';

export interface Job {
  id: string;
  passengerName: string;
  passengerPhone: string;
  pickupAddress: string;
  dropAddress: string;
  fare: number;
  distance: string;
  duration: string;
  status: 'offered' | 'current' | 'queued' | 'completed';
  createdAt: string;
  completedAt?: string;
  notes?: string;
  bookingId?: string;
  deviceUid?: string;
  paymentType?: PaymentType;
  offerTimeoutSecs?: number;  // dispatcher's configured response window (seconds)
  offerSentAt?: number;       // Unix ms when the dispatcher sent this offer
  vehicleType?: string;       // required vehicle type from dispatcher ("Car","Van","Not Specified",…)
  passengers?: number;        // required passenger count from dispatcher
  bookingType?: string;       // e.g. "Freight", "Food", "FullVehical", "Normal" — from BookingType field
  orderDetails?: string;      // free-text order details from freight/food owner panel (Details/Info field)
  sourceCompanyId?: string;   // set when job is dispatched by a different company (shared-driver feature)
  // Total Mobility fields — set by dispatcher when paymentType === 'total_mobility'
  tmVoucherNo?: string;       // TM card / voucher number
  tmPassengerName?: string;   // cardholder name on TM card
  tmCardExpiry?: string;      // card expiry MM/YY
  tmHoistRequired?: boolean;  // does the vehicle need the wheelchair hoist?
  tmHoistCount?: number;      // number of hoists needed
  tmSubsidy?: number;         // council subsidy amount
  tmPassengerPays?: number;   // amount passenger pays (fare minus subsidy)
  tmPaymentMethod?: string;   // how passenger pays their portion (cash/card)
  // Completion summary fields — populated when job is completed
  tariffName?: string;        // tariff used (e.g. "Total Mobility")
  waitingMins?: number;       // minutes waited at pickup before meter started
  waitingCost?: number;       // cost during waiting period
  rideCost?: number;          // distance-based fare component
  flagFall?: number;          // flag fall component
  arrivedAt?: string;         // ISO timestamp: driver tapped "Arrived"
  pickedUpAt?: string;        // ISO timestamp: meter started (passenger on board)
  wheelchair?: boolean;       // true = WAV required (sourced from ACC client record)
  acc_client_id?: string;     // ACC client — show "ACC Funded" badge (no claim/PO details shown to driver)
  po_id?: string;             // Purchase Order ID — used only for tripsUsed increment on completion
  jobPaymentMethod?: string;  // raw paymentMethod from dispatch notification ('cash'|'card'|'account'|'online'|'stripe'|''); drives meter-vs-fixed-price logic
  paymentStatus?: string;     // 'paid' | 'completed' | 'pending' | '' — set by dispatch or Stripe webhook
  prepaid?: boolean;          // legacy prepaid flag — treated same as paymentStatus='paid'
  serviceType?: string;       // 'taxi' | 'food' | 'freight' | 'tm' — service type from dispatch
  stops?: string;             // extra stops (from nextstopdata / StopAdded events)
}

/** Returns true if the job has already been paid (online/card/Stripe etc.)
 *  so no fare collection is needed from the passenger at trip end. */
export function isJobPrepaid(job: Job | null | undefined): boolean {
  if (!job) return false;
  const ps = (job.paymentStatus ?? '').toLowerCase();
  return ps === 'paid' || ps === 'completed' || job.prepaid === true;
}

export interface ShiftRecord {
  id: string;
  date: string;
  startTime: string;
  startMs?: number;       // epoch ms for elapsed-timer calculations
  endMs?: number;         // epoch ms when shift ended — reliable duration calculation
  endTime?: string;
  earnings: number;
  jobCount: number;
  shiftLogId?: string;    // Firebase key in shiftLogs/{companyId}/{driverId}
  breakMinutes?: number;  // total break time recorded for this shift
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  timestamp: string;
  mediaType?: 'image' | 'video' | 'audio' | null;
  mediaUrl?: string | null;
}

export interface ChatThread {
  id: string;
  contactName: string;
  contactType: 'dispatcher' | 'passenger';
  lastMessage: string;
  lastTime: string;
  unread: number;
  messages: ChatMessage[];
}

export interface OnlineDriver {
  vehicleId: string;
  vehicleNumber: string;
  driverName: string;
  status: string;
  lat: number;
  lng: number;
  zoneName: string;
  zoneId: number;
  zoneQueue: number;
  jobCount: number;
  joboffer: number;
}

export interface MyZoneInfo {
  zoneName: string;
  zoneId: number;
  zoneQueue: number;
  vehicleStatus: string;
  zoneAssignedAt: number | null; // ms timestamp when this zone was assigned/changed
}

export interface Tariff {
  id: string;
  name: string;
  flagFall: number;
  ratePerMile: number;
  waitingPerMin: number;
  speedThreshold: number;  // km/h — below this speed the car is considered stopped (waiting mode)
  waitingInterval: number; // seconds — charge waitingPerMin once per this many stopped seconds
}

export interface HailJob {
  id: string;
  bookingId: string;
  passengerName: string;
  passengerPhone: string;
  pickupAddress: string;
  dropAddress: string;
  fare: number;
  distance: string;
  duration: string;
  notes?: string;
  createdAt: string;
  claimedBy?: string;
}

// v22bo: 'split' = passenger pays the fare across multiple methods in a single
// trip (e.g. account customer pays 70 % by account + 30 % by cash). The split
// rows live on PaymentData.splitParts; dispatch HQ receives them in the sync
// POST as PaymentSplits[] (replacing the previous null placeholder).
export type PaymentType = 'cash' | 'eftpos' | 'card' | 'account' | 'total_mobility' | 'acc' | 'gift_card' | 'split';

export interface PaymentSplitPart {
  method: Exclude<PaymentType, 'split'>;
  amount: number;
}

export interface PaymentData {
  type: PaymentType;
  // Total Mobility
  tmVoucherNo?: string;      // TM card number / voucher number
  tmPassengerPays?: number;  // Amount passenger pays (their subsidised portion)
  tmSubsidy?: number;        // Council subsidy amount
  tmPassengerName?: string;  // Name of TM card holder
  tmTripCategory?: string;   // 'medical' | 'social' | 'employment' | 'other'
  // Card (manual entry + Stripe charge)
  cardLastFour?: string;     // Last 4 digits
  cardHolder?: string;       // Cardholder name
  cardExpiry?: string;       // MM/YY format
  cardBrand?: string;        // 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown'
  stripePaymentIntentId?: string; // Stripe PaymentIntent id after successful charge
  stripeCharged?: boolean;        // true once the card has been charged via Stripe
  // Account / ACC Claim
  accClientRef?: string;     // Human-readable client reference typed by driver (e.g. ACC-00142)
  accClientId?: string;      // Resolved Firebase push key from accClients lookup
  accResolvedName?: string;  // Client display name resolved from Firebase
  accClaimNo?: string;       // ACC claim number (shared between 'account' and 'acc' types)
  accPoNumber?: string;      // Purchase order number
  // Gift Card
  giftCardCode?: string;     // Gift card number / redemption code
  // v22bo: split-payment parts (cash + card + account + TM + ACC + gift card
  // in any combination). When type==='split', splitParts is the source of
  // truth and must sum to the fare.
  splitParts?: PaymentSplitPart[];
  // v22bo: account-client default split percentage (0-100) loaded from
  // accClients/{cid}/{key}/percentPaid — used to pre-fill split rows.
  accPercentPaid?: number;
}

export interface JobCompletionExtras {
  tariffName?: string;
  waitingMins?: number;
  waitingCost?: number;
  rideCost?: number;
  flagFall?: number;
  arrivedAt?: string;
  pickedUpAt?: string;
  dropLatLng?: string;   // "lat,lng" GPS position captured at drop-off (legacy combined string)
  distanceKm?: number;   // kilometres on meter
  pickupLat?: number;    // GPS at driver Arrived / trip start
  pickupLng?: number;
  dropLat?: number;      // GPS at trip completion
  dropLng?: number;
  dropAddress?: string;  // human-readable address at drop-off (GPS reverse-geocoded or modal input)
  driverCost?: number;   // driver's share of fare (no commission model yet)
  // Total Mobility
  tmVoucherNo?: string;
  tmPassengerName?: string;
  tmTripCategory?: string;
  tmPassengerPays?: number;
  tmSubsidy?: number;    // council subsidy amount — written to allbookings & completedJobs for SA portal
  // Card details
  cardLastFour?: string;
  cardHolder?: string;
  cardExpiry?: string;
  cardBrand?: string;
  stripePaymentIntentId?: string;
  stripeCharged?: boolean;
  // v22be — extra payment context for /api/job/sync-offline-trip enrichment
  accClaimNo?: string;
  accClientRef?: string;
  accClientId?: string;
  giftCardCode?: string;
  paymentType?: string;       // raw payment-method tap (cash/card/eftpos/account/total_mobility/acc/gift_card/split)
  driverNote?: string;        // free-text note from driver (reserved — no UI yet, wire format ready)
  tripIssueCategory?: string; // 'none'|'vomit'|'damage'|'no-show'|'refused'|'other' (reserved)
  fixedFareOverride?: number; // flat fare override amount (reserved — no UI yet)
  fixedFareReason?: string;   // 'fixed_flat_fare'|'manual_adjustment'|'discount'|'other' (reserved)
  fixedFareNote?: string;     // explanation (reserved)
  // v22bm: per-trip extras picked by driver on completion modal (Airport,
  // Bike carrier, Extra bag, EFTPOS surcharge, Cleaning, Other). Each item
  // is `{ id, name, amount }`. extrasTotal is the sum (added to fare.total).
  extrasItems?: { id: string; name: string; amount: number }[];
  extrasTotal?: number;
  // v22bo: split-payment parts (method + amount) when passenger pays across
  // multiple methods. Sent to dispatch HQ as PaymentSplits[]. Sums to fare.
  paymentSplits?: { method: string; amount: number }[];
  accPercentPaid?: number; // v22bo: client-default account-pay percentage (0-100)
}

// v22bg: capture once at module load — runtime metadata HQ now persists on
// every closed-job record so they can answer "which OTA was this driver on
// for trip #X" without asking us. Sent at the root of /api/job/sync-offline-trip.
const RUNTIME_META = {
  runtimeVersion: String(Updates.runtimeVersion ?? ''),
  groupId:        String((Updates as any).updateId ?? ''),
  channel:        String((Updates as any).channel ?? ''),
  platform:       Platform.OS,
  appVersion:     APP_VERSION,
};

// v22bi: HQ asked for canonical mm:ss / hh:mm:ss duration string on every
// closed-trip payload so the dispatch console doesn't have to derive it.
function fmtDurationMmSs(totalSeconds: number): string {
  const t = Math.max(0, Math.round(totalSeconds));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

// v22bk: helpers to summarise the per-trip waiting windows for the sync POST.
//   waitingMinutes = sum of (end-start) seconds / 60, rounded to 1dp.
//   waitingWindows = array of {start, end} ISO pairs (open windows are closed
//   with `closeAtISO` for the snapshot — the live ref is untouched).
function summariseWaitingWindows(
  windows: ReadonlyArray<{ start: string; end?: string }>,
  closeAtISO: string,
): { waitingMinutes: number; waitingWindows: Array<{ start: string; end: string }> } {
  let totalSecs = 0;
  const closed: Array<{ start: string; end: string }> = [];
  for (const w of windows) {
    const end = w.end ?? closeAtISO;
    const startMs = new Date(w.start).getTime();
    const endMs   = new Date(end).getTime();
    if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) continue;
    totalSecs += Math.round((endMs - startMs) / 1000);
    closed.push({ start: w.start, end });
  }
  return {
    waitingMinutes: parseFloat((totalSecs / 60).toFixed(1)),
    waitingWindows: closed,
  };
}

// v22bi: shared sync-offline-trip POST helper with Sentry breadcrumb + warning
// on failure (HQ-requested visibility — was silent .catch(()=>{}) before, which
// caused today's missing hail-trip incident).
// v22bj: also enqueues failed POSTs to AsyncStorage for retry; drains on every
// successful POST + on AppState foreground + on network online + every 60s.
function postSyncOfflineTrip(
  url: string,
  payload: Record<string, unknown>,
  meta: { bookingId: any; driverId: any; serviceType: string; tripCloseTime: string },
) {
  const _onFailure = (httpStatus: number | string, errorMsg: string) => {
    try {
      Sentry.addBreadcrumb({
        category: 'dispatch',
        level: 'warning',
        message: 'syncOfflineTrip POST failed',
        data: { ...meta, httpStatus, errorMsg: errorMsg.slice(0, 200) },
      });
      Sentry.captureMessage(`syncOfflineTrip POST failed: ${httpStatus} (${meta.serviceType})`, 'warning');
    } catch { /* breadcrumb best-effort */ }
    // v22bj: persist for retry — drain on foreground / network online / periodic
    enqueueSyncPost(url, payload, meta).catch(() => {});
  };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn('[syncOfflineTrip] HTTP', res.status, 'for', meta.bookingId);
        _onFailure(res.status, `HTTP ${res.status}`);
      } else {
        // v22bj: opportunistic chain-drain — every successful POST nudges any
        // previously queued failures to retry while we know the network works.
        drainSyncPostQueue().catch(() => {});
      }
    })
    .catch((e: any) => {
      const _msg = String(e?.message ?? e ?? '');
      const _httpStatus = e?.name === 'AbortError' ? 'timeout' : 'network_error';
      console.warn('[syncOfflineTrip] network error for', meta.bookingId, '-', _msg);
      _onFailure(_httpStatus, _msg);
    });
}

function parsePaymentType(raw?: string): PaymentType {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s.includes('eftpos'))                                                           return 'eftpos';
  if (s.includes('credit') || s === 'card')                                           return 'card';
  if (s === 'acc' || s === 'accident_compensation' || s === 'accident compensation')   return 'acc';
  if (s === 'account' || s === 'acct')                                                return 'account';
  if (s.includes('mobility') || s === 'tm' || s.includes('voucher') || s === 'total_mobility') return 'total_mobility';
  if (s === 'gift_card' || s === 'gift card' || s.includes('giftcard'))               return 'gift_card';
  if (s === 'split' || s.includes('split'))                                           return 'split'; // v22bo
  return 'cash';
}

// ── NZ LOCAL TIME HELPERS ────────────────────────────────────────────────────
// The dispatcher console reads dates as plain strings written to Firebase.
// Using ISO / UTC timestamps causes wrong date+time on the dispatcher side
// (NZ is UTC+12/UTC+13, so UTC shows the wrong hour and sometimes wrong date).
// These helpers always produce strings in Pacific/Auckland local time.
const NZ_TZ = 'Pacific/Auckland';
function nzDateTime(d: Date = new Date()): string {
  try {
    return d.toLocaleString('en-NZ', {
      timeZone: NZ_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return d.toISOString(); }
}
function nzDate(d: Date = new Date()): string {
  try {
    return d.toLocaleDateString('en-NZ', { timeZone: NZ_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return d.toISOString().slice(0, 10); }
}
function nzTime(d: Date = new Date()): string {
  try {
    return d.toLocaleTimeString('en-NZ', { timeZone: NZ_TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  } catch { return d.toISOString().slice(11, 19); }
}
// v22az: NZ-local ISO without Z / offset suffix. The dispatch console treats
// unstamped ISO as already-NZ-local (matches their TZ=Pacific/Auckland setup),
// so we must NOT send the UTC `2026-05-15T14:21:17.443Z` form for timeline
// timestamp fields (BookingDateTime / OfferedAt / AcceptedAt / PickingAt /
// ActiveAt / JobCompleteTime). Produces e.g. "2026-05-16T02:21:17".
function nzLocalISO(d: Date = new Date()): string {
  try {
    // Swedish locale prints YYYY-MM-DD HH:mm:ss; swap space for "T".
    return d.toLocaleString('sv-SE', { timeZone: NZ_TZ }).replace(' ', 'T');
  } catch { return d.toISOString().replace(/\.\d+Z$/, ''); }
}
// Format seconds as "mm:ss" for the dispatch console's TotalTime field.
function fmtMinSec(totalSecs: number): string {
  const safe = Math.max(0, Math.floor(totalSecs || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// ─────────────────────────────────────────────────────────────────────────────

export interface TariffChange {
  tariff: Tariff;
  changedAt: string;
  distanceKm: number;
  seconds: number;
}

export interface PauseEntry {
  pausedAt: string;
  resumedAt: string;
  durationSecs: number;
}

export interface HailTripMeta {
  bookingId: string;
  pickupAddress: string;
  zone: string;
  paymentType: PaymentType;
  paymentData?: PaymentData;  // full payment capture including TM voucher / card details
  startedAt: string;
  initialTariff: Tariff;
  pickupLat?: number;   // GPS captured when meter starts
  pickupLng?: number;
  bookingType?: string; // 'taxi' | 'food' | 'freight' — set by driver at hail start
}

const DEFAULT_TARIFFS: Tariff[] = [
  { id: 't1', name: 'Tariff 1 — Day',       flagFall: 3.00, ratePerMile: 2.80, waitingPerMin: 0.24, speedThreshold: 1, waitingInterval: 60 },
  { id: 't2', name: 'Tariff 2 — Night',     flagFall: 4.00, ratePerMile: 3.20, waitingPerMin: 0.30, speedThreshold: 1, waitingInterval: 60 },
  { id: 't3', name: 'Tariff 3 — Public Hol',flagFall: 5.00, ratePerMile: 3.80, waitingPerMin: 0.38, speedThreshold: 1, waitingInterval: 60 },
];

interface DriverContextType {
  driver: Driver | null;
  status: DriverStatus;
  setStatus: (s: DriverStatus) => void;
  jobs: Job[];
  offeredJobs: Job[];
  currentJob: Job | null;
  queuedJobs: Job[];
  completedJobs: Job[];
  acceptJob: (job: Job) => Promise<void>;
  acceptJobToQueue: (job: Job) => Promise<void>;
  rejectJob: (jobId: string) => Promise<void>;
  recallJob: (jobId: string, reason?: string) => Promise<void>;
  completeJob: (jobId: string, fare: number, extras?: JobCompletionExtras) => Promise<void>;
  incomingJob: Job | null;
  dismissIncoming: () => void;
  shiftActive: boolean;
  currentShift: ShiftRecord | null;
  shiftHistory: ShiftRecord[];
  startShift: () => Promise<void>;
  endShift: () => Promise<void>;
  breakActive: boolean;
  breakStartMs: number | null;
  todayBreakMs: number;
  weeklyWorkMinutes: number;
  lastShiftEndMs: number | null;
  shiftBlocked: { reason: string; availableAt: number } | null;
  startBreak: () => void;
  endBreak: () => void;
  // v12-ota18: chatThreads/sendChatMessage/quickReplies moved to useDriverChat()
  meterRunning: boolean;
  meterPaused: boolean;
  meterIsWaiting: boolean;
  meterWaitingIntervals: number;
  // v12-ota13: meterSeconds/meterDistance/meterFare/meterWaitingCost moved to
  // DriverTickContext (useDriverTick) so they don't cascade re-renders to
  // every screen every second.
  startMeter: () => void;
  pauseMeter: () => void;
  stopMeter: () => void;
  cancelTrip: () => void;
  submitTripRating: (
    bookingId: string,
    rating: number,
    source: 'hail' | 'dispatch',
    extras?: { reasons?: string[]; comment?: string; passengerPhone?: string; passengerName?: string },
  ) => void;
  pendingRating: { bookingId: string; source: 'hail' | 'dispatch'; passengerName?: string; passengerPhone?: string; fare?: number } | null;
  clearPendingRating: () => void;
  addMeterDistance: (km: number) => void;
  availableTariffs: Tariff[];
  activeTariff: Tariff;
  setActiveTariff: (t: Tariff) => void;
  isConnected: boolean;
  // v12-ota16: onlineDrivers + myZoneInfo moved to useDriverFleet() — see bottom of file
  hailJobs: HailJob[];
  claimHailJob: (job: HailJob) => Promise<{ status: 'ok'; jobId: string } | { status: 'taken' } | { status: 'error' }>;
  createPendingJob: (fields: {
    passengerName: string;
    passengerPhone: string;
    passengerEmail: string;
    pickupAddress: string;
    dropAddress: string;
    vehicleType: string;
    notes: string;
    scheduledFor: Date | null;
    dispatcherOnly: boolean;
  }) => Promise<{ bookingId: string; dispatchVisible: boolean }>;
  takenAlert: string | null;
  dismissTakenAlert: () => void;
  cancelledJobAlert: { id: number; title: string; message: string } | null;
  clearCancelledJobAlert: () => void;
  systemAlert: { id: number; type: 'kicked' | 'suspended'; title: string; message: string } | null;
  clearSystemAlert: () => void;
  hailTripMeta: HailTripMeta | null;
  startHailTrip: (tariff: Tariff, zone: string, paymentData: PaymentData, pickupAddress: string, bookingType?: string) => Promise<void>;
  completeHailTrip: (dropAddress: string, frozenFare?: number, frozenDist?: number, frozenSecs?: number, paymentData?: PaymentData, extrasItems?: { id: string; name: string; amount: number }[], extrasTotal?: number) => Promise<void>;
  seatCapacity: number;
  vehicleTypeCode: string;
  storePushToken: (token: string) => void;
  // v12-ota18: isOnline/isSyncing/pendingQueueCount/pendingUploadCount moved to useDriverSync()
  // v12-ota13: currentSpeedKmh + currentGps moved to DriverTickContext.
  getLastGpsPosition: () => { lat: number; lng: number } | null;
  // v12-ota14: snapshot getter so callbacks can read live meter values
  // without subscribing to the per-second tick context.
  getMeterSnapshot: () => { fare: number; dist: number; secs: number; waitingCost: number };
  resumedJob: ResumedJobData | null;
  clearResumedJob: () => void;
}

const DriverContext = createContext<DriverContextType | null>(null);

// Haversine distance between two GPS coordinates — returns kilometres
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function DriverProvider({ children }: { children: ReactNode }) {
  const { driver } = useAuth();
  // Keep a ref so async callbacks always see the latest driver value
  const driverRef = useRef(driver);
  const statusRef  = useRef<DriverStatus>('Available');
  useEffect(() => { driverRef.current = driver; }, [driver]);

  // v22bf: clear any stale driverQueue/{cid}/{driverId}/queued slot on driver
  // load. If the app was killed mid-queue (or the slot was never cleared for
  // any other reason), the leftover reservation blocks every subsequent
  // accept-to-queue with a false "Queue Full" — and the offer auto-bounces
  // back to dispatch HQ unassigned. Run once per (companyId,driverId) login.
  useEffect(() => {
    if (!driver?.companyId || !driver?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const qRef = ref(database, `driverQueue/${driver.companyId}/${driver.id}/queued`);
        const snap = await get(qRef);
        if (cancelled || !snap.exists()) return;
        const slot: any = snap.val();
        const slotBookingId = String(slot?.bookingId ?? '');
        // If we have NO local 'queued' job for this slot's bookingId, the slot
        // is stale — clear it. (At this point on driver load, `jobs` is fresh
        // from the listeners.)
        const hasMatching = jobs.some(j => j.status === 'queued' && j.bookingId === slotBookingId);
        if (!hasMatching) {
          await remove(qRef).catch(() => {});
          console.log('[QueueCleanup] Cleared stale driverQueue slot on login (bookingId=' + slotBookingId + ')');
        }
      } catch (e) {
        console.log('[QueueCleanup] read failed (non-fatal):', e);
      }
    })();
    return () => { cancelled = true; };
  }, [driver?.companyId, driver?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // v22bc: hydrate today's completed trips from Firebase on login so they
  // survive an app restart. Previously the local `jobs` array was the only
  // store of completed Job entries — anything completed before a Galaxy Fold
  // memory kill / app reload disappeared from Closed Jobs / Shift summary /
  // Profile stats even though the data was safely in completedJobs/{cid}.
  // Fetches the most recent 100 entries (push-keys are time-ordered) and
  // filters to this driver, last 24h, that aren't already in local state.
  useEffect(() => {
    if (!driver?.companyId || !driver?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await get(query(
          ref(database, `completedJobs/${driver.companyId}`),
          limitToLast(100)
        ));
        if (cancelled || !snap.exists()) return;
        const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
        const hydrated: Job[] = [];
        snap.forEach(child => {
          const r: any = child.val();
          if (!r) return;
          const rDriverId = String(r.driverId ?? r.DriverId ?? '');
          if (rDriverId !== driver.id) return;
          const isoStr = r.completedAt_ISO ?? r.completedAt ?? r.CompletedAt_ISO ?? '';
          const ms = Date.parse(String(isoStr));
          if (!Number.isFinite(ms) || ms < cutoffMs) return;
          const bId = String(r.bookingId ?? r.BookingId ?? r.Id ?? child.key ?? '');
          if (!bId) return;
          const fareNum = typeof r.fare === 'number' ? r.fare
            : typeof r.Fare === 'number' ? r.Fare
            : parseFloat(String(r.fare ?? r.Fare ?? r.TotalFare ?? '0')) || 0;
          const distKm = typeof r.distanceKm === 'number' ? r.distanceKm
            : parseFloat(String(r.distanceKm ?? r.JobDistance ?? '0')) || 0;
          hydrated.push({
            id:             bId,
            bookingId:      bId,
            passengerName:  String(r.passengerName ?? r.PassengerName ?? r.ppname ?? (r.source === 'hail' ? 'Street Pickup' : 'Passenger')),
            passengerPhone: String(r.passengerPhone ?? r.PassengerPhone ?? r.AccountId ?? ''),
            pickupAddress:  String(r.pickupAddress ?? r.PickAddress ?? ''),
            dropAddress:    String(r.dropAddress  ?? r.DropAddress  ?? ''),
            fare:           parseFloat(fareNum.toFixed(2)),
            distance:       `${distKm.toFixed(2)} km`,
            duration:       String(r.durationLabel ?? r.TotalTime ?? ''),
            status:         'completed',
            createdAt:      String(r.startedAt_ISO ?? r.startedAt ?? isoStr ?? new Date().toISOString()),
            completedAt:    String(isoStr ?? new Date().toISOString()),
            paymentType:    (r.paymentType ?? r.PaymentType ?? 'cash') as PaymentType,
            tariffName:     r.tariffName ?? r.TariffName ?? r.TarriffType,
            waitingCost:    typeof r.waitingCost === 'number' ? r.waitingCost : undefined,
            rideCost:       typeof r.distanceCost === 'number' ? r.distanceCost : (typeof r.RideCost === 'number' ? r.RideCost : undefined),
            flagFall:       typeof r.flagFall === 'number' ? r.flagFall : (typeof r.flagFallAmount === 'number' ? r.flagFallAmount : (typeof r.FareBase === 'number' ? r.FareBase : undefined)),
            tmVoucherNo:    r.tmVoucherNo ?? r.TmVoucherNo,
            tmPassengerName:r.tmPassengerName ?? r.TmPassengerName,
            tmPassengerPays:typeof r.tmPassengerPays === 'number' ? r.tmPassengerPays : undefined,
            acc_client_id:  r.accClientId ?? r.Acc_client_id,
          });
        });
        if (cancelled || hydrated.length === 0) return;
        setJobs(prev => {
          const seen = new Set(prev.map(j => j.id));
          const fresh = hydrated.filter(h => !seen.has(h.id));
          if (fresh.length === 0) return prev;
          return [...prev, ...fresh];
        });
        console.log(`[Hydrate] Loaded ${hydrated.length} recent completed trips from Firebase`);
      } catch (e) {
        console.log('[Hydrate] completedJobs read failed (non-fatal):', e);
      }
    })();
    return () => { cancelled = true; };
  }, [driver?.companyId, driver?.id]);

  const [status, setStatusState] = useState<DriverStatus>('Available');
  // Keep statusRef always current so async callbacks / reconnect handler can read it
  statusRef.current = status;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [incomingJob, setIncomingJob] = useState<Job | null>(null);
  const [shiftActive, setShiftActive] = useState(false);
  const shiftActiveRef = useRef(false);
  // Mirror shiftActive into ref so async closures (jobs listener) can read it without stale state
  shiftActiveRef.current = shiftActive;
  const [currentShift, setCurrentShift] = useState<ShiftRecord | null>(null);
  const [shiftHistory, setShiftHistory] = useState<ShiftRecord[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([{
    id: 'thread-dispatch',
    contactName: 'Dispatch Control',
    contactType: 'dispatcher',
    lastMessage: '',
    lastTime: new Date().toISOString(),
    unread: 0,
    messages: [],
  }]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const [meterRunning, setMeterRunning] = useState(false);
  const [meterPaused, setMeterPaused] = useState(false);
  const [meterSeconds, setMeterSeconds] = useState(0);
  const [meterDistance, setMeterDistance] = useState(0);
  const meterInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const [onlineDrivers, setOnlineDrivers] = useState<OnlineDriver[]>([]);
  const [myZoneInfo, setMyZoneInfo] = useState<MyZoneInfo | null>(null);
  const myZoneInfoRef = useRef<MyZoneInfo | null>(null);
  const [availableTariffs, setAvailableTariffs] = useState<Tariff[]>(DEFAULT_TARIFFS);
  const [activeTariff, setActiveTariffState] = useState<Tariff>(DEFAULT_TARIFFS[0]);

  const [hailJobs, setHailJobs] = useState<HailJob[]>([]);
  const [takenAlert, setTakenAlert] = useState<string | null>(null);
  const [cancelledJobAlert, setCancelledJobAlert] = useState<{ id: number; title: string; message: string } | null>(null);
  const [systemAlert, setSystemAlert] = useState<{ id: number; type: 'kicked' | 'suspended'; title: string; message: string } | null>(null);

  const notifRef = useRef<DatabaseReference | null>(null);
  const passengerJobRef = useRef<DatabaseReference | null>(null);
  const prevVehicleIdRef = useRef<string>('');
  const fleetRef = useRef<DatabaseReference | null>(null);
  const myPresenceRef = useRef<DatabaseReference | null>(null);
  const hailListenerRef = useRef<DatabaseReference | null>(null);
  // Track the zone name currently shown so we know when dispatch changes it
  const zoneAssignedRef = useRef<{ name: string; at: number } | null>(null);
  // Track bookingIds already shown as incoming alerts to prevent re-triggering
  const seenBookingIdsRef = useRef<Set<string>>(new Set());
  // 22bo-fix6: dedup KEY is bookingId alone. The earlier fix5 attempt at
  // (bookingId, offeredAt) tuple keys was BROKEN — dispatch writes notification/
  // and jobs/ paths at slightly different times so the two listeners saw
  // different offeredAt values, both passed dedup, and BOTH pushed a Job into
  // jobs[]. Same booking, two entries (notif-* and jobs-*), accept only promoted
  // one → the orphan stayed in the offered list and re-popped on tap.
  // Cross-listener dedup is the primary correctness guarantee. Re-offer
  // support is achieved purely via clearSeenForBooking() on recall/cancel paths.
  const seenKey = (bookingId: string, _offeredAt: any): string => bookingId;
  // v12-ota22c4 #4: bookings we have already completed on THIS device. Survives
  // app restarts via the boot effect that hydrates from tripJournal's pending
  // ids. Any incoming offer / re-broadcast for one of these is suppressed by
  // adding the bookingId to seenBookingIdsRef as well — the existing dedup
  // path then naturally swallows the duplicate, no listener changes required.
  // clearSeenForBooking refuses to un-block these so a dispatch recall/cancel
  // arriving after our local completion cannot re-open the trip.
  const locallyCompletedBookingIdsRef = useRef<Set<string>>(new Set<string>());
  const markBookingLocallyCompleted = (bookingId: string | null | undefined) => {
    if (!bookingId) return;
    const id = String(bookingId);
    locallyCompletedBookingIdsRef.current.add(id);
    seenBookingIdsRef.current.add(id);
  };
  const clearSeenForBooking = (bookingId: string) => {
    if (!bookingId) return;
    // v12-ota22c4 #4: never re-allow offers for bookings we have locally completed.
    if (locallyCompletedBookingIdsRef.current.has(bookingId)) return;
    const prefix = `${bookingId}::`;
    const toDelete: string[] = [];
    seenBookingIdsRef.current.forEach(k => {
      if (k === bookingId || k.startsWith(prefix)) toDelete.push(k);
    });
    toDelete.forEach(k => seenBookingIdsRef.current.delete(k));
  };
  // Track hail job keys seen in previous snapshot (to detect disappearances)
  const prevHailKeysRef = useRef<Set<string>>(new Set());
  // bookingIds claimed by this driver (so we don't show "taken" alert for our own claims)
  const claimedByMeRef = useRef<Set<string>>(new Set());

  const [hailTripMeta, setHailTripMeta] = useState<HailTripMeta | null>(null);
  const hailTripMetaRef = useRef<HailTripMeta | null>(null);

  // Track whether app is in foreground so we know when to fire a local push notification
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const pushTokenRef = useRef<string | null>(null);

  // Vehicle capacity — used to filter job offers that require more seats than we have.
  // Defaults to 4 (standard car). Stored in Firebase driver profile.
  const [seatCapacity, setSeatCapacityState] = useState(4);
  const [vehicleTypeCode, setVehicleTypeCodeState] = useState('');
  const seatCapacityRef = useRef(4);
  const vehicleTypeCodeRef = useRef('');
  const meterSecondsRef = useRef(0);
  const meterDistanceRef = useRef(0);
  // v22bj: explicit meter-charging window timestamps. Separated from
  // pickup/dropoff per HQ spec — pickup→dropoff = wheels-rolling-with-customer,
  // MeterOnAt→MeterOffAt = meter-was-charging (for dispute resolution).
  const meterOnAtRef  = useRef<string | null>(null);
  const meterOffAtRef = useRef<string | null>(null);
  // v22bk: per-trip waiting windows for the dispatch audit panel. Each entry
  // is one wait-mode session: pushed when the GPS/tick detector decides we
  // entered waiting, closed (end stamped) when we exit OR when the meter
  // stops / is paused. waitingMinutes is derived by summing (end-start)/60.
  const waitingWindowsRef = useRef<Array<{ start: string; end?: string }>>([]);
  // Waiting-mode tracking — updated by GPS speed vs tariff.speedThreshold
  const [meterIsWaiting, setMeterIsWaiting] = useState(false);
  const [meterWaitingIntervals, setMeterWaitingIntervals] = useState(0);
  const [meterWaitingCost, setMeterWaitingCost] = useState(0); // continuous $/s accumulator
  const meterIsWaitingRef = useRef(false);
  const meterWaitingSecsRef = useRef(0);     // stopped seconds in current interval
  const meterWaitingIntervalsRef = useRef(0); // complete intervals charged
  const meterWaitingCostRef = useRef(0);     // continuous waiting cost ($/s), drives live fare
  // Current GPS speed displayed in UI
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);
  // v12-ota17: throttle speed re-renders by remembering the last value pushed to React state
  const lastSpeedStateValueRef = useRef(0);
  // Shared GPS state for all map components (consolidated single watcher)
  const [currentGps, setCurrentGps] = useState<{ lat: number; lng: number } | null>(null);
  const lastGpsStateWriteMsRef = useRef(0);
  const lastGpsStateValueRef = useRef<{ lat: number; lng: number } | null>(null);
  // Hysteresis: require 3 consecutive GPS readings below threshold before entering waiting mode
  // (prevents false triggers from GPS jitter when moving slowly)
  const waitingHysteresisRef = useRef(0);  // consecutive below-threshold readings
  const movingHysteresisRef  = useRef(0);  // consecutive above-threshold readings
  // Last GPS fix used for meter distance accumulation (independent of job-screen GPS watcher)
  const lastGpsForMeterRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastGpsTickMsRef  = useRef<number>(0); // epoch ms of most recent GPS callback while meter running
  // v22ba: stamped on EVERY GPS callback (not just when meter running) so the
  // watchdog below can detect a silently-paused Android GPS subscription and
  // re-arm it. Samsung's OS sometimes throttles `watchPositionAsync` callbacks
  // on idle foreground (no taps, screen on) — driver had to background+foreground
  // the app to wake them up. This ref + watchdog do that automatically.
  const lastAnyGpsTickMsRef = useRef<number>(0);
  const lastDistTickMsRef = useRef<number>(0); // v22y: epoch ms of last distance-accumulation tick (for speed×dt fallback on moderate-accuracy GPS)
  const lastSpeedKmhRef   = useRef<number>(0); // most recent GPS speed (km/h), used by the meter tick for time-based waiting detection
  const lastGpsPositionRef = useRef<{ lat: number; lng: number } | null>(null); // last known GPS position (any accuracy)
  // Rolling buffer of recent GPS fixes (last ~12 points ≈ ~12 s at 1 Hz)
  // Used to detect stationary car via displacement when speed is unavailable/noisy
  const gpsBufferRef = useRef<{ lat: number; lng: number; ts: number }[]>([]);
  const activeTariffRef = useRef<Tariff>(DEFAULT_TARIFFS[0]);
  const tariffChangesRef = useRef<TariffChange[]>([]);
  const pauseLogRef = useRef<PauseEntry[]>([]);
  const pauseStartRef = useRef<string | null>(null);
  const meterRunningRef = useRef(false);
  const meterPausedRef  = useRef(false);
  // Timestamp (ms) when the app was backgrounded while meter was running.
  // Used to inject missing seconds when the app returns to foreground.
  const backgroundedAtRef = useRef<number | null>(null);
  // ota22c-cutover-c: tracks ANY background entry (independent of meter state)
  // so the foreground branch can force a Firebase socket rebuild after long doze.
  const lastBackgroundAtRef = useRef<number | null>(null);
  const jobsListenerAttachedRef = useRef<boolean>(false);
  // Tracks when driver last tapped Accept — used to reject stale "Away" notifications
  // that arrive after accept due to dispatcher timer firing simultaneously.
  const lastAcceptTimeRef = useRef<number>(0);
  // Always-current snapshot of jobs array (avoids stale closures in effects)
  const latestJobsRef = useRef<Job[]>([]);
  // Tracks previous status to detect Away → Available transition
  const prevStatusRef = useRef<DriverStatus>('Available');
  // Always-current connection flag for use inside async notification handlers
  const isConnectedRef = useRef(false);
  // ── 22bp (G5) — booking version / updatedAt stale-write guard ──────────────
  // Dispatch now stamps every notification/{driverId}, jobs/{cid}/{vid}/{did},
  // pendingjobs/{cid}/{bookingId} and allbookings/{cid}/{bookingId} write with:
  //   version    — monotonic per-booking sequence (updateSeq) starting at 1
  //   updatedAt  — Firebase serverTimestamp() sentinel resolved server-side
  // Use these to drop out-of-order or duplicate events. Map is keyed by
  // bookingId; cleared on sign-out. Missing version is treated as 0 so old
  // legacy dispatch writes still pass through (forward-compatible).
  const bookingVersionsRef = useRef<Map<string, { version: number; updatedAt: number }>>(new Map());
  // High-water mark for bookingEvents/{cid}/{bookingId} seq — one entry per active booking.
  const bookingEventSeqRef = useRef<Map<string, number>>(new Map());
  // Set to true just before the driver intentionally removes their own presence
  // (endShift / signOut / kick-cleanup) so the presence-deletion watcher
  // doesn't mis-fire as a dispatch kick.
  const selfClearedPresenceRef = useRef(false);
  // v22s: separate deadline-based suppression for hail-trip completion.
  // Unlike selfClearedPresenceRef (a boolean that the watcher resets on any
  // snap.exists() tick), this is a timestamp the watcher consults directly —
  // so a self-write that re-creates the node DOES NOT clear the suppression
  // window, and the window can't be accidentally inherited from an earlier
  // operation. Scope: hail-completion presence churn only.
  const presenceKickSuppressUntilRef = useRef(0);
  // Set to true the moment sign-out begins — blocks ALL writeOnlinePresence calls
  // so a Firebase reconnect race after firebaseSignOut() can't re-create the node.
  const signingOutRef = useRef(false);

  // ── NZ compliance shift state ─────────────────────────────────────────────
  const [breakActive, setBreakActive] = useState(false);
  const [breakStartMs, setBreakStartMs] = useState<number | null>(null);
  const [todayBreakMs, setTodayBreakMs] = useState(0);
  const [shiftLogId, setShiftLogId] = useState<string | null>(null);
  const [weeklyWorkMinutes, setWeeklyWorkMinutes] = useState(0);
  const [dailyWorkMinutes, setDailyWorkMinutes] = useState(0);
  const [lastShiftEndMs, setLastShiftEndMs] = useState<number | null>(null);
  const [shiftBlocked, setShiftBlocked] = useState<{ reason: string; availableAt: number } | null>(null);
  const shiftLogIdRef = useRef<string | null>(null);
  const todayBreakMsRef = useRef(0);
  const breakStartMsRef = useRef<number | null>(null);
  const breakActiveRef = useRef(false);
  const warningFiredRef = useRef<Set<string>>(new Set());
  const lastShiftEndMsRef = useRef<number | null>(null);
  const weeklyWorkMinutesRef = useRef(0);
  const dailyWorkMinutesRef = useRef(0);

  // ── Offline / write-queue state ───────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [pendingUploadCount, setPendingUploadCount] = useState(0);
  const [resumedJob, setResumedJob] = useState<ResumedJobData | null>(null);
  // Retry handle for pending offline-trip uploads
  const uploadRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnlineRef = useRef(true);
  // Firebase paths that have onDisconnect handlers registered for job return.
  // Cleared when meter starts (trip begun) or job completes/cancels.
  const jobDisconnectPathRef     = useRef<string | null>(null);
  const bookingDisconnectPathRef = useRef<string | null>(null);

  // ── Sign-out reset ────────────────────────────────────────────────────────
  // DriverProvider never unmounts between sessions, so all state must be
  // explicitly wiped when the driver signs out (driver → null) to prevent
  // the next sign-in from inheriting stale shift / job / meter state.
  useEffect(() => {
    if (driver) return; // driver just became non-null — nothing to reset
    setShiftActive(false);
    setCurrentShift(null);
    setJobs([]);
    setIncomingJob(null);
    setStatusState('Available');
    setMeterRunning(false);
    setMeterPaused(false);
    setMeterSeconds(0);
    setMeterDistance(0);
    if (meterInterval.current) { clearInterval(meterInterval.current); meterInterval.current = null; }
    seenBookingIdsRef.current.clear();
    // v12-ota22c4-d: also reset the locally-completed booking guard on sign-out
    // so a new driver on this device (or the same driver re-logging in next
    // shift) starts with a clean slate. Live snapshots stay bounded to the
    // current session, which removes the architect's theoretical bookingId
    // re-use concern across days.
    locallyCompletedBookingIdsRef.current.clear();
    bookingVersionsRef.current.clear();
    bookingEventSeqRef.current.clear();
    claimedByMeRef.current.clear();
    prevHailKeysRef.current.clear();
    setOnlineDrivers([]);
    myZoneInfoRef.current = null;
    setMyZoneInfo(null);
    setHailTripMeta(null);
    hailTripMetaRef.current = null;
    // Clear cross-driver state so sign-out → sign-in doesn't leak rating prompts
    setPendingRating(null);
    tripsSinceRatingRef.current = 0;
    meterSecondsRef.current = 0;
    meterDistanceRef.current = 0;
    tariffChangesRef.current = [];
    pauseLogRef.current = [];
    pauseStartRef.current = null;
    meterRunningRef.current = false;
    // NZ compliance state reset
    setBreakActive(false);
    setBreakStartMs(null);
    setTodayBreakMs(0);
    setShiftLogId(null);
    setShiftBlocked(null);
    shiftLogIdRef.current = null;
    todayBreakMsRef.current = 0;
    breakStartMsRef.current = null;
    breakActiveRef.current = false;
    warningFiredRef.current.clear();
    // Reset daily total on logout — reloaded fresh from Firebase on next login
    dailyWorkMinutesRef.current = 0;
    setDailyWorkMinutes(0);
    // Keep weeklyWorkMinutes / lastShiftEndMs — they reload from Firebase on next login
  }, [driver]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load NZ compliance history when driver logs in ────────────────────────
  useEffect(() => {
    if (!driver?.id || !driver?.companyId) return;
    // Read lastshifttime for daily rest check
    get(ref(database, `lastshifttime/${driver.id}`))
      .then(snap => {
        if (snap.exists()) {
          const raw = snap.val();
          const endMs = typeof raw === 'string' ? new Date(raw).getTime() : Number(raw);
          if (!isNaN(endMs) && endMs > 0) {
            lastShiftEndMsRef.current = endMs;
            setLastShiftEndMs(endMs);
          }
        }
      })
      .catch(() => {});

    // Sum totalMinutes from last 7 days for weekly rolling total,
    // and from last 24 hours for daily total (used in rest-period compliance check).
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    get(ref(database, `shiftLogs/${driver.companyId}/${driver.id}`))
      .then(snap => {
        if (!snap.exists()) return;
        let weeklyMins = 0;
        let dailyMins = 0;
        snap.forEach(child => {
          const d = child.val();
          if (!d?.startTime) return;
          const startMs = new Date(String(d.startTime)).getTime();
          if (isNaN(startMs) || startMs < sevenDaysAgo) return;
          const mins = d.totalMinutes ? Number(d.totalMinutes) : 0;
          weeklyMins += mins;
          if (startMs >= oneDayAgo) dailyMins += mins;
        });
        weeklyWorkMinutesRef.current = weeklyMins;
        dailyWorkMinutesRef.current = dailyMins;
        setWeeklyWorkMinutes(weeklyMins);
        setDailyWorkMinutes(dailyMins);
      })
      .catch(() => {});
  }, [driver?.id, driver?.companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recompute shift-start block whenever compliance data changes ──────────
  useEffect(() => {
    if (shiftActive) { setShiftBlocked(null); return; }
    const result = checkShiftStartCompliance(
      lastShiftEndMsRef.current,
      weeklyWorkMinutesRef.current,
      dailyWorkMinutesRef.current,
    );
    if (result.blocked) {
      setShiftBlocked({ reason: result.reason, availableAt: result.availableAt });
    } else {
      setShiftBlocked(null);
    }
  }, [lastShiftEndMs, weeklyWorkMinutes, dailyWorkMinutes, shiftActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── NZ compliance warning timer (fires during active shift) ───────────────
  useEffect(() => {
    if (!shiftActive || !currentShift?.startMs) return;
    warningFiredRef.current.clear();
    const intervalId = setInterval(() => {
      const startMs = currentShift.startMs ?? Date.now();
      const breakMs = todayBreakMsRef.current +
        (breakStartMsRef.current ? Date.now() - breakStartMsRef.current : 0);
      const workMs = Math.max(0, Date.now() - startMs - breakMs);
      const dailyRemaining = DAILY_LIMIT_MS - workMs;

      if (dailyRemaining <= 60 * 60 * 1000 && dailyRemaining > 30 * 60 * 1000 &&
          !warningFiredRef.current.has('1hr')) {
        warningFiredRef.current.add('1hr');
        Alert.alert('⚠️ Shift Warning',
          `1 hour remaining in your shift. You have worked ${fmtMs(workMs)} today.`);
      }
      if (dailyRemaining <= 30 * 60 * 1000 && dailyRemaining > 0 &&
          !warningFiredRef.current.has('30min')) {
        warningFiredRef.current.add('30min');
        Alert.alert('⚠️ Shift Warning', '30 minutes remaining in your shift.');
      }
      if (dailyRemaining <= 0 && !warningFiredRef.current.has('14h')) {
        warningFiredRef.current.add('14h');
        const availableAt = Date.now() + 10 * 60 * 60 * 1000;
        Alert.alert('🛑 Daily Limit Reached',
          `You have reached your 14-hour daily limit. You must take at least 10 hours rest. Your next shift can start at ${fmtNZDateTime(availableAt)}.`);
      }
      // Weekly 5-hour warning
      const weeklyNow = weeklyWorkMinutesRef.current + Math.floor(workMs / 60000);
      const weeklyRemaining = WEEKLY_LIMIT_MIN - weeklyNow;
      if (weeklyRemaining <= 5 * 60 && weeklyRemaining > 0 &&
          !warningFiredRef.current.has('weekly5hr')) {
        warningFiredRef.current.add('weekly5hr');
        Alert.alert('⚠️ Weekly Limit Warning',
          `You have ${fmtMins(weeklyRemaining)} remaining this week (70-hour weekly limit).`);
      }
      if (weeklyRemaining <= 0 && !warningFiredRef.current.has('weekly70h')) {
        warningFiredRef.current.add('weekly70h');
        const availableAt = Date.now() + 24 * 60 * 60 * 1000;
        Alert.alert('🛑 Weekly Limit Reached',
          `You have reached your 70-hour weekly limit. You must take 24 hours continuous rest. You can start work again at ${fmtNZDateTime(availableAt)}.`);
      }
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, [shiftActive, currentShift?.startMs, weeklyWorkMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load vehicle capacity + type from admin-managed Firebase records ────────
  // Primary source: vehicles/{companyId}/{vehicleId}  (set by admin/dispatcher)
  // Fallback:       drivers/{companyId}/{uid}          (legacy / manual override)
  // Driver cannot edit these — they are admin-only.
  useEffect(() => {
    if (!driver?.companyId || !driver?.vehicleId || !driver?.uid) return;

    const applyValues = (cap: number, vtype: string) => {
      setSeatCapacityState(cap);
      seatCapacityRef.current = cap;
      setVehicleTypeCodeState(vtype);
      vehicleTypeCodeRef.current = vtype;
    };

    // 1. Live listener on admin vehicle record
    const vehicleRef = ref(database, `vehicles/${driver.companyId}/${driver.vehicleId}`);
    let vehicleUnsubscribed = false;
    const vehicleUnsub = onValue(vehicleRef, (snap) => { markSyncBlock('vehicle');
      if (!snap.exists()) return;
      const val = snap.val();
      const cap   = parseInt(String(val?.seatCapacity ?? val?.seats ?? '4'), 10) || 4;
      const vtype = String(val?.vehicleTypeCode ?? val?.vehicleType ?? '').trim();
      applyValues(cap, vtype);
    });

    // 2. One-time fallback on driver profile if vehicle node is absent
    get(ref(database, `vehicles/${driver.companyId}/${driver.vehicleId}`))
      .then(snap => {
        if (snap.exists() || vehicleUnsubscribed) return;
        return get(ref(database, `drivers/${driver.companyId}/${driver.uid}`));
      })
      .then(snap => {
        if (!snap || !snap.exists()) return;
        const val = snap.val();
        const cap   = parseInt(String(val?.seatCapacity ?? '4'), 10) || 4;
        const vtype = String(val?.vehicleTypeCode ?? '').trim();
        applyValues(cap, vtype);
      })
      .catch(() => {});

    return () => {
      vehicleUnsubscribed = true;
      vehicleUnsub();
    };
  }, [driver?.uid, driver?.vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Job visibility filter ─────────────────────────────────────────────────
  // Returns true if this job should be shown to this driver based on vehicle type
  // and passenger count. "Not Specified" or blank vehicle type = show to everyone.
  function jobMatchesVehicle(job: Job): boolean {
    const reqType = (job.vehicleType ?? '').trim().toLowerCase();
    const reqPax  = job.passengers ?? 1;
    const myType  = vehicleTypeCodeRef.current.trim().toLowerCase();
    const myCap   = seatCapacityRef.current;

    // Type check: if dispatcher specified a vehicle type, it must match (or driver has none set)
    const typeOk = !reqType || reqType === 'not specified' || !myType || reqType === myType;
    // Capacity check: job cannot need more passengers than we can carry
    const capOk  = reqPax <= myCap;
    return typeOk && capOk;
  }

  // ── Keep latestJobsRef in sync so effects can read current jobs without stale closures ──
  useEffect(() => { latestJobsRef.current = jobs; }, [jobs]);

  // ── 22bo-fix9 (G7): availability after a booking is removed ─────────────
  // HQ asked the driver app to STOP inferring "available" purely from "this
  // booking was cancelled". If the driver still has a queued booking or
  // another active trip on their slate, dispatch should see Assigned/Busy,
  // not Available — otherwise dispatch may offer a parallel trip the driver
  // can't actually take. This helper rewrites a requested 'Available' down
  // to 'Assigned' (queued remains) or 'Busy' (another current trip remains).
  // Statuses other than 'Available' pass through unchanged.
  const adjustAvailabilityForRemainingJobs = (
    requested: DriverStatus,
    nextJobs: Job[],
  ): DriverStatus => {
    if (requested !== 'Available') return requested;
    if (nextJobs.some(j => j.status === 'current')) return 'Busy';
    if (nextJobs.some(j => j.status === 'queued'))  return 'Assigned';
    return 'Available';
  };

  // ── 22bp (G5) — should this incoming snapshot be skipped as stale? ─────────
  // Returns true if we have already applied a newer (or equal) event for this
  // bookingId. Caller skips all state mutation when true. Behaviour:
  //   • If incoming has `version` AND we have a stored version → compare versions.
  //   • Else if both have `updatedAt` → compare timestamps.
  //   • Else → never stale (legacy writes from old dispatch builds always pass).
  const shouldSkipStaleEvent = (
    bookingId: string,
    incomingVersion: any,
    incomingUpdatedAt: any,
  ): boolean => {
    if (!bookingId) return false;
    const prev = bookingVersionsRef.current.get(bookingId);
    if (!prev) return false;
    const vNew = Number(incomingVersion);
    const tNew = Number(incomingUpdatedAt);
    if (Number.isFinite(vNew) && vNew > 0 && prev.version > 0) {
      if (vNew < prev.version) return true;
      // Equal version with same/older timestamp → duplicate replay
      if (vNew === prev.version && Number.isFinite(tNew) && tNew <= prev.updatedAt) return true;
      return false;
    }
    if (Number.isFinite(tNew) && tNew > 0 && prev.updatedAt > 0) {
      return tNew < prev.updatedAt;
    }
    return false;
  };

  // Record the high-water mark for a bookingId after we have successfully
  // processed an event. Only ever moves forward.
  const markBookingVersion = (
    bookingId: string,
    incomingVersion: any,
    incomingUpdatedAt: any,
  ) => {
    if (!bookingId) return;
    const prev = bookingVersionsRef.current.get(bookingId);
    const vNew = Number(incomingVersion);
    const tNew = Number(incomingUpdatedAt);
    const nextVersion = Number.isFinite(vNew) && vNew > 0
      ? Math.max(vNew, prev?.version ?? 0)
      : (prev?.version ?? 0);
    const nextUpdatedAt = Number.isFinite(tNew) && tNew > 0
      ? Math.max(tNew, prev?.updatedAt ?? 0)
      : (prev?.updatedAt ?? 0);
    bookingVersionsRef.current.set(bookingId, { version: nextVersion, updatedAt: nextUpdatedAt });
  };
  // ── Keep isConnectedRef in sync for use inside async notification handlers ──
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);

  // ── Away → Available: re-surface any pending offered job ─────────────────────
  // When the driver goes Away (missed a job) and then taps "Make Available",
  // if there is still an unaccepted offered job, re-pop the IncomingJobAlert
  // so the driver gets another chance. Loops every time they go Available again.
  useEffect(() => {
    const wasAway = prevStatusRef.current === 'Away';
    prevStatusRef.current = status;
    if (!wasAway || status !== 'Available') return;
    if (!shiftActive) return;

    const offered = latestJobsRef.current.filter(j => j.status === 'offered');
    if (offered.length === 0) return;

    const first = offered[0];
    const refreshed = { ...first, offerSentAt: Date.now(), offerTimeoutSecs: 120 };
    console.log('[Away→Available] Re-surfacing pending offered job:', first.id);
    setJobs(prev => prev.map(j =>
      j.id === first.id ? { ...j, offerSentAt: Date.now(), offerTimeoutSecs: 120 } : j
    ));
    setIncomingJob(refreshed);
  }, [status, shiftActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Queued job promotion — when current trip clears, surface first queued job ──
  const prevCurrentJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    const activeTripId = jobs.find(j => j.status === 'current')?.id ?? null;
    const prevId = prevCurrentJobIdRef.current;
    prevCurrentJobIdRef.current = activeTripId;
    // Current job just finished (went from some ID → null)
    if (prevId && !activeTripId) {
      const nextQueued = jobs.find(j => j.status === 'queued');
      if (nextQueued) {
        // Promote first queued job: show as incoming alert (5-min window so driver can handle it)
        setJobs(prev => prev.map(j =>
          j.id === nextQueued.id ? { ...j, status: 'offered' as const, offerSentAt: Date.now(), offerTimeoutSecs: 300 } : j
        ));
        setIncomingJob({ ...nextQueued, status: 'offered', offerSentAt: Date.now(), offerTimeoutSecs: 300 });
        // Clear dispatch console queue handoff — driver is no longer "queued"
        const d = driverRef.current;
        if (d?.companyId && d?.id) {
          remove(ref(database, `driverQueue/${d.companyId}/${d.id}/queued`)).catch(() => {});
        }
      }
    }
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the admin/owner panel updates the driver's vehicleId while a shift is active,
  // clear the old Firebase presence path and re-write to the new one
  useEffect(() => {
    const newVehicleId = driver?.vehicleId ?? '';
    const oldVehicleId = prevVehicleIdRef.current;

    if (!shiftActive || !driver?.companyId || !newVehicleId) {
      prevVehicleIdRef.current = newVehicleId;
      return;
    }

    if (oldVehicleId && oldVehicleId !== newVehicleId) {
      const numVehicle = parseInt(newVehicleId, 10);
      const vehicleIdValue = Number.isNaN(numVehicle) ? newVehicleId : numVehicle;
      remove(ref(database, `online/${driver.companyId}/${oldVehicleId}/current`))
        .catch(() => {});
      set(ref(database, `online/${driver.companyId}/${newVehicleId}/current`), {
        driverid:      (() => { const n = parseInt(driver.id ?? '', 10); return Number.isNaN(n) ? (driver.id ?? '') : n; })(),
        drivername:    driver.name ?? '',
        vehiclenumber: newVehicleId,
        VehicleId:     vehicleIdValue,
        vehicletype:   (vehicleTypeCodeRef.current || 'Not Specified'),
        PlayerId:      driver.uid ?? '',
        online:        true,
        lastSeen:      Date.now(),
        vehiclestatus: status === 'Assigned' ? 'Picking' : status, // 22c cutover
        lat:           0,
        lng:           0,
        time:          new Date().toISOString(),
        zonename:      '',
        zoneid:        0,
        zonequeue:     1,
        jobCount:      0,
        joboffer:      0,
        JobphoneNo:    '',
        jobpickup:     '',
        jobdropoff:    '',
        CompanyId:     driver.companyId ?? '',
        Email:         driver.email ?? '',
        PhoneNo:       driver.phone ?? '',
      }).then(() => {
        console.log('[DriverCtx] VehicleId changed mid-shift — presence moved to', newVehicleId);
      }).catch(() => {});
    }

    prevVehicleIdRef.current = newVehicleId;
  }, [driver?.vehicleId, shiftActive]);

  useEffect(() => {
    return () => {
      if (meterInterval.current) clearInterval(meterInterval.current);
    };
  }, []);

  // Continuous GPS tracking while shift is active.
  // - Updates lat/lng in Firebase every ~10s so the dispatch map stays current.
  // - Also accumulates meter distance via haversine when the meter is running.
  //   This runs regardless of which tab the driver is on, fixing the km-not-counting bug.
  useEffect(() => {
    if (!shiftActive || !driver?.vehicleId || !driver?.companyId) return;
    // Reset last-GPS ref so we don't carry a stale position across shift restarts
    lastGpsForMeterRef.current = null;
    lastAnyGpsTickMsRef.current = Date.now(); // arm the watchdog at "now" so first 25s aren't a false stall

    let subscription: Location.LocationSubscription | null = null;
    let lastPresenceWrite = 0; // rate-limit Firebase writes to every 10s
    let watchdogTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false; // set true on effect cleanup so async re-subscribe doesn't fire after unmount

    const startSubscription = async (): Promise<void> => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        if (cancelled) return;

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,  // High accuracy — needed for km tracking
            // v22o: was 4000ms — combined with 3-reading hysteresis gave 12s
            // lag before waiting-rate kicked in (matched user-reported "14s
            // to change waiting rate"). 2s interval + 2-reading hysteresis
            // below = ~4s state changes, matching hardware taxi meters.
            timeInterval: 2000,
            distanceInterval: 0,               // 0 = time-only; don't suppress updates when stopped
          },
          (loc) => {
            const lat = loc.coords.latitude;
            const lng = loc.coords.longitude;

            // Always track last known position so drop-off LatLng is available at completion
            lastGpsPositionRef.current = { lat, lng };
            // v22ba: watchdog liveness stamp — fires on EVERY GPS callback regardless
            // of meter state, so the dead-subscription detector below can tell the
            // difference between "no movement" and "OS throttled the subscription".
            lastAnyGpsTickMsRef.current = Date.now();

            // ── GPS state-update throttle (v12-ota4) ───────────────────────────
            // setCurrentGps re-renders every consumer of DriverContext (most of
            // the app), so this fires sparingly: only when the position has
            // moved ≥15 m, or every 15 s as a heartbeat for live maps. The
            // refs above always carry the freshest fix for distance/meter use.
            const nowMs = Date.now();
            const prev = lastGpsStateValueRef.current;
            const movedM = prev
              ? haversineKm(prev.lat, prev.lng, lat, lng) * 1000
              : Infinity;
            const sinceMs = nowMs - lastGpsStateWriteMsRef.current;
            if (movedM >= 15 || sinceMs >= 15000) {
              lastGpsStateWriteMsRef.current = nowMs;
              lastGpsStateValueRef.current = { lat, lng };
              setCurrentGps({ lat, lng });
            }

            // ── GPS accuracy gates ────────────────────────────────────────
            // v22y ROOT-CAUSE FIX for "km not ticking" on Samsung A04:
            // The old ≤25 m gate was too tight. Budget Android phones (A04,
            // many others) routinely report accuracy of 30–60 m even outdoors,
            // which meant goodFix was NEVER true → meterDistanceRef stayed at
            // 0 the entire trip. We now use ≤50 m for distance (still tight
            // enough to reject obvious garbage fixes) and add a speed-based
            // fallback below that works even at worse accuracy.
            const accuracyM = loc.coords.accuracy ?? 999;
            const goodFix   = accuracyM <= 50;
            const decentFix = accuracyM <= 100;

            // ── Live speed display (always, even outside meter) ──────────
            const speedMs = loc.coords.speed ?? -1;
            const speedKmhRaw = speedMs >= 0 ? speedMs * 3.6 : 0;
            // v12-ota17: round to nearest 5 km/h so re-renders are rare
            // (every GPS update was forcing all GPS-context consumers — incl.
            // the native map — to reconcile, blocking the JS thread on A04).
            const speedRounded = Math.round(speedKmhRaw / 5) * 5;
            if (speedRounded !== lastSpeedStateValueRef.current) {
              lastSpeedStateValueRef.current = speedRounded;
              setCurrentSpeedKmh(speedRounded);
            }

            // ── Meter distance accumulation + waiting-mode detection ─────────
            // Only add distance when meter is running and not paused.
            // Uses a separate lastGpsForMeterRef so job/[id].tsx map updates
            // don't interfere with the distance counter.
            if (meterRunningRef.current && !meterPausedRef.current) {
              const tariff = activeTariffRef.current;

              // Stamp GPS tick time so the meter interval can detect GPS blackouts
              lastGpsTickMsRef.current = Date.now();
              // v22p: stamp last speed so the 1s meter tick can do time-based
              // waiting detection even when Samsung throttles GPS callbacks.
              lastSpeedKmhRef.current = speedMs >= 0 ? speedKmhRaw : -1;
              // (per-tick log removed — was firing 30×/min and blocking JS thread on Android)

              // ── Waiting detection: dual-method with hysteresis ─────────────
              // Primary:   GPS speed field (m/s → km/h). Reliable on many devices.
              // Fallback:  Position-buffer displacement. Used when speed is null/0
              //            or GPS accuracy is poor (common on Android when stationary).
              //
              // Hysteresis: require 3 consecutive readings below threshold before
              // switching to waiting mode.  This stops GPS jitter from flickering
              // the indicator when the car is moving slowly (e.g. in traffic).
              //
              // Buffer: keep last 12 fixes (~12 s at 1 Hz update rate).
              const nowTs = Date.now();
              // Use decentFix (≤100m) for the position buffer so phones with
              // moderate GPS accuracy can still contribute to stop detection.
              if (decentFix) {
                gpsBufferRef.current.push({ lat, lng, ts: nowTs });
                if (gpsBufferRef.current.length > 12) gpsBufferRef.current.shift();
              }

              let rawWaiting = false;

              // Effective speed threshold: use tariff value but floor at 5 km/h.
              // Stationary Android GPS commonly reports 2–4 km/h noise even at standstill.
              // A lower floor causes the meter to flicker between waiting/moving at red lights.
              // 5 km/h (walking pace) gives a clean cut-off that matches hardware taxi meters.
              const effectiveSpeedThreshold = Math.max(tariff.speedThreshold, 5);

              if (speedMs >= 0) {
                // Speed field is valid — use it directly (works regardless of accuracy)
                rawWaiting = speedKmhRaw < effectiveSpeedThreshold;
              } else if (decentFix) {
                // Speed unavailable but position is usable — check displacement buffer
                const buf = gpsBufferRef.current;
                if (buf.length >= 4) {
                  // Max displacement between any two points in the buffer
                  let maxDisplKm = 0;
                  for (let i = 0; i < buf.length; i++) {
                    for (let j = i + 1; j < buf.length; j++) {
                      const d = haversineKm(buf[i].lat, buf[i].lng, buf[j].lat, buf[j].lng);
                      if (d > maxDisplKm) maxDisplKm = d;
                    }
                  }
                  // < 20 m spread across all buffered fixes → car is stopped
                  rawWaiting = maxDisplKm < 0.020;
                } else {
                  rawWaiting = false; // Not enough buffer yet — assume moving
                }
              } else {
                // GPS accuracy is truly poor (>100 m) and speed unavailable.
                // Can't determine movement — assume waiting (car likely indoors/stopped).
                rawWaiting = true;
              }

              // v22u: speed-authoritative override. When GPS reports a real speed
              // (speedMs >= 0) above the tariff threshold, the car is definitely
              // moving regardless of what the displacement buffer says — Samsung
              // Fold 7 sometimes gives clustered low-accuracy fixes while driving
              // that wrongly look stationary to the displacement check. Trusting
              // speed here breaks the meter out of a stuck "waiting" state and
              // lets per-km charges + distance accumulation resume immediately.
              // v22v fix: use the SAME effective threshold the tick logic uses
              // (min 5 km/h) so stationary-phone GPS noise (2–4 km/h flicker)
              // can never falsely suppress waiting charges.
              const effSpeedThr = Math.max(tariff.speedThreshold, 5);
              if (speedMs >= 0 && speedKmhRaw >= effSpeedThr) {
                rawWaiting = false;
              }

              // Dual hysteresis: both entering AND leaving waiting mode require
              // 3 consecutive consistent readings.  This prevents GPS speed jitter
              // (stationary phones often flicker between 0–2 km/h) from locking the
              // meter in "moving" mode and blocking the waiting fare.
              if (rawWaiting) {
                waitingHysteresisRef.current = Math.min(waitingHysteresisRef.current + 1, 5);
                movingHysteresisRef.current  = 0;
              } else {
                movingHysteresisRef.current  = Math.min(movingHysteresisRef.current + 1, 5);
                waitingHysteresisRef.current = 0;
              }
              // v22o: hysteresis reduced from 3 → 2 readings. With 2s GPS
              // interval that means ~4s to switch state instead of 12s.
              let nowWaiting: boolean;
              if (meterIsWaitingRef.current) {
                nowWaiting = movingHysteresisRef.current < 2; // stay waiting until clearly moving
              } else {
                nowWaiting = waitingHysteresisRef.current >= 2; // enter waiting after 2 stopped reads
              }

              if (nowWaiting !== meterIsWaitingRef.current) {
                meterIsWaitingRef.current = nowWaiting;
                setMeterIsWaiting(nowWaiting);
                // v22bk: record per-trip wait windows for the audit POST
                const _wwTs = new Date().toISOString();
                if (nowWaiting) {
                  waitingWindowsRef.current.push({ start: _wwTs });
                } else {
                  // Resuming movement — reset partial waiting-interval counter
                  meterWaitingSecsRef.current = 0;
                  const _last = waitingWindowsRef.current[waitingWindowsRef.current.length - 1];
                  if (_last && !_last.end) _last.end = _wwTs;
                }
              }

              // Only accumulate distance when NOT in waiting mode.
              // v22y: two paths — position-delta (preferred when GPS is tight)
              // and speed × dt fallback (saves trips on phones whose GPS chip
              // reports moderate accuracy but a valid doppler-derived speed,
              // which is the Samsung A04 / many budget Android case).
              if (!nowWaiting) {
                let accumulated = false;
                if (goodFix && lastGpsForMeterRef.current) {
                  const delta = haversineKm(
                    lastGpsForMeterRef.current.lat, lastGpsForMeterRef.current.lng, lat, lng
                  );
                  // Ignore GPS jumps > 0.5 km in 4s (signal glitch / tunnel exit)
                  if (delta > 0 && delta < 0.5) {
                    meterDistanceRef.current += delta;
                    setMeterDistance(meterDistanceRef.current);
                    accumulated = true;
                  }
                }
                // Speed-based fallback: doppler speed is accurate even when
                // position isn't, so use speedMs × dt when goodFix path didn't
                // contribute this tick. Cap dt to 5 s so a paused/backgrounded
                // app waking up can't dump huge phantom km in one shot.
                //
                // v22ab ROOT-CAUSE FIX: removed the `speedKmhRaw >= effectiveSpeedThreshold`
                // guard. The outer `!nowWaiting` gate already enforces "the car
                // is moving" via the hysteresis logic — the inner threshold check
                // was redundant AND blocked accumulation in slow traffic / start-
                // stop driving / urban speeds below the tariff's 10-12 km/h waiting
                // threshold. With the guard gone, any non-zero doppler speed while
                // the meter thinks we're moving will tick the km counter.
                if (!accumulated && speedMs > 0) {
                  const prevTickMs = lastDistTickMsRef.current;
                  if (prevTickMs > 0) {
                    const dtSec = Math.min(5, (nowTs - prevTickMs) / 1000);
                    if (dtSec > 0) {
                      const km = (speedMs * dtSec) / 1000;
                      if (km > 0 && km < 0.5) {
                        meterDistanceRef.current += km;
                        setMeterDistance(meterDistanceRef.current);
                      }
                    }
                  }
                }
                lastDistTickMsRef.current = nowTs;
              } else {
                lastDistTickMsRef.current = nowTs;
              }
              if (goodFix) lastGpsForMeterRef.current = { lat, lng };
            } else {
              // Not metering — still update last position so first delta after
              // meter starts isn't artificially large
              if (goodFix) lastGpsForMeterRef.current = { lat, lng };
            }

            // ── Firebase presence lat/lng (rate-limited) ─────────────────────
            // v22ar: rate-limit reduced from 10s → 5s so dispatch's staleness
            // filter (which appears to hide drivers whose `time` field is
            // >5–8 s old, causing the 10–20 s flap) always sees fresh data.
            const now = Date.now();
            if (now - lastPresenceWrite < 5000) return; // max 1 write per 5s
            lastPresenceWrite = now;
            const d = driverRef.current;
            if (!d?.vehicleId || !d?.companyId) return;
            const presenceFields = {
              lat, lng,
              // v22ar: PascalCase mirrors + GPS / speed fields the dispatch
              // popup reads. Was showing "undefined" for Vehicle Speed,
              // GPS Status, Vehicle Type, App Version — fixed now.
              Lat: lat, Lng: lng, Latitude: lat, Longitude: lng,
              hasGps: true,
              gpsStatus: 'OK', GpsStatus: 'OK',
              vehicleSpeed: speedRounded, VehicleSpeed: speedRounded, Speed: speedRounded,
              time: new Date().toISOString(),
              // v22ap: re-assert online:true + lastSeen on every presence write.
              // Without this, a brief WebSocket blip fires the onDisconnect handler
              // which sets online:false — and nothing re-asserts true until the
              // 30s heartbeat.
              online: true,
              lastSeen: serverTimestamp(),
            };
            update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), presenceFields).catch(() => {});
            // v22at: REMOVED parent-path write — was causing dispatch HQ to
            // render a duplicate driver row. See writeOnlinePresence for the
            // full explanation.
            // ── Mirror driver location into active booking so passenger app tracking works ──
            // Passenger app reads DriverLat/DriverLng from allbookings/{cid}/{jobId}
            const activeJob = latestJobsRef.current.find(j => j.status === 'current');
            if (activeJob?.bookingId) {
              update(ref(database, `allbookings/${d.companyId}/${activeJob.bookingId}`), {
                DriverLat: lat, DriverLng: lng,
              }).catch(() => {});
            }
          }
        );
      } catch {
        // GPS not available — map will show last known position
      }
    };

    startSubscription();

    // v22ba: GPS subscription watchdog. Polls every 10s. If the meter is running
    // (or driver is on shift) and we haven't seen ANY GPS callback in 25s, the
    // Android OS has silently throttled the subscription — tear it down and
    // re-arm. Driver no longer has to background+foreground the app to wake
    // the km counter back up.
    watchdogTimer = setInterval(() => {
      if (cancelled) return;
      const since = Date.now() - lastAnyGpsTickMsRef.current;
      if (since < 25000) return; // healthy — recent fix received
      // Stall detected. Only act when we'd actually use GPS — meter running
      // OR shift active (presence writes also depend on it).
      if (!meterRunningRef.current && !shiftActive) return;
      console.log('[GpsWatchdog] No GPS callback for', Math.round(since / 1000), 's — re-arming watchPositionAsync');
      try { subscription?.remove(); } catch {}
      subscription = null;
      lastAnyGpsTickMsRef.current = Date.now(); // reset before re-subscribing so we don't double-fire
      startSubscription();
    }, 10000);

    return () => {
      cancelled = true;
      if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
      subscription?.remove();
      subscription = null;
      lastGpsForMeterRef.current = null;
    };
  }, [shiftActive, driver?.vehicleId, driver?.companyId]);

  // ── AppState tracker ──────────────────────────────────────────────────────
  // • Keeps appStateRef current so the job-offer handler knows when to fire a
  //   local push notification (when app is backgrounded).
  // • Corrects the meter for time elapsed while the app was backgrounded.
  //   The OS suspends setInterval when the screen is off; wall-clock time is
  //   always accurate, so we inject the missing seconds on foreground resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      // ota22c-cutover-c: trace every AppState transition to Sentry so we can
      // correlate "zombie listener" bugs with screen-off duration.
      try { Sentry.addBreadcrumb({ category: 'appstate', level: 'info', message: `${prev} -> ${next}`, data: { prev, next, t: Date.now() } }); } catch {}

      // ── Going to background / screen off ────────────────────────────────
      if ((next === 'background' || next === 'inactive') && prev === 'active') {
        // ota22c-cutover-c: always stamp ANY background entry (not only when
        // the meter is running) so the foreground branch below can compute
        // doze duration and decide whether to force a socket rebuild.
        lastBackgroundAtRef.current = Date.now();
        if (meterRunningRef.current && !meterPausedRef.current) {
          backgroundedAtRef.current = Date.now();
          console.log('[Meter] App backgrounded — recording time for meter correction');
        }
      }

      // ota22c-cutover-c: LONG-RESUME RECOVERY ─────────────────────────────
      // After Android doze (screen off ≥2 min), Firebase listeners can be in
      // a half-attached zombie state: the websocket reports connected but
      // server→client pushes never arrive. Symptoms (verified from a real
      // incident): driver shows Available on dispatch HQ but never receives
      // job offers; auto-dispatch fires without popup; completed bookings
      // remain Active server-side. Force-cycle the Firebase socket so the
      // existing .info/connected reconnect handler refires and reconciles
      // via /api/driver/active-bookings.
      if (next === 'active' && prev !== 'active' && lastBackgroundAtRef.current !== null) {
        const elapsedMs = Date.now() - lastBackgroundAtRef.current;
        lastBackgroundAtRef.current = null;
        if (elapsedMs > 120_000) {
          try { Sentry.addBreadcrumb({ category: 'long-resume', level: 'warning', message: `Long doze ${Math.round(elapsedMs/1000)}s — forcing socket rebuild`, data: { elapsedMs } }); } catch {}
          console.warn(`[LongResume] Backgrounded ${Math.round(elapsedMs/1000)}s — cycling Firebase socket`);
          // Surface "Reconnecting" to UI immediately so the driver doesn't
          // start a hail trip / accept an offer over a dead pipe.
          setIsConnected(false);
          isConnectedRef.current = false;
          try {
            const { goOffline: _goOff } = require('firebase/database');
            _goOff(database);
          } catch {}
          // Brief gap then reconnect. The .info/connected listener at L6033
          // will then refire, drain the command queue, and refetch active
          // bookings — that's our reconciliation path.
          setTimeout(() => {
            try { goOnline(database); } catch {}
          }, 250);
        }
      }

      // 22bo-fix3: foreground re-check requested by dispatch team. Confirms the
      // jobs listener is still attached AND does a one-shot get() to surface
      // any offer that may have arrived while the JS engine was suspended.
      if (next === 'active' && prev !== 'active') {
        const d = driverRef.current;
        if (d?.companyId && d?.vehicleId && d?.id) {
          const path = `jobs/${d.companyId}/${d.vehicleId}/${d.id}`;
          console.log(`[Jobs][Foreground] resumed - listenerAttached=${jobsListenerAttachedRef.current} path=${path}`);
          try { Sentry.addBreadcrumb({ category: 'jobs-foreground', level: 'info', message: 'resumed', data: { listenerAttached: jobsListenerAttachedRef.current, path } }); } catch {}
          get(ref(database, path)).then(snap => {
            const v = snap.exists() ? (snap.val() || {}) : null;
            const status = v?.Status ?? v?.status ?? '(none)';
            const bid = v?.BookingId ?? v?.bookingid ?? v?.bookingId ?? '(none)';
            const offeredAt = v?.offeredAt ?? v?.OfferedAt ?? '(none)';
            console.log(`[Jobs][Foreground] one-shot get exists=${snap.exists()} Status=${status} BookingId=${bid} offeredAt=${offeredAt}`);
            try { Sentry.addBreadcrumb({ category: 'jobs-foreground-get', level: 'info', message: `Status=${status} BookingId=${bid}`, data: { exists: snap.exists(), Status: status, BookingId: bid, offeredAt } }); } catch {}
          }).catch((e: any) => console.warn('[Jobs][Foreground] one-shot get failed:', e?.message));
        }
      }

      // ── Returning to foreground ──────────────────────────────────────────
      if (next === 'active' && backgroundedAtRef.current !== null) {
        const bgAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;

        if (meterRunningRef.current && !meterPausedRef.current) {
          const elapsedSecs = Math.max(0, Math.floor((Date.now() - bgAt) / 1000));
          if (elapsedSecs > 0) {
            // Inject the seconds the OS skipped
            meterSecondsRef.current += elapsedSecs;
            setMeterSeconds(meterSecondsRef.current);

            // Inject waiting cost if the meter was in waiting mode
            if (meterIsWaitingRef.current) {
              const t = activeTariffRef.current;
              if (t) {
                const perSec = t.waitingPerMin / (t.waitingInterval || 60);
                meterWaitingCostRef.current += perSec * elapsedSecs;
                setMeterWaitingCost(meterWaitingCostRef.current);
                meterWaitingSecsRef.current += elapsedSecs;
                const newIntervals = Math.floor(meterWaitingSecsRef.current / (t.waitingInterval || 60));
                if (newIntervals > 0) {
                  meterWaitingIntervalsRef.current += newIntervals;
                  meterWaitingSecsRef.current = meterWaitingSecsRef.current % (t.waitingInterval || 60);
                  setMeterWaitingIntervals(meterWaitingIntervalsRef.current);
                }
              }
            }

            // Restart the interval — OS may have paused or killed it
            if (meterInterval.current) clearInterval(meterInterval.current);
            meterInterval.current = setInterval(() => {
              meterSecondsRef.current += 1;
              setMeterSeconds(meterSecondsRef.current);
              if (meterIsWaitingRef.current) {
                const t = activeTariffRef.current;
                const perSec = t.waitingPerMin / (t.waitingInterval || 60);
                meterWaitingCostRef.current += perSec;
                setMeterWaitingCost(meterWaitingCostRef.current);
                meterWaitingSecsRef.current += 1;
                if (meterWaitingSecsRef.current >= (t.waitingInterval || 60)) {
                  meterWaitingIntervalsRef.current += 1;
                  meterWaitingSecsRef.current = 0;
                  setMeterWaitingIntervals(meterWaitingIntervalsRef.current);
                }
              }
            }, 1000);

            console.log(`[Meter] Background correction: +${elapsedSecs}s injected, meter now ${meterSecondsRef.current}s`);
          }
        }
      }
    });
    return () => sub.remove();
  }, []);

  // ── v12-ota22c4 #4: Hydrate locally-completed booking IDs on boot ─────────
  // Loads tj:pending (jobIds whose completion is saved locally but hasn't
  // synced upstream yet) and adds each one to BOTH locallyCompletedBookingIds
  // and seenBookingIds. The existing offer-listener dedup then suppresses any
  // re-broadcast of those bookings from the server — for example, a dispatch
  // box that crashed mid-sync and is re-emitting Active records on restart.
  // Runs once per driver session.
  useEffect(() => {
    if (!driver?.id || !driver?.companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const ids = await getPendingTripIds();
        if (cancelled) return;
        let added = 0;
        for (const id of ids) {
          if (!id) continue;
          if (!locallyCompletedBookingIdsRef.current.has(id)) {
            locallyCompletedBookingIdsRef.current.add(id);
            seenBookingIdsRef.current.add(id);
            added++;
          }
        }
        if (added > 0) {
          console.log(`[OfferGuard] Hydrated ${added} locally-completed bookings from journal — blocked from re-offer`);
        }
      } catch (e) {
        console.log('[OfferGuard] Hydration failed (non-fatal):', e);
      }
    })();
    return () => { cancelled = true; };
  }, [driver?.id, driver?.companyId]);

  // ── v12-ota22c4 #2: Persist live meter snapshot every 5s while running ────
  // Writes a single AsyncStorage record (taxi360.activeMeterSnapshot.v1) with
  // meter seconds/distance/waitingCost + tariff + bookingId + hailMeta. If
  // the app force-closes, the phone reboots, or Android OOM-kills the JS
  // bridge, the snapshot persists and the cold-start resume effect (below)
  // restores the meter on next launch — driver does NOT have to tap anything
  // to recover. When the meter is stopped cleanly (setMeterRunning(false) via
  // stopMeter / completeJob / cancelTrip / sign-out reset), this effect's
  // cleanup branch clears the snapshot so we don't false-positive resume on
  // the next launch.
  useEffect(() => {
    if (!meterRunning) {
      clearMeterSnapshot().catch(() => {});
      return;
    }
    const persist = () => {
      const d = driverRef.current;
      if (!d?.companyId || !d?.id) return;
      const hm = hailTripMetaRef.current;
      const isHail = !!hm;
      const cj = latestJobsRef.current?.find(j => j.status === 'current') || null;
      const t = activeTariffRef.current;
      saveMeterSnapshot({
        companyId: d.companyId,
        driverId:  d.id,
        vehicleId: d.vehicleId || '',
        bookingId: isHail
          ? (hm?.bookingId ?? null)
          : (cj?.bookingId ?? cj?.id ?? null),
        isHail,
        source: isHail ? 'hail' : ((cj as any)?.source || 'dispatch'),
        jobType: isHail ? ((hm as any)?.bookingType || 'taxi') : ((cj as any)?.jobType || 'taxi'),
        meterRunning: true,
        meterPaused: meterPausedRef.current,
        meterSeconds: meterSecondsRef.current,
        meterDistance: meterDistanceRef.current,
        meterIsWaiting: meterIsWaitingRef.current,
        meterWaitingSecs: meterWaitingSecsRef.current,
        meterWaitingIntervals: meterWaitingIntervalsRef.current,
        meterWaitingCost: meterWaitingCostRef.current,
        meterOnAt: meterOnAtRef.current,
        tariffId: t?.id || '',
        tariffName: t?.name || '',
        flagFall: t?.flagFall ?? 0,
        ratePerMile: t?.ratePerMile ?? 0,
        waitingPerMin: t?.waitingPerMin ?? 0,
        waitingInterval: t?.waitingInterval ?? 60,
        speedThreshold: t?.speedThreshold ?? 1,
        tariffFull: t,
        pickupAddress: isHail ? ((hm as any)?.pickupAddress ?? null) : ((cj as any)?.pickupAddress ?? null),
        pickupLat:     isHail ? ((hm as any)?.pickupLat ?? null)     : ((cj as any)?.pickupLat ?? null),
        pickupLng:     isHail ? ((hm as any)?.pickupLng ?? null)     : ((cj as any)?.pickupLng ?? null),
        hailMeta: isHail ? hm : null,
      }).catch(() => {});
    };
    persist();
    const id = setInterval(persist, 5000);
    return () => clearInterval(id);
  }, [meterRunning]);

  // ── v12-ota22c4 #3: Cold-start meter resume ───────────────────────────────
  // Runs once after the driver has signed in AND availableTariffs has loaded.
  // If a non-stale snapshot for this exact driver/company/vehicle exists, we
  // restore meter refs + React state, optionally re-attach hailTripMeta, and
  // re-arm the 1Hz tick. Driver sees an "Trip resumed" alert with the live
  // fare so they know what happened. Dispatch jobs auto-rehydrate from the
  // allbookings listener so we don't restore jobs[] here.
  const meterResumedForDriverRef = useRef<string | null>(null);
  useEffect(() => {
    if (!driver?.id || !driver?.companyId) return;
    if (availableTariffs.length === 0) return; // wait for tariffs from Firebase
    if (meterResumedForDriverRef.current === driver.id) return;
    let cancelled = false;
    let pendingAlertTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const snap = await loadMeterSnapshot();
      if (cancelled || !snap || !snap.meterRunning) return;
      if (snap.companyId !== driver.companyId) return;
      if (snap.driverId !== driver.id) return;
      if (snap.vehicleId && driver.vehicleId && snap.vehicleId !== driver.vehicleId) return;
      meterResumedForDriverRef.current = driver.id;

      // Drift adjustment — at most 30 min, since real trips don't typically
      // exceed that gap. Anything older is clamped to keep the fare sane.
      const ageSecs = Math.min(30 * 60, Math.max(0, Math.floor((Date.now() - snap.savedAt) / 1000)));

      // Resolve tariff — prefer freshly-loaded matching id, then the embedded
      // full object, then a synthetic one built from the scalar fields.
      const fromList = availableTariffs.find(t => t.id === snap.tariffId);
      const tariff: Tariff = (fromList as Tariff)
        || (snap.tariffFull as Tariff)
        || ({
          id: snap.tariffId || 'restored',
          name: snap.tariffName || 'Restored',
          flagFall: snap.flagFall,
          ratePerMile: snap.ratePerMile,
          waitingPerMin: snap.waitingPerMin,
          waitingInterval: snap.waitingInterval || 60,
          speedThreshold: snap.speedThreshold || 1,
        } as Tariff);

      activeTariffRef.current = tariff;
      setActiveTariffState(tariff);

      // Restore refs (with drift baked into seconds + proportional waiting)
      meterSecondsRef.current = snap.meterSeconds + ageSecs;
      meterDistanceRef.current = snap.meterDistance;
      meterIsWaitingRef.current = snap.meterIsWaiting;
      meterWaitingSecsRef.current = snap.meterWaitingSecs;
      meterWaitingIntervalsRef.current = snap.meterWaitingIntervals;
      let extraWait = 0;
      if (snap.meterIsWaiting && ageSecs > 0) {
        const perSec = (tariff.waitingPerMin || 0) / (tariff.waitingInterval || 60);
        extraWait = perSec * ageSecs;
      }
      meterWaitingCostRef.current = snap.meterWaitingCost + extraWait;
      meterRunningRef.current = true;
      meterPausedRef.current  = snap.meterPaused;
      meterOnAtRef.current    = snap.meterOnAt;

      if (snap.isHail && snap.hailMeta) {
        hailTripMetaRef.current = snap.hailMeta;
        setHailTripMeta(snap.hailMeta);
      }

      setMeterRunning(true);
      setMeterPaused(snap.meterPaused);
      setMeterSeconds(meterSecondsRef.current);
      setMeterDistance(meterDistanceRef.current);
      setMeterIsWaiting(snap.meterIsWaiting);
      setMeterWaitingIntervals(snap.meterWaitingIntervals);
      setMeterWaitingCost(meterWaitingCostRef.current);
      setStatusState('Busy');

      // Re-arm the 1Hz tick. Distance accumulation re-attaches automatically
      // through the GPS watcher effect once meterRunningRef is true again.
      if (meterInterval.current) clearInterval(meterInterval.current);
      meterInterval.current = setInterval(() => {
        if (!meterRunningRef.current || meterPausedRef.current) return;
        meterSecondsRef.current += 1;
        setMeterSeconds(meterSecondsRef.current);
        if (meterIsWaitingRef.current) {
          const t = activeTariffRef.current;
          const perSec = (t.waitingPerMin || 0) / (t.waitingInterval || 60);
          meterWaitingCostRef.current += perSec;
          setMeterWaitingCost(meterWaitingCostRef.current);
          meterWaitingSecsRef.current += 1;
          if (meterWaitingSecsRef.current >= (t.waitingInterval || 60)) {
            meterWaitingIntervalsRef.current += 1;
            meterWaitingSecsRef.current = 0;
            setMeterWaitingIntervals(meterWaitingIntervalsRef.current);
          }
        }
      }, 1000);

      const mins = Math.floor(meterSecondsRef.current / 60);
      const km   = meterDistanceRef.current.toFixed(2);
      const fareNow = (tariff.flagFall + meterDistanceRef.current * tariff.ratePerMile + meterWaitingCostRef.current).toFixed(2);
      console.log(`[Meter] Cold-start resume: ${mins}min, ${km}km, $${fareNow}, +${ageSecs}s drift, isHail=${snap.isHail}`);
      // v12-ota22c4-d: cancellable timer — if the driver signs out (or the
      // effect deps change) before this fires, we don't want a "Trip resumed"
      // alert popping over the login screen.
      pendingAlertTimer = setTimeout(() => {
        if (cancelled) return;
        Alert.alert(
          'Trip resumed',
          `Your meter was restored after the app restart.\n\nFare so far: $${fareNow}\nDistance: ${km} km\nTime: ${mins} min\n\nKeep driving — complete the trip normally and it will sync.`,
          [{ text: 'OK' }],
        );
      }, 800);
    })();
    return () => {
      cancelled = true;
      if (pendingAlertTimer) { clearTimeout(pendingAlertTimer); pendingAlertTimer = null; }
    };
  }, [driver?.id, driver?.companyId, availableTariffs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── v22c-d4: Restore last-used tariff from AsyncStorage ───────────────────
  // Runs once after availableTariffs loads. If the driver picked a non-TM
  // tariff in a previous session, default to it instead of the first one in
  // the list. Skipped if a meter is already running (cold-start resume above
  // owns the active tariff in that case) or if Firebase already restored a
  // tariff from snap.tariffId in the meterResume effect.
  const lastTariffRestoredRef = useRef(false);
  useEffect(() => {
    if (!driver?.id) return;
    if (availableTariffs.length === 0) return;
    if (lastTariffRestoredRef.current) return;
    if (meterRunningRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const { getLastTariffId } = await import('@/lib/lastPickerDefaults');
        const lastId = await getLastTariffId();
        if (cancelled || !lastId) return;
        const found = availableTariffs.find(t => t.id === lastId);
        if (!found) return;
        if (meterRunningRef.current) return;
        lastTariffRestoredRef.current = true;
        activeTariffRef.current = found;
        setActiveTariffState(found);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [driver?.id, availableTariffs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Safety net: stop background-location task if driver disappears ────────
  // If the auth state clears (kick, session expiry, sign-out via a path that
  // doesn't go through clearOnlinePresence), make sure the foreground service
  // notification + GPS stream stop. Otherwise the OS keeps tracking even
  // though the driver is no longer logged in.
  useEffect(() => {
    if (!driver) {
      stopBackgroundLocation().catch(() => {});
    }
  }, [driver]);

  // ── storePushToken ────────────────────────────────────────────────────────
  // Called from _layout.tsx after Expo push token is obtained.
  // Stores the token in:
  //   • pushTokenRef (in-memory, so the online-presence writer can include it)
  //   • drivers/{companyId}/{uid}/pushToken  (persistent — dispatch console reads this)
  //
  // ⚠ Firebase Realtime Database rules required:
  //   The path drivers/{companyId}/{uid}/pushToken must be readable by the
  //   dispatch console so it can call the Expo Push API when assigning jobs.
  //   If your rules are "auth != null" for reads this is already covered.
  //   If they are more restrictive, add a read rule for that path.
  const storePushToken = (token: string) => {
    pushTokenRef.current = token;
    const d = driverRef.current;
    if (!d?.companyId || !d?.uid) return;
    update(ref(database, `drivers/${d.companyId}/${d.uid}`), { pushToken: token }).catch(() => {});
    console.log('[Push] Push token stored in Firebase for', d.uid);
  };

  // ── Removed duplicate AppState resume effect (v12-ota5) ───────────────────
  // This block previously registered a SECOND AppState 'change' listener that
  // also wrote vehiclestatus + GPS on every foreground transition — duplicating
  // the work of the smarter "Silent presence refresh" effect at line ~4383
  // (which checks Firebase first to avoid downgrading Assigned/Busy → Available).
  // Two listeners caused: (a) double Firebase writes per resume, (b) double
  // Sentry breadcrumbs, (c) thrashing during rapid pause/resume cycles when
  // modals or alerts opened. Consolidated into the single effect below.

  // NOTE: meterRunning useEffect removed — Firebase status is now set explicitly
  // inside startMeter ('Busy'), rejectJob ('Available'), recallJob ('Available'),
  // and completeJob ('Available') to avoid race conditions on reject/cancel.

  // Listen to all online drivers (fleet) and own presence zone info while on shift
  useEffect(() => {
    if (!shiftActive || !driver?.companyId) {
      if (fleetRef.current) { off(fleetRef.current); fleetRef.current = null; }
      if (myPresenceRef.current) { off(myPresenceRef.current); myPresenceRef.current = null; }
      setOnlineDrivers([]);
      myZoneInfoRef.current = null;
      setMyZoneInfo(null);
      return;
    }

    // Fleet listener — online/{companyId}
    const fRef = ref(database, `online/${driver.companyId}`);
    fleetRef.current = fRef;
    onValue(fRef, (snap) => {
      if (!snap.exists()) { setOnlineDrivers([]); return; }
      const drivers: OnlineDriver[] = [];
      snap.forEach((vehicleSnap) => {
        const cur = vehicleSnap.child('current').val();
        if (!cur) return;
        drivers.push({
          vehicleId: String(cur.VehicleId ?? cur.vehiclenumber ?? vehicleSnap.key ?? ''),
          vehicleNumber: String(cur.vehiclenumber ?? vehicleSnap.key ?? ''),
          driverName: String(cur.drivername ?? ''),
          status: String(cur.vehiclestatus ?? 'Available'),
          lat: Number(cur.lat ?? 0),
          lng: Number(cur.lng ?? 0),
          zoneName: String(cur.zonename ?? ''),
          zoneId: Number(cur.zoneid ?? 0),
          zoneQueue: Number(cur.zonequeue ?? 0),
          jobCount: Number(cur.jobCount ?? 0),
          joboffer: Number(cur.joboffer ?? 0),
        });
      });
      setOnlineDrivers(drivers);
    });

    // My own presence — so dispatch-assigned zone shows up instantly
    if (driver.vehicleId) {
      const mRef = ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`);
      myPresenceRef.current = mRef;
      onValue(mRef, (snap) => {
        if (!snap.exists()) return;
        const d = snap.val();
        const newZoneName = String(d.zonename ?? '');

        // Record the moment dispatch assigns or changes the zone.
        // Preserve the existing timestamp if the zone name hasn't changed.
        if (!newZoneName) {
          zoneAssignedRef.current = null;
        } else if (newZoneName !== zoneAssignedRef.current?.name) {
          zoneAssignedRef.current = { name: newZoneName, at: Date.now() };
        }

        const newZoneInfo: MyZoneInfo = {
          zoneName: newZoneName,
          zoneId: Number(d.zoneid ?? 0),
          zoneQueue: Number(d.zonequeue ?? 0),
          vehicleStatus: String(d.vehiclestatus ?? 'Available'),
          zoneAssignedAt: newZoneName ? (zoneAssignedRef.current?.at ?? null) : null,
        };
        myZoneInfoRef.current = newZoneInfo;
        setMyZoneInfo(newZoneInfo);
      });
    }

    return () => {
      if (fleetRef.current) { off(fleetRef.current); fleetRef.current = null; }
      if (myPresenceRef.current) { off(myPresenceRef.current); myPresenceRef.current = null; }
    };
  }, [shiftActive, driver?.companyId, driver?.vehicleId]);

  // Tariff listener — the dispatch console writes to tariffZones/{companyId}.
  // A fallback listener on tariffs/{companyId} covers apps that use the old path.
  // Whichever path returns data first wins; the other is ignored if list already loaded.
  useEffect(() => {
    if (!driver?.companyId) return;

    const parseTariffs = (snap: any): Tariff[] => {
      const list: Tariff[] = [];
      snap.forEach((child: any) => {
        const d = child.val();
        if (!d) return;
        // Accept both old driver-app field names AND dispatch console field names:
        //   ratePerMile / pricePerKm / rate_per_mile
        //   flagFall    / baseFare   / flag_fall
        //   waitingPerMin / waitingRate / waiting_per_min
        const hasName = d.name || d.TariffName || d.tariffName;
        const hasRate = d.ratePerMile != null || d.pricePerKm != null || d.rate_per_mile != null || d.PricePerKm != null;
        if (!hasName || !hasRate) {
          console.log('[Tariff] Skipping entry', child.key, '— missing name or rate fields. Keys:', Object.keys(d).join(', '));
          return;
        }
        const parsed: Tariff = {
          id:              child.key ?? `tariff-${list.length}`,
          name:            String(d.name ?? d.TariffName ?? d.tariffName),
          flagFall:        Number(d.flagFall ?? d.flag_fall ?? d.baseFare ?? d.BaseFare ?? 3.00),
          ratePerMile:     Number(d.ratePerMile ?? d.rate_per_mile ?? d.pricePerKm ?? d.PricePerKm ?? 2.80),
          waitingPerMin:   Number(d.waitingPerMin ?? d.waiting_per_min ?? d.waitingRate ?? d.WaitingRate ?? 0.24),
          speedThreshold:  Number(d.speedThreshold ?? d.SpeedThreshold ?? d.speed_threshold ?? 1),
          waitingInterval: Number(d.waitingInterval ?? d.WaitingInterval ?? d.waiting_interval ?? 60),
        };
        console.log('[Tariff] Parsed:', parsed.id, parsed.name, '| rate:', parsed.ratePerMile, '| flagFall:', parsed.flagFall, '| waiting/min:', parsed.waitingPerMin, '| speedThreshold:', parsed.speedThreshold, 'km/h | waitingInterval:', parsed.waitingInterval, 's');
        list.push(parsed);
      });
      return list;
    };

    const applyTariffs = (list: Tariff[], source: string) => {
      if (list.length === 0) return;
      console.log('[Tariff] Loaded', list.length, 'tariffs from', source);
      setAvailableTariffs(list);
      setActiveTariffState(prev => list.find(t => t.id === prev.id) ?? list[0]);
    };

    // Primary path: tariffZones (what dispatch console writes to)
    const tariffZonesRef = ref(database, `tariffZones/${driver.companyId}`);
    onValue(tariffZonesRef, (snap) => {
      if (snap.exists()) {
        console.log('[Tariff] tariffZones raw:', JSON.stringify(snap.val()).slice(0, 300));
        applyTariffs(parseTariffs(snap), 'tariffZones');
      } else {
        console.log('[Tariff] tariffZones/' + driver.companyId + ' — no data (path empty)');
      }
    }, (err) => {
      console.warn('[Tariff] tariffZones permission denied or error:', err.message);
    });

    // Fallback path: tariffs (legacy)
    const tariffRef = ref(database, `tariffs/${driver.companyId}`);
    onValue(tariffRef, (snap) => {
      if (snap.exists()) {
        console.log('[Tariff] tariffs raw:', JSON.stringify(snap.val()).slice(0, 300));
        applyTariffs(parseTariffs(snap), 'tariffs');
      } else {
        console.log('[Tariff] tariffs/' + driver.companyId + ' — no data (path empty)');
      }
    }, (err) => {
      console.warn('[Tariff] tariffs permission denied or error:', err.message);
    });

    return () => { off(tariffZonesRef); off(tariffRef); };
  }, [driver?.companyId]);

  // Hail job queue — listens to pendingjobs/{companyId} for all drivers
  useEffect(() => {
    if (!driver?.companyId || !shiftActive) {
      if (hailListenerRef.current) { off(hailListenerRef.current); hailListenerRef.current = null; }
      setHailJobs([]);
      prevHailKeysRef.current = new Set();
      return;
    }

    const hailRef = ref(database, `pendingjobs/${driver.companyId}`);
    hailListenerRef.current = hailRef;

    // Open jobs older than 4 hours are considered stale (test data / never-claimed).
    // They are silently removed from Firebase so they never resurface.
    const STALE_MS = 4 * 60 * 60 * 1000;

    onValue(hailRef, (snap) => {
      const myId = driverRef.current?.id;
      const companyId = driverRef.current?.companyId;
      const currentKeys = new Set<string>();
      const unclaimed: HailJob[] = [];

      if (snap.exists()) {
        snap.forEach((child) => {
          const d = child.val();
          const key = child.key ?? '';

          // ── Age check — auto-expire stale unclaimed jobs ───────────────────
          const createdRaw = d.CreatedAt ?? d.createdAt;
          const ageMs = createdRaw ? Date.now() - new Date(createdRaw).getTime() : 0;
          if (createdRaw && ageMs > STALE_MS && !d.claimedBy) {
            // Job is old and still unclaimed — delete it silently from Firebase
            console.log('[PendingJobs] Auto-removing stale job', key, '— age:', Math.round(ageMs / 60000), 'min');
            remove(ref(database, `pendingjobs/${companyId}/${key}`)).catch(() => {});
            return; // don't add to currentKeys or unclaimed
          }

          currentKeys.add(key);

          // Auto-dispatch jobs from the console are never marked dispatcherOnly —
          // show any unclaimed job that isn't explicitly dispatcher-hold.
          // Also surface jobs tagged auto/autoDispatch regardless of dispatcherOnly.
          const isAuto = d.auto === true || d.autoDispatch === true ||
            String(d.DispatchMode ?? d.dispatchMode ?? d.dispatchmode ?? '').toLowerCase() === 'auto' ||
            d.CreatedBy === 'dispatch';
          const isVisible = !d.claimedBy && (!d.dispatcherOnly || isAuto);

          if (isVisible) {
            // Available for claiming
            unclaimed.push({
              id: key,
              bookingId: d.bookingRef ?? key,
              passengerName: String(d.PassengerName ?? d.passengerName ?? 'Passenger'),
              passengerPhone: String(d.PassengerPhone ?? d.passengerPhone ?? ''),
              pickupAddress: String(d.PickAddress ?? d.pickupAddress ?? ''),
              dropAddress: String(d.DropAddress ?? d.dropAddress ?? ''),
              fare: parseFloat(String(d.Fare ?? d.fare ?? '0')) || 0,
              distance: String(d.Distance ?? d.distance ?? '—'),
              duration: String(d.Duration ?? d.duration ?? '—'),
              notes: d.Info ?? d.notes ?? '',
              createdAt: d.CreatedAt ?? d.createdAt ?? new Date().toISOString(),
            });
          } else if (d.claimedBy !== myId && !claimedByMeRef.current.has(key)) {
            // Another driver just claimed a job we could see — alert if it was visible before
            if (prevHailKeysRef.current.has(key)) {
              setTakenAlert('A job was just claimed by another driver');
              setTimeout(() => setTakenAlert(null), 5000);
            }
          }
        });
      }

      // Detect jobs that vanished entirely and we didn't claim
      prevHailKeysRef.current.forEach((key) => {
        if (!currentKeys.has(key) && !claimedByMeRef.current.has(key)) {
          setTakenAlert('A job in the queue was taken by another driver');
          setTimeout(() => setTakenAlert(null), 5000);
        }
      });

      prevHailKeysRef.current = currentKeys;
      setHailJobs(unclaimed);
    });

    return () => {
      if (hailListenerRef.current) { off(hailListenerRef.current); hailListenerRef.current = null; }
    };
  }, [shiftActive, driver?.companyId]);

  useEffect(() => {
    // Dispatch writes job offers to notification/{driverId} (SQL ID, e.g. "D002").
    // Use driverId as the primary key; fall back to vehicleId only if id not yet set.
    if (!driver?.id && !driver?.vehicleId) return;
    const notifKey = driver?.id || driver?.vehicleId;

    setIsConnected(false);

    const notifPath = ref(database, `notification/${notifKey}`);
    notifRef.current = notifPath;

    const unsub = onValue(notifPath, async (snapshot) => { markSyncBlock('notification');
      // v12-ota12: per-fire entry log removed (CPU tax on every notification tick).
      setIsConnected(true);
      if (!snapshot.exists()) return;

      const data = snapshot.val();
      if (!data) return;

      // Dispatch schema:
      //   data.content   = human-readable action string (some events use data.status instead)
      //   data.bookingid = "bookingId,action,driverId,userId,source" (comma-separated)
      // Read content from whichever field dispatch used
      const content: string = (data.content ?? data.status ?? data.message ?? data.action ?? '').toString().toLowerCase();
      const bookingIdStr: string = (data.bookingid ?? data.BookingId ?? '').toString();
      const parts = bookingIdStr.split(',');
      const bookingId = parts[0]?.trim() ?? '';
      // Dispatcher is normally at parts[4], but some system messages (e.g. "Taxi Time,msg,date,time,0,Dispatcher")
      // put it at parts[5] or later.  Check every position.
      const notifSender = parts[4]?.trim() ?? '';
      const isFromDispatcher = parts.some(p => p.trim() === 'Dispatcher');

      console.log('[Notif] RAW data:', JSON.stringify(data));
      console.log('[Notif] content:', data.content, '| bookingid:', bookingIdStr, '| sender:', notifSender, '| isFromDispatcher:', isFromDispatcher);

      // ── 22bp (G5) — stale-write guard ─────────────────────────────────────
      // If we've already applied a newer event for this bookingId, drop this
      // snapshot. Firebase can replay older values during reconnect or local
      // cache flush; without this we re-popped offers that had already been
      // accepted/cancelled. Non-booking events (Away/suspend/chat with
      // bookingId === '' or 'Taxi Time') always pass through.
      if (bookingId && /^\d+$/.test(bookingId)) {
        if (shouldSkipStaleEvent(bookingId, data.version, data.updatedAt)) {
          console.log('[Notif] Stale event dropped — bookingId:', bookingId,
            'incoming v:', data.version, 'ts:', data.updatedAt,
            'have:', JSON.stringify(bookingVersionsRef.current.get(bookingId)));
          remove(notifPath).catch(() => {});
          return;
        }
        // Mark high-water mark up front — any subsequent replay of the same
        // write is now eligible to be dropped, even if processing below is
        // async (jobs-path fetch retries up to 3 seconds).
        markBookingVersion(bookingId, data.version, data.updatedAt);
      }

      // ── 22bp (G4) — eventType router ──────────────────────────────────────
      // Dispatch now stamps a top-level eventType on every notification write.
      // Recognised values: new_offer | updated | cancelled | reassigned |
      // completed | recalled. Authoritative when present; fall back to keyword
      // routing below when absent (legacy dispatch builds).
      const eventType = String(data.eventType ?? '').toLowerCase().trim();
      if (eventType && bookingId && /^\d+$/.test(bookingId)) {
        if (eventType === 'cancelled' || eventType === 'recalled' || eventType === 'reassigned') {
          // Offer pulled before the driver responded (or reassigned away).
          // Silently close the offer modal + drop the offered row from jobs[].
          // If the driver has ALREADY accepted (current/queued), defer to the
          // jobs-path / allbookings listener which has the full cancel UX
          // (alert + status reset + presence patch).
          const known = latestJobsRef.current.find(j => j.bookingId === bookingId);
          if (!known || known.status === 'offered') {
            console.log('[Notif] eventType=', eventType, '→ silent close for bookingId:', bookingId);
            setIncomingJob(prev => (prev?.bookingId === bookingId ? null : prev));
            setJobs(prev => prev.filter(j => !(j.bookingId === bookingId && j.status === 'offered')));
            clearSeenForBooking(bookingId);
          } else {
            console.log('[Notif] eventType=', eventType, '— booking is', known.status, ', deferring to jobs/allbookings listener');
          }
          markBookingVersion(bookingId, data.version, data.updatedAt);
          remove(notifPath).catch(() => {});
          return;
        }
        if (eventType === 'completed') {
          // Trip closed elsewhere (driver completed on another device, or
          // dispatch closed). Local completeJob/cancellation already handled
          // state; just clean up the notification.
          console.log('[Notif] eventType=completed — removing stale notification for', bookingId);
          markBookingVersion(bookingId, data.version, data.updatedAt);
          remove(notifPath).catch(() => {});
          return;
        }
        if (eventType === 'updated') {
          // Field-level edit. The allbookings listener owns the patch path
          // (covers all field merges with the Alert). Mark version, fall
          // through so the existing logic can still react if it wants.
          console.log('[Notif] eventType=updated — letting allbookings listener patch', bookingId);
          markBookingVersion(bookingId, data.version, data.updatedAt);
          remove(notifPath).catch(() => {});
          return;
        }
        // eventType === 'new_offer' or anything else → fall through to the
        // existing keyword router. Version will be marked once the offer is
        // surfaced to the driver below.
      }

      // ── DRIVER'S OWN ECHO ─────────────────────────────────────────────────
      // When the driver sends a message they write to notification/{driverId} so
      // the dispatch console sees it.  That triggers our OWN onValue listener.
      // Detect the echo: sender field is the driver's vehicleId, NOT "Dispatcher".
      const d0 = driverRef.current;
      const isOwnEcho = !isFromDispatcher &&
        notifSender !== '' &&
        (notifSender === d0?.vehicleId || notifSender === d0?.id);
      if (isOwnEcho) {
        console.log('[Notif] skipping own echo (sender:', notifSender, ')');
        return;   // leave the node for dispatch to read; dispatch's set() will overwrite it later
      }

      // ── AWAY STATUS (driver missed job / dispatcher reset) ─────────────────
      // Format: bookingid = "Taxi Time,<msg>,<date>,<time>,0,Dispatcher"
      // This tells driver they were set Away for not accepting a job in time.
      //
      // 22c (Bug #2 fix — server-dev escalation): branch on `data.source`.
      // A dispatcher UNASSIGN of a specific booking arrives with a numeric
      // bookingId + source='Dispatcher' — that's a job-pull, NOT an Away
      // timeout, and must NOT flip the driver to Away. Only system-level
      // signals (bookingId='Taxi Time' / empty bookingId) should trigger
      // Away. Passenger-cancel paths likewise carry a real bookingId and
      // go through the cancel listener, never here.
      const notifSource = String(data.source ?? data.Source ?? '').trim();
      const hasNumericBookingId = bookingId && /^\d+$/.test(bookingId);
      const isSystemAwaySignal =
        bookingId === 'Taxi Time' ||
        !bookingId ||
        bookingId === '0';
      const matchesAwayKeyword =
        content.includes('not accepted in time') ||
        content.includes('tap available when ready') ||
        (content.includes('away') && !content.includes('driver away'));
      // Only treat as Away when this is a system-level signal. A keyword
      // match alongside a numeric booking ID is a dispatcher unassign that
      // happens to mention "away" in the message — route it through the
      // cancellation path instead.
      const isAwayNotif = isSystemAwaySignal && matchesAwayKeyword
        || (isSystemAwaySignal && bookingId === 'Taxi Time'); // legacy fast-path

      // Dispatcher unassign of a specific booking (numeric bookingId from a
      // Dispatcher source) — silent close, no Away flip. Mirrors the
      // eventType='reassigned' path above for legacy dispatch builds that
      // don't stamp eventType yet.
      if (
        hasNumericBookingId &&
        (notifSource === 'Dispatcher' || isFromDispatcher) &&
        matchesAwayKeyword &&
        !isAwayNotif
      ) {
        console.log('[Notif] Dispatcher unassign of booking', bookingId, '— silent close, NOT Away (Bug #2 fix)');
        setIncomingJob(prev => (prev?.bookingId === bookingId ? null : prev));
        setJobs(prev => prev.filter(j => !(j.bookingId === bookingId && j.status === 'offered')));
        clearSeenForBooking(bookingId);
        remove(notifPath).catch(() => {});
        return;
      }

      if (isAwayNotif) {
        // ── Race-condition guard ────────────────────────────────────────────
        // If the driver tapped Accept within the last 15 s, this "Away"
        // notification was already in-flight when they accepted (dispatcher
        // timer fired simultaneously).  Ignore it — the driver DID accept.
        const msSinceAccept = Date.now() - lastAcceptTimeRef.current;
        // Grace window = dispatcher's full timeout (30 s) + network buffer.
        // If the driver accepted within this window and we already have a
        // current job in local state, the "Away" was in-flight — ignore it.
        const hasCurrentJob = jobs.some(j => j.status === 'current' || j.status === 'queued');
        if (msSinceAccept < 35_000 && hasCurrentJob) {
          console.log('[Notif] Ignoring stale Away notification — driver accepted', msSinceAccept, 'ms ago, has current job');
          remove(notifPath).catch(() => {});
          return;
        }

        console.log('[Notif] Away/missed-job notification from dispatcher — setting status to Away');

        // Clear current/queued jobs when no meter is running.
        // KEEP offered jobs — they will be re-surfaced as an IncomingJobAlert
        // the next time the driver taps "Make Available" (Away → Available loop).
        // If the dispatcher cancels the job, the cancel notification will remove it.
        setJobs(prev => {
          if (meterRunningRef.current) {
            // On a live metered trip — keep trip job; remove any dangling offers
            return prev.filter(j => j.status !== 'offered');
          }
          // No active trip — keep only offered jobs for re-surfacing later
          return prev.filter(j => j.status === 'offered');
        });
        setIncomingJob(null);

        // Also clean up Firebase so dispatcher sees driver as unassigned
        const d = driverRef.current;
        if (d?.companyId && d?.vehicleId && d?.id) {
          remove(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)).catch(() => {});
          update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
            vehiclestatus: 'Away',
            joboffer: 0, jobCount: 0,
            JobphoneNo: '', jobpickup: '', jobdropoff: '',
            time: new Date().toISOString(),
          }).catch(() => {});
        }

        // Set local status to Away so the "Make me Available" banner appears on home screen.
        setStatusState('Away');
        statusRef.current = 'Away';
        Alert.alert(
          'Job Not Accepted',
          'You did not respond to the job offer in time and have been set to Away.\n\nGo to Home and tap the banner to make yourself Available again.',
          [{ text: 'OK' }]
        );
        remove(notifPath).catch(() => {});
        return;
      }

      // ── AUTO-DISPATCH / HAIL QUEUE JOB ────────────────────────────────────
      // When dispatch sets a booking to "Auto" mode it broadcasts to all online
      // drivers rather than targeting one.  Route these into pendingjobs so every
      // driver sees the card and the first to claim it wins.
      const isAutoDispatch =
        content.includes('auto') ||
        content.includes('queue') ||
        content.includes('hail') ||
        data.autoDispatch === true ||
        data.auto === true ||
        data.DispatchMode === 'auto' ||
        data.dispatchMode === 'auto' ||
        String(data.dispatchmode ?? '').toLowerCase() === 'auto';

      if (isAutoDispatch && bookingId) {
        // Guard: don't duplicate. 22bo-fix5: dedup on (bookingId, offeredAt) so
        // a re-offer with new offeredAt is treated as fresh.
        const __k = seenKey(bookingId, data.offeredAt ?? data.OfferedAt);
        if (seenBookingIdsRef.current.has(__k)) {
          remove(notifPath).catch(() => {});
          return;
        }
        seenBookingIdsRef.current.add(__k);

        const d = driverRef.current;
        if (d?.companyId) {
          // Fetch job details if available (retry up to 3x — notification can arrive before the write)
          let jobData: any = null;
          if (d.vehicleId) {
            const autoJobPath = ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`);
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const jobSnap = await get(autoJobPath);
                if (jobSnap.exists()) { jobData = jobSnap.val(); break; }
              } catch { break; }
              if (attempt < 2) await new Promise(r => setTimeout(r, 800));
            }
          }

          // Write to pendingjobs so all drivers see it in the Hail tab
          const pendingPayload: Record<string, any> = {
            PassengerName:  jobData?.PassengerName ?? data.PassengerName ?? data.passengerName ?? 'Passenger',
            PassengerPhone: jobData?.PassengerPhone ?? data.PassengerPhone ?? data.passengerPhone ?? '',
            PickAddress:    jobData?.PickAddress    ?? data.PickAddress    ?? data.pickAddress    ?? '',
            DropAddress:    jobData?.DropAddress    ?? data.DropAddress    ?? data.dropAddress    ?? '',
            Fare:           jobData?.Fare           ?? data.Fare           ?? data.fare           ?? '0',
            Distance:       jobData?.Distance       ?? data.Distance       ?? '—',
            Duration:       jobData?.Duration       ?? data.Duration       ?? '—',
            Info:           jobData?.Info           ?? data.Info           ?? data.notes          ?? '',
            CreatedAt:      new Date().toISOString(),
            CreatedBy:      'dispatch',
            bookingRef:     bookingId,
          };
          set(ref(database, `pendingjobs/${d.companyId}/${bookingId}`), pendingPayload).catch(() => {});
        }

        remove(notifPath).catch(() => {});
        return;
      }

      // ── NEW JOB OFFER ──────────────────────────────────────────────────────
      // Covers initial offers AND re-dispatches after a missed/declined job.
      // Also covers "Pending" notifications (no content field) sent by dispatch
      // when the driver is busy — these use the bookingid action "Pending" with
      // a numeric booking ID and no content field at all.
      const isPendingDispatch =
        isFromDispatcher &&
        !!bookingId &&
        /^\d+$/.test(bookingId) &&
        parts[1]?.trim().toLowerCase() === 'pending' &&
        content === '';

      if (isPendingDispatch) {
        console.log('[Notif] Pending dispatch offer (no content) — routing as job offer for bookingId:', bookingId);
      }

      // Catch-all: any notification from dispatcher with a numeric bookingId that
      // wasn't handled as Away / Auto-dispatch / suspend / kick is a job offer.
      // Prevents silent drop when dispatch sends empty-content or non-keyword content.
      const isDispatcherJobOffer = isFromDispatcher && !!bookingId && /^\d+$/.test(bookingId);

      if (
        isPendingDispatch || isDispatcherJobOffer ||
        content.includes('new job')       || content.includes('offered')         ||
        content.includes('view details')  || content.includes('re-offer')        ||
        content.includes('redispatch')    || content.includes('re-dispatch')     ||
        content.includes('re-assign')     || content.includes('reassign')        ||
        content.includes('dispatched to') || content.includes('re-dispatched')   ||
        content.includes('job offer')     || content.includes('job assigned')
      ) {
        if (!bookingId) {
          // No bookingId — delete and ignore
          remove(notifPath).catch(() => {});
          return;
        }

        // OTA22c3 — Hail self-notification guard. If the dispatch server pushes
        // a notification for the driver's OWN active hail bookingId (e.g. echo
        // of /api/job/create with source:'hail'), do NOT pop the offer modal.
        if (hailTripMetaRef.current?.bookingId && bookingId === hailTripMetaRef.current.bookingId) {
          console.log('[Notif] Ignoring own hail self-notification — bookingId:', bookingId);
          remove(notifPath).catch(() => {});
          return;
        }

        // Guard: don't re-show if already handled. 22bo-fix5: dedup on
        // (bookingId, offeredAt) — a re-offer carries a new offeredAt so the
        // tuple is fresh even when the bookingId is the same.
        const __nk = seenKey(bookingId, data.offeredAt ?? data.OfferedAt);
        if (seenBookingIdsRef.current.has(__nk)) {
          remove(notifPath).catch(() => {});
          return;
        }
        seenBookingIdsRef.current.add(__nk);

        // Fetch full job details from the jobs path.
        // The notification can arrive before dispatch finishes writing the job record,
        // so retry up to 4 times (every 800 ms) until data appears.
        //
        // GUARD: When the meter is running the jobs/ path belongs to the ACTIVE trip.
        // Skip both the stale-clear and the jobs-path read — touching either would
        // corrupt or cancel the live trip.  The allbookings fallback below supplies
        // the new offer's details instead.
        let jobData: any = null;
        if (meterRunningRef.current) {
          console.log('[Notif] Meter running — skipping jobs/ read, will use allbookings for offer', bookingId);
        } else if (driverRef.current?.companyId && driverRef.current?.vehicleId && driverRef.current?.id) {
          // Purge any stale jobs-path record from a previous job before we try
          // to read the new one.  Without this, a lingering DriverAccepted node
          // (no BookingId, or a different BookingId) either poisons the new job's
          // details OR makes the dispatcher think the driver is still occupied.
          const jobsRef = ref(
            database,
            `jobs/${driverRef.current.companyId}/${driverRef.current.vehicleId}/${driverRef.current.id}`
          );
          try {
            const staleSnap = await get(jobsRef);
            if (staleSnap.exists()) {
              const staleData = staleSnap.val();
              const staleBookingId = String(staleData.BookingId ?? '');
              const isDriverStatusWrite = !staleData.PassengerName && !staleData.PickAddress;
              // Clear if: different/missing bookingId, OR our own driver-status-only write
              // (DriverDeclined/DriverAccepted/Offered with no passenger fields).
              if (!staleBookingId || staleBookingId !== bookingId || isDriverStatusWrite) {
                await remove(jobsRef).catch(() => {});
                console.log('[Notif] Cleared stale jobs path (was:', staleData.Status, staleBookingId || 'no-bookingId', ')');
              }
            }
          } catch { /* non-critical */ }

          if (driverRef.current?.companyId && driverRef.current?.vehicleId) {
            const jobPath = ref(
              database,
              `jobs/${driverRef.current.companyId}/${driverRef.current.vehicleId}/${driverRef.current.id}`
            );
            for (let attempt = 0; attempt < 4; attempt++) {
              try {
                const jobSnap = await get(jobPath);
                if (jobSnap.exists()) {
                  jobData = jobSnap.val();
                  break;
                }
              } catch {
                // network error — stop retrying
                break;
              }
              // Data not there yet — wait 800 ms then retry
              if (attempt < 3) {
                console.log(`[Notif] jobs path empty on attempt ${attempt + 1}, retrying in 800ms…`);
                await new Promise(r => setTimeout(r, 800));
              }
            }
            console.log('[Notif] jobData after fetch:', jobData ? JSON.stringify(jobData).slice(0, 200) : 'null');
          }
        }

        // Fallback: if jobs path was empty after retries, read from allbookings/{companyId}/{bookingId}.
        // The dispatcher creates the allbookings record at booking creation time (before dispatching),
        // so it always has full passenger + address details even when jobs/ path is delayed.
        if (!jobData && driverRef.current?.companyId && bookingId) {
          try {
            const abSnap = await get(ref(database, `allbookings/${driverRef.current.companyId}/${bookingId}`));
            if (abSnap.exists()) {
              jobData = abSnap.val();
              console.log('[Notif] jobData from allbookings:', JSON.stringify(jobData).slice(0, 200));
            }
          } catch {
            console.log('[Notif] allbookings read failed (permission or network)');
          }
        }

        // ── Terminal-status guard ──────────────────────────────────────────────
        // If allbookings shows the job is already Completed / Cancelled / NoShow,
        // do NOT surface it as an offer. Dispatch sometimes re-fires notifications
        // (manual re-dispatch, network retry) for jobs that are already closed —
        // without this check the driver gets a popup for a finished trip.
        const terminalStatus = String(jobData?.Status ?? '').trim().toLowerCase();
        if (terminalStatus === 'completed' || terminalStatus === 'cancelled' ||
            terminalStatus === 'canceled'  || terminalStatus === 'noshow'    ||
            terminalStatus === 'no-show'   || terminalStatus === 'no_show') {
          console.log('[Notif] Skipping offer — booking', bookingId, 'is already', terminalStatus);
          remove(notifPath).catch(() => {});
          // Also remove the stale jobs-path entry if dispatch left one behind
          const dq = driverRef.current;
          if (dq?.companyId && dq?.vehicleId && dq?.id) {
            remove(ref(database, `jobs/${dq.companyId}/${dq.vehicleId}/${dq.id}`)).catch(() => {});
          }
          return;
        }

        // Sanitise deviceUid — parts[3] can be the literal string "null" from the
        // dispatch notification format, which would write to Passengerjobs/null/status.
        const rawDeviceUid = jobData?.DeviceUid ?? parts[3]?.trim() ?? '';
        const resolvedDeviceUid = (rawDeviceUid && rawDeviceUid !== 'null') ? rawDeviceUid : '';

        // Synchronise the driver countdown with the dispatcher's timer.
        // Dispatcher sends TimeOut (seconds) and usually a DateTime/time field.
        // We compute the exact ms when the offer expires so IncomingJobAlert can
        // show the same number the dispatcher console shows.
        const rawTimeout = data.TimeOut ?? data.timeout ?? data.jobtimeout ??
                           data.JobTimeout ?? data.Timeout ?? data.jobTimeout;
        const offerTimeoutSecs = (parseInt(String(rawTimeout ?? ''), 10) || 30);

        // Parse dispatcher's send timestamp. Try several field names.
        const rawSentAt = data.time ?? data.DateTime ?? data.dateTime ??
                          data.timestamp ?? data.Timestamp ?? data.sentAt;
        let offerSentAt: number;
        if (rawSentAt) {
          const parsed = new Date(rawSentAt).getTime();
          offerSentAt = isNaN(parsed) ? Date.now() : parsed;
        } else {
          offerSentAt = Date.now();
        }
        console.log(`[Notif] Offer timeout: ${offerTimeoutSecs}s, sent at: ${new Date(offerSentAt).toISOString()}, elapsed: ${Math.round((Date.now()-offerSentAt)/1000)}s`);

        // Dispatch sends job fields in the notification payload too
        // (jobpickup / jobdropoff / jobname / JobphoneNo / jobinfo).
        // Use them as fallbacks when the jobs/ Firebase path is empty.
        const newJob: Job = {
          id: `job-${bookingId}-${Date.now()}`,
          bookingId,
          deviceUid:       resolvedDeviceUid,
          passengerName:   (jobData?.PassengerName  ?? String(data.jobname    ?? data.PassengerName ?? '').trim()) || 'Passenger',
          passengerPhone:  (jobData?.PassengerPhone ?? String(data.JobphoneNo ?? data.jobphone      ?? '').trim()),
          pickupAddress:   (jobData?.PickAddress    ?? String(data.jobpickup  ?? data.PickAddress   ?? '').trim()) || 'See dispatch for pickup',
          dropAddress:     (jobData?.DropAddress    ?? String(data.jobdropoff ?? data.DropAddress   ?? '').trim()) || 'See dispatch for drop-off',
          fare:            parseFloat(String(jobData?.Fare ?? data.jobFare ?? data.Fare ?? '0')) || 0,
          distance:        (jobData?.Distance ?? String(data.jobdistance ?? '—')) || '—',
          duration:        jobData?.Duration ?? '—',
          status:          'offered',
          createdAt:       new Date().toISOString(),
          notes:           jobData?.Info ?? String(data.jobinfo ?? '').trim(),
          paymentType:     parsePaymentType(
                             jobData?.PaymentType ?? jobData?.AccountType ??
                             data.PaymentType     ?? data.AccountType     ?? data.paymenttype
                           ),
          offerTimeoutSecs,
          offerSentAt,
          vehicleType:     String(data.jobvehicletype ?? jobData?.VehicleType ?? '').trim() || 'Not Specified',
          passengers:      parseInt(String(data.jobpassengers ?? jobData?.Passengers ?? '1'), 10) || 1,
          bookingType:     String(jobData?.BookingType ?? data.BookingType ?? data.bookingType ?? data.serviceType ?? data.ServiceType ?? '').trim() || undefined,
          orderDetails:    String(jobData?.Details ?? jobData?.Info ?? data.Details ?? data.jobinfo ?? '').trim() || undefined,
          // sourceCompanyId: the company that dispatched this job — may differ from driver's home company
          sourceCompanyId: (() => {
            const src = String(
              data.sourceCompanyId ?? data.SourceCompanyId ?? data.CompanyId ?? data.companyId ??
              jobData?.CompanyId ?? jobData?.companyId ?? jobData?.sourceCompanyId ?? ''
            ).trim();
            const homeId = driverRef.current?.companyId ?? '';
            return (src && src !== homeId) ? src : undefined;
          })(),
          // TM fields — fall back to passenger-app array fields if dispatcher hasn't mapped them
          tmVoucherNo:     String(
            jobData?.tmVoucherNo ?? data.tmVoucherNo ??
            (Array.isArray(data.tmVoucherNumbers) ? data.tmVoucherNumbers[0] : undefined) ??
            data.tmPassengers?.[0]?.cardNumber ?? ''
          ).trim() || undefined,
          tmPassengerName: String(jobData?.tmPassengerName ?? data.tmPassengerName ?? data.tmPassengers?.[0]?.name ?? '').trim() || undefined,
          tmCardExpiry:    String(jobData?.tmCardExpiry  ?? data.tmCardExpiry  ?? '').trim() || undefined,
          tmHoistRequired: !!(jobData?.tmHoistRequired ?? data.tmHoistRequired),
          tmHoistCount:    parseInt(String(jobData?.tmHoistCount ?? data.tmHoistCount ?? '0'), 10) || 0,
          tmSubsidy:       parseFloat(String(jobData?.tmSubsidy ?? data.tmSubsidy ?? '0')) || undefined,
          tmPassengerPays: parseFloat(String(jobData?.tmPassengerPays ?? data.tmPassengerPays ?? '0')) || undefined,
          tmPaymentMethod: String(jobData?.tmPaymentMethod ?? data.tmPaymentMethod ?? '').trim() || undefined,
          // paymentMethod drives meter-vs-fixed/pre-paid logic in the Meter tab
          jobPaymentMethod: String(
            data.paymentMethod ?? data.PaymentMethod ??
            jobData?.paymentMethod ?? jobData?.PaymentMethod ?? ''
          ).trim().toLowerCase() || undefined,
          // Stripe/prepaid payment status — drives end-of-trip skip-payment logic
          paymentStatus: String(
            data.paymentStatus ?? data.PaymentStatus ??
            jobData?.paymentStatus ?? jobData?.PaymentStatus ?? ''
          ).trim().toLowerCase() || undefined,
          prepaid: !!(data.prepaid ?? data.Prepaid ?? jobData?.prepaid ?? jobData?.Prepaid) || undefined,
          serviceType: String(
            data.serviceType ?? data.ServiceType ??
            jobData?.serviceType ?? jobData?.ServiceType ?? ''
          ).trim().toLowerCase() || undefined,
        };

        // v12-ota22c4-f: PHANTOM-OFFER GUARD.  If neither the jobs/ path nor
        // the allbookings fallback returned any data AND the notification
        // payload itself has no passenger/pickup/drop fields, the resulting
        // newJob is just placeholders ('Passenger' / 'See dispatch for …').
        // Surfacing it pops an empty offer modal — exact symptom the driver
        // reported after hail completion.  Drop it.
        const _hasJobData    = !!jobData;
        const _hasPushFields =
          String(data.jobname    ?? data.PassengerName ?? '').trim() !== '' ||
          String(data.jobpickup  ?? data.PickAddress   ?? '').trim() !== '' ||
          String(data.jobdropoff ?? data.DropAddress   ?? '').trim() !== '' ||
          String(data.JobphoneNo ?? data.jobphone      ?? '').trim() !== '';
        if (!_hasJobData && !_hasPushFields) {
          console.log('[Notif] Phantom notification — no jobData and no push fields for bookingId:', bookingId, '— suppressing offer');
          remove(notifPath).catch(() => {});
          return;
        }

        // ── Vehicle type / capacity filter ───────────────────────────────────
        // Skip offers the driver's vehicle can't fulfil.
        if (!jobMatchesVehicle(newJob)) {
          console.log('[Notif] Job filtered out — vehicle type/capacity mismatch:', newJob.vehicleType, newJob.passengers, 'vs', vehicleTypeCodeRef.current, seatCapacityRef.current, 'seats');
          remove(notifPath).catch(() => {});
          return;
        }

        // Guard: if driver is already on a dispatched trip or running a Hail meter,
        // add as SILENT offer (badge count only, no popup) — mirrors jobs-path listener.
        // Driver can accept-to-queue or decline silently from the Dashboard badge.
        const driverIsBusy = jobs.some(j => j.status === 'current') || meterRunningRef.current;
        if (driverIsBusy) {
          console.log('[Notif] Silent offer — driver busy, queuing silently:', bookingId);
          setJobs(prev => {
            if (prev.some(j => j.bookingId === bookingId)) return prev;
            return [newJob, ...prev];
          });
        } else {
          setIncomingJob(newJob);
          setJobs(prev => {
            const exists = prev.find(j => j.bookingId === bookingId);
            if (exists) return prev;
            return [newJob, ...prev];
          });
          // ── Local push notification when app is backgrounded ─────────────
          // When the app is in the background or screen is locked, the
          // IncomingJobAlert modal cannot show. Fire a local push notification
          // so the driver gets a banner + sound even when not looking at the app.
          // (When app is completely killed, the dispatch console must send a
          // remote push via the Expo Push API using the token in Firebase.)
          if (appStateRef.current !== 'active') {
            scheduleJobNotification({
              pickup: newJob.pickupAddress || '',
              jobId: bookingId,
            }).catch(() => {});
          }
        }

        // Signal to the dispatcher console that the driver has received the offer
        // and is deciding — booking status should show 'Offered', not 'Assigned'.
        // Only write to allbookings (not to the jobs path — writing there corrupts
        // the dispatcher's job data which is the source of truth for field reads).
        // Always fires (busy or free) so dispatch sees the offer was received.
        if (driverRef.current?.companyId) {
          update(ref(database, `allbookings/${driverRef.current.companyId}/${bookingId}`), {
            Status: 'Offered',
            OfferedAt: new Date().toISOString(),
          }).catch(() => {});
        }

        // Delete notification — driver app is now handling it
        remove(notifPath).catch(() => {});
        return;
      }

      // ── DRIVER SUSPENDED ───────────────────────────────────────────────────
      // Dispatcher sends a notification with content containing "suspend".
      // Content may include duration e.g. "suspended for 2 hours".
      if (content.includes('suspend')) {
        // Extract duration string if present in content (e.g. "2 hours", "1 day")
        const durationMatch = content.match(/(\d+\s*(hour|day|minute|week|month)s?)/i);
        const durationPart = durationMatch ? ` for ${durationMatch[0]}` : '';

        // Clean up presence so dispatch sees driver offline
        const dSusp = driverRef.current;
        if (dSusp?.companyId && dSusp?.vehicleId) {
          selfClearedPresenceRef.current = true;
          remove(ref(database, `online/${dSusp.companyId}/${dSusp.vehicleId}/current`)).catch(() => {});
        }
        setJobs([]);
        setIncomingJob(null);
        stopMeter();
        remove(notifPath).catch(() => {});

        // Note: the dispatch console writes the suspension record to
        // suspended/{companyId}/{vehicleId} — the real-time listener below
        // will pick that up and show the alert. The notification handler
        // still clears presence/jobs immediately for fast UX.
        // Only show alert here if the message is different (fallback).
        setSystemAlert({
          id: Date.now(),
          type: 'suspended',
          title: 'Account Suspended',
          message: `You have been suspended${durationPart}. Please contact the company to have your suspension removed.`,
        });
        return;
      }

      // ── DRIVER KICKED FROM SYSTEM (global, no specific job) ────────────────
      // System-level kicks arrive with bookingIdStr starting with "Taxi Time"
      // (same prefix used for Away/system notifications).
      // Job-specific kicks have a numeric bookingId (e.g. "20042026155").
      // Broaden keyword list to catch all variations dispatch might send.
      const KICK_KEYWORDS = ['kicked', 'removed from system', 'driver removed', 'account removed', 'deactivated', 'blocked driver', 'driver block'];
      const hasKickKeyword = KICK_KEYWORDS.some(kw => content.includes(kw));
      const isSystemKick = hasKickKeyword &&
        (bookingIdStr.startsWith('Taxi Time') || !/^\d/.test(bookingId));

      if (isSystemKick) {
        // ── Guard 1: network problem ──────────────────────────────────────
        // If the driver is not connected when this arrives, it may be a
        // phantom notification due to connectivity loss — do NOT sign out.
        if (!isConnectedRef.current) {
          Alert.alert(
            'Network Problem',
            'Your connection dropped briefly. The app will reconnect automatically — please wait a moment.',
            [{
              text: 'OK',
              onPress: () => {
                // Force Firebase to attempt reconnection immediately
                goOnline(database);
              },
            }],
          );
          remove(notifPath).catch(() => {});
          return;
        }

        // ── Guard 2: driver has an active job ─────────────────────────────
        // Cannot be kicked while on a trip or with a job on screen.
        // v22s: include hailTripMetaRef — between handleOpenComplete (which
        // pauses the meter) and completeHailTrip writing the final status,
        // meterRunningRef may briefly read false. Without this check, a
        // stale "kicked" notification arriving during trip completion fires
        // the "Removed from System" alert mid-payment-confirmation.
        const hasActiveJob = meterRunningRef.current ||
          !!hailTripMetaRef.current ||
          latestJobsRef.current.some(j => j.status === 'current' || j.status === 'queued');
        if (hasActiveJob) {
          console.log('[Notif] System kick ignored — driver has an active job');
          remove(notifPath).catch(() => {});
          return;
        }

        // ── Kick: clear presence + sign out ──────────────────────────────
        const dKick = driverRef.current;
        if (dKick?.companyId && dKick?.vehicleId) {
          selfClearedPresenceRef.current = true;   // prevent presence-watcher double-fire
          remove(ref(database, `online/${dKick.companyId}/${dKick.vehicleId}/current`)).catch(() => {});
        }
        setJobs([]);
        setIncomingJob(null);
        stopMeter();
        remove(notifPath).catch(() => {});

        setSystemAlert({
          id: Date.now(),
          type: 'kicked',
          title: 'Removed from System',
          message: 'You have been removed from the system by dispatch. Please start shift again.',
        });
        return;
      }

      // ── DRIVER KICKED FROM A SPECIFIC JOB ──────────────────────────────────
      if (content.includes('kicked')) {
        // v22bf: if the kicked job was locally queued, free the dispatch console
        // queue slot too — otherwise the next accept-to-queue gets "Queue Full".
        const kickedWasQueued = jobs.some(j => j.bookingId === bookingId && j.status === 'queued');
        setJobs(prev => prev.filter(j => {
          // For the active (current) job: only remove if the kick explicitly targets its bookingId
          if (j.status === 'current') return bookingId ? j.bookingId !== bookingId : false;
          // For offered/queued: remove if bookingId matches
          return j.bookingId !== bookingId;
        }));
        setIncomingJob(null);
        setStatusState('Available');
        stopMeter();
        if (kickedWasQueued) {
          const dk = driverRef.current;
          if (dk?.companyId && dk?.id) {
            remove(ref(database, `driverQueue/${dk.companyId}/${dk.id}/queued`)).catch(() => {});
          }
        }

        // Clear job fields from presence
        const d = driverRef.current;
        if (d?.companyId && d?.vehicleId) {
          update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
            vehiclestatus: 'Available',
            joboffer: 0, jobCount: 0,
            JobphoneNo: '', jobpickup: '', jobdropoff: '',
            time: new Date().toISOString(),
          }).catch(() => {});
        }

        Alert.alert('Dispatch', 'You have been removed from this job by dispatch.', [{ text: 'OK' }]);
        remove(notifPath).catch(() => {});
        return;
      }

      // ── JOB UPDATED (dispatcher edited pickup / drop / fare / notes) ─────────
      if (
        content.includes('job update') || content.includes('updated') ||
        content.includes('job edit')   || content.includes('update')  ||
        content.includes('changed')    || content.includes('modified') ||
        content.includes('edit')
      ) {
        console.log('[Notif] Job Updated notification — refreshing job details from Firebase');
        const d = driverRef.current;
        if (d?.companyId) {
          try {
            let jd: Record<string, any> | null = null;

            // Primary source: allbookings — dispatcher always writes updates here
            if (bookingId) {
              const abSnap = await get(ref(database, `allbookings/${d.companyId}/${bookingId}`));
              if (abSnap.exists()) jd = abSnap.val();
            }

            // Fallback: jobs path (for hail jobs or when bookingId is missing)
            if (!jd && d.vehicleId && d.id) {
              const jobSnap = await get(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`));
              if (jobSnap.exists()) jd = jobSnap.val();
            }

            if (jd) {
              const updatedBookingId = String(jd.BookingId ?? bookingId ?? '');
              setJobs(prev => prev.map(j => {
                const isMatch = (updatedBookingId && j.bookingId === updatedBookingId) || j.status === 'current';
                if (!isMatch) return j;
                return {
                  ...j,
                  passengerName:  jd!.PassengerName  ?? j.passengerName,
                  passengerPhone: jd!.PassengerPhone ?? j.passengerPhone,
                  pickupAddress:  jd!.PickAddress    ?? j.pickupAddress,
                  dropAddress:    jd!.DropAddress    ?? j.dropAddress,
                  fare:           parseFloat(jd!.Fare ?? '0') || j.fare,
                  distance:       jd!.Distance       ?? j.distance,
                  duration:       jd!.Duration       ?? j.duration,
                  notes:          jd!.Info           ?? j.notes,
                };
              }));
              Alert.alert(
                'Job Updated',
                `Dispatch has updated your job.\n\nPickup: ${jd.PickAddress ?? '—'}\nDrop: ${jd.DropAddress ?? '—'}\nFare: $${parseFloat(jd.Fare ?? '0').toFixed(2)}`,
                [{ text: 'OK' }]
              );
            } else {
              // No data found — still show a generic alert so driver knows
              Alert.alert('Job Updated', 'Dispatch has updated your job. Tap the job for details.', [{ text: 'OK' }]);
            }
          } catch { /* ignore */ }
        }
        remove(notifPath).catch(() => {});
        return;
      }

      // ── CANCEL / PASSENGER CANCELLED ───────────────────────────────────────
      // Catches: "cancel", "passenger cancel", "job cancelled", "dispatch cancel"
      if (content.includes('cancel')) {
        const d = driverRef.current;

        // Determine whether the cancel targets the currently active trip.
        // If no bookingId is provided, or it matches the current job, cancel it.
        let cancelledActiveTrip = false;
        let cancelledJobName = 'your booking';

        // v22bf: detect cancel of a queued (or offered) job so we can free the
        // dispatch-console driverQueue slot — otherwise stale slot blocks the
        // next accept-to-queue with a false "Queue Full" error.
        let cancelledQueuedBookingId: string | null = null;
        setJobs(prev => {
          const currentJob = prev.find(j => j.status === 'current') ?? null;
          // Match if: (a) notification has no bookingId (dispatch broadcast), or
          //           (b) bookingId explicitly matches the current job
          const matchesCurrent =
            !bookingId ||
            (currentJob?.bookingId === bookingId);

          cancelledActiveTrip = !!currentJob && matchesCurrent;
          if (cancelledActiveTrip && currentJob) {
            cancelledJobName = currentJob.passengerName ?? 'your booking';
          }

          // Find any queued/offered job being filtered out
          if (bookingId) {
            const cq = prev.find(j => j.bookingId === bookingId && (j.status === 'queued' || j.status === 'offered'));
            if (cq) cancelledQueuedBookingId = cq.bookingId ?? null;
          }

          return prev.filter(j => {
            if (j.status === 'current') {
              return !matchesCurrent; // keep if this cancel doesn't target it
            }
            return bookingId ? j.bookingId !== bookingId : true;
          });
        });
        setIncomingJob(null);
        if (cancelledQueuedBookingId) {
          const dc = driverRef.current;
          if (dc?.companyId && dc?.id) {
            remove(ref(database, `driverQueue/${dc.companyId}/${dc.id}/queued`)).catch(() => {});
          }
        }

        setTimeout(() => {
          if (cancelledActiveTrip) {
            setStatusState('Available');
            statusRef.current = 'Available';
            stopMeter();
            if (d?.companyId && d?.vehicleId && d?.id) {
              remove(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)).catch(() => {});
              update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
                vehiclestatus: 'Available',
                joboffer: 0, jobCount: 0,
                JobphoneNo: '', jobpickup: '', jobdropoff: '',
                time: new Date().toISOString(),
              }).catch(() => {});
            }
            const isByPassenger = content.includes('passenger');
            setCancelledJobAlert({
              id: Date.now(),
              title: 'Job Cancelled',
              message: isByPassenger
                ? `${cancelledJobName} has cancelled this booking.`
                : 'Dispatch has cancelled this booking.',
            });
          } else {
            console.log('[Notif] Cancel for', bookingId, '— not the active trip, offer cleared only');
          }
        }, 0);

        remove(notifPath).catch(() => {});
        return;
      }

      // ── DISPATCH CHAT MESSAGE ──────────────────────────────────────────────
      // isFromDispatcher was computed at the top of this handler (checks ALL parts[] positions).
      // Non-Dispatcher, non-own-echo notification — stale leftover from previous session.
      // Remove silently so it doesn't appear as an incoming message.
      if (!isFromDispatcher && notifSender !== '') {
        console.log('[Notif] Removing stale non-Dispatcher notification (sender:', notifSender, ')');
        remove(notifPath).catch(() => {});
        return;
      }

      const looksLikeMessage = content.includes('message') && !content.includes('job');
      const hasAnyKickKeyword = ['kicked', 'removed from system', 'driver removed', 'account removed', 'deactivated', 'blocked driver', 'driver block', 'suspend'].some(kw => content.includes(kw));
      if (isFromDispatcher && (looksLikeMessage || (!content.includes('new job') && !content.includes('offered') &&
          !hasAnyKickKeyword && !content.includes('cancel') && data.content))) {
        // Extract real message: prefer parts[1] from bookingid (most reliable),
        // fall back to data.content.
        const msgBody = (parts[1]?.trim()) || String(data.content ?? data.message ?? data.Message ?? '');
        console.log('[Notif] Treating as chat message from Dispatch:', msgBody);
        const msg: ChatMessage = {
          id: `notif-msg-${Date.now()}`,
          senderId: 'dispatch',
          senderName: 'Dispatch Control',
          body: msgBody,
          timestamp: new Date().toISOString(),
        };
        if (msg.body) {
          setChatThreads(prev => prev.map(t =>
            t.id === 'thread-dispatch'
              ? { ...t, messages: [...t.messages, msg], lastMessage: msg.body, lastTime: msg.timestamp, unread: t.unread + 1 }
              : t
          ));
        }
        remove(notifPath).catch(() => {});
        return;
      }

      // ── TRULY UNRECOGNISED — log and delete ────────────────────────────────
      console.warn('[Notif] Unrecognised notification content:', data.content, '| raw:', JSON.stringify(data));
      remove(notifPath).catch(() => {});
    }, (error) => {
      console.warn('Firebase notification listener error:', error);
      setIsConnected(false);
    });

    return () => {
      off(notifPath);
      // Do NOT set isConnected false here — connection state is owned exclusively
      // by the .info/connected listener and must not be cleared on listener lifecycle events.
    };
  }, [driver?.vehicleId || driver?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Backward-compat notification/{vehicleId} → notification/{driverId} relay runs
  // on the Bookawaka Superadmin server (notificationRelay.ts) so legacy vehicle-keyed
  // offers are forwarded even when this app is backgrounded.

  useEffect(() => {
    if (!driver?.id) {
      setChatThreads([{
        id: 'thread-dispatch',
        contactName: 'Dispatch Control',
        contactType: 'dispatcher',
        lastMessage: 'Connect to see messages',
        lastTime: new Date().toISOString(),
        unread: 0,
        messages: [],
      }]);
      return;
    }

    // Robustly parse any date string the dispatch console might write.
    // Handles: ISO 8601, NZ locale "16/04/2026, 7:05:22 am", Unix ms numbers.
    const safeParseDate = (raw: any): string => {
      if (!raw) return new Date().toISOString();
      // Unix timestamp (number)
      if (typeof raw === 'number') return new Date(raw).toISOString();
      const s = String(raw).trim();
      // Already valid ISO / RFC-2822?
      const direct = new Date(s);
      if (!isNaN(direct.getTime())) return direct.toISOString();
      // NZ locale "16/04/2026, 7:05:22 am" or "16/04/2026 7:05:22 AM"
      const nz = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?/i);
      if (nz) {
        const [, dd, mm, yyyy, hr, min, sec, ampm] = nz;
        let h = parseInt(hr, 10);
        if (ampm?.toLowerCase() === 'pm' && h < 12) h += 12;
        if (ampm?.toLowerCase() === 'am' && h === 12) h = 0;
        const p = new Date(+yyyy, +mm - 1, +dd, h, +min, +sec);
        if (!isNaN(p.getTime())) return p.toISOString();
      }
      return new Date().toISOString();
    };

    const parseChatSnapshot = (snapshot: any, existingMsgs: ChatMessage[] = []): ChatMessage[] => {
      if (!snapshot.exists()) return existingMsgs;
      const data = snapshot.val() as Record<string, any>;
      console.log('[Chat] Firebase snapshot received on', snapshot.ref.toString(), '— keys:', Object.keys(data).length);
      const msgs: ChatMessage[] = Object.entries(data).map(([key, val]) => ({
        id: key,
        senderId: String(val.SenderId ?? 'dispatch'),
        senderName: String(val.SenderName ?? 'Dispatch'),
        body: String(val.Message ?? val.message ?? ''),
        timestamp: safeParseDate(val.DateTime ?? val.timestamp),
      })).filter(m => m.body);
      // Merge with existing (from other path listener) and deduplicate by id
      const merged = [...existingMsgs, ...msgs];
      const seen = new Set<string>();
      return merged.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
        .sort((a, b) => {
          const ta = new Date(a.timestamp).getTime();
          const tb = new Date(b.timestamp).getTime();
          return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
        });
    };

    let msgsFromIdPath: ChatMessage[] = [];
    let msgsFromUidPath: ChatMessage[] = [];
    let msgsFromVehiclePath: ChatMessage[] = [];

    const rebuildThread = () => {
      const allMsgs = [...msgsFromIdPath, ...msgsFromUidPath, ...msgsFromVehiclePath];
      const seen = new Set<string>();
      const deduped = allMsgs.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
        .sort((a, b) => {
          const ta = new Date(a.timestamp).getTime();
          const tb = new Date(b.timestamp).getTime();
          return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
        });
      setChatThreads(prev => {
        const notifMsgs = prev.find(t => t.id === 'thread-dispatch')?.messages.filter(m => m.id.startsWith('notif-msg-')) ?? [];
        const combined = [...deduped, ...notifMsgs].sort((a, b) => {
          const ta = new Date(a.timestamp).getTime();
          const tb = new Date(b.timestamp).getTime();
          return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
        });
        return [{
          id: 'thread-dispatch',
          contactName: 'Dispatch Control',
          contactType: 'dispatcher',
          lastMessage: combined[combined.length - 1]?.body ?? '',
          lastTime: combined[combined.length - 1]?.timestamp ?? new Date().toISOString(),
          unread: 0,
          messages: combined,
        }];
      });
    };

    // Primary: chat/{numericDriverId}
    const chatPath = ref(database, `chat/${driver.id}`);
    onValue(chatPath, (snapshot) => {
      console.log('[Chat] onValue fired for chat/', driver.id, '— exists:', snapshot.exists());
      msgsFromIdPath = parseChatSnapshot(snapshot);
      rebuildThread();
    });

    // Secondary: chat/{vehicleId} — dispatch consoles sometimes key by vehicle number (e.g. "T201")
    const vehicleId = driver.vehicleId;
    const chatVehiclePath = vehicleId ? ref(database, `chat/${vehicleId}`) : null;
    if (chatVehiclePath) {
      onValue(chatVehiclePath, (snapshot) => {
        if (snapshot.exists()) {
          console.log('[Chat] onValue fired for chat/', vehicleId, '— exists:', snapshot.exists());
          msgsFromVehiclePath = parseChatSnapshot(snapshot);
          rebuildThread();
        }
      });
    }

    // Tertiary: chat/{firebaseUid}
    const chatUidPath = ref(database, `chat/${driver.uid}`);
    onValue(chatUidPath, (snapshot) => {
      if (snapshot.exists()) {
        console.log('[Chat] onValue fired for chat/', driver.uid, '— exists:', snapshot.exists());
        msgsFromUidPath = parseChatSnapshot(snapshot);
        rebuildThread();
      }
    });

    return () => {
      off(chatPath);
      off(chatUidPath);
      if (chatVehiclePath) off(chatVehiclePath);
    };
  }, [driver?.id]);

  // ── New admin-panel messages listener: messages/{companyId} ────────────────
  // Additive — runs independently of existing chat/ and notification/ listeners.
  // Shows messages where to === driverId OR to === "all".
  // Message format from admin panel: { from, senderName, to, text, timestamp, mediaType, mediaUrl }
  useEffect(() => {
    if (!driver?.companyId || !driver?.id) return;
    const companyId = driver.companyId;
    const driverId  = driver.id;

    const msgsRef = ref(database, `messages/${companyId}`);
    const unsub = onValue(msgsRef, (snap) => { markSyncBlock('messages');
      if (!snap.exists()) return;
      const raw = snap.val() as Record<string, any>;
      const msgs: ChatMessage[] = Object.entries(raw)
        .filter(([, v]) =>
          v && (v.to === driverId || v.to === 'all') && String(v.from ?? '').toLowerCase() !== 'driver'
        )
        .map(([key, v]) => {
          const tsRaw = v.timestamp;
          const ts = typeof tsRaw === 'number'
            ? new Date(tsRaw).toISOString()
            : new Date(String(tsRaw ?? '')).toISOString();
          const fromDriver = String(v.from ?? '').toLowerCase() === 'driver';
          return {
            id: `adminmsg-${key}`,
            senderId:  fromDriver ? driverId : 'dispatch',
            senderName: String(v.senderName ?? (fromDriver ? 'You' : 'Dispatch')),
            body: String(v.text ?? ''),
            timestamp: isNaN(new Date(ts).getTime()) ? new Date().toISOString() : ts,
            mediaType: (v.mediaType as ChatMessage['mediaType']) ?? null,
            mediaUrl:  typeof v.mediaUrl === 'string' ? v.mediaUrl : null,
          } satisfies ChatMessage;
        })
        .filter(m => m.body || m.mediaUrl);

      if (msgs.length === 0) return;

      setChatThreads(prev => {
        const thread = prev.find(t => t.id === 'thread-dispatch');
        const existing = thread?.messages ?? [];
        // Merge new messages, deduplicate by id
        const merged = [...existing, ...msgs];
        const seen = new Set<string>();
        const deduped = merged
          .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const last = deduped[deduped.length - 1];
        return prev.map(t =>
          t.id === 'thread-dispatch'
            ? {
                ...t,
                messages: deduped,
                lastMessage: last?.body || (last?.mediaType ? `[${last.mediaType}]` : ''),
                lastTime: last?.timestamp ?? t.lastTime,
              }
            : t
        );
      });
    });

    return () => off(msgsRef);
  }, [driver?.companyId, driver?.id]);

  // ── Quick replies loader: quickReplies/{companyId}/driver ──────────────────
  useEffect(() => {
    if (!driver?.companyId) return;
    const qrRef = ref(database, `quickReplies/${driver.companyId}/driver`);
    const unsub = onValue(qrRef, (snap) => {
      if (!snap.exists()) return;
      const val = snap.val();
      if (Array.isArray(val)) {
        setQuickReplies(val.filter((s): s is string => typeof s === 'string' && s.trim().length > 0));
      } else if (val && typeof val === 'object') {
        // Firebase sometimes stores arrays as objects with numeric keys
        setQuickReplies(
          Object.values(val)
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        );
      }
    });
    return () => off(qrRef);
  }, [driver?.companyId]);

  useEffect(() => {
    if (!driver?.companyId || !driver?.vehicleId || !driver?.id) return;

    // Dispatch console sends jobs keyed by numeric driverId, not Firebase UID
    const jobPath = ref(database, `jobs/${driver.companyId}/${driver.vehicleId}/${driver.id}`);
    // 22bo-fix3: dispatch team requested diagnostic logging. One-shot attach/detach log.
    jobsListenerAttachedRef.current = true;
    console.log(`[Jobs][Listener] ATTACHED path=jobs/${driver.companyId}/${driver.vehicleId}/${driver.id} appState=${appStateRef.current}`);
    try { Sentry.addBreadcrumb({ category: 'jobs-listener', level: 'info', message: 'attached', data: { cid: driver.companyId, vid: driver.vehicleId, did: driver.id, appState: appStateRef.current } }); } catch {}
    const unsub = onValue(jobPath, (snapshot) => { markSyncBlock('jobs');
      // 22bo-fix3: per-fire diagnostic. Logs app state + key job fields on every
      // Firebase value event so we can prove offers ARE arriving at the listener
      // even when the popup doesn't render (vs listener-not-attached scenarios).
      try {
        const __v = snapshot.exists() ? (snapshot.val() || {}) : null;
        const __status = __v?.Status ?? __v?.status ?? '(none)';
        const __bid = __v?.BookingId ?? __v?.bookingid ?? __v?.bookingId ?? '(none)';
        const __offeredAt = __v?.offeredAt ?? __v?.OfferedAt ?? '(none)';
        console.log(`[Jobs][Fire] appState=${appStateRef.current} exists=${snapshot.exists()} Status=${__status} BookingId=${__bid} offeredAt=${__offeredAt}`);
        Sentry.addBreadcrumb({
          category: 'jobs-fire',
          level: 'info',
          message: `Status=${__status} BookingId=${__bid}`,
          data: { appState: appStateRef.current, exists: snapshot.exists(), Status: __status, BookingId: __bid, offeredAt: __offeredAt },
        });
      } catch {}
      // v12-ota12: per-fire entry log REMOVED. Was costing real CPU on every
      // dispatch update via console-breadcrumb capture. Sub-branch logs below
      // (path-removed / cancelled / new-offer) stay because they fire only
      // on real events, not on every Firebase tick.
      const __jobsT0 = Date.now();
      const __jobsTime = (branch: string) => {
        const dur = Date.now() - __jobsT0;
        if (dur >= 80) {
          try { Sentry.captureMessage(`Slow jobs handler: ${branch} (${dur}ms)`,
            { level: 'warning', tags: { kind: 'slow-jobs-branch', branch, durationMs: String(dur) } }); } catch {}
        }
      };
      // ── 22c / G2 — auto-disarm guard ────────────────────────────────────────
      // Post-cutover (Wed 27 May), dispatch writes per-bookingId children at
      // jobs/{cid}/{vid}/{drv}/{bookingId} instead of flat fields on the parent.
      // The new G2 child listeners (onChildAdded/Changed/Removed below) handle
      // that layout. If THIS onValue handler sees a snapshot that looks like a
      // parent-of-children (no top-level BookingId/Status, nested objects each
      // carry their own Status/BookingId/eventType), bail — the child listeners
      // own it. Pre-cutover the old flat layout still routes through normally.
      if (snapshot.exists()) {
        const __v = snapshot.val();
        if (__v && typeof __v === 'object' && !__v.BookingId && !__v.Status) {
          const __hasNested = Object.values(__v).some((c: any) =>
            c && typeof c === 'object' && (c.BookingId !== undefined || c.Status !== undefined || c.eventType !== undefined)
          );
          if (__hasNested) {
            console.log('[Jobs] G2 layout detected on parent — skipping onValue, child listeners own this');
            __jobsTime('g2-layout-skip');
            return;
          }
        }
      }

      // ── JOB PATH DELETED — dispatch cancelled the job ───────────────────────
      // When dispatch cancels a job it may simply remove the jobs path rather
      // than setting Status:'Cancelled'.  Detect this and cancel the active trip.
      // Guard: only act if shift is active — on startup the path is empty, not cancelled.
      if (!snapshot.exists()) {
        if (!shiftActiveRef.current) return; // startup fire — no shift, no active trip
        console.log('[Jobs] jobs path removed — checking for active trip to cancel');
        // 22bo-fix5: dispatch recall/unassign clears the jobs/ path. Wipe ALL
        // dedup keys for the active job's bookingId so the next re-offer of the
        // same booking pops the modal again.
        try {
          const curr = latestJobsRef.current?.find(j => j.status === 'current' || j.status === 'offered');
          if (curr?.bookingId) clearSeenForBooking(curr.bookingId);
        } catch {}
        let hadActiveTrip = false;
        let cancelBookingId: string | null = null;
        let nextStatus: DriverStatus = 'Available';
        // v12-ota11: startTransition lets React yield to user input during the
        // re-render storm caused by these multi-context state updates.
        startTransition(() => {
        setJobs(prev => {
          const currentJob = prev.find(j => j.status === 'current');
          if (!currentJob) return prev;
          hadActiveTrip = true;
          cancelBookingId = currentJob.bookingId ?? null;
          const next = prev.filter(j => j.status !== 'current');
          // 22bo-fix9 (G7): keep Assigned if a queued booking still remains.
          nextStatus = adjustAvailabilityForRemainingJobs('Available', next);
          return next;
        });
        setIncomingJob(null);
        if (hadActiveTrip) {
          setStatusState(nextStatus);
          statusRef.current = nextStatus;
          stopMeter();
          const d = driverRef.current;
          if (d?.companyId && d?.vehicleId) {
            update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
              vehiclestatus: nextStatus,
              joboffer: 0, jobCount: 0,
              JobphoneNo: '', jobpickup: '', jobdropoff: '',
              time: new Date().toISOString(),
            }).catch(() => {});
          }
          // Read CancelledBy from allbookings — the jobs path was deleted so no
          // data is available here; the passenger app writes CancelledBy there.
          (async () => {
            let msg = 'This booking has been cancelled.';
            const d2 = driverRef.current;
            if (cancelBookingId && d2?.companyId) {
              try {
                const snap = await get(ref(database, `allbookings/${d2.companyId}/${cancelBookingId}`));
                const by = String(snap.val()?.CancelledBy ?? snap.val()?.cancelledBy ?? '').toLowerCase();
                if (by === 'passenger') msg = 'The passenger has cancelled this booking.';
                else if (by === 'dispatcher' || by === 'dispatch') msg = 'This booking has been cancelled by dispatch.';
              } catch {}
            }
            setCancelledJobAlert({ id: Date.now(), title: 'Job Cancelled', message: msg });
          })();
        }
        }); // end startTransition
        __jobsTime('path-removed');
        return;
      }

      const data = snapshot.val();
      if (!data) return;

      const bookingId = String(data.BookingId ?? '');

      // ── 22bp (G5) — stale-write guard ─────────────────────────────────────
      // Dispatch stamps version (monotonic) and updatedAt (serverTimestamp)
      // on every jobs-path write. Drop snapshots older than what we've
      // already applied for this bookingId. No bookingId → no guard
      // (field-update path without bookingId still passes through below).
      if (bookingId) {
        if (shouldSkipStaleEvent(bookingId, data.version, data.updatedAt)) {
          console.log('[Jobs] Stale event dropped — bookingId:', bookingId,
            'incoming v:', data.version, 'ts:', data.updatedAt,
            'have:', JSON.stringify(bookingVersionsRef.current.get(bookingId)));
          __jobsTime('stale-dropped');
          return;
        }
        markBookingVersion(bookingId, data.version, data.updatedAt);
      }

      const jobStatus = String(data.Status ?? '').toLowerCase();

      // ── DRIVER-SIDE WRITES — ignore them in the listener ────────────────────
      // _freeDriver writes DriverDeclined/DriverCancel back to the jobs path so
      // the dispatcher console can detect the decline.  The onValue listener
      // fires immediately on those writes and must NOT re-add the job as current.
      if (jobStatus === 'driverdeclined' || jobStatus === 'drivercancel' || jobStatus === 'driveraccepted') {
        console.log('[Jobs] Ignoring own driver-status write on jobs path — status:', data.Status, 'bookingId:', bookingId);
        return;
      }

      // ── OTA22c3 — Hail self-write guard ──────────────────────────────────
      // startHailTrip writes the hail booking flat onto jobs/{cid}/{vid}/{did}
      // (Status:'Active', Source:'hail') so the dispatcher console / SA portal
      // can see the trip is live.  Without this guard the onValue listener
      // re-classifies that self-write as an incoming dispatcher offer, fires
      // setIncomingJob, the meter pauses while the modal is open, and any
      // subsequent jobs-path write (heartbeat, status flip) re-pops the modal
      // → modal storm starves the JS thread on Samsung One UI → force-close
      // → driver lands on login screen.  Two checks: Source==='hail' (covers
      // fresh writes) AND bookingId match against the active hail meta
      // (covers post-start mutations that may drop the Source field).
      if ((data.Source ?? data.source ?? '').toString().toLowerCase() === 'hail' ||
          (hailTripMetaRef.current?.bookingId && bookingId === hailTripMetaRef.current.bookingId)) {
        console.log('[Jobs] Ignoring own hail self-write — bookingId:', bookingId, 'Source:', data.Source);
        __jobsTime('hail-self-write');
        return;
      }

      // ── TERMINAL-STATUS GUARD — never offer a Completed/NoShow booking ──────
      // Dispatch sometimes leaves a stale Status:'Completed' record on the jobs
      // path, or re-writes a finished job after a network retry.  Without this
      // guard the driver gets a popup for a trip that's already done.
      if (jobStatus === 'completed' || jobStatus === 'noshow' ||
          jobStatus === 'no-show'   || jobStatus === 'no_show') {
        console.log('[Jobs] Skipping — booking', bookingId || '(no id)', 'on jobs path is already', jobStatus, '— clearing stale record');
        const dq = driverRef.current;
        if (dq?.companyId && dq?.vehicleId && dq?.id) {
          remove(ref(database, `jobs/${dq.companyId}/${dq.vehicleId}/${dq.id}`)).catch(() => {});
        }
        return;
      }

      // ── CANCELLATION via jobs path ───────────────────────────────────────────
      // Dispatch or passenger app may write Status:'Cancelled' directly to the jobs path.
      if (jobStatus === 'cancelled' || jobStatus === 'canceled') {
        console.log('[Jobs] Status Cancelled received on jobs path — bookingId:', bookingId);
        // 22bo-fix5: clear dedup so a re-offer of the same bookingId after a
        // dispatch recall pops the modal again.
        if (bookingId) clearSeenForBooking(bookingId);
        let hadActiveTrip = false;
        let nextStatus: DriverStatus = 'Available';
        startTransition(() => {
        setJobs(prev => {
          const currentJob = prev.find(j => j.status === 'current') ?? null;
          const targets = bookingId
            ? (j: Job) => j.bookingId === bookingId
            : (j: Job) => j.status === 'current';
          hadActiveTrip = !!currentJob && targets(currentJob);
          const next = prev.filter(j => !targets(j));
          // 22bo-fix9 (G7): keep Assigned if a queued booking still remains.
          nextStatus = adjustAvailabilityForRemainingJobs('Available', next);
          return next;
        });
        setIncomingJob(null);
        if (hadActiveTrip) {
          setStatusState(nextStatus);
          statusRef.current = nextStatus;
          stopMeter();
          const d = driverRef.current;
          if (d?.companyId && d?.vehicleId && d?.id) {
            remove(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)).catch(() => {});
            update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
              vehiclestatus: nextStatus,
              joboffer: 0, jobCount: 0,
              JobphoneNo: '', jobpickup: '', jobdropoff: '',
              time: new Date().toISOString(),
            }).catch(() => {});
          }
          // Check CancelledBy — first in the jobs snapshot itself, then in allbookings
          // (passenger app writes CancelledBy: "passenger"/"dispatcher" to allbookings)
          (async () => {
            let msg = 'This booking has been cancelled.';
            const snapshotBy = String(data.CancelledBy ?? data.cancelledBy ?? '').toLowerCase();
            if (snapshotBy === 'passenger') {
              msg = 'The passenger has cancelled this booking.';
            } else if (snapshotBy === 'dispatcher' || snapshotBy === 'dispatch') {
              msg = 'This booking has been cancelled by dispatch.';
            } else {
              const d2 = driverRef.current;
              if (bookingId && d2?.companyId) {
                try {
                  const snap = await get(ref(database, `allbookings/${d2.companyId}/${bookingId}`));
                  const by = String(snap.val()?.CancelledBy ?? snap.val()?.cancelledBy ?? '').toLowerCase();
                  if (by === 'passenger') msg = 'The passenger has cancelled this booking.';
                  else if (by === 'dispatcher' || by === 'dispatch') msg = 'This booking has been cancelled by dispatch.';
                } catch {}
              }
            }
            setCancelledJobAlert({ id: Date.now(), title: 'Job Cancelled', message: msg });
          })();
        }
        }); // end startTransition
        __jobsTime('status-cancelled');
        return;
      }

      // ── FIELD UPDATE via jobs path (dispatcher wrote details without BookingId) ─
      // Covers two cases:
      //   1. Dispatcher edited a trip that's already underway ('current').
      //   2. Dispatcher wrote job details after sending the notification — the job
      //      may still be 'offered' because the detail write is delayed (up to 30 s
      //      after the notification in some dispatcher console versions).
      if (!bookingId) {
        console.log('[Jobs] Firebase jobs path update without BookingId — Status:', data.Status, '— patching offered/current job');
        startTransition(() => {
        setJobs(prev => {
          // Prefer the active trip; fall back to the most recent offered job
          const targetIdx = prev.findIndex(j => j.status === 'current') !== -1
            ? prev.findIndex(j => j.status === 'current')
            : prev.findIndex(j => j.status === 'offered');
          if (targetIdx === -1) return prev;
          const updated = [...prev];
          const rawPt2 = data.PaymentType ?? data.AccountType;
          updated[targetIdx] = {
            ...updated[targetIdx],
            passengerName:  data.PassengerName  ?? updated[targetIdx].passengerName,
            passengerPhone: data.PassengerPhone ?? updated[targetIdx].passengerPhone,
            pickupAddress:  data.PickAddress    ?? updated[targetIdx].pickupAddress,
            dropAddress:    data.DropAddress    ?? updated[targetIdx].dropAddress,
            fare:           parseFloat(data.Fare ?? '0') || updated[targetIdx].fare,
            notes:          data.Info           ?? updated[targetIdx].notes,
            paymentType:      rawPt2 ? parsePaymentType(rawPt2) : updated[targetIdx].paymentType,
            jobPaymentMethod: String(data.paymentMethod ?? data.PaymentMethod ?? '').trim().toLowerCase() || updated[targetIdx].jobPaymentMethod,
          };
          return updated;
        });
        // Also update incomingJob if the dispatcher is enriching an offer in progress
        setIncomingJob(prev => {
          if (!prev) return prev;
          const rawPt = data.PaymentType ?? data.AccountType;
          return {
            ...prev,
            passengerName:  data.PassengerName  ?? prev.passengerName,
            passengerPhone: data.PassengerPhone ?? prev.passengerPhone,
            pickupAddress:  data.PickAddress    ?? prev.pickupAddress,
            dropAddress:    data.DropAddress    ?? prev.dropAddress,
            fare:           parseFloat(data.Fare ?? '0') || prev.fare,
            notes:          data.Info           ?? prev.notes,
            paymentType:      rawPt ? parsePaymentType(rawPt) : prev.paymentType,
            jobPaymentMethod: String(data.paymentMethod ?? data.PaymentMethod ?? '').trim().toLowerCase() || prev.jobPaymentMethod,
          };
        });
        }); // end startTransition
        __jobsTime('field-update-no-bookingid');
        return;
      }

      startTransition(() => {
      setJobs(prev => {
        // If this bookingId already exists (from notification listener), update it to current
        // rather than adding a duplicate entry
        const existingIdx = prev.findIndex(j => j.bookingId === bookingId);
        if (existingIdx !== -1) {
          const updated = [...prev];
          const rawPt = data.PaymentType ?? data.AccountType;
          updated[existingIdx] = {
            ...updated[existingIdx],
            // Enrich with any extra fields dispatch sent via the jobs path
            passengerName:  data.PassengerName  ?? updated[existingIdx].passengerName,
            passengerPhone: data.PassengerPhone ?? updated[existingIdx].passengerPhone,
            pickupAddress:  data.PickAddress    ?? updated[existingIdx].pickupAddress,
            dropAddress:    data.DropAddress    ?? updated[existingIdx].dropAddress,
            fare:           parseFloat(data.Fare ?? '0') || updated[existingIdx].fare,
            distance:       data.Distance       ?? updated[existingIdx].distance,
            duration:       data.Duration       ?? updated[existingIdx].duration,
            deviceUid:      data.DeviceUid      ?? updated[existingIdx].deviceUid,
            notes:          data.Info           ?? updated[existingIdx].notes,
            paymentType:      rawPt ? parsePaymentType(rawPt) : updated[existingIdx].paymentType,
            jobPaymentMethod: String(data.paymentMethod ?? data.PaymentMethod ?? '').trim().toLowerCase() || updated[existingIdx].jobPaymentMethod,
            bookingType:    data.BookingType    ?? updated[existingIdx].bookingType,
            orderDetails:   (data.Details ?? data.Info)    ?? updated[existingIdx].orderDetails,
            status: 'current',
          };
          return updated;
        }

        // Brand-new job: bookingId not in local state yet.
        // Build fields OUTSIDE setJobs so we can pass them to setIncomingJob after.
        // (Defining them inside a state updater prevents calling setIncomingJob from there.)
        return prev; // signal "needs brand-new handling" — done below outside setJobs
      });
      }); // end startTransition

      // ── BRAND-NEW JOB via jobs path (not yet in local state) ─────────────────
      // Build job fields now (not inside a state updater) so we can surface the
      // accept/decline modal via setIncomingJob — the notification listener does
      // the same thing.  Previously this went straight to status:'current' with no
      // popup, meaning drivers got no chance to accept or decline the offer.
      const baseJobFields = {
        bookingId,
        passengerName:  data.PassengerName  ?? 'Passenger',
        passengerPhone: data.PassengerPhone ?? '',
        pickupAddress:  data.PickAddress    ?? '',
        dropAddress:    data.DropAddress    ?? '',
        fare:           parseFloat(data.Fare ?? '0') || 0,
        distance:       data.Distance       ?? '—',
        duration:       data.Duration       ?? '—',
        createdAt:      data.DateTime       ?? new Date().toISOString(),
        notes:          data.Info           ?? '',
        deviceUid:      data.DeviceUid      ?? '',
        paymentType:    parsePaymentType(data.PaymentType ?? data.AccountType),
        bookingType:    String(data.BookingType ?? data.bookingType ?? data.serviceType ?? data.ServiceType ?? '').trim() || undefined,
        orderDetails:   String(data.Details ?? data.Info ?? '').trim() || undefined,
        // TM fields — fall back to passenger-app array fields if dispatcher hasn't mapped them
        tmVoucherNo:     String(
          data.tmVoucherNo ??
          (Array.isArray(data.tmVoucherNumbers) ? data.tmVoucherNumbers[0] : undefined) ??
          data.tmPassengers?.[0]?.cardNumber ?? ''
        ).trim() || undefined,
        tmPassengerName: String(data.tmPassengerName ?? data.tmPassengers?.[0]?.name ?? '').trim() || undefined,
        tmCardExpiry:    String(data.tmCardExpiry   ?? '').trim() || undefined,
        tmHoistRequired: !!(data.tmHoistRequired),
        tmHoistCount:    parseInt(String(data.tmHoistCount ?? '0'), 10) || 0,
        tmSubsidy:       parseFloat(String(data.tmSubsidy ?? '0')) || undefined,
        tmPassengerPays: parseFloat(String(data.tmPassengerPays ?? '0')) || undefined,
        tmPaymentMethod: String(data.tmPaymentMethod ?? '').trim() || undefined,
        jobPaymentMethod: String(data.paymentMethod ?? data.PaymentMethod ?? '').trim().toLowerCase() || undefined,
      };

      // Guard: if driver is already occupied (dispatched trip OR Hail meter running),
      // add as SILENT OFFER (no popup — badge count only; accept-to-queue at leisure).
      const driverIsBusy = !!jobs.find(j => j.status === 'current') || meterRunningRef.current;
      const alreadyKnown = jobs.some(j => j.bookingId === bookingId);
      if (alreadyKnown) {
        // dedup — already handled by the setJobs branch above or notification listener
      } else if (driverIsBusy) {
        console.log('[Jobs] Silent offer via jobs path — driver busy (dispatched or Hail), queuing silently:', bookingId);
        const silentOffer: Job = {
          ...baseJobFields,
          id: `silent-${bookingId || Date.now()}`,
          status: 'offered' as const,
          offerSentAt:     Date.now(),
          offerTimeoutSecs: 0, // no expiry — stays until driver acts or dispatch cancels
        };
        startTransition(() => {
        setJobs(prev => {
          if (prev.some(j => j.bookingId === bookingId)) return prev; // dedup
          return [silentOffer, ...prev];
        });
        });
      } else {
        // Driver is free — surface as offer modal (accept / decline within timeout).
        // Previously this fell through to status:'current' with no popup at all.
        //
        // v12-ota22e DOUBLE-MODAL FIX: dispatch writes BOTH notification/ AND
        // jobs/{cid}/{vid}/{did} for the same offer. The notification listener
        // adds bookingId to seenBookingIdsRef BEFORE calling setIncomingJob.
        // If we see the same bookingId here it means the notification listener
        // already showed the modal — do NOT call setIncomingJob again, that
        // would unmount + remount the modal mid-tap and swallow the driver's
        // Accept press. Just enrich the jobs[] entry and bail.
        const __jk = seenKey(bookingId, data.offeredAt ?? data.OfferedAt);
        if (seenBookingIdsRef.current.has(__jk)) {
          console.log('[Jobs] Offer', bookingId, 'already shown by notification listener — enriching only, NOT re-opening modal');
          startTransition(() => {
            setJobs(prev => {
              const idx = prev.findIndex(j => j.bookingId === bookingId);
              if (idx === -1) return prev;
              const updated = [...prev];
              updated[idx] = { ...updated[idx], ...baseJobFields };
              return updated;
            });
            // Also enrich the live incomingJob so the modal shows the latest
            // pickup/drop/fare without remounting.
            setIncomingJob(prev => (prev && prev.bookingId === bookingId) ? { ...prev, ...baseJobFields } : prev);
          });
          __jobsTime('main-already-shown');
          return;
        }
        console.log('[Jobs] New offer via jobs path — driver free, showing accept modal:', bookingId);
        seenBookingIdsRef.current.add(__jk);
        const newOfferJob: Job = {
          ...baseJobFields,
          id: `jobs-${bookingId || Date.now()}`,
          status: 'offered' as const,
          offerSentAt:     Date.now(),
          offerTimeoutSecs: 60,
        };
        // v22bl: hail-silent — mirror the notification-listener guard. If the
        // driver is on a dispatch trip OR running a hail meter, the new offer
        // enters the offers list silently (no modal, no sound, no push) so the
        // driver is never distracted while driving. They can review/accept it
        // from the Dashboard queue badge when it's safe.
        const _jobsBusy = jobs.some(j => j.status === 'current') || meterRunningRef.current;
        startTransition(() => {
          setJobs(prev => {
            if (prev.some(j => j.bookingId === bookingId)) return prev; // dedup
            return [newOfferJob, ...prev];
          });
        });
        if (!_jobsBusy) {
          // setIncomingJob stays urgent so the offer modal appears within one frame.
          setIncomingJob(newOfferJob);
          // Fire local push notification if the app is in the background
          if (appStateRef.current !== 'active') {
            scheduleJobNotification({
              pickup: newOfferJob.pickupAddress || '',
              jobId:  bookingId,
            }).catch(() => {});
          }
        } else {
          console.log('[Jobs] Silent offer — driver busy (hail or dispatch), queuing silently:', bookingId);
        }
        // Signal to dispatcher that offer was received
        if (driverRef.current?.companyId) {
          update(ref(database, `allbookings/${driverRef.current.companyId}/${bookingId}`), {
            Status:    'Offered',
            OfferedAt: new Date().toISOString(),
          }).catch(() => {});
        }
      }
      __jobsTime('main');
    });

    return () => {
      off(jobPath);
      jobsListenerAttachedRef.current = false;
      console.log('[Jobs][Listener] DETACHED');
      try { Sentry.addBreadcrumb({ category: 'jobs-listener', level: 'info', message: 'detached' }); } catch {}
    };
  }, [driver?.companyId, driver?.vehicleId, driver?.id]);

  // ── 22c / G2 — Per-bookingId child listeners ──────────────────────────────
  // New contract: dispatch writes each booking as a separate child under
  //   jobs/{companyId}/{vehicleId}/{driverId}/{bookingId}
  // with eventType ∈ {new_offer | updated | cancelled | recalled | completed | reassigned}
  // and a monotonic `version` + `updatedAt` for stale-write protection.
  //
  // PRE-CUTOVER (≤ Wed 27 May AM): dispatch still writes flat fields to the
  //   parent path — no children exist — these listeners stay dormant.
  // POST-CUTOVER: parent fills with per-bookingId children. The old onValue
  //   handler auto-disarms via the G2 layout detector. THESE listeners take
  //   over without any code change or re-deploy.
  //
  // Terminal events: dispatch writes eventType then calls remove() on the
  //   child. onChildRemoved fires with snap.val() = last-known data so we
  //   can read eventType + CancelledBy off the removed snapshot.
  useEffect(() => {
    if (!driver?.companyId || !driver?.vehicleId || !driver?.id) return;
    const parentPath = ref(database, `jobs/${driver.companyId}/${driver.vehicleId}/${driver.id}`);
    console.log(`[Jobs/G2] child listeners ATTACHED path=jobs/${driver.companyId}/${driver.vehicleId}/${driver.id}`);
    try { Sentry.addBreadcrumb({ category: 'jobs-g2', level: 'info', message: 'child listeners attached' }); } catch {}

    // Build the standard job-fields blob from a Firebase booking snapshot.
    const buildBaseFields = (bookingId: string, data: any) => ({
      bookingId,
      passengerName:  data.PassengerName  ?? 'Passenger',
      passengerPhone: data.PassengerPhone ?? '',
      pickupAddress:  data.PickAddress    ?? '',
      dropAddress:    data.DropAddress    ?? '',
      fare:           parseFloat(data.Fare ?? '0') || 0,
      distance:       data.Distance       ?? '—',
      duration:       data.Duration       ?? '—',
      createdAt:      data.DateTime       ?? new Date().toISOString(),
      notes:          data.Info           ?? '',
      deviceUid:      data.DeviceUid      ?? '',
      paymentType:    parsePaymentType(data.PaymentType ?? data.AccountType),
      bookingType:    String(data.BookingType ?? data.bookingType ?? data.serviceType ?? data.ServiceType ?? '').trim() || undefined,
      orderDetails:   String(data.Details ?? data.Info ?? '').trim() || undefined,
      tmVoucherNo:    String(
        data.tmVoucherNo ??
        (Array.isArray(data.tmVoucherNumbers) ? data.tmVoucherNumbers[0] : undefined) ??
        data.tmPassengers?.[0]?.cardNumber ?? ''
      ).trim() || undefined,
      tmPassengerName: String(data.tmPassengerName ?? data.tmPassengers?.[0]?.name ?? '').trim() || undefined,
      tmCardExpiry:    String(data.tmCardExpiry   ?? '').trim() || undefined,
      tmHoistRequired: !!(data.tmHoistRequired),
      tmHoistCount:    parseInt(String(data.tmHoistCount ?? '0'), 10) || 0,
      tmSubsidy:       parseFloat(String(data.tmSubsidy ?? '0')) || undefined,
      tmPassengerPays: parseFloat(String(data.tmPassengerPays ?? '0')) || undefined,
      tmPaymentMethod: String(data.tmPaymentMethod ?? '').trim() || undefined,
      jobPaymentMethod: String(data.paymentMethod ?? data.PaymentMethod ?? '').trim().toLowerCase() || undefined,
    });

    // Handle a brand-new offer arriving via onChildAdded.
    const handleNewOffer = (bookingId: string, data: any) => {
      // v12-ota22c4-e: HARD GUARD — a record on the driver's OWN jobs path
      // with Source:'hail' is a self-write from startHailTrip (or a stale
      // self-write from a previous session where remove() was offline-queued
      // and never flushed). It must NEVER pop as a dispatch offer modal — the
      // record lacks PassengerName / PickAddress / DropAddress fields, so the
      // modal renders empty with just Accept/Reject buttons (exact symptom
      // the driver reported after completing a hail trip). The hailTripMetaRef
      // self-write guard above only works WHILE the meta is set; this stricter
      // Source-based guard does not depend on in-memory state, so it survives
      // app restarts and the post-completion window where the ref is cleared
      // before the Firebase remove() fires.
      const srcRaw = (data?.Source ?? data?.source ?? '').toString().toLowerCase();
      if (srcRaw === 'hail') {
        console.log('[Jobs/G2] handleNewOffer: dropping hail self-write echo (Source=hail):', bookingId);
        // Also mark as locally-completed so any future re-emission of this
        // same record on this device is suppressed by the seen-dedup.
        markBookingLocallyCompleted(bookingId);
        return;
      }
      // v12-ota22c4-f: PHANTOM RECORD GUARD.  If the record on the jobs path
      // has NO passenger fields AND no address fields at all, it is not a
      // real dispatch offer — it is either a leftover driver-status-only
      // write (Status:'DriverAccepted'/'DriverDeclined' from a previous
      // session that failed to remove), an empty stub from a malformed
      // dispatcher push, or the residue of a partially-cleared hail record.
      // Surfacing it pops an empty offer modal — exact symptom the driver
      // reported after completing a hail trip.  Treat as noise and drop.
      const _pn = String(data?.PassengerName ?? data?.passengerName ?? '').trim();
      const _pa = String(data?.PickAddress   ?? data?.pickupAddress ?? '').trim();
      const _da = String(data?.DropAddress   ?? data?.dropAddress   ?? '').trim();
      if (!_pn && !_pa && !_da) {
        console.log('[Jobs/G2] handleNewOffer: dropping phantom record (no passenger/pickup/drop):', bookingId, 'Status:', data?.Status);
        return;
      }
      const baseJobFields = buildBaseFields(bookingId, data);
      const driverIsBusy = !!latestJobsRef.current.find(j => j.status === 'current') || meterRunningRef.current;
      const alreadyKnown = latestJobsRef.current.some(j => j.bookingId === bookingId);

      if (alreadyKnown) {
        // Enrich existing entry (notification listener already added it)
        startTransition(() => {
          setJobs(prev => {
            const idx = prev.findIndex(j => j.bookingId === bookingId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...baseJobFields };
            return updated;
          });
          setIncomingJob(prev => (prev && prev.bookingId === bookingId) ? { ...prev, ...baseJobFields } : prev);
        });
        return;
      }

      if (driverIsBusy) {
        console.log('[Jobs/G2] Silent offer — driver busy:', bookingId);
        const silentOffer: Job = {
          ...baseJobFields,
          id: `g2-silent-${bookingId}`,
          status: 'offered' as const,
          offerSentAt: Date.now(),
          offerTimeoutSecs: 0,
        };
        startTransition(() => {
          setJobs(prev => prev.some(j => j.bookingId === bookingId) ? prev : [silentOffer, ...prev]);
        });
        return;
      }

      // Dedup vs notification listener — same dedup key family as the onValue path
      const k = seenKey(bookingId, data.offeredAt ?? data.OfferedAt);
      if (seenBookingIdsRef.current.has(k)) {
        console.log('[Jobs/G2] Offer', bookingId, 'already shown by notification listener — enriching only');
        startTransition(() => {
          setJobs(prev => {
            const idx = prev.findIndex(j => j.bookingId === bookingId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...baseJobFields };
            return updated;
          });
          setIncomingJob(prev => (prev && prev.bookingId === bookingId) ? { ...prev, ...baseJobFields } : prev);
        });
        return;
      }

      console.log('[Jobs/G2] New offer — showing accept modal:', bookingId);
      seenBookingIdsRef.current.add(k);
      const newOfferJob: Job = {
        ...baseJobFields,
        id: `g2-${bookingId}`,
        status: 'offered' as const,
        offerSentAt: Date.now(),
        offerTimeoutSecs: 60,
      };
      startTransition(() => {
        setJobs(prev => prev.some(j => j.bookingId === bookingId) ? prev : [newOfferJob, ...prev]);
      });
      setIncomingJob(newOfferJob);
      if (appStateRef.current !== 'active') {
        scheduleJobNotification({ pickup: newOfferJob.pickupAddress || '', jobId: bookingId }).catch(() => {});
      }
      if (driverRef.current?.companyId) {
        update(ref(database, `allbookings/${driverRef.current.companyId}/${bookingId}`), {
          Status:    'Offered',
          OfferedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    };

    // Patch fields on an existing job entry (onChildChanged path).
    const handleFieldUpdate = (bookingId: string, data: any) => {
      const rawPt = data.PaymentType ?? data.AccountType;
      const patch = {
        passengerName:  data.PassengerName  ?? undefined,
        passengerPhone: data.PassengerPhone ?? undefined,
        pickupAddress:  data.PickAddress    ?? undefined,
        dropAddress:    data.DropAddress    ?? undefined,
        fare:           data.Fare !== undefined ? (parseFloat(data.Fare) || 0) : undefined,
        distance:       data.Distance       ?? undefined,
        duration:       data.Duration       ?? undefined,
        deviceUid:      data.DeviceUid      ?? undefined,
        notes:          data.Info           ?? undefined,
        paymentType:    rawPt ? parsePaymentType(rawPt) : undefined,
        jobPaymentMethod: data.paymentMethod !== undefined || data.PaymentMethod !== undefined
          ? String(data.paymentMethod ?? data.PaymentMethod ?? '').trim().toLowerCase() || undefined
          : undefined,
        bookingType:    data.BookingType    ?? undefined,
        orderDetails:   (data.Details ?? data.Info) ?? undefined,
      };
      // Strip undefined keys so we don't overwrite good values with nothing
      const cleanPatch: Record<string, any> = {};
      for (const k of Object.keys(patch)) {
        const v = (patch as any)[k];
        if (v !== undefined) cleanPatch[k] = v;
      }
      startTransition(() => {
        setJobs(prev => {
          const idx = prev.findIndex(j => j.bookingId === bookingId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...cleanPatch };
          return updated;
        });
        setIncomingJob(prev => (prev && prev.bookingId === bookingId) ? { ...prev, ...cleanPatch } : prev);
      });
    };

    // Terminal handler — fired by onChildRemoved. eventType drives the UX.
    const handleTerminal = (bookingId: string, eventType: string, lastData: any) => {
      const reason = (eventType || '').toLowerCase();
      const existingJob = latestJobsRef.current.find(j => j.bookingId === bookingId);
      if (!existingJob) {
        console.log('[Jobs/G2] Terminal for unknown bookingId — silent drop:', bookingId, 'reason:', reason);
        clearSeenForBooking(bookingId);
        return;
      }

      clearSeenForBooking(bookingId);

      // Silent removals — no alert, just clean up local state
      // - completed: driver-initiated via /api/job/command, this is the server echo
      // - reassigned: offer redirected to another driver, treat as cancelled per spec
      // - recalled while only offered: dispatch pulled the offer back, close modal silently
      const isSilent =
        reason === 'completed' ||
        reason === 'reassigned' ||
        (reason === 'recalled' && existingJob.status === 'offered');

      if (isSilent) {
        console.log('[Jobs/G2] Silent terminal —', reason, 'for', bookingId);
        startTransition(() => {
          setJobs(prev => prev.filter(j => j.bookingId !== bookingId));
          setIncomingJob(prev => (prev?.bookingId === bookingId) ? null : prev);
        });
        return;
      }

      // Cancellation flow: cancelled | recalled-while-current | unknown reason
      const wasCurrent = existingJob.status === 'current';
      let nextStatus: DriverStatus = 'Available';
      startTransition(() => {
        setJobs(prev => {
          const next = prev.filter(j => j.bookingId !== bookingId);
          nextStatus = adjustAvailabilityForRemainingJobs('Available', next);
          return next;
        });
        setIncomingJob(prev => (prev?.bookingId === bookingId) ? null : prev);
      });

      if (wasCurrent) {
        setStatusState(nextStatus);
        statusRef.current = nextStatus;
        stopMeter();
        const d = driverRef.current;
        if (d?.companyId && d?.vehicleId) {
          update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
            vehiclestatus: nextStatus,
            joboffer: 0, jobCount: 0,
            JobphoneNo: '', jobpickup: '', jobdropoff: '',
            time: new Date().toISOString(),
          }).catch(() => {});
        }
      }

      // Build alert message. Read CancelledBy off removed snapshot first, then allbookings.
      (async () => {
        let msg = 'This booking has been cancelled.';
        const snapshotBy = String(lastData?.CancelledBy ?? lastData?.cancelledBy ?? '').toLowerCase();
        if (snapshotBy === 'passenger') {
          msg = 'The passenger has cancelled this booking.';
        } else if (snapshotBy === 'dispatcher' || snapshotBy === 'dispatch') {
          msg = 'This booking has been cancelled by dispatch.';
        } else {
          const d2 = driverRef.current;
          if (d2?.companyId) {
            try {
              const snap = await get(ref(database, `allbookings/${d2.companyId}/${bookingId}`));
              const by = String(snap.val()?.CancelledBy ?? snap.val()?.cancelledBy ?? '').toLowerCase();
              if (by === 'passenger') msg = 'The passenger has cancelled this booking.';
              else if (by === 'dispatcher' || by === 'dispatch') msg = 'This booking has been cancelled by dispatch.';
            } catch {}
          }
        }
        setCancelledJobAlert({ id: Date.now(), title: 'Job Cancelled', message: msg });
      })();
    };

    // ── onChildAdded — new offer OR replay on listener attach ──────────────
    const unsubAdded = onChildAdded(parentPath, (snap) => { markSyncBlock('jobs-g2-added');
      const bookingId = snap.key;
      const data = snap.val();
      if (!bookingId || !data || typeof data !== 'object') return;

      // OTA22c3: skip our own hail self-write echo (defense in depth — should
      // not reach this path because startHailTrip writes flat scalars to the
      // parent, but a future G2 hail-as-child write would land here).
      if (hailTripMetaRef.current?.bookingId && bookingId === hailTripMetaRef.current.bookingId) {
        console.log('[Jobs/G2] Skip own hail self-write (childAdded):', bookingId);
        return;
      }

      console.log(`[Jobs/G2] childAdded bookingId=${bookingId} Status=${data.Status} eventType=${data.eventType} v=${data.version}`);
      try {
        Sentry.addBreadcrumb({ category: 'jobs-g2', level: 'info',
          message: `added ${bookingId} ${data.Status}/${data.eventType}` });
      } catch {}

      // Stale-write guard (22bp G5)
      if (typeof data.version === 'number' || data.updatedAt !== undefined) {
        if (shouldSkipStaleEvent(bookingId, data.version, data.updatedAt)) {
          console.log('[Jobs/G2] Stale childAdded dropped:', bookingId,
            'incoming v:', data.version, 'have:', JSON.stringify(bookingVersionsRef.current.get(bookingId)));
          return;
        }
        markBookingVersion(bookingId, data.version, data.updatedAt);
      }

      const status = String(data.Status ?? '').toLowerCase();

      // Replay on initial attach — driver already accepted this booking earlier.
      // No modal, just add as current/queued. lib/activeBookings reconcile (G6)
      // also handles this on reconnect; both paths short-circuit if already known.
      if (status === 'assigned' || status === 'picking' || status === 'ontrip') {
        if (latestJobsRef.current.some(j => j.bookingId === bookingId)) return;
        console.log('[Jobs/G2] Silent attach — existing accepted booking', bookingId);
        const baseJobFields = buildBaseFields(bookingId, data);
        const job: Job = {
          ...baseJobFields,
          id: `g2-attach-${bookingId}`,
          status: 'current' as const,
        };
        startTransition(() => {
          setJobs(prev => prev.some(j => j.bookingId === bookingId) ? prev : [job, ...prev]);
        });
        return;
      }

      if (status === 'queued') {
        if (latestJobsRef.current.some(j => j.bookingId === bookingId)) return;
        console.log('[Jobs/G2] Silent attach — queued booking', bookingId);
        const baseJobFields = buildBaseFields(bookingId, data);
        const job: Job = {
          ...baseJobFields,
          id: `g2-attach-queued-${bookingId}`,
          status: 'offered' as const,
          offerSentAt: Date.now(),
          offerTimeoutSecs: 0,
        };
        startTransition(() => {
          setJobs(prev => prev.some(j => j.bookingId === bookingId) ? prev : [job, ...prev]);
        });
        return;
      }

      // Anything else → treat as new offer (Offered / Pending / unset)
      handleNewOffer(bookingId, data);
    });

    // ── onChildChanged — field update on an existing booking ───────────────
    const unsubChanged = onChildChanged(parentPath, (snap) => { markSyncBlock('jobs-g2-changed');
      const bookingId = snap.key;
      const data = snap.val();
      if (!bookingId || !data || typeof data !== 'object') return;

      // OTA22c3: skip our own hail self-write echo.
      if (hailTripMetaRef.current?.bookingId && bookingId === hailTripMetaRef.current.bookingId) {
        console.log('[Jobs/G2] Skip own hail self-write (childChanged):', bookingId);
        return;
      }

      console.log(`[Jobs/G2] childChanged bookingId=${bookingId} eventType=${data.eventType} v=${data.version}`);

      if (typeof data.version === 'number' || data.updatedAt !== undefined) {
        if (shouldSkipStaleEvent(bookingId, data.version, data.updatedAt)) {
          console.log('[Jobs/G2] Stale childChanged dropped:', bookingId);
          return;
        }
        markBookingVersion(bookingId, data.version, data.updatedAt);
      }

      handleFieldUpdate(bookingId, data);
    });

    // ── onChildRemoved — terminal event (cancelled/recalled/completed/reassigned) ──
    const unsubRemoved = onChildRemoved(parentPath, (snap) => { markSyncBlock('jobs-g2-removed');
      const bookingId = snap.key;
      const lastData = snap.val() ?? {};
      if (!bookingId) return;

      // OTA22c3: skip our own hail self-write echo. completeHailTrip removes
      // jobs/{cid}/{vid}/{did} which can fire onChildRemoved for the hail
      // bookingId — we must NOT interpret that as a cancellation.
      if (hailTripMetaRef.current?.bookingId && bookingId === hailTripMetaRef.current.bookingId) {
        console.log('[Jobs/G2] Skip own hail self-write (childRemoved):', bookingId);
        return;
      }

      const eventType = String(lastData?.eventType ?? '').toLowerCase();
      console.log(`[Jobs/G2] childRemoved bookingId=${bookingId} eventType=${eventType || '(none)'}`);
      try {
        Sentry.addBreadcrumb({ category: 'jobs-g2', level: 'info',
          message: `removed ${bookingId} ${eventType || 'unknown'}` });
      } catch {}

      handleTerminal(bookingId, eventType, lastData);
    });

    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
      console.log('[Jobs/G2] child listeners DETACHED');
      try { Sentry.addBreadcrumb({ category: 'jobs-g2', level: 'info', message: 'child listeners detached' }); } catch {}
    };
  }, [driver?.companyId, driver?.vehicleId, driver?.id]);

  // ── PASSENGER CANCEL VIA Passengerjobs/{deviceUid} ────────────────────────
  // The dispatch console (and passenger app) write status:"Passengercancel" to
  // Passengerjobs/{deviceUid} when a passenger cancels.  Listen while a job is
  // active (deviceUid present) and react immediately.
  const currentJobDeviceUid = (jobs.find(j => j.status === 'current')?.deviceUid) ?? '';
  useEffect(() => {
    if (!currentJobDeviceUid) return;
    const passengerJobPath = ref(database, `Passengerjobs/${currentJobDeviceUid}`);
    console.log('[PassengerJobs] Listening on Passengerjobs/', currentJobDeviceUid);
    const unsub = onValue(passengerJobPath, (snapshot) => { markSyncBlock('passengerJobs');
      if (!snapshot.exists()) return;
      const data = snapshot.val() ?? {};
      const jobStatus = String(data.status ?? '').toLowerCase();
      console.log('[PassengerJobs] snapshot — status:', data.status);
      if (jobStatus === 'passengercancel' || jobStatus === 'cancel' || jobStatus === 'cancelled') {
        console.log('[PassengerJobs] Passenger/dispatch cancel detected on Passengerjobs path');
        // 22bo-fix9 (G7): keep Assigned if a queued booking still remains.
        let nextStatus: DriverStatus = 'Available';
        setJobs(prev => {
          const next = prev.filter(j => j.status !== 'current');
          nextStatus = adjustAvailabilityForRemainingJobs('Available', next);
          return next;
        });
        setIncomingJob(null);
        setStatusState(nextStatus);
        statusRef.current = nextStatus;
        stopMeter();
        const d = driverRef.current;
        if (d?.companyId && d?.vehicleId && d?.id) {
          remove(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)).catch(() => {});
          update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
            vehiclestatus: nextStatus,
            joboffer: 0, jobCount: 0,
            JobphoneNo: '', jobpickup: '', jobdropoff: '',
            time: new Date().toISOString(),
          }).catch(() => {});
        }
        // passengercancel = explicitly passenger; generic cancel → check allbookings CancelledBy
        if (jobStatus === 'passengercancel') {
          setCancelledJobAlert({ id: Date.now(), title: 'Job Cancelled', message: 'The passenger has cancelled this booking.' });
        } else {
          (async () => {
            let msg = 'This booking has been cancelled.';
            const d2 = driverRef.current;
            const bId = (jobs.find(j => j.status === 'current')?.bookingId) ?? null;
            if (bId && d2?.companyId) {
              try {
                const snap = await get(ref(database, `allbookings/${d2.companyId}/${bId}`));
                const by = String(snap.val()?.CancelledBy ?? snap.val()?.cancelledBy ?? '').toLowerCase();
                if (by === 'passenger') msg = 'The passenger has cancelled this booking.';
                else if (by === 'dispatcher' || by === 'dispatch') msg = 'This booking has been cancelled by dispatch.';
              } catch {}
            }
            setCancelledJobAlert({ id: Date.now(), title: 'Job Cancelled', message: msg });
          })();
        }
      }
    });
    return () => off(passengerJobPath);
  }, [currentJobDeviceUid]);

  // Live allbookings listener for the current active job.
  // The dispatcher console edits bookings at allbookings/{companyId}/{bookingId}.
  // Watching this path ensures field changes (fare, pickup, drop, notes) are
  // reflected on the driver app in real-time without needing a notification.
  const currentJobBookingId = (jobs.find(j => j.status === 'current')?.bookingId) ?? '';
  useEffect(() => {
    if (!currentJobBookingId || !driver?.companyId) return;
    const bookingPath = ref(database, `allbookings/${driver.companyId}/${currentJobBookingId}`);
    console.log('[AllBookings] Listening on allbookings/', driver.companyId, '/', currentJobBookingId);
    onValue(bookingPath, (snapshot) => { markSyncBlock('booking');
      if (!snapshot.exists()) return;
      const d = snapshot.val() ?? {};

      // ── 22bp (G5) — stale-write guard ─────────────────────────────────────
      // Dispatch stamps every allbookings write with version + updatedAt.
      // Drop replays / out-of-order updates that have already been applied.
      if (shouldSkipStaleEvent(currentJobBookingId, d.version, d.updatedAt)) {
        console.log('[AllBookings] Stale event dropped — bookingId:', currentJobBookingId,
          'incoming v:', d.version, 'ts:', d.updatedAt);
        return;
      }
      // Mark high-water mark immediately — patch logic below is idempotent so
      // it's safe to record version even on no-op tickovers.
      markBookingVersion(currentJobBookingId, d.version, d.updatedAt);

      // Handle Status:Cancelled written directly to allbookings by passenger app or dispatch.
      // This is the primary cancellation signal when the passenger app cancels — it writes
      // CancelledBy:"passenger" here even before touching the jobs path.
      const statusLower = String(d.Status ?? d.status ?? '').toLowerCase();
      if (statusLower === 'cancelled' || statusLower === 'canceled') {
        let wasActive = false;
        // 22bo-fix9 (G7): keep Assigned if a queued booking still remains.
        let nextStatus: DriverStatus = 'Available';
        setJobs(prev => {
          if (!prev.some(j => j.bookingId === currentJobBookingId && j.status === 'current')) return prev;
          wasActive = true;
          const next = prev.filter(j => j.bookingId !== currentJobBookingId);
          nextStatus = adjustAvailabilityForRemainingJobs('Available', next);
          return next;
        });
        if (wasActive) {
          setIncomingJob(null);
          setStatusState(nextStatus);
          statusRef.current = nextStatus;
          stopMeter();
          const drv = driverRef.current;
          if (drv?.companyId && drv?.vehicleId && drv?.id) {
            remove(ref(database, `jobs/${drv.companyId}/${drv.vehicleId}/${drv.id}`)).catch(() => {});
            update(ref(database, `online/${drv.companyId}/${drv.vehicleId}/current`), {
              vehiclestatus: nextStatus,
              joboffer: 0, jobCount: 0,
              JobphoneNo: '', jobpickup: '', jobdropoff: '',
              time: new Date().toISOString(),
            }).catch(() => {});
          }
          const by = String(d.CancelledBy ?? d.cancelledBy ?? '').toLowerCase();
          const msg = by === 'passenger'
            ? 'The passenger has cancelled this booking.'
            : (by === 'dispatcher' || by === 'dispatch')
              ? 'This booking has been cancelled by dispatch.'
              : 'This booking has been cancelled.';
          setCancelledJobAlert({ id: Date.now(), title: 'Job Cancelled', message: msg });
        }
        return;
      }

      // Only patch if field-level data is present — ignore bare status-only writes
      const hasMeaningfulFields =
        d.PickAddress || d.DropAddress || d.PassengerName || d.Fare || d.Info;
      if (!hasMeaningfulFields) return;

      // Compute the updated job outside setJobs so we can show an Alert after
      // the state update — calling Alert inside a setState updater crashes Android.
      let changeAlert: { pickup: string; drop: string; fare: number } | null = null;

      setJobs(prev => {
        const next = prev.map(j => {
          if (j.bookingId !== currentJobBookingId) return j;
          const updatedFare = parseFloat(String(d.Fare ?? d.fare ?? '0')) || j.fare;
          const updated = {
            ...j,
            passengerName:  d.PassengerName  ?? d.passengerName  ?? j.passengerName,
            passengerPhone: d.PassengerPhone ?? d.passengerPhone ?? j.passengerPhone,
            pickupAddress:  d.PickAddress    ?? d.pickAddress    ?? j.pickupAddress,
            dropAddress:    d.DropAddress    ?? d.dropAddress    ?? j.dropAddress,
            fare:           updatedFare,
            distance:       d.Distance ?? d.distance ?? j.distance,
            duration:       d.Duration ?? d.duration ?? j.duration,
            notes:          d.Info ?? d.notes ?? j.notes,
          };
          const changed =
            updated.pickupAddress !== j.pickupAddress ||
            updated.dropAddress   !== j.dropAddress   ||
            updated.fare          !== j.fare           ||
            updated.passengerName !== j.passengerName;
          if (changed) {
            changeAlert = { pickup: updated.pickupAddress, drop: updated.dropAddress, fare: updated.fare };
          }
          return updated;
        });
        return next;
      });

      // Show alert outside the state updater to avoid Android crash
      if (changeAlert) {
        const { pickup, drop, fare } = changeAlert as { pickup: string; drop: string; fare: number };
        Alert.alert(
          'Job Updated',
          `Dispatch updated your job.\n\nPickup: ${pickup}\nDrop: ${drop}\nFare: $${fare.toFixed(2)}`,
          [{ text: 'OK' }]
        );
      }
    });
    return () => off(bookingPath);
  }, [currentJobBookingId, driver?.companyId]);

  // ── bookingEvents listener — granular field + lifecycle updates ─────────────
  // Subscribes while the driver has an active (current) job. Events are ordered
  // by seq; duplicates and out-of-order replays are dropped via bookingEventSeqRef.
  useEffect(() => {
    if (!currentJobBookingId || !driver?.companyId) return;

    const bookingId = currentJobBookingId;
    const companyId = driver.companyId;
    const eventsPath = ref(database, `bookingEvents/${companyId}/${bookingId}`);
    console.log('[BookingEvents] Listening on bookingEvents/', companyId, '/', bookingId);

    const applyFieldPatch = (patch: ReturnType<typeof patchFromChanges>, alertTitle: string) => {
      if (!patch || Object.keys(patch).length === 0) return;
      let changeAlert: { pickup: string; drop: string; fare: number; stops?: string } | null = null;

      setJobs(prev => prev.map(j => {
        if (j.bookingId !== bookingId || j.status !== 'current') return j;
        const updated = { ...j, ...patch };
        const changed =
          (patch.pickupAddress !== undefined && patch.pickupAddress !== j.pickupAddress) ||
          (patch.dropAddress   !== undefined && patch.dropAddress   !== j.dropAddress)   ||
          (patch.fare          !== undefined && patch.fare          !== j.fare)          ||
          (patch.stops         !== undefined && patch.stops         !== j.stops)         ||
          (patch.passengerName !== undefined && patch.passengerName !== j.passengerName);
        if (changed) {
          changeAlert = {
            pickup: updated.pickupAddress,
            drop:   updated.dropAddress,
            fare:   updated.fare,
            stops:  updated.stops,
          };
        }
        return updated;
      }));

      if (changeAlert) {
        const { pickup, drop, fare, stops } = changeAlert;
        const stopsLine = stops ? `\nStops: ${stops.replace(/\n/g, ', ')}` : '';
        Alert.alert(
          alertTitle,
          `Dispatch updated your job.\n\nPickup: ${pickup}\nDrop: ${drop}\nFare: $${fare.toFixed(2)}${stopsLine}`,
          [{ text: 'OK' }],
        );
      }
    };

    const handleRemoteTerminal = (kind: 'complete' | 'cancel' | 'recall', by?: string) => {
      let wasActive = false;
      let nextStatus: DriverStatus = 'Available';
      setJobs(prev => {
        if (!prev.some(j => j.bookingId === bookingId && j.status === 'current')) return prev;
        wasActive = true;
        const next = prev.filter(j => j.bookingId !== bookingId);
        nextStatus = adjustAvailabilityForRemainingJobs('Available', next);
        return next;
      });
      if (!wasActive) return;

      markBookingLocallyCompleted(bookingId);
      clearSeenForBooking(bookingId);
      setIncomingJob(null);
      setStatusState(nextStatus);
      statusRef.current = nextStatus;
      stopMeter();

      const drv = driverRef.current;
      if (drv?.companyId && drv?.vehicleId && drv?.id) {
        remove(ref(database, `jobs/${drv.companyId}/${drv.vehicleId}/${drv.id}`)).catch(() => {});
        update(ref(database, `online/${drv.companyId}/${drv.vehicleId}/current`), {
          vehiclestatus: nextStatus,
          joboffer: 0,
          jobCount: nextJobsCount(drv, bookingId),
          JobphoneNo: '',
          jobpickup: '',
          jobdropoff: '',
          time: new Date().toISOString(),
        }).catch(() => {});
      }

      if (kind === 'complete') {
        console.log('[BookingEvents] StatusChanged complete — cleared active job', bookingId);
        return;
      }

      const byLower = String(by ?? '').toLowerCase();
      const msg = kind === 'recall'
        ? 'This booking was recalled by dispatch.'
        : byLower === 'passenger'
          ? 'The passenger has cancelled this booking.'
          : (byLower === 'dispatcher' || byLower === 'dispatch')
            ? 'This booking has been cancelled by dispatch.'
            : 'This booking has been cancelled.';
      setCancelledJobAlert({ id: Date.now(), title: kind === 'recall' ? 'Job Recalled' : 'Job Cancelled', message: msg });
    };

    function nextJobsCount(d: Driver, removedBookingId: string): number {
      return latestJobsRef.current.filter(
        j => j.bookingId !== removedBookingId && (j.status === 'current' || j.status === 'queued'),
      ).length;
    }

    const processEvent = (event: ReturnType<typeof parseBookingEvent>) => {
      if (!event) return;
      const lastSeq = bookingEventSeqRef.current.get(bookingId) ?? 0;
      if (event.seq <= lastSeq) {
        console.log('[BookingEvents] Skip stale seq', event.seq, '<=', lastSeq, 'type:', event.type);
        return;
      }
      bookingEventSeqRef.current.set(bookingId, event.seq);
      markBookingVersion(bookingId, event.seq, event.timestamp);

      console.log('[BookingEvents] Apply seq', event.seq, 'type', event.type, 'data', JSON.stringify(event.data));

      const changes = extractChanges(event.data);

      switch (event.type) {
        case 'PickupChanged':
          applyFieldPatch(patchFromChanges(changes, latestJobsRef.current.find(j => j.bookingId === bookingId) ?? {}), 'Pickup Updated');
          break;
        case 'FareChanged':
          applyFieldPatch(patchFromChanges(changes, latestJobsRef.current.find(j => j.bookingId === bookingId) ?? {}), 'Fare Updated');
          break;
        case 'StopAdded':
          applyFieldPatch(patchFromChanges(changes, latestJobsRef.current.find(j => j.bookingId === bookingId) ?? {}), 'Stops Updated');
          break;
        case 'StatusChanged': {
          const action = String(event.data.action ?? '').toLowerCase();
          const toStatus = String(event.data.to ?? '').trim();
          const fromStatus = String(event.data.from ?? '').trim();
          const cancelledBy = String(event.data.CancelledBy ?? event.data.by ?? '').trim();

          if (action === 'created' || action === 'assign' || action === 'accept') {
            if (changes) {
              applyFieldPatch(
                patchFromChanges(changes, latestJobsRef.current.find(j => j.bookingId === bookingId) ?? {}),
                'Job Updated',
              );
            }
            break;
          }
          if (action === 'complete' || toStatus === 'Completed' || toStatus === 'Closed') {
            handleRemoteTerminal('complete');
            break;
          }
          if (action === 'cancel' || toStatus === 'Cancelled' || toStatus === 'Canceled') {
            handleRemoteTerminal('cancel', cancelledBy);
            break;
          }
          if (action === 'recall' || (toStatus === 'Pending' && fromStatus !== 'Pending')) {
            handleRemoteTerminal('recall', cancelledBy);
            break;
          }
          if (changes) {
            applyFieldPatch(
              patchFromChanges(changes, latestJobsRef.current.find(j => j.bookingId === bookingId) ?? {}),
              'Job Updated',
            );
          }
          break;
        }
        default:
          break;
      }
    };

    const unsubAdded = onChildAdded(eventsPath, (snap) => {
      markSyncBlock('bookingEvents');
      processEvent(parseBookingEvent(snap.val()));
    });

    // Replay existing events in seq order (push-key order ≠ seq order).
    let cancelled = false;
    get(eventsPath).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const backlog = sortBookingEventsBySeq(
        Object.values(snap.val() ?? {})
          .map(v => parseBookingEvent(v))
          .filter((e): e is NonNullable<typeof e> => !!e),
      );
      for (const ev of backlog) processEvent(ev);
    }).catch(err => console.warn('[BookingEvents] initial catch-up failed:', err?.message ?? err));

    return () => {
      cancelled = true;
      unsubAdded();
      bookingEventSeqRef.current.delete(bookingId);
    };
  }, [currentJobBookingId, driver?.companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (s: DriverStatus) => {
    setStatusState(s);
    statusRef.current = s;   // keep ref in sync so heartbeat uses the new status
    if (!driver) return;

    // 22bo-fix8: HQ-reported bug — tapping "Available" only re-patched
    // vehiclestatus + time on online/{cid}/{vid}/current. If any of the
    // dispatch-required fields (vehicletype, PlayerId, lat/lng) had gone
    // stale or were never written by an earlier launch, the dispatch console's
    // zone-queue listener silently dropped the record and auto-dispatch
    // skipped the driver. Now we ALSO re-assert the full presence record
    // (vehicletype + PlayerId + fresh GPS + lastSeen serverTimestamp) on
    // every status tap so dispatch always sees a complete row.
    if (driver.vehicleId && driver.companyId) {
      // Fast path: minimal patch lands in <50ms so UI feels instant.
      update(ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`), {
        vehiclestatus: s,
        time: new Date().toISOString(),
      }).catch(err => console.warn('[Status] Firebase status patch failed:', err));
      // Slow path: full presence record (with GPS read) — non-blocking.
      writeOnlinePresence(s).catch(err => console.warn('[Status] Full presence refresh failed:', err?.message));
    }

    // Also try the REST API (best-effort)
    dispatchPost({
      Action: 'FnDriverStatusUpdate',
      Parms: `ZoneId,,&&VehicleId,,${driver.vehicleId}&&CompanyId,,${driver.companyId}&&DriverId,,${driver.id}&&Status,,${s}`,
      UserKey: driver.passforlink,
    }).catch(err => console.warn('[Status] FnDriverStatusUpdate (non-blocking):', err?.message));
  };

  // 22bo-fix7: belt-and-braces invariant — if a bookingId is already 'current'
  // or 'queued', any stale 'offered' row with the same bookingId is filtered
  // out at the derived-list level so it can NEVER render on the home offers
  // banner or meter offers tab. Defends against any future listener path that
  // might leave a duplicate behind during a cancel→re-offer race window.
  const currentJob = jobs.find(j => j.status === 'current') ?? null;
  const queuedJobs = jobs.filter(j => j.status === 'queued');
  const _occupiedBookingIds = new Set<string>(
    [
      currentJob?.bookingId,
      ...queuedJobs.map(j => j.bookingId),
    ].filter((b): b is string => !!b)
  );
  const offeredJobs = jobs.filter(j =>
    j.status === 'offered' && !(j.bookingId && _occupiedBookingIds.has(j.bookingId))
  );

  // ── Live jobDetails listener — Stripe webhook race condition ─────────────────
  // A web booking may arrive before Stripe's webhook fires. Subscribe to
  // jobDetails/{bookingId} so paymentStatus flips to 'paid' the moment the
  // webhook lands, without requiring any driver action.
  const _currentBookingId = currentJob?.bookingId ?? null;
  useEffect(() => {
    if (!_currentBookingId) return;
    const jobDetailsPath = ref(database, `jobDetails/${_currentBookingId}`);
    const unsub = onValue(jobDetailsPath, (snap) => { markSyncBlock('jobDetails');
      if (!snap.exists()) return;
      const d = snap.val() as Record<string, any>;
      const ps = String(d.paymentStatus ?? d.PaymentStatus ?? '').trim().toLowerCase();
      const prpd = !!(d.prepaid ?? d.Prepaid ?? false);
      if (!ps && !prpd) return;
      setJobs(prev => prev.map(j => {
        if (j.bookingId !== _currentBookingId) return j;
        const already = ['paid', 'completed'].includes((j.paymentStatus ?? '').toLowerCase()) || j.prepaid;
        if (already) return j;
        return {
          ...j,
          paymentStatus: ps || j.paymentStatus,
          prepaid: prpd || j.prepaid,
          jobPaymentMethod: String(d.paymentMethod ?? d.PaymentMethod ?? j.jobPaymentMethod ?? '').trim().toLowerCase() || j.jobPaymentMethod,
        };
      }));
    });
    return () => off(jobDetailsPath);
  }, [_currentBookingId]); // eslint-disable-line
  const completedJobs = jobs.filter(j => j.status === 'completed');

  // ── Helper: map job → required allowedServices flag ───────────────────────
  // Returns a human-readable error string if the job type is not allowed,
  // or null if the driver may proceed.
  const checkJobTypeBlocked = (job: Job): string | null => {
    const allowed = driver?.allowedServices;
    if (!allowed) return null; // no restrictions loaded — allow
    const bt  = (job.bookingType ?? '').toLowerCase();
    const pay = (job.paymentType  ?? '').toLowerCase();
    const isFreight = bt.includes('freight') || bt.includes('parcel') || bt.includes('cargo');
    const isFood    = bt.includes('food')    || bt.includes('meal')   || bt.includes('restaurant') || bt.includes('deliver');
    // ota22c-cutover-d: tow recognition — aliases tow / towing / recovery
    const isTow     = bt.includes('tow')     || bt.includes('recovery');
    const isTm      = pay === 'total_mobility' || bt.includes('tm') || bt.includes('mobility');
    if (isFreight && !allowed.freight) return 'You are not authorised for freight deliveries. Contact your administrator.';
    if (isFood    && !allowed.food)    return 'You are not authorised for food deliveries. Contact your administrator.';
    if (isTow     && !allowed.tow)     return 'You are not authorised for towing jobs. Contact your administrator.';
    if (isTm      && !allowed.tm)      return 'You are not authorised for Total Mobility jobs. Contact your administrator.';
    if (!isFreight && !isFood && !isTow && !isTm && !allowed.taxi) return 'You are not authorised for taxi jobs. Contact your administrator.';
    return null;
  };

  const acceptJob = async (job: Job) => {
    try {
    if (!job || typeof job !== 'object') {
      console.error('[acceptJob] Invalid job payload:', job);
      return;
    }
    // Block if driver account is deactivated by SA
    if (driver?.active === false) {
      Alert.alert('Account Deactivated', 'Your account has been deactivated. Please contact your fleet administrator.');
      return;
    }
    // Block if driver is not authorised for this job type
    const blocked = checkJobTypeBlocked(job);
    if (blocked) {
      Alert.alert('Job Type Not Permitted', blocked);
      return;
    }
    cancelJobNotifications().catch(() => {}); // dismiss any pending "New Job" banner
    lastAcceptTimeRef.current = Date.now(); // guard against stale "Away" notifications
    // 22bo-fix6: match by bookingId (not id) so ANY stray duplicate Job entry
    // for this booking — e.g. one from the notification listener and another
    // from the jobs-path listener — gets promoted/dedup'd in a single sweep.
    // Without this, the orphan stayed in jobs[] with status:'offered', kept
    // showing on home, and re-popped the modal when tapped.
    const __acceptBid = job.bookingId ?? '';
    setJobs(prev => {
      let promoted = false;
      const next: Job[] = [];
      for (const j of prev) {
        const isThisBooking = __acceptBid
          ? (j.bookingId === __acceptBid)
          : (j.id === job.id);
        if (isThisBooking) {
          if (promoted) continue; // drop any further duplicate of this booking
          next.push({ ...j, status: 'current' as const });
          promoted = true;
        } else if (j.status === 'current') {
          next.push({ ...j, status: 'queued' as const });
        } else {
          next.push(j);
        }
      }
      if (!promoted) next.push({ ...job, status: 'current' as const });
      return next;
    });
    setIncomingJob(null);
    setStatusState('Assigned');

    if (driver) {
      // OTA20 ANR FIX: every Firebase write below is fire-and-forget so the JS
      // thread is freed the moment the user presses Accept.  Without this,
      // Android force-closes the app while the writes are in flight on slow
      // networks (Galaxy A04).  Firebase preserves write order from a single
      // client, so the `Assigned` writes still land before any subsequent
      // startMeter / completeJob writes from this same device.
      try {
        if (driver.vehicleId && driver.companyId) {
          writeOnlinePresence('Assigned', driver.vehicleId).catch(() => {});
          // Patch job fields that writeOnlinePresence doesn't know about.
          const existingQueued = jobs.filter(j => j.status === 'queued' && j.id !== job.id).length;
          // 22c cutover: keep ONLY presence-side fields. Server stamps
          // JobphoneNo/jobpickup/jobdropoff into online/.../current itself on
          // command:'accept' (server.js:6282/7381). currentJobId stays — that's
          // a driver-app presence field for crash-recovery.
          update(ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`), {
            joboffer:      0,
            jobCount:      1 + existingQueued,
            currentJobId:  job.bookingId ?? '',
          }).catch(() => {});
          // Top-level vehiclestatus — dispatch reads this on child_added.
          // 22c cutover: 'Picking' is the server-side convention for accepted-
          // in-progress (server.js:7725, 9101). Was 'Assigned' — dispatch UI
          // doesn't read 'Assigned' as a recognised state.
          update(ref(database, `online/${driver.companyId}/${driver.vehicleId}`), {
            vehiclestatus: 'Picking',
          }).catch(() => {});
          // v22bl: parallel tripStage field so dispatch board can see the
          // explicit lifecycle (OnTheWay → Arrived → OnBoard → Available).
          // Kept SEPARATE from vehiclestatus so the existing Assigned/Busy
          // contract that dispatch relies on is not disturbed.
          update(ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`), {
            tripStage: 'OnTheWay',
          }).catch(() => {});
          console.log('[Accept] Queued Picking presence for', driver.vehicleId);
          // 22c cutover: jobs/ DriverAccepted, rideStatus, onDisconnect
          // jobs/ + allbookings handlers, and Passengerjobs status writes
          // all removed — server's command:'accept' handler owns them now.
        }
        remove(ref(database, `notification/${driver.id}`)).catch(() => {});

        dispatchPost({
          Action: 'FnDispatchJobStatus',
          Parms: `BookingId,,${job.bookingId}&&DriverId,,${driver.id}&&Status,,DriverAccepted&&CompanyId,,${driver.companyId}`,
          UserKey: driver.passforlink,
        }).catch(() => {});

        // OTA22c (D3): G2 dispatch contract — POST /api/job/command 'accept'.
        // Dual-write: runs ALONGSIDE the legacy DriverAccepted flat writes
        // above so pre-cutover dispatch (reads jobs/ flat path) keeps
        // working. Post-cutover dispatch reads commands instead and the
        // flat writes become inert. Queue absorbs offline / 5xx failures
        // and replays via drainJobCommandQueue on reconnect. Idempotent
        // via clientRequestId.
        if (job.bookingId && driver.passforlink && driver.companyId && driver.vehicleId) {
          sendOrQueueJobCommand({
            passforlink: driver.passforlink,
            bookingId: job.bookingId,
            command: 'accept',
            clientRequestId: newClientRequestId(),
            payload: {
              companyId: driver.companyId,
              driverId: driver.id,
              vehicleId: driver.vehicleId,
              acceptedAt: new Date().toISOString(),
            },
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('Accept job sync failed:', err);
      }

      // Journal: Accepted event (local storage first, non-blocking)
      getGps().then(gps => {
        appendJournalEntry({
          jobId:     job.bookingId ?? job.id,
          companyId: driver.companyId ?? '',
          driverId:  driver.id       ?? '',
          vehicleId: driver.vehicleId ?? '',
          eventType: 'Accepted',
          timestamp: new Date().toISOString(),
          lat: gps.lat,
          lng: gps.lng,
          meta: { pickupAddress: job.pickupAddress },
        }).then(refreshPendingUploadCount);
      }).catch(() => {});
      logDriverEvent('Accepted', job.bookingId ?? job.id);
    }
    } catch (err: any) {
      console.error('[acceptJob] Unhandled error:', err?.message ?? err, err?.stack);
      try {
        Sentry.captureException(err, {
          tags: { area: 'acceptJob' },
          extra: { bookingId: job?.bookingId, jobId: job?.id, driverId: driver?.id },
        });
      } catch {}
      Alert.alert(
        'Accept failed',
        'Something went wrong accepting this job. Please try again or contact dispatch.',
      );
    }
  };

  // ── Accept a silent offer into the Queue (called while driver is on a Hail) ──
  // Unlike acceptJob (which makes the job 'current'), this keeps the Hail as
  // 'current' and puts the dispatched job in the queue so it resurfaces when
  // the Hail ends.  Writes DriverAccepted so dispatch moves it to the Queued
  // section, and updates jobCount so the dispatcher sees the updated load.
  const acceptJobToQueue = async (job: Job) => {
    if (driver?.active === false) {
      Alert.alert('Account Deactivated', 'Your account has been deactivated. Please contact your fleet administrator.');
      return;
    }
    const blocked = checkJobTypeBlocked(job);
    if (blocked) { Alert.alert('Job Type Not Permitted', blocked); return; }

    // v22bg: HQ policy — food/freight are uncapped, taxi/tm/unknown stay at 1.
    // Inbound aliases (restaurant→food, delivery→freight) are already normalised
    // by dispatch before we receive the job, but we tolerate them locally too.
    const _rawSvc = String(job.serviceType ?? job.jobType ?? '').toLowerCase().trim();
    // ota22c-cutover-d: tow/towing/recovery → 'tow', restaurant → 'food', delivery → 'freight'
    const _svc = _rawSvc === 'restaurant' ? 'food'
               : _rawSvc === 'delivery'   ? 'freight'
               : (_rawSvc === 'towing' || _rawSvc === 'recovery' || _rawSvc === 'tow') ? 'tow'
               : _rawSvc;
    // ota22c-cutover-d: tow joins food/freight as multi-queue (uncapped) — tow operators
    //   often stack 2-3 calls back-to-back, same dispatch pattern as freight.
    const isMultiQueueType = _svc === 'food' || _svc === 'freight' || _svc === 'tow';

    // ── Dispatch console handoff: 1-queued cap for taxi/tm; uncapped for food/freight ──
    // Local race guard first — blocks two near-simultaneous taps
    if (!isMultiQueueType && jobs.some(j => j.status === 'queued' && j.id !== job.id)) {
      Alert.alert(
        'Queue Full',
        'You already have a job queued. Complete or release it before accepting another.',
      );
      return;
    }
    // Then atomic Firebase guard via transaction — wins or aborts on conflict.
    // v22bg: skip the single-slot transaction entirely for food/freight — those
    // service types are uncapped and use the per-bookingId multi-slot path.
    if (!isMultiQueueType && driver?.companyId && driver?.id) {
      try {
        // OTA21: keep the atomic transaction await — it's a single quick write
        // and provides the cross-device collision guarantee. Only the slow
        // downstream writes (jobCount update, dispatchPost) are fire-and-forget.
        const queueRef = ref(database, `driverQueue/${driver.companyId}/${driver.id}/queued`);
        const txRes = await runTransaction(queueRef, (current) => {
          // v22bf: allow re-accepting the SAME bookingId (idempotent). Previously
          // any non-null slot aborted — so if a stale slot remained from a prior
          // session, or this exact same job was already reserved, the driver
          // got a false "Queue Full" error and the offer bounced back to UA.
          if (current !== null && current?.bookingId !== (job.bookingId ?? '')) {
            return; // abort: a DIFFERENT job holds the slot
          }
          return {
            bookingId: job.bookingId ?? '',
            reservedAt: Date.now(),
            status: 'Reserving',
          };
        });
        if (!txRes.committed) {
          // v22bf: only show the alert if a DIFFERENT job is actually holding
          // the slot locally. If our local 'queued' list is empty, the Firebase
          // slot is stale — clear it and try again next tap.
          const hasLocalQueued = jobs.some(j => j.status === 'queued' && j.bookingId !== job.bookingId);
          if (hasLocalQueued) {
            Alert.alert(
              'Queue Full',
              'You already have a job queued. Complete or release it before accepting another.',
            );
            return;
          }
          // Stale Firebase slot — clear it and proceed
          console.warn('[AcceptToQueue] Stale driverQueue slot detected — clearing and continuing');
          await remove(queueRef).catch(() => {});
        }
      } catch (err) {
        console.warn('[AcceptToQueue] driverQueue reservation failed (continuing):', err);
      }
    }

    lastAcceptTimeRef.current = Date.now();
    setJobs(prev => prev.map(j =>
      j.id === job.id ? { ...j, status: 'queued' as const } : j
    ));

    // OTA22c (D3): G2 dispatch contract — accept-to-queue path also sends
    // command 'accept' with queued=true so dispatch knows this driver
    // accepted the offer into their hail-side queue (not as current trip).
    if (job.bookingId && driver?.passforlink && driver?.companyId && driver?.vehicleId) {
      sendOrQueueJobCommand({
        passforlink: driver.passforlink,
        bookingId: job.bookingId,
        command: 'accept',
        clientRequestId: newClientRequestId(),
        payload: {
          companyId: driver.companyId,
          driverId: driver.id,
          vehicleId: driver.vehicleId,
          acceptedAt: new Date().toISOString(),
          queued: true,
        },
      }).catch(() => {});
    }

    if (driver?.companyId && driver?.vehicleId && driver?.id) {
      try {
        // Dispatch console queue handoff — write the full job object so the
        // dispatcher's queue UI can render it without a second lookup.
        // v22bg: taxi/tm write to /queued (single slot, overwrites). Food/freight
        // write to /queuedMulti/{bookingId} so multiple can coexist without
        // clobbering each other. Dispatch reads both paths.
        if (job.bookingId) {
          // 22c cutover: driverQueue/queued direct write removed — server's
          // command:'accept' (queued:true) owns this state now. Dispatch
          // QueueJob endpoint still notified below for legacy console UI.

          // Tell dispatch via the console queue endpoint.
          // v22bh: Sentry breadcrumb on failure (HQ asked for visibility on
          // silent-failure rate as food/freight volume ramps).
          dispatchPost({
            Action: 'QueueJob',
            Parms:  `bookingid,,${job.bookingId}&&driverid,,${driver.id}&&source,,DriverApp`,
            UserKey: driver.passforlink,
          }).catch((e: any) => {
            console.warn('[AcceptToQueue] QueueJob POST failed:', e);
            const _msg = String(e?.message ?? e ?? '');
            const _statusMatch = _msg.match(/HTTP\s+(\d{3})/);
            const _httpStatus = _statusMatch ? Number(_statusMatch[1]) : (e?.name === 'AbortError' ? 'timeout' : 'network_error');
            try {
              Sentry.addBreadcrumb({
                category: 'dispatch',
                level: 'warning',
                message: 'QueueJob POST failed',
                data: {
                  bookingId:   job.bookingId,
                  driverId:    driver.id,
                  serviceType: _svc || 'taxi',
                  httpStatus:  _httpStatus,
                  errorMsg:    _msg.slice(0, 200),
                },
              });
              Sentry.captureMessage(`QueueJob POST failed: ${_httpStatus} (${_svc || 'taxi'})`, 'warning');
            } catch { /* breadcrumb best-effort */ }
          });
        }

        // Bump jobCount in presence so dispatch shows the driver is carrying
        // the current Hail + the newly queued job.
        const existingQueued = jobs.filter(j => j.status === 'queued' && j.id !== job.id).length;
        // OTA21: fire-and-forget so the accept tap is instant
        update(ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`), {
          jobCount: 1 + existingQueued + 1, // current + already queued + this one
        }).catch(() => {});
        // 22c cutover: jobs/ DriverAccepted, allbookings Queued, and
        // rideStatus writes all removed — server's command:'accept' with
        // queued:true owns this state now. Console-queue REST endpoint
        // (QueueJob) is still notified above for legacy dispatch UI.
        // OTA21: fire-and-forget — REST call must never block the accept tap
        dispatchPost({
          Action: 'FnDispatchJobStatus',
          Parms: `BookingId,,${job.bookingId}&&DriverId,,${driver.id}&&Status,,DriverAccepted&&CompanyId,,${driver.companyId}`,
          UserKey: driver.passforlink,
        }).catch((err) => console.warn('[AcceptToQueue] FnDispatchJobStatus POST failed:', err));
      } catch (err) {
        console.warn('[AcceptToQueue] sync failed:', err);
      }
    }
  };

  // ── Offline onDisconnect cleanup ─────────────────────────────────────────
  // Cancels any registered onDisconnect handlers for the current job.
  // Must be called whenever the job lifecycle is resolved (meter start,
  // complete, cancel, or shift end) so Firebase doesn't wrongly return the
  // job to Unassigned after the event is already processed.
  const cancelJobOnDisconnects = async () => {
    const d = driverRef.current;
    if (!d?.companyId || !d?.vehicleId || !d?.id) return;
    try {
      await onDisconnect(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)).cancel();
    } catch (e) {
      console.warn('[OnDisconnect] Failed to cancel job disconnect handler:', e);
    }
    if (bookingDisconnectPathRef.current) {
      try {
        await onDisconnect(ref(database, bookingDisconnectPathRef.current)).cancel();
      } catch (e) {
        console.warn('[OnDisconnect] Failed to cancel booking disconnect handler:', e);
      }
      bookingDisconnectPathRef.current = null;
    }
    jobDisconnectPathRef.current = null;
    console.log('[OnDisconnect] Job disconnect handlers cancelled');
  };

  // ── Shared free-driver reset ───────────────────────────────────────────────
  // Wipes all local + Firebase state for a driver that is no longer on a job.
  // Called by rejectJob and recallJob.
  //
  // toStatus controls the Firebase/local presence after the job is cleared.
  // Both rejectJob and recallJob pass 'Available' so the driver stays in the
  // dispatch queue without having to manually re-enable themselves.
  const _freeDriver = async (
    jobId: string,
    deviceUid: string | undefined,
    passengerStatus: 'DriverDeclined' | 'DriverCancel',
    toStatus: DriverStatus = 'Available',
    bookingId?: string,
    recallReason?: string,
  ) => {
    // 1. Kill the meter instantly — before anything async
    if (meterInterval.current) clearInterval(meterInterval.current);
    meterRunningRef.current = false;
    meterPausedRef.current  = false;
    setMeterRunning(false);
    setMeterPaused(false);
    setMeterSeconds(0);
    setMeterDistance(0);

    // 2. Wipe local job + incoming state
    const beingRemoved = jobs.find(j => j.id === jobId);
    // 22bo-fix9 (G7): if the driver still has a queued booking after this
    // reject/recall, downgrade the requested 'Available' to 'Assigned' so
    // dispatch doesn't see the driver as fully free and offer a parallel trip.
    let effectiveStatus: DriverStatus = toStatus;
    setJobs(prev => {
      const next = prev.filter(j => j.id !== jobId);
      effectiveStatus = adjustAvailabilityForRemainingJobs(toStatus, next);
      return next;
    });
    setIncomingJob(null);

    // 2b. Free dispatch console queue slot if the job being removed was queued
    if (beingRemoved?.status === 'queued') {
      const dq = driverRef.current;
      if (dq?.companyId && dq?.id) {
        remove(ref(database, `driverQueue/${dq.companyId}/${dq.id}/queued`)).catch(() => {});
      }
    }

    // 3. Set local status immediately (before Firebase) to avoid flicker
    setStatusState(effectiveStatus);

    const d = driverRef.current;
    if (!d?.companyId || !d?.vehicleId) return;

    // 3b. Cancel any job onDisconnect handlers — fire-and-forget so the UI
    //     reset is never blocked on a slow Firebase round-trip (OTA21).
    cancelJobOnDisconnects().catch(() => {});

    // 4. Fire all Firebase writes in parallel — non-blocking so reject/recall/
    //    end-shift never freeze the UI waiting on the network (OTA21).
    Promise.resolve(writeOnlinePresence(effectiveStatus, d.vehicleId)).catch(() => {});

    // 22c cutover: jobs/ DriverDeclined/Cancel, Passengerjobs status,
    // rideStatus, and allbookings Unassigned writes all removed — server's
    // command:'cancel' (declined / cancelled_by_driver) owns this state.
    // Presence-only writes survive: jobpickup/jobdropoff/JobphoneNo are
    // server-stamped now, so we ONLY clear our own bookkeeping flags +
    // reset top-level vehiclestatus.
    const declinedAt = new Date().toISOString();
    const writes: Promise<any>[] = [
      update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
        joboffer: 0, jobCount: 0,
        tripStage: null, // v22bl: clear lifecycle stage on _freeDriver
        currentJobId: null,
      }),
      // Reset top-level vehiclestatus — presence concern, KEEP.
      update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
        vehiclestatus: effectiveStatus, // 22bo-fix9 (G7): respect queued bookings
      }),
      remove(ref(database, `notification/${d.id}`)),
    ];

    // OTA21: fire-and-forget so reject/recall/end-shift never block the UI on
    // a slow Firebase round-trip. Each write is wrapped in .catch above; this
    // .allSettled is purely diagnostic.
    Promise.allSettled(writes).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[FreeDriver] write[${i}] failed (non-critical):`, r.reason);
        }
      });
    });

    // OTA22c (D3): G2 dispatch contract — POST /api/job/command 'cancel'.
    // Dual-write with the legacy DriverDeclined / DriverCancel flat writes.
    // reason discriminates: passengerStatus===DriverDeclined → 'declined',
    // DriverCancel → 'cancelled_by_driver'. recallReason flows through as
    // reasonText so dispatch can show "Mechanical issue", "Traffic", etc.
    if (bookingId && d.passforlink && d.companyId) {
      sendOrQueueJobCommand({
        passforlink: d.passforlink,
        bookingId,
        command: 'cancel',
        clientRequestId: newClientRequestId(),
        payload: {
          companyId: d.companyId,
          driverId: d.id,
          vehicleId: d.vehicleId,
          reason: passengerStatus === 'DriverDeclined' ? 'declined' : 'cancelled_by_driver',
          reasonText: recallReason ?? null,
          cancelledAt: declinedAt,
        },
      }).catch(() => {});
    }

    // 5. Safety-net: re-assert chosen status after Firebase round-trip
    setStatusState(toStatus);
    console.log('[FreeDriver] done — status set to:', toStatus);

    // 6. The dispatch console may write 'Away' to the online presence when it
    //    detects DriverDeclined on the jobs path. Re-assert our real status after
    //    5 s so the dispatch map reflects 'Available' again (and the heartbeat
    //    doesn't have to wait the full 30 s to correct it).
    setTimeout(() => {
      if (statusRef.current === toStatus && d.vehicleId && d.companyId) {
        update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
          vehiclestatus: toStatus,
          time: new Date().toISOString(),
        }).catch(() => {});
        console.log('[FreeDriver] 5s re-assert — confirmed status:', toStatus);
      }
    }, 5000);
  };

  // Reject: driver did not want the job (manual tap or 30s timeout).
  // → stays Available so the driver remains in the queue without interruption.
  const rejectJob = async (jobId: string) => {
    cancelJobNotifications().catch(() => {}); // dismiss any pending "New Job" banner
    const job = jobs.find(j => j.id === jobId);
    if (job?.bookingId) clearSeenForBooking(job.bookingId);

    // BUG-1 FIX: If the meter is running (driver is mid-trip) and the rejected job
    // is only an OFFERED job (not the active current trip), perform a lightweight
    // rejection that does NOT stop the running meter or reset meter state.
    if (meterRunningRef.current && job && job.status !== 'current') {
      const wasQueued = job.status === 'queued';
      setJobs(prev => prev.filter(j => j.id !== jobId));
      setIncomingJob(null);
      const d = driverRef.current;
      if (d?.companyId && d?.vehicleId && d?.id) {
        const declinedAt = new Date().toISOString();
        // 22c cutover: driverQueue, jobs/ DriverDeclined, Passengerjobs, and
        // allbookings Unassigned writes all removed — server's
        // command:'cancel' (reason:'declined') owns booking state. Only the
        // local notification inbox cleanup remains.
        Promise.allSettled([
          remove(ref(database, `notification/${d.id}`)),
        ]).catch(() => {});

        // OTA22c (D3): G2 dispatch contract — POST /api/job/command 'cancel'
        // for the inline-meter rejection path (driver mid-trip declines a
        // newly-offered job without interrupting the active meter). Dual-write
        // alongside the legacy DriverDeclined flat write above.
        if (job.bookingId && d.passforlink && d.companyId) {
          sendOrQueueJobCommand({
            passforlink: d.passforlink,
            bookingId: job.bookingId,
            command: 'cancel',
            clientRequestId: newClientRequestId(),
            payload: {
              companyId: d.companyId,
              driverId: d.id,
              vehicleId: d.vehicleId,
              reason: 'declined',
              reasonText: 'declined while on active trip',
              cancelledAt: declinedAt,
            },
          }).catch(() => {});
        }
      }
      return;
    }

    await _freeDriver(jobId, job?.deviceUid, 'DriverDeclined', 'Available', job?.bookingId);
  };

  // Recall: driver accepted but can't complete — returns to Available (stays in queue).
  // reason is written to Firebase so dispatch can see why the job was recalled.
  const recallJob = async (jobId: string, reason?: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (job?.bookingId) clearSeenForBooking(job.bookingId);
    await _freeDriver(jobId, job?.deviceUid, 'DriverCancel', 'Available', job?.bookingId, reason);
  };

  const completeJob = async (jobId: string, fare: number, extras?: JobCompletionExtras) => {
    try { // v12-ota18: wrap whole body so a single bad write can't crash the app

    const job = jobs.find(j => j.id === jobId);

    // 1. Stop meter and mark job completed locally — synchronous, no await
    // Capture meter refs BEFORE stopMeter() zeros them so saveTripSummary gets
    // the real values even though it runs inside an async getGps() callback.
    const capturedDist = meterDistanceRef.current;
    const capturedSecs = meterSecondsRef.current;
    stopMeter();
    setJobs(prev => {
      const updated = prev.map(j =>
        j.id === jobId
          ? { ...j, status: 'completed' as const, fare, completedAt: new Date().toISOString(), ...(extras ?? {}) }
          : j
      );
      // After dispatch trip completes, promote the first queued job back to
      // 'offered' so the accept/decline modal re-surfaces automatically.
      const firstQueued = updated.find(j => j.status === 'queued');
      if (!firstQueued) return updated;
      // Clear dispatch console queue handoff — slot is now free
      const dx = driverRef.current;
      if (dx?.companyId && dx?.id) {
        remove(ref(database, `driverQueue/${dx.companyId}/${dx.id}/queued`)).catch(() => {});
      }
      return updated.map(j => j.id === firstQueued.id ? { ...j, status: 'offered' as const } : j);
    });
    // Force Available immediately — before any async ops so there's no window
    // where the driver shows as Busy/Assigned after tapping Complete
    setStatusState('Available');

    const d = driverRef.current;
    if (!d?.companyId || !d?.vehicleId) return;

    // v12-ota19: ALL Firebase writes below are fire-and-forget. Previously
    // ~5s of awaited writes blocked the JS thread → Android ANR force-close.
    // The UI (modal close, meter zero, status flip) already happened above.
    cancelJobOnDisconnects().catch(() => {});

    // 2. Fire all Firebase writes in parallel — use Promise.allSettled so a
    //    REST-API failure (360taxi.co.nz is permanently offline) can never
    //    block or hide the presence reset.
    // Write full Available presence record first so dispatch gets a complete node.
    writeOnlinePresence('Available', d.vehicleId).catch(() => {});
    const writes: Promise<any>[] = [
      // Clear job fields on top of the presence reset
      update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
        joboffer: 0, jobCount: 0, JobphoneNo: '', jobpickup: '', jobdropoff: '',
        tripStage: null, // v22bl: clear lifecycle stage on completeJob
      }),
      // Reset top-level vehiclestatus so dispatch page-load reads Available instead of Assigned.
      // acceptJob writes this field to 'Assigned'; writeOnlinePresence only touches /current/.
      // Without this, completed drivers are invisible to auto-dispatch until dispatch page reload.
      update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
        vehiclestatus: 'Available',
      }),
      // Remove the job assignment node so dispatch can reassign the booking
      remove(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)),
      // Remove any lingering notification
      remove(ref(database, `notification/${d.id}`)),
    ];

    // Tell passenger app the ride is done (only if we have their deviceUid)
    if (job?.deviceUid) {
      writes.push(set(ref(database, `Passengerjobs/${job.deviceUid}/status`), 'Completed'));
    }

    // Update rideStatus so SA portal sees the job as Completed
    if (job?.bookingId) {
      writeRideStatusUpdate(d.companyId, job.bookingId, {
        status: 'Completed',
        updatedAt: Date.now(),
      });
    }

    // v12-ota19: fire-and-forget so completion never blocks UI.
    Promise.allSettled(writes).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[Complete] write[${i}] failed (non-critical):`, r.reason);
        }
      });
    });

    // 4. Best-effort: write completion record to allbookings so dispatcher sees final fare + payment type.
    // If offline, enqueue to AsyncStorage so the write survives an app kill and flushes on reconnect.
    if (job?.bookingId && d.companyId) {
      const _allbookingsUpdate: Record<string, unknown> = {
        Status:           'Completed',
        status:           'completed',    // SA portal lowercase alias — counted in earnings reports
        FinalFare:        fare,
        fare:             fare,           // SA portal lowercase alias for FinalFare
        meterFare:        fare,           // SA portal fallback field name
        // v22bo fix (architect): completion-time chosen payment method
        // (extras.paymentType, set by meter.tsx handleConfirmComplete) wins
        // over the offer-time job.paymentType. Without this, a driver who
        // taps Split (or switches Cash → Card on the modal) would still see
        // the original method written to dispatch.
        PaymentType:      (extras?.paymentType ?? job.paymentType ?? 'cash'),
        paymentType:      (extras?.paymentType ?? job.paymentType ?? 'cash'), // SA portal lowercase alias
        // Pax Pays badge — paymentMethod + boolean flags both written for dispatcher compatibility
        paymentMethod:   ((): string => {
                          const _pt = String(extras?.paymentType ?? job.paymentType ?? 'cash').toLowerCase();
                          if (_pt === 'split') return 'split';
                          if (['card','eftpos'].includes(_pt)) return 'card';
                          if (['account','total_mobility','acc'].includes(_pt)) return 'account';
                          return 'cash';
                        })(),
        cashPayment:    ['cash','gift_card'].includes(String(extras?.paymentType ?? job.paymentType ?? 'cash').toLowerCase()),
        cardPayment:    ['card','eftpos'].includes(String(extras?.paymentType ?? job.paymentType ?? '').toLowerCase()),
        accountPayment: ['account','total_mobility','acc'].includes(String(extras?.paymentType ?? job.paymentType ?? '').toLowerCase()),
        // v22bo: explicit PaymentSplits on allbookings record too (dispatch HQ reads this).
        PaymentSplits:  (extras?.paymentSplits && extras.paymentSplits.length) ? extras.paymentSplits : null,
        CompletedAt:      nzDateTime(),            // NZ display string — dispatcher facing only
        completedAt:      new Date().toISOString(), // ISO string — SA portal primary date field
        CompletedAt_ISO:  new Date().toISOString(),
        completedAt_ISO:  new Date().toISOString(), // SA portal primary ISO field for date filtering
        CompletedDate:    nzDate(),
        CompletedTime:    nzTime(),
        // startedAt_ISO — ISO timestamp for when meter started (pickedUpAt) used by SA month grouping
        startedAt_ISO:    extras?.pickedUpAt ?? extras?.arrivedAt ?? new Date().toISOString(),
        vehicleId:        d.vehicleId ?? '', // SA portal reads vehicleId for earnings grouping
        driverName: (d.name && !d.name.includes('@')) ? d.name : d.name ? d.name.split('@')[0] : d.vehicleId ?? '',
        ...(extras?.tariffName    ? { TariffName:    extras.tariffName }    : {}),
        ...(extras?.waitingMins   != null ? { WaitingTime: `${extras.waitingMins} min` } : {}),
        ...(extras?.waitingCost   != null ? { WaitingCost: extras.waitingCost }   : {}),
        ...(extras?.rideCost      != null ? { RideCost:    extras.rideCost }      : {}),
        ...(extras?.arrivedAt     ? { ArrivedAt:    extras.arrivedAt }     : {}),
        ...(extras?.pickedUpAt    ? { PickedUpAt:   extras.pickedUpAt }    : {}),
        // Fare breakdown — read by dispatch console fare display
        TotalFare:    fare,
        FareBase:     extras?.flagFall    ?? 0,
        FareTime:     extras?.waitingCost ?? 0,
        FareDistance: extras?.rideCost    ?? Math.max(0, fare - (extras?.waitingCost ?? 0) - (extras?.flagFall ?? 0)),
        FareExtras:   extras?.extrasTotal ?? 0, // v22bm
        JobDistance:  extras?.distanceKm  ?? 0,
        FareCurrency: 'NZD',
        // Drop-off GPS + address — always write so dispatch route map shows correct end point
        DropLatLng:   extras?.dropLatLng ?? (extras?.dropLat ? `${extras.dropLat.toFixed(6)},${extras.dropLng!.toFixed(6)}` : '0,0'),
        // v22ba: PickAddress / DropAddress now written UNCONDITIONALLY (PascalCase
        // priority for HQ's new modal). Was missing PickAddress entirely + only wrote
        // DropAddress when the driver typed one → HQ's modal showed blank address line
        // with only the PickLatLng map pin visible, hence the "just giving coordinates"
        // complaint. Fallback chain ensures we always supply a string.
        PickAddress:  job?.pickupAddress ?? '',
        DropAddress:  extras?.dropAddress ?? job?.dropAddress ?? '',
        ...(extras?.distanceKm    != null ? { distanceKm:  extras.distanceKm }  : {}),
        ...(extras?.pickupLat     != null ? { pickupLat:   extras.pickupLat }   : {}),
        ...(extras?.pickupLng     != null ? { pickupLng:   extras.pickupLng }   : {}),
        ...(extras?.dropLat       != null ? { dropLat:     extras.dropLat }     : {}),
        ...(extras?.dropLng       != null ? { dropLng:     extras.dropLng }     : {}),
        DriverCost:   extras?.driverCost ?? fare,
        // v22az: dispatch console field-map aliases — added per HQ's read order so
        // the new-modal trip detail card + old-modal PDF populate without further changes.
        TarriffType:  extras?.tariffName ?? '',         // legacy SQL column (double-r) for Tariff Name
        ...(extras?.tariffId ? { TarriffId: extras.tariffId } : {}), // legacy SQL column (double-r) for Tariff ID
        ppname:       job?.passengerName ?? '',         // passenger name read by old modal + PDF
        AccountId:    job?.passengerPhone ?? '',        // legacy: SQL "AccountId" col = passenger phone
        drivername:   (d.name && !d.name.includes('@')) ? d.name : d.name ? d.name.split('@')[0] : d.vehicleId ?? '', // new modal reads lowercase
        CallSign:     d.vehicleId ?? '',                // vehicle display name
        VehicleNo:    d.vehicleId ?? '',
        TotalTime:    fmtMinSec(capturedSecs),          // "mm:ss" string for old modal
        BookingSource: 'Dispatch Console',
        bookingidx:   job?.bookingId ?? '',             // new modal Job ID
        Id:           job?.bookingId ?? '',
        PickLatLng:   (extras?.pickupLat != null && extras?.pickupLng != null)
                        ? `${extras.pickupLat.toFixed(6)},${extras.pickupLng.toFixed(6)}`
                        : '',                            // new-modal map pickup pin
        EstimatedDistance: extras?.distanceKm ?? 0,     // old modal field (plain number; UI appends ' km')
        Recieve_payment: fare,                          // legacy SQL field (note typo) — paid amount
        paymentStatus: 'paid',
        PaymentStatus: 'paid',
        // Timeline timestamps — NZ-local ISO without Z (dispatch console TZ Pacific/Auckland)
        ActiveAt:        nzLocalISO(extras?.pickedUpAt ? new Date(extras.pickedUpAt) : new Date()),
        JobCompleteTime: nzLocalISO(),
        newcompelete:    nzLocalISO(),                  // legacy SQL alias (yes, the typo is theirs)
        // Total Mobility — PascalCase (dispatcher) + camelCase (SA portal) aliases
        ...(extras?.tmVoucherNo ? {
          TmVoucherNo:   extras.tmVoucherNo,
          tmVoucherNo:   extras.tmVoucherNo,   // SA portal reads this field name
          cardNumber:    extras.tmVoucherNo,   // SA portal reads cardNumber for TM voucher
        } : {}),
        ...(extras?.tmPassengerName ? { TmPassengerName:  extras.tmPassengerName }  : {}),
        ...(extras?.tmTripCategory  ? { TmTripCategory:   extras.tmTripCategory }   : {}),
        ...(extras?.tmPassengerPays != null ? { TmPassengerPays: extras.tmPassengerPays } : {}),
        // tmSubsidy — SA portal uses for subsidy claim totals
        ...(extras?.tmSubsidy != null ? {
          tmSubsidy:    extras.tmSubsidy,
          tmSubsidyFare: extras.tmSubsidy, // SA portal alternative field name
        } : {}),
        // Card
        ...(extras?.cardLastFour           ? { CardLastFour:           extras.cardLastFour }           : {}),
        ...(extras?.cardHolder             ? { CardHolder:              extras.cardHolder }             : {}),
        ...(extras?.cardExpiry             ? { CardExpiry:              extras.cardExpiry }             : {}),
        ...(extras?.cardBrand              ? { CardBrand:               extras.cardBrand }              : {}),
        ...(extras?.stripePaymentIntentId  ? { StripePaymentIntentId:  extras.stripePaymentIntentId }  : {}),
        ...(extras?.stripeCharged          ? { StripeCharged:           true }                         : {}),
      };
      // 22c cutover: direct allbookings update + completedJobs push removed —
      // server's command:'complete' handler writes both. The _allbookingsUpdate
      // payload above is left intact for reference (it builds the same fields
      // the server now persists from the command payload below).
      void _allbookingsUpdate;

      // OTA22c (D3): G2 dispatch contract — POST /api/job/command 'complete'.
      // Dual-write alongside the legacy completedJobs push + /api/job/sync-
      // offline-trip POST below. Server is idempotent via clientRequestId so
      // both paths can fire safely; post-cutover the legacy writes become
      // inert and the command becomes the source of truth. Full fare
      // breakdown + lifecycle timestamps included so dispatch can render
      // the trip detail card without a secondary lookup.
      if (d.passforlink) {
        sendOrQueueJobCommand({
          passforlink: d.passforlink,
          bookingId: job.bookingId,
          command: 'complete',
          clientRequestId: newClientRequestId(),
          payload: {
            companyId: d.companyId,
            driverId: d.id,
            vehicleId: d.vehicleId,
            fare: parseFloat(fare.toFixed(2)),
            fareBase: extras?.flagFall ?? 0,
            fareTime: extras?.waitingCost ?? 0,
            fareDistance: extras?.rideCost ?? Math.max(0, fare - (extras?.waitingCost ?? 0) - (extras?.flagFall ?? 0)),
            fareExtras: extras?.extrasTotal ?? 0,
            fareCurrency: 'NZD',
            distanceKm: extras?.distanceKm != null ? parseFloat(extras.distanceKm.toFixed(3)) : parseFloat(capturedDist.toFixed(3)),
            durationSecs: capturedSecs,
            paymentType: extras?.paymentType ?? job.paymentType ?? 'cash',
            paymentSplits: extras?.paymentSplits ?? null,
            tariffName: extras?.tariffName ?? null,
            waitingMins: extras?.waitingMins ?? null,
            pickupAddress: job.pickupAddress ?? '',
            dropAddress: extras?.dropAddress ?? job.dropAddress ?? '',
            pickupLat: extras?.pickupLat ?? null,
            pickupLng: extras?.pickupLng ?? null,
            dropLat: extras?.dropLat ?? null,
            dropLng: extras?.dropLng ?? null,
            arrivedAt: extras?.arrivedAt ?? null,
            pickedUpAt: extras?.pickedUpAt ?? null,
            completedAt: new Date().toISOString(),
            meterOnAt: meterOnAtRef.current ?? null,
            meterOffAt: meterOffAtRef.current ?? null,
            // TM
            tmVoucherNo: extras?.tmVoucherNo ?? null,
            tmPassengerName: extras?.tmPassengerName ?? null,
            tmTripCategory: extras?.tmTripCategory ?? null,
            tmPassengerPays: extras?.tmPassengerPays ?? null,
            tmSubsidy: extras?.tmSubsidy ?? null,
            // Card
            cardLastFour: extras?.cardLastFour ?? null,
            cardHolder: extras?.cardHolder ?? null,
            cardExpiry: extras?.cardExpiry ?? null,
            cardBrand: extras?.cardBrand ?? null,
            stripePaymentIntentId: extras?.stripePaymentIntentId ?? null,
            stripeCharged: extras?.stripeCharged ?? false,
            // ACC / Account — architect review HIGH#1: dispatch complete
            // payload was missing these for account/ACC dispatch trips.
            accClientRef: extras?.accClientRef ?? null,
            accClientId: extras?.accClientId ?? null,
            accClaimNo: extras?.accClaimNo ?? null,
            // Gift card / split-payment identifiers
            giftCardCode: extras?.giftCardCode ?? null,
            // Reserved free-text + override fields (wire-format ready)
            driverNote: extras?.driverNote ?? null,
            tripIssueCategory: extras?.tripIssueCategory ?? null,
            fixedFareOverride: extras?.fixedFareOverride ?? null,
            fixedFareReason: extras?.fixedFareReason ?? null,
            extrasItems: extras?.extrasItems ?? null,
            source: 'dispatch',
          },
        }).catch(() => {});
      }

      // 22c cutover: legacy /api/job/sync-offline-trip POST removed.
      // command:'complete' above is now the single source of truth (server
      // dev explicitly: "sync-offline-trip does NOT work for Active bookings").
      // _flagFall etc kept declared so the postSyncOfflineTrip removal
      // doesn't leave dangling references downstream.
      const _flagFall    = extras?.flagFall    ?? 0;
      const _waitingCost = extras?.waitingCost ?? 0;
      const _rideCost    = extras?.rideCost    ?? Math.max(0, fare - _waitingCost - _flagFall);
      const _distKm      = extras?.distanceKm  ?? 0;
      const _dropLatLng  = extras?.dropLatLng  ?? (extras?.dropLat ? `${extras.dropLat.toFixed(6)},${extras.dropLng!.toFixed(6)}` : '');
      // v22be: enriched payload per dispatch-console spec — waiting mins,
      // tariff log, payment-method breakdown, TM/ACC/gift-card identifiers,
      // fixed-fare override + driver-note slots (wire format reserved).
      const _payTypeDisp = String((extras?.paymentType as string | undefined) ?? job?.paymentType ?? 'cash').toLowerCase();
      const _payTariff   = activeTariffRef.current;
      const _waitingMins = (_payTariff?.waitingPerMin ?? 0) > 0
        ? Math.round((_waitingCost / _payTariff.waitingPerMin) * 100) / 100
        : 0;
      const _tmPays     = extras?.tmPassengerPays;
      const _tmSubsidy  = _payTypeDisp === 'total_mobility' && typeof _tmPays === 'number'
        ? parseFloat((fare - _tmPays).toFixed(2))
        : null;
      // v22bi/22bj: lifecycle timestamps. pickup/dropoff = wheels-rolling-with-customer;
      // MeterOnAt/MeterOffAt = meter-was-charging (separate per HQ spec for disputes).
      const _completedAtISO = new Date().toISOString();
      const _pickupISO      = extras?.pickedUpAt ?? extras?.arrivedAt ?? _completedAtISO;
      const _dropoffISO     = _completedAtISO;
      const _meterOnISO     = meterOnAtRef.current  ?? _pickupISO;
      const _meterOffISO    = meterOffAtRef.current ?? _completedAtISO;
      const _totalSecsDisp  = typeof capturedSecs === 'number' ? capturedSecs : 0;
      const _bookingTypeDisp: string = (job as any)?.bookingType ?? 'taxi';
      // 22c cutover: postSyncOfflineTrip call removed. Payload kept below as a
      // dead local for reference, gated behind `if (false)` so the existing
      // expression syntax compiles.
      if (false) postSyncOfflineTrip(`${getServerUrl()}/api/job/sync-offline-trip`,
        {
          ...RUNTIME_META, // v22bg: HQ persists runtimeVersion/groupId/platform per trip
          BookingId:    job.bookingId,
          CompanyId:    d.companyId,
          DriverId:     d.id,
          VehicleId:    d.vehicleId,
          TotalFare:    fare,
          FareBase:     _flagFall,
          FareTime:     _waitingCost,
          FareDistance: _rideCost,
          FareExtras:   extras?.extrasTotal ?? 0, // v22bm
          JobDistance:  _distKm,
          FareCurrency: 'NZD',
          DropLatLng:   _dropLatLng,
          DropAddress:  extras?.dropAddress ?? job?.dropAddress ?? '',
          Status:       'Completed',
          Source:       'dispatch',
          BookingType:  _bookingTypeDisp,
          // v22bi: lifecycle timestamps (ISO 8601 UTC) + canonical duration
          PickupTime:   _pickupISO,
          DropoffTime:  _dropoffISO,
          MeterOnAt:    _meterOnISO,
          MeterOffAt:   _meterOffISO,
          TotalTime:    fmtDurationMmSs(_totalSecsDisp),
          JobDuration:  parseFloat((_totalSecsDisp / 60).toFixed(2)),
          // Payment breakdown
          PaymentType:           _payTypeDisp,
          // v22bo: split-payment parts when the passenger pays across
          // multiple methods (e.g. 70 % account + 30 % cash).
          PaymentSplits:         (extras?.paymentSplits && extras.paymentSplits.length) ? extras.paymentSplits : null,
          SettledInCar:          !['account'].includes(_payTypeDisp),  // account = invoiced, not in-car
          TmVoucherNo:           extras?.tmVoucherNo  ?? null,
          TmPassengerPays:       typeof _tmPays === 'number' ? _tmPays : null,
          TmSubsidy:             _tmSubsidy,
          AccClaimNo:            extras?.accClaimNo   ?? null,
          AccClientRef:          extras?.accClientRef ?? null,
          AccClientId:           extras?.accClientId  ?? null,
          GiftCardCode:          extras?.giftCardCode ?? null,
          CardLastFour:          extras?.cardLastFour ?? null,
          StripePaymentIntentId: extras?.stripePaymentIntentId ?? null,
          StripeCharged:         extras?.stripeCharged ?? null,
          // v22bm: driver-picked extras (airport / bike / bag / EFTPOS / etc.)
          ExtrasItems: extras?.extrasItems ?? [],
          ExtrasTotal: extras?.extrasTotal ?? 0,
          // Waiting time — minutes + dollars
          WaitingMins:      _waitingMins,
          WaitingIntervals: meterWaitingIntervalsRef.current,
          WaitingCost:      _waitingCost,
          // v22bk: dispute-resolution audit — total waited minutes derived from
          // recorded wait-mode entry/exit windows + the per-window timeline.
          // HQ extractor reads both fields directly.
          WaitingMinutes:   summariseWaitingWindows(waitingWindowsRef.current, _completedAtISO).waitingMinutes,
          WaitingWindows:   summariseWaitingWindows(waitingWindowsRef.current, _completedAtISO).waitingWindows,
          // Audit log — tariff changes + manual pauses + active tariff
          ActiveTariffId:   String(_payTariff?.id ?? ''),
          ActiveTariffName: _payTariff?.name ?? '',
          TariffChanges:    tariffChangesRef.current ?? [],
          PauseLog:         pauseLogRef.current      ?? [],
          // Fixed-fare override + driver notes (wire format ready; UI to follow)
          FixedFareOverride: extras?.fixedFareOverride ?? null,
          FixedFareReason:   extras?.fixedFareReason   ?? null,
          FixedFareNote:     extras?.fixedFareNote     ?? null,
          DriverNote:        extras?.driverNote        ?? null,
          TripIssueCategory: extras?.tripIssueCategory ?? 'none',
        },
        {
          bookingId:     job.bookingId,
          driverId:      d.id,
          serviceType:   _bookingTypeDisp,
          tripCloseTime: _completedAtISO,
        },
      );

      // TM trips: also write to trips/{cid}/{bookingId} so the admin TM modules can read them
      const jobPayType = extras?.tmVoucherNo ? 'total_mobility' : (job?.paymentType ?? '');
      if (jobPayType === 'total_mobility' && extras?.tmVoucherNo) {
        update(ref(database, `trips/${d.companyId}/${job.bookingId}`), {
          tripId:          job.bookingId,
          source:          'dispatch',
          driverId:        d.id,
          driverName:      (d.name && !d.name.includes('@')) ? d.name : d.name ? d.name.split('@')[0] : d.vehicleId ?? '',
          vehicleId:       d.vehicleId,
          companyId:       d.companyId,
          cardNumber:      extras.tmVoucherNo,
          passengerName:   extras.tmPassengerName ?? job?.passengerName ?? '',
          tripCategory:    extras.tmTripCategory  ?? 'other',
          fareTotal:       fare,
          passengerAmount: extras.tmPassengerPays ?? 0,
          distanceKm:      extras.distanceKm != null ? parseFloat(extras.distanceKm.toFixed(3)) : 0,
          pickupLat:       extras.pickupLat ?? null,
          pickupLng:       extras.pickupLng ?? null,
          dropLat:         extras.dropLat ?? null,
          dropLng:         extras.dropLng ?? null,
          pickupAddress:   job?.pickupAddress ?? '',
          dropAddress:     job?.dropAddress ?? '',
          dateTime:        new Date().toISOString(),
          date:            nzDate(),
          time:            nzTime(),
          status:          'Completed',
          flagged:         false,
        }).catch(() => {});
      }
    }

    // 4b-ACC. Increment ACC Purchase Order tripsUsed when job has a po_id
    if (job?.acc_client_id && job?.po_id && d.companyId) {
      const poPath = `accClients/${d.companyId}/${job.acc_client_id}/purchaseOrders/${job.po_id}/tripsUsed`;
      runTransaction(ref(database, poPath), (current) => (typeof current === 'number' ? current + 1 : 1))
        .catch(() => {}); // best-effort — non-critical
    }

    // ota22c-cutover-d: legacy module-specific mirror (foodOrders/freightOrders)
    //   REMOVED — last surviving direct Firebase booking-state write from the
    //   pre-cutover code. Server's command:'complete' now owns this state and
    //   mirrors to freightOrders / foodOrders / towOrders server-side. Keeping
    //   a parallel client write would race against the canonical server write
    //   and stamp stale fare/payment fields on partial-network completes.

    // 5. Best-effort REST API call — non-blocking, never affects local state
    const dropLatLngParm = extras?.dropLatLng ? `&&DropLatLng,,${extras.dropLatLng}` : '';
    const waitingCostParm = extras?.waitingCost != null ? `&&WaitingCost,,${extras.waitingCost}` : '';
    const driverCostParm  = extras?.driverCost  != null ? `&&DriverCost,,${extras.driverCost}`  : '';
    dispatchPost({
      Action: 'FnDriverCompleteJob',
      Parms: `BookingId,,${job?.bookingId}&&DriverId,,${d.id}&&Fare,,${fare}&&CompanyId,,${d.companyId}${dropLatLngParm}${waitingCostParm}${driverCostParm}`,
      UserKey: d.passforlink,
    }).catch(err => console.warn('[Complete] FnDriverCompleteJob (non-blocking):', err?.message ?? err));

    // 6. Local trip journal — save Completed event + full trip summary
    //    Saved to device storage regardless of network state.
    const bookingKey = job?.bookingId ?? jobId;
    const nowIso     = new Date().toISOString();
    getGps().then(gps => {
      appendJournalEntry({
        jobId:     bookingKey,
        companyId: d.companyId ?? '',
        driverId:  d.id        ?? '',
        vehicleId: d.vehicleId ?? '',
        eventType: 'MeterOff',
        timestamp: nowIso,
        lat: gps.lat,
        lng: gps.lng,
      }).catch(() => {});
      appendJournalEntry({
        jobId:     bookingKey,
        companyId: d.companyId ?? '',
        driverId:  d.id        ?? '',
        vehicleId: d.vehicleId ?? '',
        eventType: 'Completed',
        timestamp: nowIso,
        lat: gps.lat,
        lng: gps.lng,
        meta: { fare, dropLatLng: extras?.dropLatLng },
      }).catch(() => {});
      logDriverEvent('Completed', bookingKey, { fare, lat: gps.lat, lng: gps.lng });

      // Use values captured synchronously before stopMeter() zeroed the refs.
      const distKm   = extras?.distanceKm ?? capturedDist;
      const secs     = capturedSecs;
      const flagFall = extras?.flagFall ?? 0;
      const waitCost = extras?.waitingCost ?? 0;
      const rideCost = extras?.rideCost ?? Math.max(0, fare - waitCost - flagFall);

      // Determine payment method label
      let payMethod = job?.paymentType ?? 'cash';
      if (extras?.cardLastFour) payMethod = `card`;
      if (extras?.tmVoucherNo)  payMethod = `total_mobility`;

      saveTripSummary({
        jobId:          bookingKey,
        companyId:      d.companyId ?? '',
        driverId:       d.id        ?? '',
        vehicleId:      d.vehicleId ?? '',
        passengerName:  job?.passengerName  ?? '',
        pickupAddress:  job?.pickupAddress  ?? '',
        dropoffAddress: job?.dropAddress    ?? '',
        pickupTime:     extras?.pickedUpAt  ?? nowIso,
        dropoffTime:    nowIso,
        duration_mins:  parseFloat((secs / 60).toFixed(1)),
        distance_km:    parseFloat(distKm.toFixed(2)),
        fare: {
          base:           flagFall,
          distanceCharge: rideCost,
          timeCharge:     waitCost,
          extras:         extras?.extrasTotal ?? 0, // v22bm
          total:          parseFloat(fare.toFixed(2)),
          currency:       'NZD',
        },
        payment: {
          method:    payMethod,
          cardLast4: extras?.cardLastFour ?? null,
          receiptNo: `RCP-${bookingKey}`,
        },
        status:           'Completed',
        completedOffline: !isConnectedRef.current,
      }).then(() => {
        // Upload immediately after saving summary so the pending list is never
        // flushed by a reconnect event before the summary is written to storage.
        runPendingUpload().catch(() => {});
      }).catch(() => {});
    }).catch(() => {});

    // v12-ota22c4 #4: this booking is now done on THIS device. Block any
    // future re-offer / re-broadcast (e.g. dispatch hasn't seen our sync yet
    // and tries to re-assign the same bookingId). Survives app restart via
    // the boot hydration effect below.
    markBookingLocallyCompleted(bookingKey);
    markBookingLocallyCompleted(job?.bookingId);
    markBookingLocallyCompleted(jobId);

    // Surface the rating prompt (subject to frequency cap) — runs after meter teardown.
    requestRating({
      bookingId:      job?.bookingId ?? jobId,
      source:         'dispatch',
      passengerName:  job?.passengerName,
      passengerPhone: job?.passengerPhone,
      fare,
    });

    } catch (err: any) {
      // v12-ota18: completion errors used to crash the app silently. Now surface them.
      console.error('[completeJob CRASH]', err);
      try { Alert.alert('Trip completion error', `${err?.message ?? err}\n\nThe trip may not have uploaded — please check Trips list.`); } catch {}
    }
  };

  const dismissIncoming = () => setIncomingJob(null);

  // Get current GPS coordinates (best-effort, falls back to 0,0)
  // v22ao ROOT-CAUSE FIX for "Getting your location…" + "no driver on dispatch":
  // On Samsung phones (Galaxy A04, Fold 7, etc), Location.getCurrentPositionAsync
  // silently hangs for 10+ seconds and often returns null. While on shift, a
  // shared watchPositionAsync is already running (see line ~913) and keeps
  // lastGpsPositionRef.current fresh every ~2 seconds. ALWAYS prefer that
  // cached value — it's instant and reliable. Only fall back to the slow
  // getCurrentPositionAsync if the watch hasn't produced a fix yet
  // (i.e. very first seconds after Start Shift), and even then with a 3 s
  // race so writeOnlinePresence is never blocked indefinitely.
  const getGps = async (): Promise<{ lat: number; lng: number }> => {
    // Fast path — use the running watch's cached position
    const cached = lastGpsPositionRef.current;
    if (cached && (cached.lat !== 0 || cached.lng !== 0)) {
      return { lat: cached.lat, lng: cached.lng };
    }
    // Slow path — race a one-shot fix against a 3 s timeout so callers
    // (writeOnlinePresence, heartbeat, etc) are never blocked by Samsung's
    // broken getCurrentPositionAsync.
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return { lat: 0, lng: 0 };
      const oneShot = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(loc => ({ lat: loc.coords.latitude, lng: loc.coords.longitude }))
        .catch(() => ({ lat: 0, lng: 0 }));
      const timeout = new Promise<{ lat: number; lng: number }>(resolve =>
        setTimeout(() => resolve({ lat: 0, lng: 0 }), 3000)
      );
      const result = await Promise.race([oneShot, timeout]);
      // If the one-shot won, also seed the cache so future getGps calls are instant
      if (result.lat !== 0 || result.lng !== 0) {
        lastGpsPositionRef.current = result;
      }
      return result;
    } catch {
      return { lat: 0, lng: 0 };
    }
  };

  // ── Offline trip journal helpers ──────────────────────────────────────────
  // Refresh the pending-upload badge count from AsyncStorage.
  const refreshPendingUploadCount = async () => {
    const n = await getPendingCount();
    setPendingUploadCount(n);
  };

  // Write a single status event to the Firebase event log using push() so
  // all offline-queued events survive as separate timestamped entries.
  const logDriverEvent = (eventType: string, jobId: string, meta?: Record<string, any>) => {
    const d = driverRef.current;
    if (!d?.companyId || !d?.id) return;
    push(ref(database, `driverEvents/${d.companyId}/${d.id}`), {
      eventType,
      jobId,
      vehicleId: d.vehicleId ?? '',
      timestamp: new Date().toISOString(),
      ...(meta ?? {}),
    }).catch(() => {});
  };

  // Run the upload for any pending offline trips, then refresh badge.
  const runPendingUpload = async () => {
    const d = driverRef.current;
    if (!d?.companyId || !d?.id || !d?.vehicleId) return;
    try {
      await uploadPendingTrips({
        driverId:     d.id,
        companyId:    d.companyId,
        vehicleId:    d.vehicleId,
        serverOrigin: getServerUrl(),
      });
    } catch { /* ignore — server may not have endpoint yet */ }
    await refreshPendingUploadCount();
  };

  const clearResumedJob = () => setResumedJob(null);

  // Ask the server if this driver has an unfinished job from before a crash.
  // Sets resumedJob state if found — home screen shows a "resume trip" alert.
  const runResumeCheck = async () => {
    const d = driverRef.current;
    if (!d?.id || !d?.companyId) return;
    const found = await checkForResumedJob(d.id, d.companyId, d.vehicleId ?? '');
    if (found) setResumedJob(found);
  };

  // Build the presence record using exact field names the dispatch console reads.
  // Always reads from driverRef.current so it never uses stale closure values,
  // and accepts an explicit vehicleId override for cases where the driver state
  // hasn't been updated yet (e.g. fresh re-read in startShift).
  const buildPresenceRecord = (status: DriverStatus, lat: number, lng: number, overrideVehicleId?: string) => {
    const d = driverRef.current;
    const rawVehicleId = overrideVehicleId ?? d?.vehicleId ?? '';
    const numericVehicleId = parseInt(rawVehicleId, 10);
    // VehicleId: use numeric if purely numeric, otherwise keep the raw string (e.g. "T201")
    const vehicleIdValue = Number.isNaN(numericVehicleId) ? rawVehicleId : numericVehicleId;

    const driverName = (d?.name && !d.name.includes('@'))
      ? d.name
      : d?.name
        ? d.name.split('@')[0]
        : rawVehicleId ? `Driver ${rawVehicleId}` : 'Driver';

    // driverid: keep as raw string (e.g. "D001" or "1212") so dispatch console
    // can match it regardless of whether the company uses numeric or alpha IDs.
    // parseInt("D001") = NaN which was silently becoming 0 — bug fixed.
    const rawId = d?.id ?? '';
    const numericId = parseInt(rawId, 10);
    const driverIdValue = Number.isNaN(numericId) ? rawId : numericId;

    // Dispatch zone-table listener silently drops records that lack full identity.
    // PlayerId = Firebase auth UID; vehicletype = the company's required type code
    // (e.g. "Car"/"Van") which the dispatch console keys its zone-queue rows on.
    const playerId   = d?.uid ?? '';
    const vehicleType = (vehicleTypeCodeRef.current || 'Not Specified');

    // v22ar: Dispatch HQ's driver popup was showing "App Version: undefined,
    // Vehicle Type: undefined, GPS Status: undefined, Vehicle Speed: undefined"
    // because dispatch reads these fields in PascalCase / specific names that
    // the driver app never wrote. Write all variants so dispatch can find them
    // regardless of which casing convention it uses, and so a staleness-based
    // filter on any of those fields stops hiding the driver every 10–20 s.
    const hasFix     = lat !== 0 || lng !== 0;
    const speedKmh   = Math.max(0, lastSpeedStateValueRef.current || 0);

    // v22bd ROOT-CAUSE: job-state fields (jobpickup/jobdropoff/JobphoneNo/
    // jobCount/joboffer/currentJobId) are owned by the transition handlers
    // — acceptJob, startHailTrip, completeJob, _freeDriver — NOT the
    // heartbeat. Previously buildPresenceRecord included them with empty
    // defaults; the 10-second update() heartbeat then wiped whatever the
    // transition handlers had written within ~10s of hail/dispatch start,
    // so dispatch HQ's active-panel driver-row + map popup permanently
    // showed blank PASSENGER/PICK UP/DROP OFF/JOBS while the driver was Busy.
    // Now: only include those fields when status === 'Available' (idle) so
    // the heartbeat clears stale data when the driver goes free, but leaves
    // them untouched while a job is active.
    const isIdle = status === 'Available';
    const jobStateFields = isIdle
      ? { jobCount: 0, joboffer: 0, JobphoneNo: '', jobpickup: '', jobdropoff: '', currentJobId: '', currentTariffId: '', currentTariffName: '' }
      : {};

    return {
      // Driver & vehicle identity
      driverid:      driverIdValue,
      drivername:    driverName,
      vehiclenumber: rawVehicleId,      // callsign/plate shown on map
      VehicleId:     vehicleIdValue,    // matches the Firebase path key
      vehicletype:   vehicleType,       // dispatch zone-table requires this
      VehicleType:   vehicleType,       // v22ar: PascalCase mirror — dispatch popup reads this
      PlayerId:      playerId,          // Firebase auth UID — dispatch zone-table requires this
      // Online presence — dispatch board reads these for OFFLINE badge
      online:        true,
      lastSeen:      Date.now(),
      // Status
      // 22c cutover: server reads vehiclestatus and expects 'Picking' for
      // accepted-in-progress (server.js:7725, 9101). Translate at the FB
      // write boundary so local DriverStatus type can stay 'Assigned'.
      vehiclestatus: status === 'Assigned' ? 'Picking' : status,
      VehicleStatus: status === 'Assigned' ? 'Picking' : status,   // v22ar: PascalCase mirror
      // GPS — never write 0,0 if we have no fix; use a null-safe fallback
      // so the dispatch map doesn't filter the driver out or place them at sea
      lat: lat || 0,
      lng: lng || 0,
      Lat: lat || 0,                    // v22ar: PascalCase mirrors
      Lng: lng || 0,
      Latitude: lat || 0,
      Longitude: lng || 0,
      hasGps: hasFix,                    // extra flag for dispatch console filtering
      gpsStatus: hasFix ? 'OK' : 'No Fix',
      GpsStatus: hasFix ? 'OK' : 'No Fix',
      // Speed (km/h) — dispatch popup expects this
      vehicleSpeed: speedKmh,
      VehicleSpeed: speedKmh,
      Speed: speedKmh,
      // App version — dispatch popup expects this
      appVersion: APP_VERSION,
      AppVersion: APP_VERSION,
      time:          new Date().toISOString(),
      // Zone (defaults — dispatch system updates these)
      zonename:      '',
      zoneid:        0,
      zonequeue:     1,
      // Job state — only cleared on idle. See v22bd note above.
      ...jobStateFields,
      // Extra context — helps dispatch portal identify the driver
      CompanyId:     d?.companyId ?? '',
      Email:         d?.email ?? '',
      PhoneNo:       d?.phone ?? '',
    };
  };

  // Write driver presence to Firebase so the dispatch portal can see them.
  // Path: online/{companyId}/{vehicleId}/current
  // Accepts an explicit vehicleId so startShift can pass effectiveVehicleId
  // even when the driver state hasn't been updated yet.
  //
  // resetZone (default false): when true, overwrite zone fields with defaults
  // (used only on shift start so a fresh shift doesn't inherit a stale zone).
  // All mid-shift writes keep resetZone=false so dispatcher-assigned zone data
  // (zonename/zoneid/zonequeue) is preserved across status changes and heartbeats.
  const writeOnlinePresence = async (status: DriverStatus, overrideVehicleId?: string, resetZone = false) => {
    // Block all presence writes once sign-out has begun — prevents the Firebase
    // SDK reconnect event (fired after firebaseSignOut) from re-creating the node.
    if (signingOutRef.current) {
      console.log('[Presence] Blocked — sign-out in progress');
      return;
    }
    const d = driverRef.current;
    const vehicleId  = overrideVehicleId ?? d?.vehicleId ?? '';
    const companyId  = d?.companyId ?? '';
    console.log('[Presence] writeOnlinePresence — vehicleId:', vehicleId, 'companyId:', companyId, 'status:', status);
    if (!vehicleId || !companyId) {
      console.warn('[Presence] Skipped — missing vehicleId or companyId (vehicleId=' + vehicleId + ', companyId=' + companyId + ')');
      return;
    }
    try {
      const { lat, lng } = await getGps();
      const record = buildPresenceRecord(status, lat, lng, vehicleId);
      const presencePath = ref(database, `online/${companyId}/${vehicleId}/current`);
      // v22aq: onDisconnect now ONLY updates lastSeen, never online:false.
      // Mobile networks blip constantly — every WebSocket drop was firing
      // online:false, hiding the driver on dispatch for ~30s until the next
      // heartbeat re-asserted online:true. Result: the driver flapped
      // "shows → disappears → shows" every few seconds even on a stable
      // shift. Dispatch should detect true offline via lastSeen staleness
      // (>60s old). Sign-out still removes the record entirely, so a
      // signed-out driver does NOT linger as online:true.
      try {
        await onDisconnect(presencePath).update({ lastSeen: serverTimestamp() });
      } catch (odErr: any) {
        console.warn('[Presence] onDisconnect.update() failed (non-fatal):', odErr?.message);
      }
      if (resetZone) {
        await set(presencePath, record);
      } else {
        // update() preserves dispatcher-set zone fields (zonename/zoneid/zonequeue)
        const { zonename: _zn, zoneid: _zi, zonequeue: _zq, ...driverFields } = record;
        await update(presencePath, driverFields);
      }
      // v22at: REVERTED the 22as popup-field parent mirror. Writing extra
      // fields to the parent node `online/{cid}/{vid}` caused dispatch HQ to
      // render a SECOND driver row (one for /current, one for the parent) —
      // making things actively worse. The popup "undefined" fields are a
      // pre-existing dispatch-HQ display issue we can't fix from the driver
      // app without source access to dispatch HQ. Only `vehiclestatus` is
      // still mirrored to the parent at the very specific transition points
      // that need it (startShift, completeJob, acceptJob, _freeDriver).
      // (presence log removed — fires every 10s, contributes to JS-thread load)
    } catch (err: any) {
      console.warn('[Presence] writeOnlinePresence failed (non-fatal):', err?.message ?? err);
    }
  };

  const clearOnlinePresence = async () => {
    if (!driver?.vehicleId || !driver?.companyId) return;
    // Stop background location task on sign-out — releases the foreground
    // service notification and stops draining battery.
    stopBackgroundLocation().catch(() => {});
    const presencePath = ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`);
    // Block any further presence writes immediately — prevents the Firebase SDK
    // reconnect event (triggered by firebaseSignOut) from re-creating the node.
    signingOutRef.current = true;
    // Flag intentional self-removal so the presence-deletion watcher doesn't
    // interpret this as a dispatch kick.
    selfClearedPresenceRef.current = true;
    try {
      // Cancel the onDisconnect handler before the intentional delete
      await onDisconnect(presencePath).cancel();
      // Write online: false + lastSeen before removing so the dispatch board
      // briefly sees the driver go offline cleanly (not just disappear).
      await update(presencePath, { online: false, lastSeen: Date.now() }).catch(() => {});
      // Remove the entire vehicle node — not just /current — so the top-level
      // vehiclestatus field written by acceptJob/completeJob is also wiped.
      // Removing only /current leaves the parent node alive with a stale
      // vehiclestatus field, which keeps the driver visible on dispatcher HQ
      // even after sign-out.
      const vehicleNode = ref(database, `online/${driver.companyId}/${driver.vehicleId}`);
      await remove(vehicleNode);
      console.log('[SignOut] Cleared full vehicle node for', driver.vehicleId);
    } catch (err: any) {
      console.warn('[SignOut] clearOnlinePresence error (non-fatal):', err?.message ?? err);
    }
  };

  // ── Offline write-queue flush ────────────────────────────────────────────
  // Executes every write that was queued in AsyncStorage while the device had
  // no connectivity.  Called automatically when isOnline flips true.
  const flushQueue = async () => {
    const queue = await readQueue();
    if (queue.length === 0) return;
    console.log(`[OfflineQueue] Flushing ${queue.length} queued writes`);
    setIsSyncing(true);
    setPendingQueueCount(queue.length);
    const failed: QueuedWrite[] = [];
    for (const item of queue) {
      try {
        const r = ref(database, item.path);
        if (item.op === 'set')    await set(r, item.data ?? null);
        else if (item.op === 'update') await update(r, (item.data ?? {}) as Record<string, unknown>);
        else if (item.op === 'remove') await remove(r);
        else if (item.op === 'push')   await push(r, item.data ?? {});
        console.log(`[OfflineQueue] ✓ ${item.type} (${item.op}) @ ${item.path}`);
      } catch (e) {
        console.warn(`[OfflineQueue] ✗ ${item.type} (${item.op}) @ ${item.path}:`, e);
        failed.push(item);
      }
      setPendingQueueCount(prev => Math.max(0, prev - 1));
    }
    // Only discard items that succeeded — preserve failed ones for the next reconnect retry
    if (failed.length > 0) {
      await rewriteQueue(failed);
      console.log(`[OfflineQueue] ${failed.length} item(s) failed — retained for next retry`);
    } else {
      await clearQueue();
    }
    setIsSyncing(false);
    setPendingQueueCount(0);
    console.log('[OfflineQueue] Flush complete');
  };

  /** Persist rideStatus/{companyId}/{bookingId} with offline-queue fallback. */
  const writeRideStatusUpdate = (
    companyId: string,
    bookingId: string,
    data: Record<string, unknown>,
  ) => {
    const path = `rideStatus/${companyId}/${bookingId}`;
    if (isOnlineRef.current) {
      update(ref(database, path), data).catch((err) => {
        console.error('[rideStatus] update failed, enqueueing for retry:', path, err);
        enqueueWrite('jobStatus', path, 'update', data);
      });
    } else {
      enqueueWrite('jobStatus', path, 'update', data);
    }
  };

  // ── Network connectivity detection ───────────────────────────────────────
  // Uses expo-network to track real device connectivity (not just Firebase
  // WebSocket state).  When connectivity is restored, the queue is flushed.
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;

    const handleState = async (connected: boolean | null | undefined) => {
      // expo-network returns null/undefined on web and some native environments
      // even when the device IS connected.  Treat unknown as "assume online" so
      // we never falsely flash the offline banner just because the API is unsupported.
      const online = connected !== false;
      const wasOnline = isOnlineRef.current;
      isOnlineRef.current = online;
      setIsOnline(online);
      if (!wasOnline && online) {
        console.log('[Network] Connectivity restored — flushing offline queue');
        await flushQueue();
        // v22bj: also drain the sync-POST retry queue so any failed
        // /api/job/sync-offline-trip from the offline window catches up.
        drainSyncPostQueue().catch(() => {});
        // OTA22c (D4): drain the G2 job-command retry queue so any
        // accept/cancel/complete commands that failed during the offline
        // window get replayed against /api/job/command. Idempotent on
        // server side via clientRequestId.
        const _drv = driverRef.current;
        if (_drv?.passforlink) {
          drainJobCommandQueue(_drv.passforlink).catch(() => {});
        }
      } else if (!online) {
        console.log('[Network] Connectivity lost — entering offline mode');
      }
    };

    // Initial state check
    Network.getNetworkStateAsync()
      .then(s => handleState(s.isConnected))
      .catch(() => handleState(true)); // If check fails, assume online

    // Subscribe to changes
    try {
      subscription = Network.addNetworkStateListener(s => {
        handleState(s.isConnected);
      });
    } catch {
      // expo-network may not support listeners in all environments (web/Expo Go)
      // Fall back to polling every 10 seconds
      const poll = setInterval(() => {
        Network.getNetworkStateAsync()
          .then(s => handleState(s.isConnected))
          .catch(() => {});
      }, 10000);
      return () => clearInterval(poll);
    }

    return () => { subscription?.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Firebase .info/connected — always-on connectivity indicator ──────────
  // Sets isConnected as soon as Firebase WebSocket confirms the connection,
  // regardless of shift state. This prevents the "offline" banner appearing
  // on the Meter screen just because expo-network returns false on mobile data.
  useEffect(() => {
    const connRef = ref(database, '.info/connected');
    let lastConn: boolean | null = null;
    const unsub = onValue(connRef, (snap) => {
      const connected = snap.val() === true;
      // ota22c-cutover-c: breadcrumb every connectivity transition so we can
      // correlate stuck/zombie-listener incidents with socket lifetime.
      if (lastConn !== connected) {
        try { Sentry.addBreadcrumb({ category: 'fb-connected', level: connected ? 'info' : 'warning', message: connected ? 'connected' : 'disconnected', data: { t: Date.now() } }); } catch {}
        lastConn = connected;
      }
      setIsConnected(connected);
    });
    return () => off(connRef);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stale presence cleanup on login ──────────────────────────────────────
  // If a previous session ended without endShift (crash, force-quit, etc.),
  // the Firebase presence record stays "Available" and dispatch sees the driver
  // as online. Clear it to "Away" as soon as the driver loads with no active shift.
  useEffect(() => {
    if (!driver?.vehicleId || !driver?.companyId || shiftActive) return;
    const d = driverRef.current;
    if (!d?.vehicleId || !d?.companyId) return;
    // v22aa: do NOT write online:false here — this effect races the AsyncStorage
    // restore of shiftActive, and if shiftActive flips true AFTER this write the
    // heartbeat only patches lat/lng/time and leaves online:false stuck (dispatch
    // sees driver as offline indefinitely even though app shows Available).
    // Only mark the previous session's status as Away — onDisconnect already
    // handled the online flag when that session's websocket closed.
    // v22ad: also patch TOP-LEVEL vehiclestatus so dispatcher's fast-path read
    // (per README invariant) sees Away too — not just /current/. And use
    // numeric lastSeen for consistency with every other write (was ISO string
    // in 22aa, mismatched type vs heartbeat/buildPresenceRecord).
    update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
      vehiclestatus: 'Away',
      lastSeen: Date.now(),
    }).catch(() => {});
    // v22am: REMOVED top-level Away write here. Dispatch reads top-level
    // vehiclestatus for fast-path classification. Writing Away to top-level
    // on every sign-in (before user has even tapped Start Shift) created a
    // bad state that lingered if startShift's Available write raced or if
    // the heartbeat's Away-recovery branch (which only patches /current/)
    // missed it. The /current/ Away write above is sufficient — when the
    // user taps Start Shift, startShift's writeOnlinePresence + top-level
    // Available update will overwrite both paths.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.id]); // Run once per login — driver?.id changes when auth resolves

  // ── Firebase reconnect handler ────────────────────────────────────────────
  // Firebase marks .info/connected false whenever the web-socket drops, then
  // true when it restores. We re-write our full presence record on every
  // reconnect so the dispatch map always shows this driver — even after a
  // brief network blip.
  useEffect(() => {
    if (!shiftActive) return;

    let mounted = true;
    let skipFirst = true; // the listener fires immediately on attach — skip it
    //  (we already wrote presence in startShift)

    const connRef = ref(database, '.info/connected');
    const unsub = onValue(connRef, async (snap) => {
      if (skipFirst) { skipFirst = false; return; }
      if (!mounted) return;
      if (snap.val() !== true) {
        console.log('[Presence] Firebase disconnected — onDisconnect will mark Away');
        return;
      }

      // OTA22c (architect HIGH#2): also drain the G2 job-command queue on
      // Firebase reconnect. expo-network's offline→online edge can miss
      // brief Firebase websocket flaps that still strand queued commands.
      const _drvCmd = driverRef.current;
      if (_drvCmd?.passforlink) {
        drainJobCommandQueue(_drvCmd.passforlink).catch(() => {});
      }

      // ── 22bp (G6) — reconnect rebuild ───────────────────────────────────
      // Firebase websocket just restored. While we were offline, dispatch
      // may have offered, edited, cancelled or reassigned bookings — and
      // any of those events can have been dropped (no buffered onValue
      // replay for events that landed and unwound while we were down).
      // Call the new `/api/driver/active-bookings` endpoint to get the
      // authoritative list and reconcile local `jobs[]`. Server derives
      // companyId + vehicleId from the X-User-Key (driver.passforlink)
      // header — never pass cid/vid as query params.
      const drcRec = driverRef.current;
      if (drcRec?.passforlink) {
        fetchActiveBookings(drcRec.passforlink).then(resp => {
          if (!resp || !mounted) return;
          console.log('[Reconcile] Active bookings from server:', resp.bookings.length);
          const serverIds = new Set(resp.bookings.map(b => b.bookingId));
          // Mark server-side versions immediately so subsequent listener fires
          // don't re-process events we already know about.
          for (const b of resp.bookings) {
            markBookingVersion(b.bookingId, b.version, b.updatedAt);
          }
          setJobs(prev => {
            // Drop local rows that no longer exist on the server (orphans
            // from a missed cancel/reassign event). Preserve hail trips
            // (no bookingId on a hail trip, OR bookingId starts with HAIL).
            const filtered = prev.filter(j => {
              if (!j.bookingId) return true;
              if (j.status === 'current' && meterRunningRef.current) return true; // never drop live trip
              return serverIds.has(j.bookingId);
            });
            // Patch field changes by version on rows we still hold.
            const patched: Job[] = filtered.map(j => {
              const b = resp.bookings.find(x => x.bookingId === j.bookingId);
              if (!b) return j;
              const updated: Job = {
                ...j,
                passengerName:  b.passengerName  ?? j.passengerName,
                passengerPhone: b.passengerPhone ?? j.passengerPhone,
                pickupAddress:  b.pickupAddress  ?? j.pickupAddress,
                dropAddress:    b.dropAddress    ?? j.dropAddress,
                fare:           typeof b.fare === 'number' ? b.fare : j.fare,
                notes:          b.notes ?? j.notes,
                paymentType:    b.paymentType ? parsePaymentType(b.paymentType) : j.paymentType,
                passengers:     typeof b.passengers === 'number' ? b.passengers : j.passengers,
              };
              return updated;
            });
            return patched;
          });
          // If the active-trip row vanished server-side, also clear the
          // offer modal so a stale popup doesn't linger.
          setIncomingJob(prev => (prev && !serverIds.has(prev.bookingId ?? '') ? null : prev));
        }).catch(() => {});
      }

      // Re-connected — re-write full presence with whatever the current status is,
      // but don't downgrade if another instance (web preview) set a higher-priority status.
      const d = driverRef.current;
      if (!d?.vehicleId || !d?.companyId) return;
      const localStatus = statusRef.current;
      console.log('[Presence] Firebase reconnected — re-writing presence for', d.vehicleId, '| local:', localStatus);
      const STATUS_LEVEL: Record<string, number> = { Away: 0, Available: 1, Assigned: 2, Busy: 3 };
      try {
        const presSnap = await get(ref(database, `online/${d.companyId}/${d.vehicleId}/current`));
        const remoteStatus: string = presSnap.val()?.vehiclestatus ?? 'Available';
        if ((STATUS_LEVEL[remoteStatus] ?? 1) > (STATUS_LEVEL[localStatus] ?? 1)) {
          console.log('[Presence] Reconnect: skipping downgrade — Firebase has', remoteStatus, 'local is', localStatus);
          const { lat, lng } = await getGps();
          update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
            lat, lng, hasGps: lat !== 0 || lng !== 0, time: new Date().toISOString(),
            // v22ap: also re-assert online:true on reconnect even when we're
            // skipping a status downgrade. Without this, a mid-trip reconnect
            // (Assigned/Busy) left online:false stuck from the onDisconnect
            // handler, hiding the driver from dispatch until the 30s heartbeat.
            online: true,
            lastSeen: serverTimestamp(),
          }).catch(() => {});
          return;
        }
      } catch { /* read failed — fall through */ }
      await writeOnlinePresence(localStatus, d.vehicleId);
      // Reconnected — try to upload any pending offline trips immediately
      runPendingUpload().catch(() => {});
      // Also check whether a prior crash left an unfinished job on the server
      runResumeCheck().catch(() => {});
    });

    return () => {
      mounted = false;
      unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive]);

  // ── Presence-deletion watcher ────────────────────────────────────────────
  // If dispatch DELETES the driver's online/current node (vs just setting Away),
  // it means the dispatcher kicked them from the system.
  // The driver's own intentional removes (endShift, signOut) set
  // selfClearedPresenceRef.current = true so we skip those.
  //
  // IMPORTANT: Dispatch consoles sometimes delete+re-create the presence node
  // as part of normal job assignment or zone changes. We use a 6-second debounce:
  // if the node re-appears within 6s it was just a re-write, NOT a kick.
  useEffect(() => {
    if (!shiftActive || !driver?.companyId || !driver?.vehicleId) return;

    const ownPresence = ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`);
    let skipFirst = true;
    let kickTimer: ReturnType<typeof setTimeout> | null = null;

    const unsub = onValue(ownPresence, (snap) => { markSyncBlock('ownPresence');
      if (skipFirst) { skipFirst = false; return; }

      if (snap.exists()) {
        // Presence re-written — cancel any pending kick timer, reset self-clear flag
        if (kickTimer) { clearTimeout(kickTimer); kickTimer = null; }
        selfClearedPresenceRef.current = false;
        return;
      }

      // Node was deleted
      if (selfClearedPresenceRef.current) {
        selfClearedPresenceRef.current = false;
        if (kickTimer) { clearTimeout(kickTimer); kickTimer = null; }
        return; // driver did this themselves
      }
      // v22s: hail-completion deadline window — independent of the boolean
      // above so it survives any snap.exists() resets that happen during
      // the brief delete/recreate churn at the end of a hail trip.
      if (Date.now() < presenceKickSuppressUntilRef.current) {
        if (kickTimer) { clearTimeout(kickTimer); kickTimer = null; }
        console.log('[Presence] Suppressing kick — within hail-completion window');
        return;
      }

      // Node deleted by someone else while shift is active.
      // Wait 6 seconds — if the node comes back it was just a dispatch re-write.
      console.log('[Presence] Online node deleted externally — starting 6s kick debounce');
      kickTimer = setTimeout(() => {
        kickTimer = null;
        // Re-check if node has come back
        const d = driverRef.current;
        if (!d?.companyId || !d?.vehicleId) return;
        get(ref(database, `online/${d.companyId}/${d.vehicleId}/current`)).then(async (check) => {
          if (check.exists()) {
            console.log('[Presence] Node came back within 6s — not a kick, resuming');
            return;
          }
          // v22al: NEVER kick a driver mid-trip. If the meter is running, a
          // hail trip is in progress, or there's a current/queued job on the
          // jobs list, treat the external delete as a phantom (Firebase
          // reconnect blip, SA portal auto-cleanup race) and immediately
          // re-write our presence to revive the node. This matches the
          // existing mid-trip guard on the notification kick path (~line 2042)
          // — the presence watcher was missing the same protection, which is
          // why driver kept getting the "Removed from System" alert mid-trip
          // even though their notification kick was being correctly ignored.
          const hasActiveTrip = meterRunningRef.current ||
            !!hailTripMetaRef.current ||
            latestJobsRef.current.some(j => j.status === 'current' || j.status === 'queued');
          if (hasActiveTrip) {
            console.log('[Presence] External delete during active trip — re-asserting presence, NOT kicking');
            try {
              await writeOnlinePresence(statusRef.current, d.vehicleId);
              await update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
                vehiclestatus: statusRef.current === 'Available' ? 'Picking' : statusRef.current, // 22c cutover
              });
            } catch (err) {
              console.warn('[Presence] Re-assert during trip failed:', err);
            }
            return;
          }
          // Still gone after 6 seconds AND no active trip — this is a real kick
          console.log('[Presence] Kick confirmed after 6s debounce');
          setJobs([]);
          setIncomingJob(null);
          stopMeter();
          setSystemAlert({
            id: Date.now(),
            type: 'kicked',
            title: 'Removed from System',
            message: 'You have been removed from the system by dispatch. Please start shift again.',
          });
        }).catch(() => {});
      }, 6000);
    });

    return () => {
      off(ownPresence);
      if (kickTimer) { clearTimeout(kickTimer); kickTimer = null; }
    };
  }, [shiftActive, driver?.companyId, driver?.vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dispatch-console suspension watcher ──────────────────────────────────
  // Dispatch writes { type, message, suspendedUntil, suspendedBy, timestamp }
  // to suspended/{companyId}/{vehicleId}.
  // Active while the driver is logged in (not just on shift) so they can be
  // suspended before starting a shift or mid-shift.
  // When the node is deleted (Restore button pressed) the listener fires with
  // snap.exists() === false — driver is immediately unlocked.
  useEffect(() => {
    if (!driver?.companyId || !driver?.vehicleId) return;

    const suspPath = ref(database, `suspended/${driver.companyId}/${driver.vehicleId}`);

    const unsub = onValue(suspPath, (snap) => {
      if (!snap.exists()) return; // No record or was just deleted (restored) — do nothing

      const susp = snap.val() as { type?: string; message?: string; suspendedUntil?: string | null };
      if (susp.type !== 'suspended') return;

      // Check whether the suspension window has already passed
      const isExpired = susp.suspendedUntil != null && new Date(susp.suspendedUntil) <= new Date();
      if (isExpired) return;

      // Active suspension detected — clear presence + jobs + show alert
      const d = driverRef.current;
      if (d?.companyId && d?.vehicleId) {
        selfClearedPresenceRef.current = true;
        remove(ref(database, `online/${d.companyId}/${d.vehicleId}/current`)).catch(() => {});
      }
      setJobs([]);
      setIncomingJob(null);
      stopMeter();
      setSystemAlert({
        id: Date.now(),
        type: 'suspended',
        title: 'Account Suspended',
        message: susp.message || 'Your account has been suspended. Please contact your dispatcher.',
      });
    });

    return () => { off(suspPath); };
  }, [driver?.companyId, driver?.vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Presence heartbeat ─────────────────────────────────────────────────────
  // Re-writes the driver's presence every 30 s while on shift.
  // This ensures a brief network blip (which triggers the Firebase onDisconnect
  // 'Away' handler) is quickly corrected — the driver never stays 'Away' for
  // more than ~30 s while the app is open and the shift is active.
  useEffect(() => {
    if (!shiftActive) return;
    const INTERVAL_MS = 30_000;
    // v22am: Fire one heartbeat immediately on shift start so any stale
    // top-level vehiclestatus = Away (from previous session, OTA reload,
    // stale-cleanup race) is corrected within ~1-2 seconds of Start Shift,
    // not 30 s later. The 30 s interval below then keeps it correct.
    const runHeartbeat = async () => {
      const d = driverRef.current;
      if (!d?.vehicleId || !d?.companyId) return;
      const localStatus = statusRef.current;
      if (localStatus === 'Away') return;
      try {
        const snap = await get(ref(database, `online/${d.companyId}/${d.vehicleId}/current`));
        const remoteStatus: string = snap.val()?.vehiclestatus ?? localStatus;
        if (remoteStatus === 'Away') {
          console.log('[Heartbeat:immediate] Firebase shows Away — restoring', localStatus);
          await writeOnlinePresence(localStatus, d.vehicleId);
          if (localStatus === 'Available') {
            update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
              vehiclestatus: 'Available',
            }).catch(() => {});
          }
        } else if (localStatus === 'Available') {
          // Always re-assert top-level Available on shift start.
          update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
            vehiclestatus: 'Available',
          }).catch(() => {});
        }
      } catch { /* ignore */ }
    };
    runHeartbeat();
    const id = setInterval(async () => {
      const d = driverRef.current;
      if (!d?.vehicleId || !d?.companyId) return;
      const localStatus = statusRef.current;
      if (localStatus === 'Away') return; // shift ended — don't re-write
      try {
        // Only do a full set() when Firebase shows 'Away' (from a blip).
        // Otherwise just patch GPS to keep the location fresh.
        const snap = await get(ref(database, `online/${d.companyId}/${d.vehicleId}/current`));
        const remoteStatus: string = snap.val()?.vehiclestatus ?? localStatus;
        if (remoteStatus === 'Away') {
          console.log('[Heartbeat] Firebase shows Away — restoring', localStatus);
          await writeOnlinePresence(localStatus, d.vehicleId);
          // v22am: writeOnlinePresence only touches /current/. Dispatch HQ
          // reads TOP-LEVEL vehiclestatus for its fast-path. If top-level is
          // stuck on Away (from the stale-cleanup effect, a crash, or an
          // OTA reload race), dispatch keeps showing the driver as Away
          // even after /current/ has been restored. Force top-level back
          // to localStatus here too, so a stuck Away self-heals within 30 s.
          if (localStatus === 'Available') {
            update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
              vehiclestatus: 'Available',
            }).catch(() => {});
          }
        } else {
          // v22aa: also re-assert online:true + lastSeen every heartbeat so a
          // stuck online:false (from on-login cleanup, onDisconnect blip, or a
          // racey write) self-heals within 30 s instead of leaving the driver
          // invisible to dispatch indefinitely.
          // v22ad: ALSO re-assert top-level vehiclestatus = localStatus every
          // heartbeat (only when localStatus is Available — Assigned/Busy are
          // owned by acceptJob/completeJob and must not be clobbered). This
          // fixes the case where a previous-session crash left top-level
          // stale (e.g. "Assigned" from a job that never completed cleanly)
          // and dispatcher kept classifying the driver as Away despite
          // current/vehiclestatus being Available.
          const { lat, lng } = await getGps();
          update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
            lat, lng, hasGps: lat !== 0 || lng !== 0,
            time: new Date().toISOString(),
            online: true,
            lastSeen: Date.now(),
          }).catch(() => {});
          if (localStatus === 'Available') {
            update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
              vehiclestatus: 'Available',
            }).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    }, INTERVAL_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive]);

  // ── Pending offline-trip upload retry ─────────────────────────────────────
  // While on shift and there are pending trips, retry upload every 60 s.
  // Stopped cleanly when the shift ends or all trips are uploaded.
  useEffect(() => {
    if (!shiftActive) return;
    // Initial check on shift start
    refreshPendingUploadCount().catch(() => {});
    cleanOldTrips().catch(() => {});
    const id = setInterval(() => {
      if (pendingUploadCount > 0) runPendingUpload().catch(() => {});
      // v22bj: drain dispatch sync-POST retry queue every 60s while on shift
      drainSyncPostQueue().catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, pendingUploadCount]);

  // Silent presence refresh when app comes back from background.
  // Guard: if Firebase shows a higher-priority status than local (set by the phone instance
  // while the web preview was in background), only patch GPS — don't overwrite Assigned/Busy
  // with Available. This prevents two simultaneously-running instances from fighting.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active') return;
      // v22bj: drain dispatch sync-POST retry queue on every foreground resume
      drainSyncPostQueue().catch(() => {});
      // OTA22c (architect HIGH#2): also drain the G2 job-command queue on
      // foreground resume so commands stranded across an app-background
      // window get retried as soon as the driver opens the app.
      const _drvCmdFg = driverRef.current;
      if (_drvCmdFg?.passforlink) {
        drainJobCommandQueue(_drvCmdFg.passforlink).catch(() => {});
      }
      const d = driverRef.current;
      if (!d?.vehicleId || !d?.companyId || !shiftActive) return;
      const localStatus = statusRef.current;
      console.log('[Presence] App resumed — refreshing presence for', d.vehicleId, '| local:', localStatus);
      const STATUS_LEVEL: Record<string, number> = { Away: 0, Available: 1, Assigned: 2, Busy: 3 };
      try {
        const snap = await get(ref(database, `online/${d.companyId}/${d.vehicleId}/current`));
        const remoteStatus: string = snap.val()?.vehiclestatus ?? 'Available';
        if ((STATUS_LEVEL[remoteStatus] ?? 1) > (STATUS_LEVEL[localStatus] ?? 1)) {
          console.log('[Presence] Resume: skipping downgrade — Firebase has', remoteStatus, 'local is', localStatus);
          const { lat, lng } = await getGps();
          update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
            lat, lng, hasGps: lat !== 0 || lng !== 0, time: new Date().toISOString(),
          }).catch(() => {});
          return;
        }
      } catch { /* read failed — fall through to normal write */ }
      await writeOnlinePresence(localStatus, d.vehicleId);
    });
    return () => subscription.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive]);

  const startShift = async () => {
    console.log('[Shift] startShift called — driver:', driver?.id, 'vehicleId:', driver?.vehicleId, 'companyId:', driver?.companyId);
    // Re-enable presence writes for this new shift (may have been blocked by previous sign-out)
    signingOutRef.current = false;

    if (!driver) return;

    // Block deactivated drivers from starting a shift
    if (driver.active === false) {
      Alert.alert(
        'Account Deactivated',
        'Your account has been deactivated by your administrator. You cannot start a shift until it is reactivated. Please contact your fleet manager.',
      );
      return;
    }

    // NZ compliance: check rest period rules before allowing shift start
    const complianceResult = checkShiftStartCompliance(
      lastShiftEndMsRef.current,
      weeklyWorkMinutesRef.current,
      dailyWorkMinutesRef.current,
    );
    if (complianceResult.blocked) {
      Alert.alert('Cannot Start Shift', complianceResult.reason);
      return;
    }

    // Always do a fresh Firebase read of the driver's vehicleId.
    // Onboarding updates Firebase THEN calls startShift immediately — the React
    // state listener hasn't propagated the new vehicleId yet, so driver.vehicleId
    // is stale. Reading directly from Firebase guarantees we use the correct vehicle.
    let effectiveVehicleId = driver.vehicleId;
    if (driver.companyId && driver.uid) {
      try {
        const snap = await get(ref(database, `drivers/${driver.companyId}/${driver.uid}`));
        if (snap.exists()) {
          const fresh = snap.val()?.vehicleId ?? '';
          if (fresh) {
            effectiveVehicleId = fresh;
            console.log('[Shift] Fresh vehicleId from Firebase:', effectiveVehicleId);
          }
        }
      } catch (err) {
        console.warn('[Shift] Firebase profile re-read failed, using local state:', err);
      }
    }

    if (!effectiveVehicleId) {
      Alert.alert(
        'Vehicle Number Required',
        'You need to set your Vehicle / Taxi Number before starting your shift.\n\nGo to the Profile tab and tap "Vehicle / Taxi Number" to set it.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Block shift start if another driver is already signed on to this vehicle.
    if (driver.companyId && !shiftActive) {
      try {
        const snap = await get(ref(database, `online/${driver.companyId}/${effectiveVehicleId}/current`));
        if (snap.exists()) {
          const data = snap.val();
          const existingDriverId = String(data?.driverid ?? '');
          const myDriverId = String(driver.id ?? '');
          // Only block if it's a DIFFERENT driver actively on shift
          if (existingDriverId && existingDriverId !== myDriverId) {
            const existingName = data?.drivername ?? existingDriverId;
            Alert.alert(
              'Vehicle Already In Use',
              `${effectiveVehicleId} is currently on shift with driver ${existingName}.\n\nContact dispatch if this is incorrect.`,
              [{ text: 'OK' }]
            );
            console.warn('[Shift] Blocked — vehicle in use by:', existingDriverId, existingName);
            return;
          }
        }
      } catch (err) {
        console.warn('[Shift] Vehicle-in-use check failed (non-blocking):', err);
        // Don't block shift start if the check itself fails (offline, etc.)
      }
    }

    // Only create a new shift record if one isn't already running.
    // When the driver returns from background, onboarding calls startShift again
    // just to re-write Firebase presence — we must not overwrite their existing
    // start time or earnings in that case.
    if (!shiftActive || !currentShift) {
      const now = new Date();
      const newShiftLogId = `${driver.id}-${now.getTime()}`;
      shiftLogIdRef.current = newShiftLogId;
      setShiftLogId(newShiftLogId);
      const shift: ShiftRecord = {
        id: `shift-${Date.now()}`,
        date: fmtNZDate(now),
        startTime: fmtNZTime(now),
        startMs: now.getTime(),
        earnings: 0,
        jobCount: 0,
        shiftLogId: newShiftLogId,
      };
      setCurrentShift(shift);
      setShiftActive(true);
      setStatusState('Available');
      // Reset break tracking for new shift
      todayBreakMsRef.current = 0;
      setTodayBreakMs(0);
      warningFiredRef.current.clear();
      // Write shift start to Firebase shiftLogs for NZ compliance reporting
      if (driver.companyId) {
        const shiftLogPayload: Record<string, unknown> = {
          startTs: now.getTime(),
          endTs: null,
          isActive: true,
          driverId: driver.id,
          vehicleId: effectiveVehicleId,
          breakMin: 0,
          startTime: now.toISOString(),
          status: 'active',
          driverName: driver.name ?? driver.id ?? '',
        };
        const shiftLogPath = `shiftLogs/${driver.companyId}/${driver.id}/${newShiftLogId}`;
        // v12-ota22j: removed the misleading "You are offline" Alert.
        // expo-network on Android sometimes returns isConnected:false even
        // with full LTE signal — the alert was firing on perfectly online
        // devices, scaring the driver. The OfflineBanner already shows
        // connection state; we don't need a modal interruption at shift start.
        // The queue handles offline writes silently regardless.
        if (isOnlineRef.current && isConnectedRef.current) {
          set(ref(database, shiftLogPath), shiftLogPayload).catch(() => {
            enqueueWrite('generic', shiftLogPath, 'set', shiftLogPayload);
          });
        } else {
          enqueueWrite('generic', shiftLogPath, 'set', shiftLogPayload);
        }
      }
    } else {
      console.log('[Shift] Already on shift — refreshing presence only (app resume)');
    }

    // Write directly to Firebase — dispatch portal reads from here.
    // Pass effectiveVehicleId explicitly in case it was re-fetched above and
    // the driver state object hasn't updated yet (avoids silent skip).
    // resetZone=true: start of shift always resets zone position to defaults
    // so the dispatcher assigns the driver to the correct zone fresh.
    // v22ak: writeOnlinePresence only touches /current/.vehiclestatus.
    // Dispatch board reads the TOP-LEVEL online/{cid}/{vid}/vehiclestatus
    // field. Without an explicit top-level write here, that field keeps the
    // previous value ('Away' from a backgrounded session, or 'Offline' from
    // last endShift) and dispatch sees the driver as Away even though the
    // driver app shows On Shift / Available — which then trips the SA portal's
    // "inactive driver" auto-cleanup, deleting the online node and surfacing
    // the "Removed from System" alert the driver reported.
    //
    // The 22ag version of this fix used three setTimeouts (t+0/+3s/+10s) and
    // a synchronous statusRef mutation, which I incorrectly blamed for the
    // crash on Start Shift — the actual "crash" was the OTA reloadAsync,
    // confirmed once the driver got past it. So 22ak restores the fix as
    // ONE clean awaited update() with no setTimeouts, no extra refs.
    try {
      await writeOnlinePresence('Available', effectiveVehicleId, true);
    } catch (err) {
      console.warn('[Shift] Firebase presence write failed:', err);
    }
    try {
      await update(
        ref(database, `online/${driver.companyId}/${effectiveVehicleId}`),
        { vehiclestatus: 'Available' },
      );
      console.log('[Shift] Top-level vehiclestatus=Available written');
    } catch (err: any) {
      console.warn('[Shift] Top-level vehiclestatus write failed:', err?.message ?? err);
    }

    // Start background-location task so the meter and GPS keep flowing while
    // the screen is off. Requires a custom dev build with expo-task-manager —
    // silently no-ops in Expo Go / web. Foreground service notification keeps
    // the OS from killing the task on Android. Driver must grant "Always allow"
    // on iOS / "Allow all the time" on Android — first-shift prompt handled here.
    // Background-location task DISABLED on low-end Android (Galaxy A04 / 3 GB RAM)
    // — the foreground service + extra GPS stream + Firebase writes were pushing
    // the OS into killing the app under memory pressure. The AppState wall-clock
    // correction in the meter useEffect already keeps trip time accurate when the
    // screen is off; only live dispatch GPS pauses while screen is locked.
    // Re-enable per-device after benchmarking on higher-RAM phones.
    // if (driver.companyId && effectiveVehicleId && driver.id) {
    //   startBackgroundLocation({ companyId: driver.companyId, vehicleId: effectiveVehicleId, driverId: driver.id });
    // }

    // Stamp this driver as the current operator of this vehicle so other drivers
    // see it as claimed even when this driver is off-shift between jobs.
    if (driver.companyId && effectiveVehicleId) {
      update(ref(database, `vehicles/${driver.companyId}/${effectiveVehicleId}`), {
        currentDriverId:   driver.id ?? '',
        currentDriverName: driver.name ?? driver.id ?? '',
      }).catch(() => {});
      console.log('[Shift] Vehicle claim stamped:', effectiveVehicleId, '→', driver.id);
    }

    // 22c cutover (server-dev Q6): jobs/ remove on shift start deleted —
    // server's _maybeRestoreDriverState + shift-end / disconnect handlers
    // clean abandoned bookings via the SOT pass (server.js:7026).

    // Check server for any unfinished job from a previous crash (non-blocking).
    runResumeCheck().catch(() => {});

    // Also try the REST API (best-effort, won't block if unavailable)
    const shiftNow = new Date();
    dispatchPost({
      Action: 'FnServiceON',
      Parms: [
        `DriverId,,${driver.id}`,
        `CompanyId,,${driver.companyId}`,
        `VehicleId,,${effectiveVehicleId}`,
        `Status,,Available`,
        `LogInDate,,${fmtNZDate(shiftNow)}`,
        `LogInTime,,${fmtNZTime(shiftNow)}`,
      ].join('&&'),
      UserKey: driver.passforlink,
    }).catch(err => console.warn('[Shift] FnServiceON (non-blocking):', err?.message));
  };

  const endShift = async () => {
    // Block ending shift if a ride is currently active
    const hasActiveRide = latestJobsRef.current.some(j => j.status === 'current') ||
      meterRunningRef.current;
    if (hasActiveRide) {
      Alert.alert(
        'Active Ride in Progress',
        'You cannot end your shift while a ride is in progress. Please complete the current ride first.',
      );
      return;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (currentShift) {
      const ended: ShiftRecord = {
        ...currentShift,
        endTime: fmtNZTime(new Date()),
        endMs: nowMs,
        earnings: completedJobs.reduce((sum, j) => sum + j.fare, 0),
        jobCount: completedJobs.length,
        breakMinutes: Math.floor(todayBreakMsRef.current / 60000),
      };
      setShiftHistory(prev => [ended, ...prev]);

      // Write shift-end record to Firebase shiftLogs for NZ compliance
      if (driver && shiftLogIdRef.current && driver.companyId) {
        const breakMs = todayBreakMsRef.current +
          (breakStartMsRef.current ? nowMs - breakStartMsRef.current : 0);
        const totalMinutes = currentShift.startMs
          ? Math.max(0, Math.floor((nowMs - currentShift.startMs - breakMs) / 60000))
          : 0;
        const breakMin = Math.floor(breakMs / 60000);
        const shiftLogPath = `shiftLogs/${driver.companyId}/${driver.id}/${shiftLogIdRef.current}`;
        const endPayload: Record<string, unknown> = {
          endTs: nowMs,
          isActive: false,
          breakMin,
          endTime: nowIso,
          status: 'completed',
          totalMinutes,
          breakMinutes: breakMin,
        };
        if (isOnlineRef.current) {
          update(ref(database, shiftLogPath), endPayload).catch(() => {
            enqueueWrite('generic', shiftLogPath, 'update', endPayload);
          });
          set(ref(database, `lastshifttime/${driver.id}`), nowIso).catch(() => {});
        } else {
          enqueueWrite('generic', shiftLogPath, 'update', endPayload);
        }
        // Update local compliance state immediately
        lastShiftEndMsRef.current = nowMs;
        weeklyWorkMinutesRef.current += totalMinutes;
        dailyWorkMinutesRef.current += totalMinutes;
        setLastShiftEndMs(nowMs);
        setWeeklyWorkMinutes(prev => prev + totalMinutes);
        setDailyWorkMinutes(prev => prev + totalMinutes);
      }
    }

    // Reset break + compliance tracking
    breakActiveRef.current = false;
    breakStartMsRef.current = null;
    setBreakActive(false);
    setBreakStartMs(null);
    setTodayBreakMs(0);
    todayBreakMsRef.current = 0;
    shiftLogIdRef.current = null;
    setShiftLogId(null);
    warningFiredRef.current.clear();

    setCurrentShift(null);
    setShiftActive(false);
    setStatusState('Away');

    if (!driver) return;

    // Stop the background location task — meter is no longer running and the
    // OS foreground-service notification should disappear immediately on
    // shift end.
    stopBackgroundLocation().catch(() => {});

    // Cancel any pending job onDisconnect handlers before clearing presence
    await cancelJobOnDisconnects();

    // Remove from Firebase so dispatch portal sees driver as offline.
    // NOTE: We deliberately do NOT call clearOnlinePresence() here — that function
    // is for sign-out only and sets signingOutRef=true which would permanently block
    // writeOnlinePresence for the rest of the session, preventing the driver from
    // starting a new shift without restarting the app.
    try {
      const presencePath = ref(database, `online/${driver.companyId}/${driver.vehicleId}/current`);
      selfClearedPresenceRef.current = true; // prevent kick-detection watcher from firing
      await onDisconnect(presencePath).cancel();
      await update(presencePath, { online: false, lastSeen: Date.now() }).catch(() => {});
      await remove(presencePath);
      console.log('[Shift] Presence node removed for', driver.vehicleId);
    } catch (err) {
      console.warn('[Shift] Firebase presence clear failed:', err);
    }

    // 22c cutover (server-dev Q6): jobs/ remove on shift end deleted —
    // server reconciles abandoned bookings via SOT pass.

    // Release the vehicle claim so other drivers can use this vehicle.
    // Only clear if WE are still the stamped driver — don't erase another
    // driver's claim if the vehicle was reassigned mid-shift.
    if (driver.companyId && driver.vehicleId) {
      get(ref(database, `vehicles/${driver.companyId}/${driver.vehicleId}/currentDriverId`))
        .then(snap => {
          if (snap.val() === driver.id) {
            update(ref(database, `vehicles/${driver.companyId!}/${driver.vehicleId!}`), {
              currentDriverId: null,
              currentDriverName: null,
            }).catch(() => {});
            console.log('[Shift] Vehicle claim released:', driver.vehicleId);
          }
        })
        .catch(() => {});
    }

    // Also try the REST API (best-effort)
    dispatchPost({
      Action: 'FnServiceOFF',
      Parms: [
        `DriverId,,${driver.id}`,
        `CompanyId,,${driver.companyId}`,
        `VehicleId,,${driver.vehicleId}`,
      ].join('&&'),
      UserKey: driver.passforlink,
    }).catch(err => console.warn('[Shift] FnServiceOFF (non-blocking):', err?.message));
  };

  // ── NZ compliance: break tracking ────────────────────────────────────────
  const startBreak = () => {
    if (!shiftActive || breakActiveRef.current) return;
    const now = Date.now();
    breakActiveRef.current = true;
    breakStartMsRef.current = now;
    setBreakActive(true);
    setBreakStartMs(now);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const d = driverRef.current;
    const logId = shiftLogIdRef.current;
    if (d?.companyId && d?.id && logId) {
      const breakId = `break-${now}`;
      const breakPath = `shiftLogs/${d.companyId}/${d.id}/${logId}/breaks/${breakId}`;
      const payload: Record<string, unknown> = { breakStart: new Date(now).toISOString() };
      if (isOnlineRef.current) {
        set(ref(database, breakPath), payload).catch(() => {
          enqueueWrite('generic', breakPath, 'set', payload);
        });
      } else {
        enqueueWrite('generic', breakPath, 'set', payload);
      }
    }
  };

  const endBreak = () => {
    const startMs = breakStartMsRef.current;
    if (!shiftActive || !breakActiveRef.current || startMs === null) return;
    const now = Date.now();
    const durationMs = now - startMs;
    todayBreakMsRef.current += durationMs;
    breakActiveRef.current = false;
    breakStartMsRef.current = null;
    setBreakActive(false);
    setBreakStartMs(null);
    setTodayBreakMs(todayBreakMsRef.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const d = driverRef.current;
    const logId = shiftLogIdRef.current;
    if (d?.companyId && d?.id && logId) {
      const breakId = `break-${startMs}`;
      const breakPath = `shiftLogs/${d.companyId}/${d.id}/${logId}/breaks/${breakId}`;
      const payload: Record<string, unknown> = {
        breakEnd: new Date(now).toISOString(),
        breakMinutes: Math.max(1, Math.round(durationMs / 60000)),
      };
      if (isOnlineRef.current) {
        update(ref(database, breakPath), payload).catch(() => {
          enqueueWrite('generic', breakPath, 'update', payload);
        });
      } else {
        enqueueWrite('generic', breakPath, 'update', payload);
      }
    }
  };

  // Get a clean display name — prefer real name, fall back to email local-part or vehicle ID
  const getDisplayName = (): string => {
    if (driver?.name && !driver.name.includes('@')) return driver.name;
    if (driver?.name && driver.name.includes('@')) return driver.name.split('@')[0];
    if (driver?.vehicleId) return `Driver ${driver.vehicleId}`;
    return 'Driver';
  };

  const sendChatMessage = async (threadId: string, body: string) => {
    const d = driverRef.current;
    if (!d) return;

    const now = new Date();
    const dateTimeStr = now.toISOString();   // ISO 8601 — safe to parse on all platforms
    const displayName = getDisplayName();
    const optimisticId = `local-${Date.now()}`;

    // 1. Optimistic update — driver sees their own message instantly, no round-trip wait
    const optimisticMsg: ChatMessage = {
      id:         optimisticId,
      senderId:   d.id,
      senderName: displayName,
      body,
      timestamp:  now.toISOString(),
    };
    setChatThreads(prev => prev.map(t =>
      t.id === threadId
        ? { ...t, messages: [...t.messages, optimisticMsg], lastMessage: body, lastTime: optimisticMsg.timestamp }
        : t
    ));

    const payload = {
      SenderId:   d.id,
      SenderName: displayName,
      Message:    body,
      DateTime:   dateTimeStr,
      CompanyId:  d.companyId,
    };

    // R4 FIX: dispatch reads ONLY driverMsg/{companyId} for driver messages.
    // notification/ is reserved for incoming job offers — do not write chat there.

    // If offline: queue both writes for later flush; message is already shown optimistically.
    if (!isOnlineRef.current) {
      await enqueueWrite('chat', `driverMsg/${d.companyId}`, 'push', {
        from: 'driver', driverId: d.id, vehicleId: d.vehicleId ?? '', senderName: displayName,
        text: body, timestamp: Date.now(),
      });
      await enqueueWrite('chat', `messages/${d.companyId}`, 'push', payload as Record<string, unknown>);
      console.log('[Chat] Offline — chat message queued for later delivery');
      return;
    }

    // R4 FIX: write ONLY to driverMsg and messages — no notification/ writes.
    // notification/ is reserved for incoming job offers; writing chat messages there
    // caused every message to appear twice in dispatch (relay + direct write).
    const writes: Promise<any>[] = [
      // (0a) driverMsg/{companyId} — dispatch reads here for incoming driver messages
      push(ref(database, `driverMsg/${d.companyId}`), {
        from:       'driver',
        driverId:   d.id,
        vehicleId:  d.vehicleId ?? '',
        senderName: displayName,
        text:       body,
        timestamp:  Date.now(),
      }) as unknown as Promise<void>,
      // (0b) messages/{companyId} — admin-panel messaging system
      push(ref(database, `messages/${d.companyId}`), {
        from:        'driver',
        senderName:  displayName,
        to:          'dispatcher',
        text:        body,
        timestamp:   Date.now(),
        mediaType:   null,
        mediaUrl:    null,
      }) as unknown as Promise<void>,
    ];

    const results = await Promise.allSettled(writes);
    const [rDrvMsg, rMessages] = results;
    console.log('[Chat] sendChatMessage writes —',
      `driverMsg/${d.companyId}:`, rDrvMsg.status,
      `| messages/${d.companyId}:`, rMessages?.status);
    if (rDrvMsg.status === 'rejected') console.warn('[Chat] driverMsg write failed:', (rDrvMsg as PromiseRejectedResult).reason);

    // 3. REST API — best-effort only, 360taxi.co.nz is permanently offline
    dispatchPost({
      Action: 'FnSendDriverMessage',
      Parms: `DriverId,,${d.id}&&Message,,${body}&&DateTime,,${dateTimeStr}&&CompanyId,,${d.companyId}`,
      UserKey: d.passforlink,
    }).catch(() => {});
  };

  const startMeter = () => {
    // v22bj: capture meter-on timestamp; clear stale meter-off
    meterOnAtRef.current = new Date().toISOString();
    meterOffAtRef.current = null;
    // v22bk: reset per-trip waiting windows (the array is closed in stopMeter)
    waitingWindowsRef.current = [];
    meterSecondsRef.current = 0;
    meterDistanceRef.current = 0;
    meterIsWaitingRef.current = false;
    meterWaitingSecsRef.current = 0;
    meterWaitingIntervalsRef.current = 0;
    meterWaitingCostRef.current = 0;
    gpsBufferRef.current = []; // clear position history so stale fixes don't skew waiting detection
    waitingHysteresisRef.current = 0;
    movingHysteresisRef.current  = 0;
    lastGpsTickMsRef.current = Date.now(); // treat meter start as a GPS tick so the 10s blackout timer starts fresh
    meterRunningRef.current = true;
    meterPausedRef.current  = false;
    lastGpsForMeterRef.current = null; // reset so first delta is clean
    setMeterRunning(true);
    setMeterPaused(false);
    setMeterSeconds(0);
    setMeterDistance(0);
    setMeterIsWaiting(false);
    setMeterWaitingIntervals(0);
    setMeterWaitingCost(0);
    setStatusState('Busy');
    // v22bl: explicit OnBoard stage so dispatch sees passenger-on-board the
    // moment the meter starts (separate from vehiclestatus which stays Busy).
    {
      const _d = driverRef.current;
      if (_d?.companyId && _d?.vehicleId) {
        update(ref(database, `online/${_d.companyId}/${_d.vehicleId}/current`), {
          tripStage: 'OnBoard',
        }).catch(() => {});
      }
    }
    if (meterInterval.current) clearInterval(meterInterval.current);
    meterInterval.current = setInterval(() => {
      meterSecondsRef.current += 1;
      setMeterSeconds(meterSecondsRef.current);

      // ── No-GPS fallback (v22p: 4 s, was 30 s) ────────────────────────────
      // Samsung Fold 7 / OneUI throttles GPS callbacks to ~30 s+ when the
      // phone is stationary — so the GPS-callback hysteresis above never
      // fires while parked. Drive waiting detection from the 1 s meter tick
      // instead: if no callbacks for 4 s OR last callback showed low speed,
      // enter waiting. GPS callbacks resume the moment the car moves, so
      // exiting waiting still goes through the regular hysteresis path.
      const gpsAgeMs   = Date.now() - lastGpsTickMsRef.current;
      const lastSpeed  = lastSpeedKmhRef.current; // -1 means speed unknown
      const tariffNow  = activeTariffRef.current;
      const speedThr   = Math.max(tariffNow.speedThreshold, 5);
      const looksStill =
        gpsAgeMs > 4000 ||                          // callbacks suppressed
        (lastSpeed >= 0 && lastSpeed < speedThr && gpsAgeMs > 2000); // last fix was slow + no fresh moving fix in 2s
      // v22u: clearly-moving detection runs every tick so we can break out of
      // a stuck "waiting" state even when the GPS-callback hysteresis path is
      // too slow (Fold 7 callback throttling, clustered fixes, etc.).
      const looksMoving = lastSpeed >= speedThr && gpsAgeMs < 4000;
      if (!meterIsWaitingRef.current && looksStill) {
        meterIsWaitingRef.current = true;
        setMeterIsWaiting(true);
        waitingHysteresisRef.current = 5;
        movingHysteresisRef.current  = 0;
        // v22bk: record per-trip wait windows for the audit POST
        waitingWindowsRef.current.push({ start: new Date().toISOString() });
      } else if (meterIsWaitingRef.current && looksMoving) {
        // v22u: force-exit waiting when speed says we're clearly moving.
        // Without this branch, the meter could stay in waiting after a long
        // GPS-callback gap because the displacement buffer needs time to fill.
        meterIsWaitingRef.current = false;
        setMeterIsWaiting(false);
        meterWaitingSecsRef.current = 0;
        movingHysteresisRef.current = 5;
        waitingHysteresisRef.current = 0;
        // v22bk: close the open wait window
        const _last = waitingWindowsRef.current[waitingWindowsRef.current.length - 1];
        if (_last && !_last.end) _last.end = new Date().toISOString();
      }

      // Waiting charge — accumulate per second so the live fare ticks continuously
      if (meterIsWaitingRef.current) {
        const t = activeTariffRef.current;
        const perSec = t.waitingPerMin / (t.waitingInterval || 60);
        meterWaitingCostRef.current += perSec;
        setMeterWaitingCost(meterWaitingCostRef.current);
        // Also track complete intervals for the receipt breakdown
        meterWaitingSecsRef.current += 1;
        if (meterWaitingSecsRef.current >= (t.waitingInterval || 60)) {
          meterWaitingIntervalsRef.current += 1;
          meterWaitingSecsRef.current = 0;
          setMeterWaitingIntervals(meterWaitingIntervalsRef.current);
        }
      }
      // Distance is accumulated by GPS updates via addMeterDistance(), not here
    }, 1000);
    // Write full Busy presence record (set, not update) so dispatch always
    // gets a complete node. Then mark the job as Active in the jobs path.
    const d = driverRef.current;
    if (d?.companyId && d?.vehicleId) {
      writeOnlinePresence('Busy', d.vehicleId).catch(() => {});
      // 22c cutover (server-dev Q1): jobs/ Status='Active' + rideStatus OnTrip
      // writes removed. Server reads online/.../current.meterOnAt and stamps
      // MeterOnAt + flips BookingStatus to Picking automatically
      // (server.js:5317).
      const _meterOnIso = new Date().toISOString();
      update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
        meterOnAt: _meterOnIso,
        MeterOnAt: _meterOnIso, // PascalCase mirror — server reads either
      }).catch(() => {});
      // Notify dispatch server: DriverStatusChanged → Busy (best-effort, non-blocking)
      // This flips the driver from Assigned → Busy on the dispatch board immediately.
      //
      // Capture the current job's bookingId SYNCHRONOUSLY before the async getGps()
      // call. Inside .then() the `jobs` closure is stale and .find() may return
      // undefined, causing the fallback to reach d.id ("D002") — a driver number,
      // not a valid job ID — which then gets uploaded to /api/syncOfflineTrip.
      const meterJob   = jobs.find(j => j.status === 'current');
      const meterJobId = meterJob?.bookingId ?? meterJob?.id ?? '';
      getGps().then(gps => {
        const zone = myZoneInfoRef.current;
        notifyDriverBusy({
          driverId:      d.id        ?? '',
          vehicleNumber: d.vehicleId ?? '',
          lat:           gps.lat,
          lng:           gps.lng,
          zoneName:      zone?.zoneName  ?? '',
          zoneId:        zone?.zoneId    ?? 0,
          zoneQueue:     zone?.zoneQueue ?? 0,
        }).catch(() => {});
        // Journal: PickedUp + MeterOn — use meterJobId captured synchronously above.
        if (!meterJobId) {
          console.warn('[Meter] startMeter: no current job bookingId — skipping MeterOn journal');
          return;
        }
        const ts = new Date().toISOString();
        appendJournalEntry({
          jobId: meterJobId, companyId: d.companyId ?? '',
          driverId: d.id ?? '', vehicleId: d.vehicleId ?? '',
          eventType: 'PickedUp', timestamp: ts, lat: gps.lat, lng: gps.lng,
        }).catch(() => {});
        appendJournalEntry({
          jobId: meterJobId, companyId: d.companyId ?? '',
          driverId: d.id ?? '', vehicleId: d.vehicleId ?? '',
          eventType: 'MeterOn', timestamp: ts, lat: gps.lat, lng: gps.lng,
        }).then(refreshPendingUploadCount).catch(() => {});
        logDriverEvent('MeterOn', meterJobId, { lat: gps.lat, lng: gps.lng });
      }).catch(() => {});
      // Trip is now in progress — cancel the "return to Unassigned" onDisconnect
      // handlers that were set when the job was accepted.  A mid-trip disconnect
      // should NOT return the job; the fare accumulates offline and is uploaded
      // when the driver reconnects.
      const jobDisPath = jobDisconnectPathRef.current
        ?? `jobs/${d.companyId}/${d.vehicleId}/${d.id}`;
      onDisconnect(ref(database, jobDisPath)).cancel().catch(() => {});
      if (bookingDisconnectPathRef.current) {
        onDisconnect(ref(database, bookingDisconnectPathRef.current)).cancel().catch(() => {});
        bookingDisconnectPathRef.current = null;
      }
      jobDisconnectPathRef.current = null;
      console.log('[OnDisconnect] Job return handlers cancelled — meter running, trip protected');
    }
  };

  const pauseMeter = () => {
    if (meterRunning && !meterPaused) {
      meterPausedRef.current = true;
      setMeterPaused(true);
      pauseStartRef.current = new Date().toISOString();
      if (meterInterval.current) clearInterval(meterInterval.current);
      // v22bk: tapping Complete (or Pause) must fully freeze the waiting timer.
      // Without this the wait-state flag (and its pill in the meter UI) stayed
      // on while the modal was open — the driver saw the "Waiting Rate" pill
      // and thought the meter was still charging. Flip the flag off and close
      // any open wait window so the audit log reflects what actually happened.
      // On resume the GPS detector re-evaluates from scratch.
      if (meterIsWaitingRef.current) {
        meterIsWaitingRef.current = false;
        setMeterIsWaiting(false);
        const _last = waitingWindowsRef.current[waitingWindowsRef.current.length - 1];
        if (_last && !_last.end) _last.end = pauseStartRef.current;
      }
      meterWaitingSecsRef.current = 0;
    } else if (meterPaused) {
      meterPausedRef.current = false;
      setMeterPaused(false);
      if (pauseStartRef.current) {
        const resumedAt = new Date().toISOString();
        const durationSecs = Math.round((Date.now() - new Date(pauseStartRef.current).getTime()) / 1000);
        pauseLogRef.current.push({ pausedAt: pauseStartRef.current, resumedAt, durationSecs });
        pauseStartRef.current = null;
      }
      meterInterval.current = setInterval(() => {
        meterSecondsRef.current += 1;
        setMeterSeconds(meterSecondsRef.current);
        if (meterIsWaitingRef.current) {
          const t = activeTariffRef.current;
          const perSec = t.waitingPerMin / (t.waitingInterval || 60);
          meterWaitingCostRef.current += perSec;
          setMeterWaitingCost(meterWaitingCostRef.current);
          meterWaitingSecsRef.current += 1;
          if (meterWaitingSecsRef.current >= (t.waitingInterval || 60)) {
            meterWaitingIntervalsRef.current += 1;
            meterWaitingSecsRef.current = 0;
            setMeterWaitingIntervals(meterWaitingIntervalsRef.current);
          }
        }
      }, 1000);
    }
  };

  const stopMeter = () => {
    // v22bj: capture meter-off timestamp before clearing (only if not already
    // captured — caller may have snapshotted it before the stopMeter call so
    // we don't overwrite an earlier explicit capture)
    if (meterRunningRef.current && !meterOffAtRef.current) {
      meterOffAtRef.current = new Date().toISOString();
    }
    // v22bk: close any open wait window before the POST snapshot fires
    const _lastW = waitingWindowsRef.current[waitingWindowsRef.current.length - 1];
    if (_lastW && !_lastW.end) _lastW.end = meterOffAtRef.current ?? new Date().toISOString();
    meterRunningRef.current = false;
    meterPausedRef.current  = false;
    setMeterRunning(false);
    setMeterPaused(false);
    setMeterSeconds(0);
    setMeterDistance(0);
    setMeterIsWaiting(false);
    setMeterWaitingIntervals(0);
    setMeterWaitingCost(0);
    meterSecondsRef.current = 0;
    meterDistanceRef.current = 0;
    meterIsWaitingRef.current = false;
    meterWaitingSecsRef.current = 0;
    meterWaitingIntervalsRef.current = 0;
    meterWaitingCostRef.current = 0;
    pauseStartRef.current = null;
    if (meterInterval.current) { clearInterval(meterInterval.current); meterInterval.current = null; }
  };

  // addMeterDistance kept for interface compatibility (no longer called externally)
  const addMeterDistance = (km: number) => {
    if (!meterRunningRef.current || meterPausedRef.current || km <= 0) return;
    meterDistanceRef.current += km;
    setMeterDistance(meterDistanceRef.current);
  };

  const cancelTrip = () => {
    if (meterInterval.current) { clearInterval(meterInterval.current); meterInterval.current = null; }
    meterRunningRef.current = false;
    meterPausedRef.current  = false;
    setMeterRunning(false);
    setMeterPaused(false);
    setMeterSeconds(0);
    setMeterDistance(0);
    setMeterWaitingCost(0);
    meterSecondsRef.current = 0;
    meterDistanceRef.current = 0;
    meterWaitingCostRef.current = 0;
    pauseStartRef.current = null;
    tariffChangesRef.current = [];
    pauseLogRef.current = [];

    const d = driverRef.current;
    const meta = hailTripMetaRef.current;

    // Capture bookingId BEFORE state is cleared so we can write to allbookings
    const cancelBookingId: string = meta?.bookingId
      ?? jobs.find(j => j.status === 'current')?.bookingId
      ?? '';

    if (meta) {
      // ── Hail trip: remove local hail job entry
      setJobs(prev => prev.filter(j => j.id !== meta.bookingId));
      setHailTripMeta(null);
      hailTripMetaRef.current = null;
    } else {
      // ── Dispatch job: clear the current job from local state
      setJobs(prev => prev.filter(j => j.status !== 'current'));
    }

    setIncomingJob(null);
    setStatusState('Available');
    statusRef.current = 'Available';

    // ── Firebase cleanup — same for both hail and dispatch jobs ──────────────
    if (d?.companyId && d?.vehicleId && d?.id) {
      // Remove from jobs path so dispatch sees no active job
      remove(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)).catch(() => {});
      // Update presence: Available + clear all job display fields
      writeOnlinePresence('Available', d.vehicleId).catch(() => {});
      update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
        joboffer: 0, jobCount: 0, JobphoneNo: '', jobpickup: '', jobdropoff: '',
        time: new Date().toISOString(),
      }).catch(() => {});
      // Notify dispatch of cancel via notification path so dispatch status board clears
      set(ref(database, `notification/${d.id}`), {
        bookingid: `,DriverCancelled,${d.id},,${d.vehicleId}`,
        content: 'Driver Cancelled Job',
      }).catch(() => {});
      // Write Cancelled status to allbookings so revenue reports exclude this trip
      if (cancelBookingId) {
        update(ref(database, `allbookings/${d.companyId}/${cancelBookingId}`), {
          status:      'Cancelled',
          Status:      'Cancelled',
          CancelledAt: new Date().toISOString(),
          CancelledBy: 'driver',
        }).catch(() => {});
      }
    }

    // Journal: Cancelled event + summary (non-blocking, best-effort)
    if (d?.companyId && d?.id) {
      const cancelJobId = (meta?.bookingId)
        ?? (jobs.find(j => j.status === 'current')?.bookingId)
        ?? (jobs.find(j => j.status === 'current')?.id)
        ?? '';
      if (cancelJobId) {
        const nowIso = new Date().toISOString();
        getGps().then(gps => {
          appendJournalEntry({
            jobId:     cancelJobId,
            companyId: d.companyId ?? '',
            driverId:  d.id        ?? '',
            vehicleId: d.vehicleId ?? '',
            eventType: 'Cancelled',
            timestamp: nowIso,
            lat: gps.lat,
            lng: gps.lng,
          }).catch(() => {});
          logDriverEvent('Cancelled', cancelJobId);
          saveTripSummary({
            jobId:          cancelJobId,
            companyId:      d.companyId ?? '',
            driverId:       d.id        ?? '',
            vehicleId:      d.vehicleId ?? '',
            passengerName:  '',
            pickupAddress:  '',
            dropoffAddress: '',
            pickupTime:     nowIso,
            dropoffTime:    nowIso,
            duration_mins:  0,
            distance_km:    0,
            fare:           { base: 0, distanceCharge: 0, timeCharge: 0, extras: 0, total: 0, currency: 'NZD' },
            payment:        { method: 'cash', receiptNo: `RCP-${cancelJobId}` },
            status:         'Cancelled',
            completedOffline: !isConnectedRef.current,
          }).then(refreshPendingUploadCount).catch(() => {});
        }).catch(() => {});
      }
    }
  };

  // Write a driver-submitted trip rating to Firebase.
  // Universal:    `driverRatings/{cid}/{bookingId}`              — both portals read this
  // Dispatch:     `allbookings/{cid}/{bookingId}/driverRating`   — patched for dispatch trips
  // Aggregation:  `passengerRatings/{cid}/{normPhone}/{bookingId}` — Owner Portal "Passengers"
  //               tab reads this path to build per-passenger history (rated stars, reasons,
  //               last/total trips). Phone is normalised to digits-only as the key.
  const submitTripRating = (
    bookingId: string,
    rating: number,
    source: 'hail' | 'dispatch',
    extras?: { reasons?: string[]; comment?: string; passengerPhone?: string; passengerName?: string },
  ) => {
    const d = driverRef.current;
    if (!d?.companyId || !bookingId) return;
    const nowISO = new Date().toISOString();
    const nowMs  = Date.now();
    const reasons = (extras?.reasons ?? []).filter(Boolean);
    const comment = (extras?.comment ?? '').trim();
    const ratingRecord = {
      rating,
      ratedAt:        nowISO,   // ISO — primary
      timestamp:      nowMs,    // ms epoch — Owner Panel / SA portal spec field
      driverId:       d.id        ?? '',
      vehicleId:      d.vehicleId ?? '',
      source,
      ...(reasons.length ? { reasons } : {}),
      ...(comment      ? { comment } : {}),
      ...(extras?.passengerPhone ? { passengerPhone: extras.passengerPhone } : {}),
      ...(extras?.passengerName  ? { passengerName:  extras.passengerName  } : {}),
    };
    update(ref(database, `driverRatings/${d.companyId}/${bookingId}`), ratingRecord).catch(() => {});
    if (source === 'dispatch') {
      update(ref(database, `allbookings/${d.companyId}/${bookingId}`), {
        driverRating:        rating,
        ratingSubmittedAt:   nowISO,
        ...(reasons.length ? { driverRatingReasons: reasons } : {}),
        ...(comment        ? { driverRatingComment: comment } : {}),
      }).catch(() => {});
    }
    // Per-passenger aggregation — only when we have a phone number to key on.
    const normPhone = (extras?.passengerPhone ?? '').replace(/\D+/g, '');
    if (normPhone) {
      update(ref(database, `passengerRatings/${d.companyId}/${normPhone}/${bookingId}`), ratingRecord).catch(() => {});
    }
  };

  // ── Pending rating prompt ───────────────────────────────────────────────────
  // After every completed trip we may show a single shared TripRatingModal.
  // Frequency cap: only prompt every Nth trip OR when fare >= threshold OR when
  // a low rating is likely (no-show / dispute) — to avoid driver-fatigue.
  const [pendingRating, setPendingRating] = useState<
    { bookingId: string; source: 'hail' | 'dispatch'; passengerName?: string; passengerPhone?: string; fare?: number } | null
  >(null);
  const tripsSinceRatingRef = useRef(0);
  const RATING_PROMPT_EVERY = 3;        // prompt every 3rd trip…
  const RATING_PROMPT_FARE  = 30;       // …or any trip with fare >= NZ$30

  const requestRating = (args: {
    bookingId: string;
    source: 'hail' | 'dispatch';
    passengerName?: string;
    passengerPhone?: string;
    fare?: number;
    force?: boolean;
  }) => {
    if (!args.bookingId) return;
    tripsSinceRatingRef.current += 1;
    const passesCap =
      args.force === true ||
      (args.fare ?? 0) >= RATING_PROMPT_FARE ||
      tripsSinceRatingRef.current >= RATING_PROMPT_EVERY;
    if (!passesCap) return;
    tripsSinceRatingRef.current = 0;
    setPendingRating({
      bookingId:      args.bookingId,
      source:         args.source,
      passengerName:  args.passengerName,
      passengerPhone: args.passengerPhone,
      fare:           args.fare,
    });
  };

  const clearPendingRating = () => setPendingRating(null);

  const createPendingJob = async (fields: {
    passengerName: string;
    passengerPhone: string;
    passengerEmail: string;
    pickupAddress: string;
    dropAddress: string;
    vehicleType: string;
    notes: string;
    scheduledFor: Date | null;
    dispatcherOnly: boolean;
  }): Promise<{ bookingId: string; dispatchVisible: boolean }> => {
    const d = driverRef.current;
    if (!d?.companyId) throw new Error('No company ID');

    // Request a server-assigned canonical job ID — fall back to local if offline
    const jobResult = await requestCentralJobId({
      companyId: d.companyId,
      source:    'dispatch',
      passenger: { name: fields.passengerName.trim(), phone: fields.passengerPhone.trim() },
      pickup:    { address: fields.pickupAddress.trim() },
      dropoff:   { address: fields.dropAddress.trim() },
      notes:     fields.notes.trim(),
    });
    const key = jobResult.ok ? jobResult.jobId : `adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (!jobResult.ok) console.warn('[createPendingJob] Local ID fallback — server unavailable:', jobResult.networkError ? 'network error' : (jobResult.serverError ?? 'unknown'));

    const payload: Record<string, any> = {
      PassengerName: fields.passengerName.trim(),
      PassengerPhone: fields.passengerPhone.trim(),
      PassengerEmail: fields.passengerEmail.trim(),
      PickAddress: fields.pickupAddress.trim(),
      DropAddress: fields.dropAddress.trim(),
      VehicleType: fields.vehicleType || 'Not Specified',
      jobvehicletype: fields.vehicleType || 'Not Specified',
      Info: fields.notes.trim(),
      CreatedAt: new Date().toISOString(),
      CreatedBy: d.id,
      CreatedByVehicle: d.vehicleId ?? '',
      CreatedByName: d.name ?? d.vehicleId ?? 'Driver',
      BookingId: key,
      Status: 'Unassigned',
    };
    if (fields.scheduledFor) payload.ScheduledFor = fields.scheduledFor.toISOString();
    if (fields.dispatcherOnly) payload.dispatcherOnly = true;

    // ── Attempt 1: pendingjobs — dispatcher unassigned tab ──────────────────
    try {
      await set(ref(database, `pendingjobs/${d.companyId}/${key}`), payload);
      console.log('[CreateBooking] Written to pendingjobs —', key);
      return { bookingId: key, dispatchVisible: true };
    } catch (e1: any) {
      console.warn('[CreateBooking] pendingjobs denied, trying fallback:', e1?.message);
    }

    // ── Attempt 2: driver's own online tree (always writable) ────────────────
    // Dispatcher won't see this in unassigned tab until Firebase rules are updated.
    const fallbackPath = `online/${d.companyId}/${d.vehicleId}/advancebookings/${key}`;
    try {
      await set(ref(database, fallbackPath), payload);
      console.log('[CreateBooking] Written to fallback path —', fallbackPath);
      return { bookingId: key, dispatchVisible: false };
    } catch (e2: any) {
      console.warn('[CreateBooking] fallback also denied:', e2?.message);
    }

    // All paths exhausted
    throw new Error('permission_denied');
  };

  const dismissTakenAlert = () => setTakenAlert(null);
  const clearCancelledJobAlert = () => setCancelledJobAlert(null);
  const clearSystemAlert = () => setSystemAlert(null);

  const claimHailJob = async (job: HailJob): Promise<{ status: 'ok'; jobId: string } | { status: 'taken' } | { status: 'error' }> => {
    const d = driverRef.current;
    if (!d?.companyId) return { status: 'error' };

    const hailJobRef = ref(database, `pendingjobs/${d.companyId}/${job.bookingId}`);

    try {
      const result = await runTransaction(hailJobRef, (currentData) => {
        if (currentData === null) return undefined; // job gone — abort
        if (currentData.claimedBy) return undefined; // already taken — abort
        return { ...currentData, claimedBy: d.id, claimedByName: d.name ?? '', claimedAt: Date.now() };
      });

      if (!result.committed) return { status: 'taken' };

      // Mark as claimed by us so the listener doesn't show a "taken" alert
      claimedByMeRef.current.add(job.bookingId);

      // Add the job to driver's local state as 'current'
      const newJob: Job = {
        id: `hail-${job.bookingId}-${Date.now()}`,
        bookingId: job.bookingId,
        passengerName: job.passengerName,
        passengerPhone: job.passengerPhone,
        pickupAddress: job.pickupAddress,
        dropAddress: job.dropAddress,
        fare: job.fare,
        distance: job.distance,
        duration: job.duration,
        status: 'current',
        createdAt: job.createdAt,
        notes: job.notes,
      };

      setJobs(prev => {
        if (prev.find(j => j.bookingId === job.bookingId)) return prev;
        return [newJob, ...prev];
      });
      setStatusState('Assigned');

      // Write job to driver's Firebase jobs path
      if (d.vehicleId && d.id) {
        set(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`), {
          BookingId: job.bookingId,
          PassengerName: job.passengerName,
          PassengerPhone: job.passengerPhone,
          PickAddress: job.pickupAddress,
          DropAddress: job.dropAddress,
          Fare: String(job.fare),
          Distance: job.distance,
          Duration: job.duration,
          Info: job.notes ?? '',
          Status: 'Assigned',
          Source: 'hail',
        }).catch(() => {});

        // Update presence to Assigned
        update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
          vehiclestatus: 'Assigned',
          joboffer: 1,
          jobCount: 1,
          JobphoneNo: job.passengerPhone,
          jobpickup: job.pickupAddress,
          jobdropoff: job.dropAddress,
          time: new Date().toISOString(),
        }).catch(() => {});
      }

      // Remove from pendingjobs after 5 s (gives other drivers a moment to see "Taken")
      setTimeout(() => {
        remove(hailJobRef).catch(() => {});
      }, 5000);

      return { status: 'ok', jobId: newJob.id };
    } catch (err) {
      console.warn('[HailJob] Transaction error:', err);
      return { status: 'error' };
    }
  };

  const startHailTrip = async (tariff: Tariff, zone: string, paymentData: PaymentData, pickupAddress: string, bookingType?: string) => {
    const d = driverRef.current;
    if (!d?.companyId) return;

    const now = new Date().toISOString();

    // ota22c-cutover-c PRE-FLIGHT GUARD ──────────────────────────────────
    // Refuse to start a hail trip while ANY dispatch booking is still active
    // locally. Real incident: driver completed dispatch booking 6112605211
    // optimistically (local UI flipped to Completed) but the server-side
    // command:'complete' never made it through a zombie socket, so the
    // booking stayed Active on the server's jobStore. Driver then hailed —
    // dispatch HQ saw a still-Active dispatch booking AND a phantom Available
    // driver running a hail meter the server didn't know existed.
    const activeDispatch = jobs.find(j =>
      j.status === 'current' && (j.source === 'dispatch' || (!j.source && j.bookingId && !String(j.bookingId).startsWith('TEMP-')))
    );
    if (activeDispatch) {
      Alert.alert(
        'Active Trip In Progress',
        'You still have an active dispatch trip. Complete or cancel it before starting a hail passenger.'
      );
      return;
    }

    // R6 FIX: request a server-assigned canonical job ID.
    // Block if server is unreachable — no local-ID fallback for hail trips.
    // Show the appropriate error depending on whether the device is offline or
    // the SA portal itself returned an error.
    const jobResult = await requestCentralJobId({
      companyId: d.companyId,
      source:    'hail',
      driverId:  d.id,
      vehicleId: d.vehicleId,
      tariffId:  String(tariff.id ?? ''),
      passenger: { name: 'Street Pickup', phone: '' },
      pickup:    { address: pickupAddress || 'Unknown pickup' },
      dropoff:   { address: '' },
    });
    // ota22c-cutover-c: REMOVED silent 404 → TEMP-id fallback. Real incident
    // proved this fallback masks every server-side rejection (driver has an
    // active booking, source:'hail' not whitelisted, auth refused, etc.) as
    // a harmless "endpoint not deployed" condition — driver app then runs a
    // ghost hail trip the server never registered. Now ALL non-OK responses
    // block, with breadcrumb so we can see why.
    let bookingId: string;
    if (jobResult.ok) {
      bookingId = jobResult.jobId;
    } else {
      try { Sentry.addBreadcrumb({ category: 'hail-blocked', level: 'warning', message: 'requestCentralJobId failed', data: { networkError: !!jobResult.networkError, serverError: jobResult.serverError, httpStatus: jobResult.httpStatus } }); } catch {}
      if (jobResult.networkError) {
        Alert.alert('No Connection', 'Your device appears to be offline. Please restore your internet connection and try again.');
      } else if (jobResult.httpStatus === 404) {
        Alert.alert('Hail Unavailable', 'The dispatch server has not enabled hail trips for this company yet. Contact your operator.');
      } else if (jobResult.serverError) {
        Alert.alert('Booking Server Error', jobResult.serverError);
      } else {
        Alert.alert('Server Unavailable', 'The booking server is not responding. Please try again in a moment.');
      }
      return;
    }

    const gpsNow = lastGpsPositionRef.current;
    const meta: HailTripMeta = { bookingId, pickupAddress, zone, paymentType: paymentData.type, paymentData, startedAt: now, initialTariff: tariff, pickupLat: gpsNow?.lat, pickupLng: gpsNow?.lng, bookingType };
    hailTripMetaRef.current = meta;
    setHailTripMeta(meta);

    tariffChangesRef.current = [];
    pauseLogRef.current = [];
    pauseStartRef.current = null;

    activeTariffRef.current = tariff;
    setActiveTariffState(tariff);

    const newJob: Job = {
      id: bookingId,
      bookingId,
      passengerName: 'Street Pickup',
      passengerPhone: '',
      pickupAddress,
      dropAddress: '',
      fare: 0,
      distance: '—',
      duration: '—',
      status: 'current',
      createdAt: now,
      notes: zone ? `Zone: ${zone}` : '',
    };
    setJobs(prev => {
      const filtered = prev.filter(j => j.status !== 'current');
      return [newJob, ...filtered];
    });

    meterSecondsRef.current = 0;
    meterDistanceRef.current = 0;
    meterIsWaitingRef.current = false;
    meterWaitingSecsRef.current = 0;
    meterWaitingIntervalsRef.current = 0;
    meterWaitingCostRef.current = 0;
    gpsBufferRef.current = [];
    waitingHysteresisRef.current = 0;
    movingHysteresisRef.current  = 0;
    lastGpsTickMsRef.current = Date.now();
    meterRunningRef.current = true;
    setMeterRunning(true);
    setMeterPaused(false);
    setMeterSeconds(0);
    setMeterDistance(0);
    setMeterIsWaiting(false);
    setMeterWaitingIntervals(0);
    setMeterWaitingCost(0);
    setStatusState('Busy');

    if (meterInterval.current) clearInterval(meterInterval.current);
    meterInterval.current = setInterval(() => {
      meterSecondsRef.current += 1;
      setMeterSeconds(meterSecondsRef.current);
      // v22p: time-based waiting detection from the 1s tick (Samsung throttles
      // GPS callbacks while parked, so we can't rely on hysteresis alone).
      const gpsAgeMsH  = Date.now() - lastGpsTickMsRef.current;
      const lastSpdH   = lastSpeedKmhRef.current;
      const tariffH    = activeTariffRef.current;
      const speedThrH  = Math.max(tariffH.speedThreshold, 5);
      const looksStillH =
        gpsAgeMsH > 4000 ||
        (lastSpdH >= 0 && lastSpdH < speedThrH && gpsAgeMsH > 2000);
      // v22u: mirrors the dispatch-tick fix — break out of stuck waiting when
      // speed says we're clearly moving.
      const looksMovingH = lastSpdH >= speedThrH && gpsAgeMsH < 4000;
      if (!meterIsWaitingRef.current && looksStillH) {
        meterIsWaitingRef.current = true;
        setMeterIsWaiting(true);
        waitingHysteresisRef.current = 5;
        movingHysteresisRef.current  = 0;
        // v22bk: record per-trip wait windows for the audit POST (hail)
        waitingWindowsRef.current.push({ start: new Date().toISOString() });
      } else if (meterIsWaitingRef.current && looksMovingH) {
        meterIsWaitingRef.current = false;
        setMeterIsWaiting(false);
        meterWaitingSecsRef.current = 0;
        movingHysteresisRef.current = 5;
        waitingHysteresisRef.current = 0;
        // v22bk: close the open wait window (hail)
        const _last = waitingWindowsRef.current[waitingWindowsRef.current.length - 1];
        if (_last && !_last.end) _last.end = new Date().toISOString();
      }
      if (meterIsWaitingRef.current) {
        const t = activeTariffRef.current;
        const perSec = t.waitingPerMin / (t.waitingInterval || 60);
        meterWaitingCostRef.current += perSec;
        setMeterWaitingCost(meterWaitingCostRef.current);
        meterWaitingSecsRef.current += 1;
        if (meterWaitingSecsRef.current >= (t.waitingInterval || 60)) {
          meterWaitingIntervalsRef.current += 1;
          meterWaitingSecsRef.current = 0;
          setMeterWaitingIntervals(meterWaitingIntervalsRef.current);
        }
      }
    }, 1000);

    if (d.vehicleId && d.id) {
      writeOnlinePresence('Busy', d.vehicleId).catch(() => {});
      // ota22c-cutover-c BUG A FIX: write TOP-LEVEL vehiclestatus='Busy'.
      // writeOnlinePresence only touches the nested /current/ field; the
      // dispatch board's fast-path classifier reads the top-level field.
      // Before this fix, starting a hail trip left top-level = 'Available'
      // and dispatch saw the driver as ready for jobs while the meter ran.
      update(ref(database, `online/${d.companyId}/${d.vehicleId}`), {
        vehiclestatus: 'Busy',
        VehicleStatus: 'Busy',
      }).catch(() => {});
      // 22c cutover: jobs/ set, allbookings set, and rideStatus update all
      // removed for hail. Server's /api/job/create (source:'hail') + the
      // completeHailTrip command:'complete' below own this state.
      // online/.../current jobpickup mirror KEPT for hail (server-dev Q3 —
      // driver-supplied since hail trips have no dispatcher record yet).
      update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
        jobpickup:    pickupAddress,
        jobdropoff:   '',
        JobphoneNo:   '',
        currentJobId: bookingId,
        meterOnAt:    now,  // server reads this and stamps MeterOnAt itself
        MeterOnAt:    now,
      }).catch(() => {});
      // Notify dispatch server: DriverStatusChanged → Busy (best-effort, non-blocking)
      getGps().then(gps => {
        const zoneInfo = myZoneInfoRef.current;
        notifyDriverBusy({
          driverId:      d.id        ?? '',
          vehicleNumber: d.vehicleId ?? '',
          lat:           gps.lat,
          lng:           gps.lng,
          zoneName:      zone || zoneInfo?.zoneName  || '',
          zoneId:        zoneInfo?.zoneId    ?? 0,
          zoneQueue:     zoneInfo?.zoneQueue ?? 0,
        }).catch(() => {});
      }).catch(() => {});
      update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
        joboffer: 0, jobCount: 1,
      }).catch(() => {});
    }
  };

  const completeHailTrip = async (dropAddress: string, frozenFare?: number, frozenDist?: number, frozenSecs?: number, paymentData?: PaymentData, extrasItems?: { id: string; name: string; amount: number }[], extrasTotal?: number) => {
    try { // v12-ota18: wrap whole body so a single bad write can't crash the app
    const d = driverRef.current;
    if (!d?.companyId || !d?.vehicleId) return;

    // v22s: presence-watcher kick suppression for hail-completion churn only.
    // Uses a deadline timestamp (not the global boolean) so a self-write that
    // re-creates the node DOES NOT clear the window, and so this can't suppress
    // a legitimate dispatcher kick that arrives more than 10s after completion.
    presenceKickSuppressUntilRef.current = Date.now() + 10000;

    // Stop accumulating immediately so refs match what the driver saw at confirmation
    if (meterInterval.current) { clearInterval(meterInterval.current); meterInterval.current = null; }

    const meta = hailTripMetaRef.current;
    const nowISO = new Date().toISOString();
    const nowNZ  = nzDateTime();    // NZ local time for dispatcher-facing fields
    const nowNZDate = nzDate();
    const nowNZTime = nzTime();

    // Use frozen snapshot values when provided so the record exactly matches
    // what was shown to the driver at the "End Trip" confirmation moment.
    const secs   = frozenSecs  ?? meterSecondsRef.current;
    const distKm = frozenDist  ?? meterDistanceRef.current;
    const tariff = activeTariffRef.current;
    const waitIntervals = meterWaitingIntervalsRef.current;
    const waitingCostAccum = meterWaitingCostRef.current; // continuous per-second accumulation
    // Use frozenFare if caller provided a snapshot (avoids extra accumulation during modal display)
    const fare = frozenFare != null
      ? frozenFare
      : tariff.flagFall + distKm * tariff.ratePerMile + waitingCostAccum;

    if (pauseStartRef.current) {
      const durationSecs = Math.round((Date.now() - new Date(pauseStartRef.current).getTime()) / 1000);
      pauseLogRef.current.push({ pausedAt: pauseStartRef.current, resumedAt: nowISO, durationSecs });
      pauseStartRef.current = null;
    }

    const totalPauseSecs = pauseLogRef.current.reduce((s, p) => s + p.durationSecs, 0);
    const distanceCost = parseFloat((distKm * tariff.ratePerMile).toFixed(2));
    const waitingCost = parseFloat(waitingCostAccum.toFixed(2)); // matches the live fare display
    const h = Math.floor(secs / 3600);
    const mm = Math.floor((secs % 3600) / 60);
    const ss = secs % 60;
    const durationLabel = h > 0
      ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

    // startedAt in NZ local time (convert from stored ISO string if available)
    const startedAtNZ = meta?.startedAt
      ? nzDateTime(new Date(meta.startedAt))
      : nowNZ;

    const record: Record<string, any> = {
      bookingId: meta?.bookingId ?? `hail-${Date.now()}`,
      source: 'hail',
      driverId: d.id,
      driverName: (d.name && !d.name.includes('@')) ? d.name : d.name ? d.name.split('@')[0] : d.vehicleId ?? '',
      vehicleId: d.vehicleId,
      companyId: d.companyId,
      pickupAddress: meta?.pickupAddress ?? '',
      dropAddress,
      zone: meta?.zone ?? '',
      bookingType: meta?.bookingType || undefined,
      tariffName: tariff.name,
      tariffId: tariff.id,
      flagFall: tariff.flagFall,
      ratePerKm: tariff.ratePerMile,
      waitingPerMin: tariff.waitingPerMin,
      tariffChanges: tariffChangesRef.current,
      distanceKm: parseFloat(distKm.toFixed(3)),
      durationSecs: secs,
      durationLabel,
      fare: parseFloat(fare.toFixed(2)),
      meterFare: parseFloat(fare.toFixed(2)), // SA portal fallback field name for fare
      flagFallAmount: tariff.flagFall,
      distanceCost,
      waitingCost,
      WaitingCost:  waitingCost,  // capitalised alias — dispatcher popup reads this field
      DriverCost:   parseFloat(fare.toFixed(2)), // full fare goes to driver (no commission model yet)
      DropLatLng:   lastGpsPositionRef.current
        ? `${lastGpsPositionRef.current.lat.toFixed(6)},${lastGpsPositionRef.current.lng.toFixed(6)}`
        : '',
      pickupLat:    meta?.pickupLat ?? null,
      pickupLng:    meta?.pickupLng ?? null,
      dropLat:      lastGpsPositionRef.current?.lat ?? null,
      dropLng:      lastGpsPositionRef.current?.lng ?? null,
      paymentType: (paymentData ?? meta?.paymentData)?.type ?? meta?.paymentType ?? 'cash',
      // Pax Pays badge — paymentMethod + boolean flags both written for dispatcher compatibility
      paymentMethod:   (['card','eftpos'].includes((paymentData ?? meta?.paymentData)?.type ?? '') ? 'card'
                      : ['account','total_mobility','acc'].includes((paymentData ?? meta?.paymentData)?.type ?? '') ? 'account'
                      : 'cash'),
      cashPayment:    ['cash','gift_card'].includes((paymentData ?? meta?.paymentData)?.type ?? 'cash'),
      cardPayment:    ['card','eftpos'].includes((paymentData ?? meta?.paymentData)?.type ?? ''),
      accountPayment: ['account','total_mobility','acc'].includes((paymentData ?? meta?.paymentData)?.type ?? ''),
      // Total Mobility extras
      ...((paymentData ?? meta?.paymentData)?.type === 'total_mobility' ? {
        tmVoucherNo:      (paymentData ?? meta?.paymentData)?.tmVoucherNo     ?? '',
        cardNumber:       (paymentData ?? meta?.paymentData)?.tmVoucherNo     ?? '', // SA portal reads cardNumber for TM voucher
        tmPassengerName:  (paymentData ?? meta?.paymentData)?.tmPassengerName ?? '',
        tmTripCategory:   (paymentData ?? meta?.paymentData)?.tmTripCategory  ?? 'other',
        tmPassengerPays:  (paymentData ?? meta?.paymentData)?.tmPassengerPays ?? 0,
        tmSubsidy:     parseFloat((fare - ((paymentData ?? meta?.paymentData)?.tmPassengerPays ?? 0)).toFixed(2)),
        tmSubsidyFare: parseFloat((fare - ((paymentData ?? meta?.paymentData)?.tmPassengerPays ?? 0)).toFixed(2)), // SA portal alternative field name
      } : {}),
      // Card extras
      ...((paymentData ?? meta?.paymentData)?.type === 'card' ? {
        cardLastFour: (paymentData ?? meta?.paymentData)?.cardLastFour ?? '',
        cardHolder:   (paymentData ?? meta?.paymentData)?.cardHolder   ?? '',
        cardExpiry:   (paymentData ?? meta?.paymentData)?.cardExpiry   ?? '',
      } : {}),
      // Account / ACC Claim extras (camelCase + dispatcher-facing aliases)
      ...((paymentData ?? meta?.paymentData)?.type === 'account' ? {
        accClientRef:   (paymentData ?? meta?.paymentData)?.accClientRef  ?? '',
        accClientId:    (paymentData ?? meta?.paymentData)?.accClientId   ?? '',
        accResolvedName:(paymentData ?? meta?.paymentData)?.accResolvedName ?? '',
        accClaimNo:     (paymentData ?? meta?.paymentData)?.accClaimNo    ?? '',
        accPoNumber:    (paymentData ?? meta?.paymentData)?.accPoNumber   ?? '',
        Acc_client_id:  (paymentData ?? meta?.paymentData)?.accClientId   ?? '',
        Acc_claim_id:   (paymentData ?? meta?.paymentData)?.accClaimNo    ?? '',
      } : {}),
      pauseLog: pauseLogRef.current,
      totalPauseSecs,
      // NZ local time for dispatcher display (PascalCase = display, camelCase = ISO for SA portal)
      startedAt:       startedAtNZ,              // NZ display string — dispatcher facing
      startedAt_NZ:    startedAtNZ,              // explicit alias
      startedAt_ISO:   meta?.startedAt ?? nowISO,
      completedAt:     nowISO,                   // ISO string — SA portal reads this for date maths
      completedAt_NZ:  nowNZ,                    // NZ display string — dispatcher facing
      completedAt_ISO: nowISO,
      CompletedDate:   nowNZDate,
      CompletedTime:   nowNZTime,
      status: 'Completed',
    };

    // v12-ota22c4-e: mark the hail bookingId locally completed SYNCHRONOUSLY
    // BEFORE we tear down hailTripMetaRef. The async saveTripSummary().then()
    // callback that also calls markBookingLocallyCompleted has a real race —
    // it can fire AFTER the ref is cleared and AFTER listeners pick up any
    // intermediate Firebase echo, which is exactly the window where an empty
    // offer modal can appear. Doing it here is idempotent and race-safe.
    if (meta?.bookingId) {
      markBookingLocallyCompleted(meta.bookingId);
    }

    stopMeter();
    // R10 FIX: Reset active tariff to first non-TM tariff after every hail trip so
    // a TM tariff from the previous trip never carries forward to the next one.
    const nonTmTariff = availableTariffs.find(t => {
      const n = (t.name ?? '').toLowerCase();
      return !n.includes('total') && !n.includes('mobility');
    }) ?? availableTariffs[0];
    if (nonTmTariff) {
      activeTariffRef.current = nonTmTariff;
      setActiveTariffState(nonTmTariff);
    }
    setHailTripMeta(null);
    hailTripMetaRef.current = null;
    tariffChangesRef.current = [];
    pauseLogRef.current = [];

    const bookingId = meta?.bookingId;
    if (bookingId) {
      setJobs(prev => {
        const existing = prev.find(j => j.id === bookingId);
        if (existing) {
          // Dispatched-style match — just re-status it (legacy path).
          return prev.map(j =>
            j.id === bookingId
              ? { ...j, status: 'completed' as const, fare: parseFloat(fare.toFixed(2)), dropAddress, completedAt: nowISO }
              : j
          );
        }
        // v22bb: hail trips were NEVER added to the local jobs array (startHailTrip
        // only sets hailTripMeta), so the .map() above was a no-op and the trip
        // never appeared in the "closed jobs" / completed-trips list inside the
        // driver app. Firebase upload was unaffected. Push a fresh completed
        // entry so Shift / Profile / Home stats include hail trips.
        const hailJobEntry: Job = {
          id:             bookingId,
          bookingId,
          passengerName:  'Street Pickup',
          passengerPhone: '',
          pickupAddress:  meta?.pickupAddress ?? '',
          dropAddress,
          fare:           parseFloat(fare.toFixed(2)),
          distance:       `${distKm.toFixed(2)} km`,
          duration:       durationLabel,
          status:         'completed',
          createdAt:      meta?.startedAt ?? nowISO,
          completedAt:    nowISO,
          paymentType:    (paymentData ?? meta?.paymentData)?.type ?? meta?.paymentType ?? 'cash',
          bookingType:    meta?.bookingType,
          tariffName:     tariff.name,
          waitingCost,
          rideCost:       distanceCost,
          flagFall:       tariff.flagFall,
          tmVoucherNo:    (paymentData ?? meta?.paymentData)?.tmVoucherNo,
          tmPassengerName:(paymentData ?? meta?.paymentData)?.tmPassengerName,
          tmPassengerPays:(paymentData ?? meta?.paymentData)?.tmPassengerPays,
          acc_client_id:  (paymentData ?? meta?.paymentData)?.accClientId,
        };
        return [...prev, hailJobEntry];
      });
    }
    setStatusState('Available');
    // Update the ref synchronously so any async handlers that fire
    // during the awaits below (reconnect, AppState) see 'Available'
    // and don't write 'Busy' back to Firebase.
    statusRef.current = 'Available';

    // After hail trip completes, promote the first queued job back to
    // 'offered' so the accept/decline modal re-surfaces automatically.
    setJobs(prev => {
      const firstQueued = prev.find(j => j.status === 'queued');
      if (!firstQueued) return prev;
      // Clear dispatch console queue handoff — slot is now free
      if (d?.companyId && d?.id) {
        remove(ref(database, `driverQueue/${d.companyId}/${d.id}/queued`)).catch(() => {});
      }
      return prev.map(j => j.id === firstQueued.id ? { ...j, status: 'offered' as const } : j);
    });

    // Build admin-facing TM trip record (trips/{cid}/{tripId}) if payment is Total Mobility
    const effPayment = paymentData ?? meta?.paymentData;
    const isTmTrip   = effPayment?.type === 'total_mobility';
    const tmTripId   = record.bookingId ?? `hail-${Date.now()}`;
    const tmRecord   = isTmTrip ? {
      tripId:          tmTripId,
      source:          'hail',
      driverId:        d.id,
      driverName:      (d.name && !d.name.includes('@')) ? d.name : d.name ? d.name.split('@')[0] : d.vehicleId ?? '',
      vehicleId:       d.vehicleId,
      companyId:       d.companyId,
      cardNumber:      effPayment?.tmVoucherNo   ?? '',
      passengerName:   effPayment?.tmPassengerName ?? '',
      tripCategory:    effPayment?.tmTripCategory  ?? 'other',
      fareTotal:       parseFloat(fare.toFixed(2)),
      passengerAmount: effPayment?.tmPassengerPays ?? 0,
      distanceKm:      parseFloat(distKm.toFixed(3)),
      pickupLat:       meta?.pickupLat ?? null,
      pickupLng:       meta?.pickupLng ?? null,
      dropLat:         lastGpsPositionRef.current?.lat ?? null,
      dropLng:         lastGpsPositionRef.current?.lng ?? null,
      pickupAddress:   meta?.pickupAddress ?? '',
      dropAddress,
      zone:            meta?.zone ?? '',
      dateTime:        nowISO,
      date:            nowNZDate,
      time:            nowNZTime,
      status:          'Completed',
      flagged:         false,
    } : null;

    // Build ACC account trip record if payment type is 'account' and a client ID was entered
    const isAccTrip   = (effPayment?.type === 'account' || effPayment?.type === 'acc') && !!effPayment?.accClientId;
    const accTripId   = record.bookingId ?? `hail-${Date.now()}`;
    const accRecord   = isAccTrip ? {
      tripId:        accTripId,
      source:        'hail',
      driverId:      d.id,
      driverName:    d.name ?? d.vehicleId ?? '',
      vehicleId:     d.vehicleId,
      companyId:     d.companyId,
      clientId:      effPayment!.accClientId,
      claimNo:       effPayment!.accClaimNo  ?? '',
      poNumber:      effPayment!.accPoNumber ?? '',
      fare:          parseFloat(fare.toFixed(2)),
      pickupAddress: meta?.pickupAddress ?? '',
      dropAddress,
      zone:          meta?.zone ?? '',
      distanceKm:    parseFloat(distKm.toFixed(3)),
      durationSecs:  secs,
      dateTime:      nowISO,
      date:          nowNZDate,
      time:          nowNZTime,
      status:        'Completed',
    } : null;

    // R7 FIX: the meter ran entirely locally (no network calls in the setInterval tick)
    // so it is never affected by connectivity drops.  The only network dependency is
    // THIS completion write — handled below with offline queuing.
    //
    // R8 FIX: If offline, queue all writes to AsyncStorage so they flush on reconnect.
    // If online, try up to 3 times before falling back to the queue.
    const enqueueHailCompletion = async () => {
      // 22c cutover: hail-complete offline-queue writes to completedJobs,
      // trips, accClients, and jobs/ removed. command:'complete' is queued
      // by sendOrQueueJobCommand itself when offline, so the booking state
      // still reaches the server on reconnect. Local-only side effects
      // (record/tmRecord/accRecord/tmTripId/accTripId) reserved as no-ops.
      void record; void tmRecord; void accRecord; void tmTripId; void accTripId;
    };

    // v12-ota19: ALL completion network writes fire-and-forget so the modal
    // closes instantly. Previously up to 4.5s of awaited Firebase writes
    // blocked the JS thread → Android ANR force-close on Galaxy A04.
    (async () => {
      if (!isOnlineRef.current) {
        await enqueueHailCompletion();
        Alert.alert('Trip saved offline', 'Your trip has been recorded locally and will upload automatically when you reconnect.');
        return;
      }
      // 22c cutover: live hail-complete completedJobs/trips/accClients/jobs
      // writes removed. command:'complete' (above) is the single source of
      // truth — server fans out into those nodes itself.
    })().catch(() => {});

    // Increment ACC Purchase Order tripsUsed (hail jobs) — same as dispatched jobs do at completeJob.
    // Only fires when the driver resolved a valid client and entered a PO number.
    if (isAccTrip && effPayment?.accClientId && effPayment?.accPoNumber && d.companyId) {
      const poPath = `accClients/${d.companyId}/${effPayment.accClientId}/purchaseOrders/${effPayment.accPoNumber}/tripsUsed`;
      runTransaction(ref(database, poPath), (current) => (typeof current === 'number' ? current + 1 : 1))
        .catch(() => {}); // best-effort — non-critical
    }

    // v12-ota19: fire-and-forget — these used to await sequentially, blocking ~1-2s.
    writeOnlinePresence('Available', d.vehicleId).catch(() => {});
    update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
      joboffer: 0, jobCount: 0, JobphoneNo: '', jobpickup: '', jobdropoff: '',
      currentJobId: null,
      // v22be: clear the live tariff fields written during the trip so dispatch
      // doesn't see stale tariff info on an Available driver
      currentTariffId: null, currentTariffName: null,
    }).catch(() => {});

    // ── Dispatcher visibility writes on completion ──────────────────────────
    // v22au: enrich the hail allbookings update to match the dispatch trip
    // completion record — was previously missing WaitingCost, fare breakdown
    // (FareBase/FareTime/FareDistance), TariffName, payment-method aliases,
    // TM/Card/ACC details, and the SA portal lowercase aliases. As a result
    // the SA portal and dispatch popup showed blank pickup / waiting cost /
    // fare-breakdown columns for any completed HAIL trip even though the
    // completedJobs push had the full data. Now hail completion mirrors the
    // full dispatch completion schema. Pickup data written at hail-start
    // (line ~5975) is preserved because we use update(), not set().
    if (record.bookingId) {
      const effPay = paymentData ?? meta?.paymentData;
      const payType = effPay?.type ?? meta?.paymentType ?? 'cash';
      const _allbookingsHailUpdate: Record<string, unknown> = {
        Status:           'Completed',
        status:           'completed',         // SA portal lowercase alias
        // Fare — PascalCase + lowercase aliases for SA portal compatibility
        Fare:             record.fare,
        FinalFare:        record.fare,
        fare:             record.fare,
        meterFare:        record.fare,
        TotalFare:        record.fare,
        FareBase:         tariff.flagFall,
        FareTime:         waitingCost,
        FareDistance:     distanceCost,
        FareExtras:       extrasTotal ?? 0, // v22bm
        FareCurrency:     'NZD',
        WaitingCost:      waitingCost,
        waitingCost:      waitingCost,
        WaitingTime:      `${Math.round(secs / 60)} min`,
        RideCost:         distanceCost,
        TariffName:       tariff.name,
        // Addresses — PickAddress preserved from start; DropAddress newly written
        PickAddress:      meta?.pickupAddress ?? '',
        DropAddress:      dropAddress,
        // Distance + time
        DistanceKm:       record.distanceKm,
        distanceKm:       record.distanceKm,
        JobDistance:      record.distanceKm,
        DurationSecs:     record.durationSecs,
        // Completion timestamps — multiple aliases for dispatcher + SA portal
        CompletedAt:      nowNZ,
        completedAt:      nowISO,
        CompletedAt_ISO:  nowISO,
        completedAt_ISO:  nowISO,
        CompletedDate:    nowNZDate,
        CompletedTime:    nowNZTime,
        startedAt_ISO:    meta?.startedAt ?? nowISO,
        // Drop GPS
        DropLat:          record.dropLat,
        DropLng:          record.dropLng,
        DropLatLng:       record.DropLatLng,
        dropLat:          record.dropLat,
        dropLng:          record.dropLng,
        // Pickup GPS — preserve from hail-start
        pickupLat:        meta?.pickupLat ?? null,
        pickupLng:        meta?.pickupLng ?? null,
        // Payment — PascalCase + lowercase + method/boolean aliases
        PaymentType:      payType,
        paymentType:      payType,
        paymentMethod:   (['card','eftpos'].includes(payType) ? 'card'
                        : ['account','total_mobility','acc'].includes(payType) ? 'account'
                        : 'cash'),
        cashPayment:    ['cash','gift_card'].includes(payType),
        cardPayment:    ['card','eftpos'].includes(payType),
        accountPayment: ['account','total_mobility','acc'].includes(payType),
        // Driver / vehicle context — SA portal earnings grouping
        DriverId:         d.id ?? '',
        VehicleId:        d.vehicleId ?? '',
        vehicleId:        d.vehicleId ?? '',
        DriverCost:       record.fare,
        driverName:       record.driverName,
        // v22az: dispatch console field-map aliases (same set added to completeJob)
        TarriffType:      tariff.name,
        ...(tariff.id ? { TarriffId: tariff.id } : {}),
        ppname:           'Street Pickup',
        AccountId:        '',                            // hail trip — no passenger phone
        drivername:       record.driverName,
        CallSign:         d.vehicleId ?? '',
        VehicleNo:        d.vehicleId ?? '',
        TotalTime:        fmtMinSec(secs),
        BookingSource:    'Hail',
        bookingidx:       record.bookingId,
        Id:               record.bookingId,
        PickLatLng:       (meta?.pickupLat != null && meta?.pickupLng != null)
                            ? `${meta.pickupLat.toFixed(6)},${meta.pickupLng.toFixed(6)}`
                            : '',
        EstimatedDistance: record.distanceKm,
        Recieve_payment:  record.fare,
        paymentStatus:    'paid',
        PaymentStatus:    'paid',
        // Timeline timestamps — NZ-local ISO without Z
        ActiveAt:         nzLocalISO(meta?.startedAt ? new Date(meta.startedAt) : new Date()),
        JobCompleteTime:  nzLocalISO(),
        newcompelete:     nzLocalISO(),
        // TM extras (only included when TM trip)
        ...(payType === 'total_mobility' ? {
          TmVoucherNo:      effPay?.tmVoucherNo ?? '',
          tmVoucherNo:      effPay?.tmVoucherNo ?? '',
          cardNumber:       effPay?.tmVoucherNo ?? '',
          TmPassengerName:  effPay?.tmPassengerName ?? '',
          TmTripCategory:   effPay?.tmTripCategory  ?? 'other',
          TmPassengerPays:  effPay?.tmPassengerPays ?? 0,
          tmSubsidy:        parseFloat((fare - (effPay?.tmPassengerPays ?? 0)).toFixed(2)),
          tmSubsidyFare:    parseFloat((fare - (effPay?.tmPassengerPays ?? 0)).toFixed(2)),
        } : {}),
        // Card extras
        ...(payType === 'card' ? {
          CardLastFour: effPay?.cardLastFour ?? '',
          CardHolder:   effPay?.cardHolder   ?? '',
          CardExpiry:   effPay?.cardExpiry   ?? '',
        } : {}),
        // ACC / account extras
        ...((payType === 'account' || payType === 'acc') ? {
          accClientRef:    effPay?.accClientRef    ?? '',
          accClientId:     effPay?.accClientId     ?? '',
          accResolvedName: effPay?.accResolvedName ?? '',
          accClaimNo:      effPay?.accClaimNo      ?? '',
          accPoNumber:     effPay?.accPoNumber     ?? '',
        } : {}),
      };
      // 22c cutover: allbookings + rideStatus direct writes removed. Server's
      // command:'complete' handler stamps both nodes from the POST payload.
      void _allbookingsHailUpdate;

      // OTA22c2 (driver-dev URGENT): server §FIX-HAIL now lands hail
      // bookings in BookingStatus:'Active' at version 1 (driver pre-attached
      // when /api/job/create sees source:'hail' + driverId + vehicleId).
      // Complete must therefore go through /api/job/command — the legacy
      // /api/job/sync-offline-trip path expects Pending and was silently
      // failing post §FIX-HAIL, causing app-hang on Complete + ghost-offer
      // popups on relaunch. Payload below mirrors the dispatch contract
      // schema the dev shipped (paymentMethod / paymentSplit / tariffId /
      // waitingCost / extras / endTime / finalDropAddress / distance /
      // duration) AND retains our existing fields (additive — server can
      // read whichever it knows).
      if (d.passforlink) {
        const _hailSplitParts = effPay?.splitParts ?? null;
        sendOrQueueJobCommand({
          passforlink: d.passforlink,
          bookingId: record.bookingId,
          command: 'complete',
          ifVersion: 1, // §FIX-HAIL: hail bookings start at v1
          clientRequestId: newClientRequestId(),
          payload: {
            companyId: d.companyId,
            driverId: d.id,
            vehicleId: d.vehicleId,
            // ── Dispatch contract spec (driver dev, locked) ─────────────
            fare: parseFloat(fare.toFixed(2)),
            distance: parseFloat(distKm.toFixed(3)),
            duration: secs,
            paymentMethod: payType,
            paymentSplit: _hailSplitParts,
            tariffId: String(tariff?.id ?? ''),
            waitingCost,
            extras: extrasItems ?? [],
            endTime: nowISO,
            finalDropAddress: dropAddress,
            // ── Existing additive fields (retained for SA portal parity) ─
            fareBase: tariff.flagFall,
            fareTime: waitingCost,
            fareDistance: distanceCost,
            fareExtras: extrasTotal ?? 0,
            fareCurrency: 'NZD',
            distanceKm: record.distanceKm,
            durationSecs: record.durationSecs,
            paymentType: payType,
            tariffName: tariff.name,
            waitingMins: (tariff?.waitingPerMin ?? 0) > 0 ? Math.round((waitingCost / tariff.waitingPerMin) * 100) / 100 : 0,
            pickupAddress: meta?.pickupAddress ?? '',
            dropAddress,
            pickupLat: meta?.pickupLat ?? null,
            pickupLng: meta?.pickupLng ?? null,
            dropLat: record.dropLat ?? null,
            dropLng: record.dropLng ?? null,
            pickedUpAt: meta?.startedAt ?? nowISO,
            completedAt: nowISO,
            meterOnAt: meterOnAtRef.current ?? meta?.startedAt ?? nowISO,
            meterOffAt: meterOffAtRef.current ?? nowISO,
            tmVoucherNo: payType === 'total_mobility' ? (effPay?.tmVoucherNo ?? null) : null,
            tmPassengerName: payType === 'total_mobility' ? (effPay?.tmPassengerName ?? null) : null,
            tmTripCategory: payType === 'total_mobility' ? (effPay?.tmTripCategory ?? null) : null,
            tmPassengerPays: payType === 'total_mobility' ? (effPay?.tmPassengerPays ?? null) : null,
            tmSubsidy: payType === 'total_mobility' && typeof effPay?.tmPassengerPays === 'number' ? parseFloat((fare - effPay.tmPassengerPays).toFixed(2)) : null,
            cardLastFour: payType === 'card' ? (effPay?.cardLastFour ?? null) : null,
            cardHolder: payType === 'card' ? (effPay?.cardHolder ?? null) : null,
            cardExpiry: payType === 'card' ? (effPay?.cardExpiry ?? null) : null,
            accClientRef: (payType === 'account' || payType === 'acc') ? (effPay?.accClientRef ?? null) : null,
            accClientId: (payType === 'account' || payType === 'acc') ? (effPay?.accClientId ?? null) : null,
            accClaimNo: (payType === 'account' || payType === 'acc') ? (effPay?.accClaimNo ?? null) : null,
            accPoNumber: (payType === 'account' || payType === 'acc') ? (effPay?.accPoNumber ?? null) : null,
            giftCardCode: effPay?.giftCardCode ?? null,
            extrasItems: extrasItems ?? [],
            extrasTotal: extrasTotal ?? 0,
            source: 'hail',
            bookingType: meta?.bookingType ?? 'taxi',
          },
        }).catch(() => {});
      }
    }

    // Save trip summary to device storage so uploadPendingTrips sends a real fare
    // (not null/zero) when it flushes the journal entries for this hail job.
    // Must happen AFTER fare/secs/dist are computed above.
    const hailBookingId = meta?.bookingId ?? record.bookingId;
    if (hailBookingId) {
      const hailPayMethod = (effPayment?.type === 'card' || effPayment?.type === 'eftpos') ? 'card'
        : (effPayment?.type === 'total_mobility') ? 'total_mobility'
        : (effPayment?.type === 'account') ? 'account'
        : 'cash';
      saveTripSummary({
        jobId:          hailBookingId,
        companyId:      d.companyId ?? '',
        driverId:       d.id        ?? '',
        vehicleId:      d.vehicleId ?? '',
        passengerName:  '',
        pickupAddress:  meta?.pickupAddress ?? '',
        dropoffAddress: dropAddress,
        pickupTime:     meta?.startedAt ?? nowISO,
        dropoffTime:    nowISO,
        duration_mins:  parseFloat((secs / 60).toFixed(1)),
        distance_km:    parseFloat(distKm.toFixed(2)),
        fare: {
          base:           tariff.flagFall,
          distanceCharge: distanceCost,
          timeCharge:     waitingCost,
          extras:         0,
          total:          parseFloat(fare.toFixed(2)),
          currency:       'NZD',
        },
        payment: {
          method:    hailPayMethod,
          cardLast4: effPayment?.cardLastFour ?? null,
          receiptNo: `RCP-${hailBookingId}`,
        },
        status:           'Completed',
        completedOffline: !isConnectedRef.current,
      }).then(() => {
        // v12-ota22c4 #4: block any future re-offer for this hail bookingId.
        markBookingLocallyCompleted(hailBookingId);
        // Upload immediately now the summary is written — avoids a reconnect event
        // flushing the pending list before the summary reaches storage.
        runPendingUpload().catch(() => {});
      }).catch(() => {});
    }

    // OTA22c2 (driver-dev URGENT §FIX-HAIL): legacy
    // POST /api/job/sync-offline-trip REMOVED for hail trips. Server now
    // lands hail bookings in BookingStatus:'Active' at version 1 (when
    // /api/job/create is called with source:'hail' + driverId + vehicleId)
    // — the legacy endpoint expects Pending and was silently failing,
    // causing app-hang on Complete + ghost-offer popups on relaunch. The
    // /api/job/command 'complete' call above is now the sole hail-complete
    // server write. Dispatch trips still use sync-offline-trip (different
    // bookingStatus, different flow — untouched).

    // Surface the rating prompt (subject to frequency cap). Hail trips have no
    // passenger contact info, so phone/name will be empty — that's expected.
    requestRating({
      bookingId: hailBookingId,
      source:    'hail',
      fare:      parseFloat(fare.toFixed(2)),
    });

    } catch (err: any) {
      // v12-ota18: completion errors used to crash the app silently. Now surface them.
      console.error('[completeHailTrip CRASH]', err);
      try { Alert.alert('Trip completion error', `${err?.message ?? err}\n\nThe trip may not have uploaded — please check Trips list.`); } catch {}
    }
  };

  const setActiveTariff = (t: Tariff) => {
    if (meterRunningRef.current) {
      tariffChangesRef.current.push({
        tariff: t,
        changedAt: new Date().toISOString(),
        distanceKm: meterDistanceRef.current,
        seconds: meterSecondsRef.current,
      });
    }
    activeTariffRef.current = t;
    setActiveTariffState(t);
    // v22c-d4: remember last-used tariff across sessions so the picker
    // pre-selects what the driver was actually using. Skip Total Mobility
    // (auto-selected per-trip when the booking has TM flags).
    try {
      const nm = String(t?.name ?? '').toLowerCase();
      if (!nm.includes('total mobility') && !nm.includes('tm ')) {
        import('@/lib/lastPickerDefaults').then(m => m.saveLastTariffId(t.id)).catch(() => {});
      }
    } catch {}
    // v22be: live tariff write to online/current so dispatch sees the active
    // tariff during the trip (HQ spec asked for this so they don't have to
    // wait until completion to know which tariff is in effect).
    const d = driverRef.current;
    if (d?.companyId && d?.vehicleId && meterRunningRef.current) {
      update(ref(database, `online/${d.companyId}/${d.vehicleId}/current`), {
        currentTariffId:   String(t.id ?? ''),
        currentTariffName: t.name ?? '',
      }).catch(() => {});
    }
  };

  // Fare = flag fall + distance rate (when moving) + waiting charge (continuous per-second accumulation)
  // meterWaitingCost accumulates waitingPerMin/waitingInterval every second while stopped,
  // so the fare ticks up in real-time rather than jumping only at full-interval boundaries.
  const meterFare = activeTariff.flagFall
    + meterDistance * activeTariff.ratePerMile
    + meterWaitingCost;

  // ── PERFORMANCE: memoize the context value ─────────────────────────────────
  // Without this, every state change in DriverProvider creates a brand-new
  // value object, forcing every consumer of useDriver() to re-render even when
  // the field they care about hasn't changed. Meter screen was re-rendering
  // many times per second during a trip — that's why buttons needed multiple
  // presses (touches dropped during the re-render burst). The deps array lists
  // every value passed; setters/functions/refs are stable so don't need listing.
  const ctxValue = useMemo(() => ({
    driver,
    status, setStatus,
    jobs, offeredJobs, currentJob, queuedJobs, completedJobs,
    acceptJob, acceptJobToQueue, rejectJob, recallJob, completeJob,
    incomingJob, dismissIncoming,
    shiftActive, currentShift, shiftHistory, startShift, endShift,
    breakActive, breakStartMs, todayBreakMs, weeklyWorkMinutes, lastShiftEndMs, shiftBlocked, startBreak, endBreak,
    // v12-ota18: chatThreads/sendChatMessage/quickReplies moved to useDriverChat()
    // v12-ota18: isOnline/isSyncing/pendingQueueCount/pendingUploadCount moved to useDriverSync()
    meterRunning, meterPaused,
    meterIsWaiting, meterWaitingIntervals,
    startMeter, pauseMeter, stopMeter, cancelTrip,
    submitTripRating, pendingRating, clearPendingRating,
    addMeterDistance,
    availableTariffs, activeTariff, setActiveTariff,
    isConnected,
    hailJobs, claimHailJob, createPendingJob, takenAlert, dismissTakenAlert,
    cancelledJobAlert, clearCancelledJobAlert,
    systemAlert, clearSystemAlert,
    hailTripMeta, startHailTrip, completeHailTrip,
    seatCapacity, vehicleTypeCode,
    storePushToken,
    getLastGpsPosition: () => lastGpsPositionRef.current,
    // v12-ota14: snapshot getter for callbacks (Alert messages, completion
    // captures) that need the current meter values at click time WITHOUT
    // subscribing the parent component to per-second tick re-renders.
    getMeterSnapshot: () => ({
      fare: (activeTariff.flagFall
        + meterDistanceRef.current * activeTariff.ratePerMile
        + meterWaitingCostRef.current),
      dist: meterDistanceRef.current,
      secs: meterSecondsRef.current,
      waitingCost: meterWaitingCostRef.current,
    }),
    resumedJob, clearResumedJob,
  }), [
    driver, status,
    jobs, offeredJobs, currentJob, queuedJobs, completedJobs,
    incomingJob,
    shiftActive, currentShift, shiftHistory,
    breakActive, breakStartMs, todayBreakMs, weeklyWorkMinutes, lastShiftEndMs, shiftBlocked,
    meterRunning, meterPaused,
    meterIsWaiting, meterWaitingIntervals,
    pendingRating,
    availableTariffs, activeTariff,
    isConnected,
    hailJobs, takenAlert,
    cancelledJobAlert,
    systemAlert,
    hailTripMeta,
    seatCapacity, vehicleTypeCode,
    resumedJob,
  ]);

  // v12-ota18: chat-only context. Tab bar + chat screens consume this; chat
  // messages no longer re-render Profile/SignOut/all other screens.
  const chatValue = useMemo(() => ({
    chatThreads, sendChatMessage, quickReplies,
  }), [chatThreads, quickReplies]); // sendChatMessage stable

  // v12-ota18: sync/network context. The OfflineBanner + meter screens watch
  // these; queue drains during trip completion no longer churn every screen.
  // v12-ota22k: replaced the dangerous bulk-clear with a per-trip review API.
  //   - getStuckTripsDetail() returns full info per trip (fare, payment, error)
  //   - clearStuckTrip(jobId) removes ONE trip after the driver explicitly
  //     acknowledged its fare on the Profile "Review Stuck Uploads" screen.
  //   - retryPendingNow() lets the driver kick off an upload manually.
  const syncValue = useMemo(() => ({
    isOnline, isSyncing, pendingQueueCount, pendingUploadCount,
    getStuckTripsDetail: async (): Promise<StuckTripDetail[]> => {
      return getStuckTripsDetail();
    },
    clearStuckTrip: async (jobId: string): Promise<boolean> => {
      const ok = await clearSpecificStuckTrip(jobId);
      if (ok) {
        const next = await getPendingCount();
        setPendingUploadCount(next);
      }
      return ok;
    },
    retryPendingNow: async (): Promise<void> => {
      await runPendingUpload();
    },
  }), [isOnline, isSyncing, pendingQueueCount, pendingUploadCount]);

  // v12-ota13: high-frequency tick values live in their own context so
  // ticking the meter (every 1s) and GPS updates (every 1-3s) re-render
  // ONLY the screens that actually display them (home / meter / job-details).
  // Previously these lived in the main DriverContext and forced every screen
  // (book, chat, shift, profile) to re-render every second — that was the
  // real cause of buttons feeling dead on the Samsung A04.
  const tickValue = useMemo(() => ({
    meterSeconds, meterDistance, meterFare, meterWaitingCost,
  }), [meterSeconds, meterDistance, meterFare, meterWaitingCost]);

  // v12-ota17: GPS in its own context so the native driver-map (LiveDriverMap)
  // does NOT reconcile every meter tick — only when GPS actually changes.
  // Previously the map re-rendered every 1s from meter ticks PLUS every GPS
  // update, doing react-native-maps bridge work each time. On Home tab the
  // map stays mounted while the user is on Profile/Chat, so that bridge work
  // was blocking the JS thread and making sign-out need ~20 presses.
  const gpsValue = useMemo(() => ({
    currentGps, currentSpeedKmh,
  }), [currentGps, currentSpeedKmh]);

  // v12-ota16: fleet data updates every time ANY driver in the company sends
  // a heartbeat (1-10 times/sec on a busy fleet). Previously this lived in
  // the main ctxValue, so EVERY useDriver() consumer (tab bar, sign-out,
  // accept-offer button, all global wrappers) re-rendered on every heartbeat.
  // Moving these to a dedicated context isolates the churn to the 5 screens
  // that actually display fleet/zone data.
  const fleetValue = useMemo(() => ({
    onlineDrivers, myZoneInfo,
  }), [onlineDrivers, myZoneInfo]);

  return (
    <DriverContext.Provider value={ctxValue}>
      <DriverChatContext.Provider value={chatValue}>
        <DriverSyncContext.Provider value={syncValue}>
          <DriverFleetContext.Provider value={fleetValue}>
            <DriverGpsContext.Provider value={gpsValue}>
              <DriverTickContext.Provider value={tickValue}>
                {children}
              </DriverTickContext.Provider>
            </DriverGpsContext.Provider>
          </DriverFleetContext.Provider>
        </DriverSyncContext.Provider>
      </DriverChatContext.Provider>
    </DriverContext.Provider>
  );
}

export function useDriver() {
  const ctx = useContext(DriverContext);
  if (!ctx) throw new Error('useDriver must be used within DriverProvider');
  return ctx;
}

// v12-ota13: separate context for high-frequency tick values.
// v12-ota17: GPS fields removed — moved to DriverGpsContext below.
type DriverTickContextType = {
  meterSeconds: number;
  meterDistance: number;
  meterFare: number;
  meterWaitingCost: number;
};
const DriverTickContext = createContext<DriverTickContextType | null>(null);
export function useDriverTick(): DriverTickContextType {
  const ctx = useContext(DriverTickContext);
  if (!ctx) throw new Error('useDriverTick must be used within DriverProvider');
  return ctx;
}

// v12-ota18: chat context — chatThreads/sendChatMessage/quickReplies. Tab bar
// + chat screens consume this so dispatcher chat msgs don't re-render Profile.
type DriverChatContextType = {
  chatThreads: ChatThread[];
  sendChatMessage: (threadId: string, body: string) => Promise<void>;
  quickReplies: string[];
};
const DriverChatContext = createContext<DriverChatContextType | null>(null);
export function useDriverChat(): DriverChatContextType {
  const ctx = useContext(DriverChatContext);
  if (!ctx) throw new Error('useDriverChat must be used within DriverProvider');
  return ctx;
}

// v12-ota18: sync/network context — isOnline, isSyncing, pendingQueueCount,
// pendingUploadCount. Consumed by <OfflineBanner> + Meter/Home pending banners.
// Queue drains during trip completion no longer churn every other screen.
type DriverSyncContextType = {
  isOnline: boolean;
  isSyncing: boolean;
  pendingQueueCount: number;
  pendingUploadCount: number;
  getStuckTripsDetail: () => Promise<StuckTripDetail[]>;
  clearStuckTrip: (jobId: string) => Promise<boolean>;
  retryPendingNow: () => Promise<void>;
};
const DriverSyncContext = createContext<DriverSyncContextType | null>(null);
export function useDriverSync(): DriverSyncContextType {
  const ctx = useContext(DriverSyncContext);
  if (!ctx) throw new Error('useDriverSync must be used within DriverProvider');
  return ctx;
}

// v12-ota17: GPS-only context. Consumers: <LiveDriverMap>, <WebViewGpsInjector>,
// <GpsRefSyncer>, <MeterPanelSpeedPill>. They no longer re-render every meter
// tick — only when GPS state actually changes (already throttled to 15m/15s
// in the watcher; speed throttled to nearest 5 km/h).
type DriverGpsContextType = {
  currentGps: { lat: number; lng: number } | null;
  currentSpeedKmh: number;
};
const DriverGpsContext = createContext<DriverGpsContextType | null>(null);
export function useDriverGps(): DriverGpsContextType {
  const ctx = useContext(DriverGpsContext);
  if (!ctx) throw new Error('useDriverGps must be used within DriverProvider');
  return ctx;
}

// v12-ota16: separate context for fleet/zone data (high-frequency Firebase
// heartbeats from other drivers). Only home, meter, shift, chat-thread, and
// job-detail screens consume this.
type DriverFleetContextType = {
  onlineDrivers: OnlineDriver[];
  myZoneInfo: MyZoneInfo | null;
};
const DriverFleetContext = createContext<DriverFleetContextType | null>(null);
export function useDriverFleet(): DriverFleetContextType {
  const ctx = useContext(DriverFleetContext);
  if (!ctx) throw new Error('useDriverFleet must be used within DriverProvider');
  return ctx;
}
