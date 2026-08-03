import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { get, onValue, ref, update } from 'firebase/database';
import { getDatabaseInstance, isFirebaseReady } from '@/lib/firebase';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { collectJobNotes } from '@/lib/jobNotes';
import { parseSchedulingMetaFromRecord } from '@/lib/jobDisplayMeta';
import { loadCompanyInfo } from '@/lib/company';
import { EarningsBreakdown, sumBreakdown } from '@/lib/earnings';
import { HistoryJob, loadDriverJobHistory } from '@/lib/jobHistory';
import { loadDriverVehicles } from '@/lib/vehicles';
import {
  assertVehicleAvailableForShift,
  fetchVehicleShiftLocks,
  mergeVehicleShiftLocks,
  subscribeVehicleShiftLocks,
  VehicleShiftLock,
} from '@/lib/vehicleShiftLock';
import { acceptJobOffer, cancelJobAsDriver, completeJobPayment, createHailJobOnDispatch, declineJobOffer, DispatchApiError, isDispatchAcceptRetryable, markSosResponderArrived, newClientTripId, promoteQueuedJob, pruneDriverQueueOnDispatch, recallJobOnDispatch, reportNoShow, respondToDriverSos, StageTransportError, syncJobStageOnDispatch, withdrawSosResponse } from '@/lib/dispatchApi';
import {
  catchUpJobStagesOnDispatch,
  isTerminalBookingStatus,
  localActiveJobLostOnServer,
  localStageFromServerStatus,
  resolveServerBookingState,
  serverStatusIndex,
} from '@/lib/jobServerSync';
import { dispatchJournalKey, isProvisionalBookingId, isValidBookingId, localJobIdFromClientTripId, normalizeBookingId, resolveJournalClientTripId } from '@/lib/bookingId';
import { flushTripJournal } from '@/lib/tripJournalFlush';
import {
  appendTripJournalEvent,
  createPendingHailJournal,
  ensureDispatchTripJournal,
  ensureJournalForJob,
} from '@/services/tripJournalService';
import {
  loadPendingSyncBanner,
  resolvePendingSyncBanner,
  savePendingSyncBanner,
  type PendingSyncBanner,
} from '@/lib/pendingSyncBanner';
import {
  clearChatNotification,
  clearDriverNotification,
  clearSosNotification,
  jobIdsMatch,
  readNotificationJobId,
  readNotificationType,
} from '@/lib/driverNotifications';
import { playInAppNotificationSound, alertDriverToOffer } from '@/lib/notificationSound';
import { subscribeChat } from '@/lib/chatService';
import { subscribeDriverQueue, filterLiveDriverQueueOffers } from '@/lib/driverQueue';
import { subscribePendingJobs } from '@/lib/pendingJobs';
import {
  findStaleDirectOfferIds,
  shouldSuppressReturnedPoolOffer,
} from '@/lib/offerReconciliation';
import {
  connectionNoticeForTransition,
  dispatchIsConnected,
  offerAcceptanceIsAllowed,
  tripJournalFlushIsAllowed,
  type DispatchConnectionNotice,
} from '@/lib/dispatchConnectionPolicy';
import {
  incomingSosAlertToNotificationData,
  parseIncomingSosAlert,
  parseIncomingSosResolved,
  type IncomingSosAlert,
} from '@/lib/sosAlert';
import {
  getDriverSosResponseState,
  isSosEmergencyActive,
  purgeStaleSosNotifications,
} from '@/lib/sosEmergency';
import {
  isFixedPriceBooking,
  readBookingTariffHints,
  readFixedFareAmount,
  readFixedFareFromBooking,
  resolveTariffFromList,
  sanitizeMeterTariff,
  sanitizeSelectedTariff,
  shouldStartMeterForBooking,
} from '@/lib/tariffResolve';
import { notifySosAlert } from '@/services/notificationService';
import { enqueueOfflineItem, flushOfflineQueue, subscribeConnectivity } from '@/services/offlineService';
import {
  clearOnlinePresence,
  isPresenceSessionEnded,
  isVehicleStatusAvailable,
  markPresenceSessionEnded,
  moveDriverToEndOfQueue,
  repairOnlinePresence,
  getPresenceWriteDiagnostics,
  setPresenceOfferPending,
  startPresenceHeartbeat,
  startShiftOnline,
  stopPresenceHeartbeat,
  subscribeFirebaseRtdbConnected,
  syncZonePresenceFields,
  updatePresenceHeartbeatStatus,
  writeOnlinePresence,
  FirebaseDriverStatus,
} from '@/services/presenceService';
import { subscribeCompanyTariffs } from '@/lib/companyTariffs';
import { isForbiddenPlaceholderTariffName } from '@/lib/tariffGuard';
import { markBookingCompleted } from '@/lib/allbookings';
import { writeClosedJob } from '@/lib/closedJobs';
import {
  closedJobFieldsForCompleteApi,
  closedJobFieldsForJournal,
} from '@/lib/closedJobSync';
import {
  bindPendingClosedJobServerId,
  flushPendingClosedJobs,
  removePendingClosedJob,
  upsertPendingClosedJob,
} from '@/lib/pendingClosedJob';
import {
  flushPendingShiftEnds,
  journalPresenceClearFailure,
} from '@/lib/pendingShiftEnd';
import { CompanyZone, findZoneAtCoords, subscribeCompanyZones } from '@/lib/companyZones';
import { getCurrentCoords, refreshHailPickupLocation } from '@/services/locationService';
import { patchOnlineCurrentJobId } from '@/lib/liveMeterPresence';
import * as Location from 'expo-location';
import {
  diffBookingChanges,
  isReturnedToDispatchPool,
  parseBookingNode,
  stageAllowsMeter,
  subscribeBooking,
  verifyJobStageOnFirebase,
} from '@/lib/bookingSync';
import { subscribeActiveJobFirebaseWatch } from '@/lib/activeJobPresenceWatch';
import {
  NZTA_BREAK_REMINDER_MESSAGE,
  NZTA_SHIFT_LIMIT_SIGNOUT_MESSAGE,
  NZTA_WEEKLY_LIMIT_SIGNOUT_MESSAGE,
  exceedsMaxShiftHours,
  exceedsWeeklyHours,
  getShiftLockout,
  initializeNztaOnLogin,
  loadNztaHours,
  markBreakReminderShown,
  needsBreak,
  setPendingLimitSignOut,
  tickWorkedMinutes,
  type EndShiftReason,
  type EndShiftSummary,
} from '@/services/nztaService';
import { notifyBreakReminder } from '@/services/notificationService';
import { createInitialMeter, watchMeter } from '@/services/meterEngine';
import { disableWakeLock, enableWakeLock } from '@/services/wakeLock';
import { calcMeterBreakdown, isTariffConfigured, NO_TARIFF_CONFIGURED, parseFiniteFare } from '@/lib/tariffs';
import {
  completionErrorMessage,
  persistActiveJobAsync,
  persistMeterAsync,
} from '@/lib/tripCompletionHelpers';
import { JobStepTimes, PaymentExtras, TariffChangeRecord } from '@/types';
import {
  ActiveJob,
  CompanyInfo,
  CompletedJob,
  JobOffer,
  JobStage,
  MainPanelTab,
  MeterState,
  PaymentType,
  PresenceDisplayStatus,
  QueuedOffer,
  Tariff,
  TmPaymentDetails,
  Vehicle,
  ZoneInfo,
} from '@/types';
import { useAuth } from '@/context/AuthContext';
import { router } from 'expo-router';

export type DriverInAppBannerState =
  | { kind: 'chat'; message: string }
  | { kind: 'sos'; message: string; alert: IncomingSosAlert };

export type DriverConnectionNotice = DispatchConnectionNotice;

interface DriverContextValue {
  presenceStatus: PresenceDisplayStatus;
  readyForJobs: boolean;
  shiftActive: boolean;
  selectedVehicleId: string;
  vehicles: Vehicle[];
  vehiclesLoading: boolean;
  zone: ZoneInfo;
  companyZones: CompanyZone[];
  jobOffer: JobOffer | null;
  paymentJob: ActiveJob | null;
  activeJob: ActiveJob | null;
  nextQueuedOffer: QueuedOffer | null;
  hailActive: boolean;
  hailPickupAddress: string | null;
  meter: MeterState | null;
  tariffs: Tariff[];
  selectedTariff: Tariff;
  queuedOffers: QueuedOffer[];
  broadcastOffers: JobOffer[];
  /** Pool offers from pendingjobs/ (U-A while busy) merged with direct broadcast offers. */
  visibleOffers: JobOffer[];
  /** @deprecated use visibleOffers */
  pendingOffers: JobOffer[];
  /** Dispatch en-route: Offers tab hidden from accept until On Board (hail exempt). */
  offersLockedForEnrouteDispatch: boolean;
  offersBadgeCount: number;
  preferredPanelTab: MainPanelTab | null;
  clearPreferredPanelTab: () => void;
  activeVehicle: Vehicle | undefined;
  jobEditNotice: string | null;
  completedJobs: CompletedJob[];
  jobHistory: HistoryJob[];
  jobHistoryLoading: boolean;
  sessionEarnings: EarningsBreakdown;
  historyEarnings: EarningsBreakdown;
  company: CompanyInfo | null;
  activeVehicleBodyType: string;
  isOffline: boolean;
  connectionNotice: DriverConnectionNotice;
  /** Phase 5d — persistent until cancel/no-show/stage journal flush completes. */
  syncingBanner: string | null;
  setSelectedVehicleId: (id: string) => void;
  refreshVehicles: () => Promise<void>;
  refreshJobHistory: () => Promise<void>;
  startShift: (vehicleId?: string) => Promise<boolean>;
  endShift: () => Promise<void>;
  endShiftAndSignOut: () => Promise<void>;
  endShiftInProgress: boolean;
  endShiftSummary: EndShiftSummary | null;
  acknowledgeEndShiftSummary: () => void;
  togglePresence: () => Promise<void>;
  acceptOffer: () => Promise<void>;
  declineOffer: (opts?: { timedOut?: boolean }) => Promise<void>;
  advanceStage: () => Promise<void>;
  setPaymentType: (payment: PaymentType) => void;
  completeJob: () => Promise<void>;
  finalizePayment: (
    paymentType: string,
    extras: PaymentExtras,
    totalFare: number,
    tmDetails?: TmPaymentDetails,
  ) => Promise<void>;
  dismissPayment: () => void;
  completionBusy: boolean;
  completionError: string | null;
  clearCompletionError: () => void;
  cancelActiveJob: () => Promise<void>;
  noShowActiveJob: () => Promise<void>;
  recallJob: () => Promise<void>;
  recallQueuedOffer: (offerId: string) => Promise<void>;
  startHail: () => Promise<void>;
  endHail: () => Promise<void>;
  /** Stop a running meter left open with no active job or hail (idle Current tab). */
  clearOrphanedIdleMeter: () => Promise<void>;
  endTrip: () => Promise<void>;
  pauseMeter: () => void;
  toggleWaitMeter: () => void;
  tariffLocked: boolean;
  setSelectedTariff: (t: Tariff) => void;
  dismissJobEditNotice: () => void;
  pickOfferFromList: (offerId: string) => Promise<void>;
  canReceiveJobOffers: boolean;
  goAway: () => Promise<void>;
  goAvailable: () => Promise<void>;
  hasTripInProgress: boolean;
  /** Status-bar lifecycle display (label/color only — not server stage). */
  tripDisplayPhase: DriverTripDisplayPhase;
  tripDisplayLabel: string;
  tripDisplayColor: string;
  /** GPS within ~50m of pickup — prompts Arrived button. */
  nearPickup: boolean;
  tripOnTheWay: boolean;
  inAppBanner: DriverInAppBannerState | null;
  dismissInAppBanner: () => void;
  incomingSosAlert: IncomingSosAlert | null;
  incomingSosResolved: boolean;
  incomingSosResolvedMessage: string;
  sosResponding: boolean;
  incomingSosResponseCommitted: boolean;
  openIncomingSosMap: () => void;
  handleSosNotificationOpen: (alert: IncomingSosAlert) => void;
  respondToIncomingSos: () => Promise<void>;
  withdrawIncomingSosResponse: () => Promise<void>;
  markIncomingSosArrived: () => Promise<void>;
  exitIncomingSosAlertScreen: () => void;
  clearIncomingSosAlert: () => void;
  dismissIncomingSosAlert: () => void;
  chatUnreadCount: number;
  markChatViewed: () => void;
  markChatTabBlurred: () => void;
}

const DriverContext = createContext<DriverContextValue | null>(null);

const EMPTY_ZONE: ZoneInfo = {
  name: '',
  position: 0,
  totalInQueue: 0,
  nearbyDrivers: 0,
};

import { parseZoneFromOnlineNode } from '@/lib/zoneQueue';
import {
  haversineMeters,
  resolveTripDisplayPhase,
  tripDisplayStyle,
  type DriverTripDisplayPhase,
} from '@/lib/driverTripDisplay';

function fmtNzDate(d: Date) {
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtNzTime(d: Date) {
  return d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function isOfferPayload(val: Record<string, unknown>): boolean {
  return !!(
    val.pickup ||
    val.from ||
    val.dropoff ||
    val.to ||
    val.jobId ||
    val.id ||
    val.jobpickup ||
    val.jobdropoff ||
    val.joboffer ||
    val.bookingid ||
    val.bookingId
  );
}

/** Edit/lifecycle notifications must reach drivers during enroute active jobs (offer gate off). */
function notificationBypassesOfferGate(val: Record<string, unknown>): boolean {
  const type = readNotificationType(val);
  const eventType = String(val.eventType ?? val.type ?? '').toLowerCase();
  if (type === 'job_updated' || val.editNotice) return true;
  if (type === 'job_removed' || type === 'job_cancelled' || type === 'no_show') return true;
  if (eventType === 'assigned' || eventType === 'accepted' || eventType === 'queued') return true;
  return false;
}

function extractOfferPayloads(val: unknown): Record<string, unknown>[] {
  if (!val || typeof val !== 'object') return [];
  if (Array.isArray(val)) {
    return val.filter(
      (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
    );
  }
  const rec = val as Record<string, unknown>;
  if (isOfferPayload(rec)) return [rec];
  return Object.values(rec).filter((x): x is Record<string, unknown> => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
    return isOfferPayload(x as Record<string, unknown>);
  });
}

function parseJobOffer(val: Record<string, unknown>): JobOffer {
  const scheduling = parseSchedulingMetaFromRecord(val);
  const allNotes = collectJobNotes(val);
  const primaryNote = allNotes.map((n) => n.text).join('\n\n') || undefined;
  const rawFare = val.fare ?? val.jobfare ?? val.jobFare;
  const offerFare =
    parseFiniteFare(val.CustomeRate) ??
    parseFiniteFare(val.customRate) ??
    parseFiniteFare(val.jobFare) ??
    parseFiniteFare(val.fixedFare) ??
    parseFiniteFare(rawFare);
  const fixedPrice = isFixedPriceBooking(val);
  const rawPayment = val.payment ?? val.jobpayment ?? val.paymentType ?? val.PaymentType ?? val.paymentMethod;
  const rawId = val.id ?? val.jobId ?? val.joboffer ?? val.bookingid ?? val.bookingId ?? val.BookingId ?? '';
  const idStr = normalizeBookingId(rawId);
  if (!isValidBookingId(idStr)) {
    console.warn('[parseJobOffer] missing or invalid booking id — pickup:', val.pickup ?? val.jobpickup);
  }
  return {
    id: idStr || String(rawId || ''),
    type: (val.type as JobOffer['type']) ?? 'Taxi',
    pickup: String(val.pickup ?? val.from ?? val.jobpickup ?? ''),
    dropoff: String(val.dropoff ?? val.to ?? val.jobdropoff ?? ''),
    passengerName: val.passengerName
      ? String(val.passengerName)
      : val.name || val.jobname
        ? String(val.name ?? val.jobname)
        : undefined,
    passengerPhone: val.passengerPhone
      ? String(val.passengerPhone)
      : val.phone || val.JobphoneNo
        ? String(val.phone ?? val.JobphoneNo)
        : undefined,
    passengerEmail: val.passengerEmail ? String(val.passengerEmail) : undefined,
    fixedFare: offerFare,
    estimatedFare: offerFare,
    isFixedPrice: fixedPrice,
    estimatedDistanceKm:
      val.estimatedDistanceKm != null
        ? Number(val.estimatedDistanceKm)
        : val.distanceKm != null
          ? Number(val.distanceKm)
          : undefined,
    paymentType: (val.paymentType ?? val.PaymentType ?? rawPayment) as PaymentType | undefined,
    isAcc: !!val.isAcc,
    isTotalMobility: !!val.isTotalMobility,
    expiresAt: Number(val.expiresAt ?? Date.now() + 30000),
    source: val.source ? String(val.source) : undefined,
    notes: primaryNote ?? (val.notes ? String(val.notes) : undefined),
    allNotes: allNotes.length ? allNotes : undefined,
    dispatcherName: String(val.DispatcherName ?? val.dispatcherName ?? '').trim() || undefined,
    pickupLat: val.pickupLat != null ? Number(val.pickupLat) : val.lat != null ? Number(val.lat) : undefined,
    pickupLng: val.pickupLng != null ? Number(val.pickupLng) : val.lng != null ? Number(val.lng) : undefined,
    dropoffLat: val.dropoffLat != null ? Number(val.dropoffLat) : undefined,
    dropoffLng: val.dropoffLng != null ? Number(val.dropoffLng) : undefined,
    silent: !!val.silent,
    vehicleTypeRequired: val.VehicleType
      ? String(val.VehicleType)
      : val.vehicleType
        ? String(val.vehicleType)
        : undefined,
    passengers:
      val.Passengers != null
        ? Number(val.Passengers)
        : val.passengers != null
          ? Number(val.passengers)
          : undefined,
    serviceTypeRaw: val.ServiceType ? String(val.ServiceType) : val.serviceType ? String(val.serviceType) : undefined,
    originalStatus:
      val.originalStatus === 'manual' || val.manualOffer === true || val.manualOffer === 'true'
        ? 'manual'
        : 'pending',
    returnReason:
      String(val.returnReason ?? val.ReturnReason ?? '').trim() || undefined,
    lastOfferDriverId:
      String(val.lastOfferDriverId ?? val.LastOfferDriverId ?? '').trim() || undefined,
    ...scheduling,
  };
}

type AwayIntent = 'none' | 'manual' | 'missed';

const EMPTY_STEP_TIMES: JobStepTimes = {};
const TRIP_BLOCK_MSG = 'Complete your current job first';

/** Hide Offers-tab pool listings for dispatch jobs from accept until On Board (hail exempt). */
function isDispatchEnrouteOffersLocked(
  activeJob: ActiveJob | null,
  hailActive: boolean,
  meterRunning: boolean,
): boolean {
  if (!activeJob || hailActive || activeJob.source === 'hail') return false;
  if (activeJob.stage === 'onboard' || activeJob.stage === 'complete') return false;
  if (meterRunning) return false;
  return true;
}

function defaultActiveJob(offer: JobOffer): ActiveJob {
  const now = Date.now();
  return {
    ...offer,
    stage: 'pickup',
    startedAt: now,
    distanceKm: 0,
    durationMin: 0,
    fare: parseFiniteFare(offer.fixedFare) ?? parseFiniteFare(offer.estimatedFare) ?? 0,
    stepTimes: { acceptedAt: now },
    tariffChanges: [],
  };
}

function bookingRawSeedFromOffer(offer: JobOffer): Record<string, unknown> | null {
  if (!offer.isFixedPrice) return null;
  return {
    TarriffId: '-1',
    TarriffType: 'Fixed',
    tarriffType: 'Fixed',
    CustomeRate: offer.fixedFare ?? offer.estimatedFare ?? offer.fare ?? '',
    jobFare: offer.fixedFare ?? offer.estimatedFare ?? offer.fare ?? '',
  };
}

function resolveTariffForDriver(
  tariffs: Tariff[],
  hints?: { id?: string; name?: string } | null,
  fallback?: Tariff,
): Tariff | null {
  const resolved = resolveTariffFromList(tariffs, hints);
  if (resolved) return resolved;
  if (fallback && !isForbiddenPlaceholderTariffName(fallback.name)) return fallback;
  return tariffs[0] ?? null;
}

function readFareFromRecord(val: Record<string, unknown>): number | undefined {
  return parseFiniteFare(
    val.EstimatedFare ??
      val.RideCost ??
      val.CustomeRate ??
      val.Fare ??
      val.fixedFare ??
      val.estimatedFare ??
      val.jobFare,
  );
}

function readPaymentFromRecord(val: Record<string, unknown>): string | undefined {
  const pay =
    val.paymentType ?? val.PaymentType ?? val.PaymentMethod ?? val.Recieve_payment ?? val.payment;
  const s = pay != null ? String(pay).trim() : '';
  return s || undefined;
}

function buildNotificationFieldPatch(val: Record<string, unknown>): Partial<JobOffer> {
  const patch: Partial<JobOffer> = { ...parseSchedulingMetaFromRecord(val) };
  const pickup = val.pickup ?? val.jobpickup ?? val.PickAddress;
  if (pickup) patch.pickup = String(pickup);
  const dropoff = val.dropoff ?? val.jobdropoff ?? val.DropAddress;
  if (dropoff) patch.dropoff = String(dropoff);
  const notes = val.notes ?? val.jobinfo ?? val.Notes;
  if (notes) patch.notes = String(notes);
  const name = val.jobname ?? val.Name ?? val.PassengerName ?? val.passengerName;
  if (name) patch.passengerName = String(name);
  const phone = val.JobphoneNo ?? val.PhoneNo ?? val.passengerPhone ?? val.phone;
  if (phone) patch.passengerPhone = String(phone);
  const fare = readFareFromRecord(val);
  if (fare != null) {
    patch.fixedFare = fare;
    patch.estimatedFare = fare;
  }
  if (isFixedPriceBooking(val)) {
    patch.isFixedPrice = true;
  }
  const pay = readPaymentFromRecord(val);
  if (pay) patch.paymentType = pay as PaymentType;
  return patch;
}

function patchJobOfferFromNotification(offer: JobOffer, val: Record<string, unknown>): JobOffer {
  return { ...offer, ...buildNotificationFieldPatch(val) };
}

function isHailTripJob(job: ActiveJob | null | undefined, hailActive: boolean): boolean {
  return hailActive || job?.source === 'hail';
}

function patchActiveJobFromNotification(job: ActiveJob, val: Record<string, unknown>): ActiveJob {
  const patch = buildNotificationFieldPatch(val) as Partial<ActiveJob>;
  if (patch.fixedFare != null) patch.fare = patch.fixedFare;
  else if (patch.estimatedFare != null) patch.fare = patch.estimatedFare;
  return { ...job, ...patch };
}

export function DriverProvider({ children }: { children: ReactNode }) {
  const { driver, signOut } = useAuth();
  const [presenceStatus, setPresenceStatus] = useState<PresenceDisplayStatus>('Offline');
  const [readyForJobs, setReadyForJobs] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [selectedVehicleId, setSelectedVehicleIdState] = useState('');
  const [rawVehicles, setRawVehicles] = useState<Vehicle[]>([]);
  const [vehicleShiftLocks, setVehicleShiftLocks] = useState<Map<string, VehicleShiftLock>>(new Map());
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [zone, setZone] = useState<ZoneInfo>(EMPTY_ZONE);
  const [companyZones, setCompanyZones] = useState<CompanyZone[]>([]);
  const companyZonesRef = useRef<CompanyZone[]>([]);
  const [jobOffer, setJobOffer] = useState<JobOffer | null>(null);
  const [paymentJob, setPaymentJob] = useState<ActiveJob | null>(null);
  const [completionBusy, setCompletionBusy] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [completedJobs, setCompletedJobs] = useState<CompletedJob[]>([]);
  const [jobHistory, setJobHistory] = useState<HistoryJob[]>([]);
  const [jobHistoryLoading, setJobHistoryLoading] = useState(false);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [connectionNotice, setConnectionNotice] =
    useState<DriverConnectionNotice>(null);
  const [syncingBanner, setSyncingBanner] = useState<string | null>(null);
  const [hailActive, setHailActive] = useState(false);
  const [hailPickupAddress, setHailPickupAddress] = useState<string | null>(null);
  const [hailPickupLat, setHailPickupLat] = useState<number | undefined>();
  const [hailPickupLng, setHailPickupLng] = useState<number | undefined>();
  const [meter, setMeter] = useState<MeterState | null>(null);
  const [tariffs, setTariffsState] = useState<Tariff[]>([]);
  const [selectedTariff, setSelectedTariffState] = useState<Tariff>(NO_TARIFF_CONFIGURED);
  const [inAppBanner, setInAppBanner] = useState<DriverInAppBannerState | null>(null);
  const [incomingSosAlert, setIncomingSosAlert] = useState<IncomingSosAlert | null>(null);
  const [incomingSosResolved, setIncomingSosResolved] = useState(false);
  const [incomingSosResolvedMessage, setIncomingSosResolvedMessage] = useState('');
  const [sosResponding, setSosResponding] = useState(false);
  const [incomingSosResponseCommitted, setIncomingSosResponseCommitted] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const chatTabFocusedRef = useRef(false);
  const lastChatNotifyKeyRef = useRef('');
  const lastSosAlertRef = useRef('');
  const incomingSosAlertRef = useRef<IncomingSosAlert | null>(null);
  const [queuedOffers, setQueuedOffers] = useState<QueuedOffer[]>([]);
  const [broadcastOffers, setBroadcastOffers] = useState<JobOffer[]>([]);
  const [poolOffers, setPoolOffers] = useState<JobOffer[]>([]);
  const [preferredPanelTab, setPreferredPanelTab] = useState<MainPanelTab | null>(null);
  const broadcastOffersRef = useRef<Map<string, JobOffer>>(new Map());
  const suppressedOfferIdsRef = useRef<Set<string>>(new Set());
  const queuedOffersRef = useRef<QueuedOffer[]>([]);
  const awayIntentRef = useRef<AwayIntent>('none');
  const [jobEditNotice, setJobEditNotice] = useState<string | null>(null);
  const [endShiftInProgress, setEndShiftInProgress] = useState(false);
  const [endShiftSummary, setEndShiftSummary] = useState<EndShiftSummary | null>(null);
  const shiftActiveRef = useRef(false);
  const endShiftInProgressRef = useRef(false);
  const endShiftSummaryAckRef = useRef<(() => void) | null>(null);
  const endShiftAndSignOutRef = useRef<
    ((opts?: {
      force?: boolean;
      reason?: EndShiftReason;
      message?: string;
      skipSummary?: boolean;
    }) => Promise<void>) | null
  >(null);
  const adminForceEndInFlightRef = useRef(false);
  const readyForJobsRef = useRef(false);
  const hailActiveRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);
  const activeJobRef = useRef<ActiveJob | null>(null);
  const presenceWriteStatusRef = useRef<FirebaseDriverStatus>('Available');
  const lastStagePresenceWriteRef = useRef<{ status: FirebaseDriverStatus; at: number } | null>(null);
  const prevQueuedOfferIdsRef = useRef<Set<string>>(new Set());
  const repairPresenceRef = useRef<((reason?: string) => Promise<void>) | null>(null);
  const refreshActiveJobRef = useRef<((reason?: string) => Promise<void>) | null>(null);
  const reconcileOffersRef = useRef<((reason?: string) => Promise<void>) | null>(null);
  const flushPendingTripJournalRef = useRef<(() => Promise<void>) | null>(null);
  const refreshSyncingBannerRef = useRef<(() => Promise<void>) | null>(null);
  const lastOfferSeenRef = useRef<{ id: string; at: number } | null>(null);
  const jobOfferRef = useRef<JobOffer | null>(null);
  const networkConnectedRef = useRef<boolean | null>(null);
  const rtdbConnectedRef = useRef<boolean | null>(null);
  const dispatchConnectedRef = useRef<boolean | null>(null);
  const connectionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterRef = useRef<MeterState | null>(null);
  const meterStopRef = useRef<(() => void) | null>(null);
  const tariffInitialPickDoneRef = useRef(false);
  const prevTariffRatesRef = useRef({ id: '', flagFall: 0, ratePerKm: 0, waitingPerMin: 0 });
  const selectedTariffRef = useRef<Tariff>(NO_TARIFF_CONFIGURED);
  const tariffsListRef = useRef<Tariff[]>([]);
  const paymentJobRef = useRef<ActiveJob | null>(null);
  const bookingRawRef = useRef<Record<string, unknown> | null>(null);
  /** Suppress false "taken back" alerts when we initiated completion (allbookings node deleted). */
  const localCompletionRef = useRef(false);
  const [tripOnTheWay, setTripOnTheWay] = useState(false);
  const [nearPickup, setNearPickup] = useState(false);
  const tripOnTheWayRef = useRef(false);
  const acceptCoordsRef = useRef<{ jobId: string; lat: number; lng: number } | null>(null);
  const acceptingOfferRef = useRef(false);

  const updateDispatchConnection = useCallback(
    (source: 'network' | 'rtdb' | 'recompute', connected?: boolean) => {
      if (source === 'network') networkConnectedRef.current = !!connected;
      if (source === 'rtdb') rtdbConnectedRef.current = !!connected;

      const previous = dispatchConnectedRef.current;
      const nextConnected = dispatchIsConnected(
        networkConnectedRef.current,
        rtdbConnectedRef.current,
      );
      const notice = connectionNoticeForTransition(previous, nextConnected);
      dispatchConnectedRef.current = nextConnected;
      setIsOffline(!nextConnected);

      if (notice === 'offline') {
        // Accept is a real-time claim — JobOfferModal hides while offline and disables
        // Accept. Keep jobOffer so the miss-timeout → Away path still runs; reconnect
        // reconciliation clears it only if dispatch no longer owns the offer.
        if (connectionNoticeTimerRef.current) {
          clearTimeout(connectionNoticeTimerRef.current);
          connectionNoticeTimerRef.current = null;
        }
        setConnectionNotice('offline');
        return;
      }

      if (notice === 'back_online') {
        setConnectionNotice('back_online');
        if (connectionNoticeTimerRef.current) {
          clearTimeout(connectionNoticeTimerRef.current);
        }
        connectionNoticeTimerRef.current = setTimeout(() => {
          setConnectionNotice(null);
          connectionNoticeTimerRef.current = null;
        }, 4_000);
      } else {
        setConnectionNotice(null);
      }
    },
    [],
  );

  const resetTripDisplayTracking = () => {
    acceptCoordsRef.current = null;
    tripOnTheWayRef.current = false;
    setTripOnTheWay(false);
    setNearPickup(false);
  };

  const captureAcceptLocation = async (jobId: string) => {
    resetTripDisplayTracking();
    try {
      const coords = await getCurrentCoords();
      acceptCoordsRef.current = { jobId, lat: coords.latitude, lng: coords.longitude };
    } catch {
      // On-the-way auto-detect waits until GPS is available on next tick.
    }
  };

  const applyTripGpsSample = (lat: number, lng: number) => {
    const job = activeJobRef.current;
    if (!job || job.stage !== 'pickup') {
      setNearPickup(false);
      return;
    }
    const accept = acceptCoordsRef.current;
    if (accept && accept.jobId === job.id && !tripOnTheWayRef.current) {
      if (haversineMeters(accept.lat, accept.lng, lat, lng) >= 50) {
        tripOnTheWayRef.current = true;
        setTripOnTheWay(true);
      }
    }
    if (job.pickupLat != null && job.pickupLng != null) {
      setNearPickup(haversineMeters(job.pickupLat, job.pickupLng, lat, lng) <= 50);
    } else {
      setNearPickup(false);
    }
  };

  useSafeEffect(() => {
    shiftActiveRef.current = shiftActive;
    updateDispatchConnection('recompute');
  }, [shiftActive], 'Driver-shiftRef');

  useSafeEffect(() => {
    readyForJobsRef.current = readyForJobs;
  }, [readyForJobs], 'Driver-readyRef');

  useSafeEffect(() => {
    hailActiveRef.current = hailActive;
  }, [hailActive], 'Driver-hailRef');

  useSafeEffect(() => {
    activeJobIdRef.current = activeJob?.id ?? null;
  }, [activeJob?.id], 'Driver-activeJobRef');

  useSafeEffect(() => {
    activeJobRef.current = activeJob;
  }, [activeJob], 'Driver-activeJobFullRef');

  useSafeEffect(() => {
    jobOfferRef.current = jobOffer;
  }, [jobOffer], 'Driver-jobOfferRef');

  useSafeEffect(() => {
    paymentJobRef.current = paymentJob;
  }, [paymentJob], 'Driver-paymentRef');

  const clearPaymentJobRef = () => {
    paymentJobRef.current = null;
  };

  useSafeEffect(() => {
    meterRef.current = meter;
  }, [meter], 'Driver-meterRef');

  useSafeEffect(() => {
    return () => {
      if (connectionNoticeTimerRef.current) {
        clearTimeout(connectionNoticeTimerRef.current);
      }
    };
  }, [], 'Driver-connectionNoticeCleanup');

  useSafeEffect(() => {
    const keepAwake =
      shiftActive ||
      !!jobOffer ||
      !!activeJob ||
      hailActive ||
      !!meter?.running;
    if (keepAwake) {
      void enableWakeLock();
      return () => disableWakeLock();
    }
    disableWakeLock();
    return undefined;
  }, [shiftActive, jobOffer, activeJob, hailActive, meter?.running], 'Driver-wakeLock');

  useSafeEffect(() => {
    if (!driver?.companyId || !driver.uid) return;
    initializeNztaOnLogin(driver.companyId, driver.uid)
      .then((state) => {
        const lockout = getShiftLockout(state);
        if (lockout.blocked) {
          Alert.alert('Rest period required', lockout.message);
        }
      })
      .catch((err) => console.error('[Driver] initializeNztaOnLogin', err));
  }, [driver?.companyId, driver?.uid], 'Driver-nztaInit');

  useSafeEffect(() => {
    void (async () => {
      try {
        const v = await getData<string>(STORAGE_KEYS.selectedVehicle);
        if (v) setSelectedVehicleIdState(v);
        const j = await getData<ActiveJob>(STORAGE_KEYS.activeJob);
        if (j) {
          if (isValidBookingId(j.id)) {
            setActiveJob({
              ...j,
              stepTimes: j.stepTimes ?? EMPTY_STEP_TIMES,
              tariffChanges: j.tariffChanges ?? [],
            });
          } else {
            console.warn('[Driver] cleared stored active job with invalid booking id:', j.id);
            await storeData(STORAGE_KEYS.activeJob, null);
          }
        }
        // Do not restore shift as "online" on launch — driver must confirm vehicle
        // and startShift each session. Always clear vehicleSessionReady too; leaving
        // it true with shift off allowed the zombie tabs UI (logged-in Profile,
        // Off main, no SOS/offers) after crash/reopen with no active job.
        await storeData(STORAGE_KEYS.shiftActive, false);
        await storeData(STORAGE_KEYS.vehicleSessionReady, false);
        const m = await getData<MeterState>(STORAGE_KEYS.meterState);
        if (m?.running && m.mode && m.breakdown) {
          setMeter(m);
          meterRef.current = m;
          setHailActive(true);
        }
        const storedBanner = await loadPendingSyncBanner();
        const resolved = (await resolvePendingSyncBanner()) ?? storedBanner;
        setSyncingBanner(resolved?.message ?? null);
        await savePendingSyncBanner(resolved);
        // Pending offline completes must not wait for a reconnect edge after remount.
        void flushPendingTripJournalRef.current?.();
      } catch (err) {
        console.error('[Driver] hydrate storage failed:', err);
      }
    })();
  }, [], 'Driver-hydrate');

  useSafeEffect(() => {
    try {
      const unsub = subscribeConnectivity(async (connected) => {
        try {
          updateDispatchConnection('network', connected);
          if (connected) {
            // Presence first: dispatch treats a quiet driver as unreachable, so
            // heal the heartbeat immediately instead of after reconcile+flush.
            if (shiftActiveRef.current) {
              void repairPresenceRef.current?.('netinfo-reconnect');
            }
            await flushPendingTripJournalRef.current?.();
            if (activeJobRef.current?.id) {
              void refreshActiveJobRef.current?.('netinfo-reconnect');
            }
            await reconcileOffersRef.current?.('netinfo-reconnect');
            await flushOfflineQueue();
            await refreshSyncingBannerRef.current?.();
          }
        } catch (err) {
          console.error('[Driver] connectivity handler:', err);
        }
      });
      return unsub;
    } catch (err) {
      console.error('[Driver] subscribeConnectivity failed:', err);
    }
  }, [], 'Driver-connectivity');

  const refreshVehicles = async () => {
    if (!driver?.companyId || !driver.uid) {
      setRawVehicles([]);
      setVehicleShiftLocks(new Map());
      return;
    }
    setVehiclesLoading(true);
    try {
      const list = await loadDriverVehicles(
        driver.companyId,
        driver.uid,
        driver.id,
        driver.vehicleId || selectedVehicleId,
      );
      setRawVehicles(list);
      const locks = await fetchVehicleShiftLocks(
        driver.companyId,
        list.map((v) => v.id),
        driver.id,
        driver.uid,
      );
      setVehicleShiftLocks(locks);
      // Pre-select first available vehicle for the picker; shift still requires explicit confirm.
      if (!selectedVehicleId) {
        const merged = mergeVehicleShiftLocks(list, locks);
        const preferred =
          merged.find((v) => v.id === driver.vehicleId?.toUpperCase() && !v.inUseByOther) ??
          merged.find((v) => !v.inUseByOther) ??
          merged[0];
        if (preferred) await setSelectedVehicleId(preferred.id);
      }
    } catch (err) {
      console.warn('[Driver] refreshVehicles failed:', err);
      setRawVehicles([]);
      setVehicleShiftLocks(new Map());
    } finally {
      setVehiclesLoading(false);
    }
  };

  useSafeEffect(() => {
    refreshVehicles().catch((err) => console.error('[Driver] refreshVehicles', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.uid, driver?.companyId, driver?.id, driver?.vehicleId], 'Driver-vehicles');

  useSafeEffect(() => {
    if (!driver?.companyId || !driver?.id || rawVehicles.length === 0 || shiftActive) return;
    const ids = rawVehicles.map((v) => v.id);
    return subscribeVehicleShiftLocks(
      driver.companyId,
      ids,
      driver.id,
      driver.uid,
      setVehicleShiftLocks,
    );
  }, [driver?.companyId, driver?.id, driver?.uid, shiftActive, rawVehicles], 'Driver-vehicleShiftLocks');

  useSafeEffect(() => {
    if (!driver?.companyId) {
      tariffInitialPickDoneRef.current = false;
      setTariffsState([]);
      setSelectedTariffState(NO_TARIFF_CONFIGURED);
      return;
    }

    tariffInitialPickDoneRef.current = false;

    return subscribeCompanyTariffs(driver.companyId, (list) => {
      tariffsListRef.current = list;
      setTariffsState(list);

      if (list.length === 0) {
        setSelectedTariffState(NO_TARIFF_CONFIGURED);
        tariffInitialPickDoneRef.current = false;
        return;
      }

      setMeter((prev) => {
        if (!prev) return prev;
        const next = sanitizeMeterTariff(prev, list);
        if (next !== prev) {
          meterRef.current = next;
          storeData(STORAGE_KEYS.meterState, next).catch(() => undefined);
        }
        return next;
      });

      if (!tariffInitialPickDoneRef.current) {
        tariffInitialPickDoneRef.current = true;
        void (async () => {
          const savedId = await getData<string>(STORAGE_KEYS.selectedTariffId);
          const latest = tariffsListRef.current;
          if (latest.length === 0) return;
          const saved = savedId ? latest.find((t) => t.id === savedId) : null;
          const pick = sanitizeSelectedTariff(latest, saved ?? latest[0]);
          setSelectedTariffState(pick);
          if (bookingRawRef.current) {
            const fromBooking = resolveTariffFromList(latest, readBookingTariffHints(bookingRawRef.current));
            if (fromBooking) setSelectedTariffState(fromBooking);
          }
        })();
        return;
      }

      setSelectedTariffState((prev) => {
        const sanitized = sanitizeSelectedTariff(list, prev);
        const fromBooking = bookingRawRef.current
          ? resolveTariffFromList(list, readBookingTariffHints(bookingRawRef.current))
          : null;
        return fromBooking ?? sanitized;
      });
    });
  }, [driver?.companyId], 'Driver-tariffs');

  useSafeEffect(() => {
    if (!driver?.companyId) {
      setCompany(null);
      return;
    }
    loadCompanyInfo(driver.companyId, driver.uid)
      .then(setCompany)
      .catch((err) => console.error('[Driver] loadCompanyInfo', err));
  }, [driver?.companyId, driver?.uid], 'Driver-company');

  const refreshJobHistory = async () => {
    if (!driver?.companyId || !driver.id) {
      setJobHistory([]);
      return;
    }
    setJobHistoryLoading(true);
    try {
      const rows = await loadDriverJobHistory(driver.companyId, driver.id, driver.uid);
      setJobHistory(rows);
    } catch (err) {
      console.warn('[Driver] refreshJobHistory failed:', err);
    } finally {
      setJobHistoryLoading(false);
    }
  };

  useSafeEffect(() => {
    refreshJobHistory().catch((err) => console.error('[Driver] refreshJobHistory', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, driver?.id], 'Driver-jobHistory');

  const hasBlockingNztaJob = useCallback(() => {
    if (hailActiveRef.current) return true;
    if (paymentJob) return true;
    return !!activeJobIdRef.current;
  }, [paymentJob]);

  const forceNztaLimitSignOutRef = useRef<
    ((reason: EndShiftReason, message: string) => Promise<void>) | null
  >(null);

  useSafeEffect(() => {
    if (!shiftActive || !driver?.companyId || !driver.uid) return;
    let cancelled = false;
    const breakAlertOpen = { current: false };
    const { companyId, uid } = driver;

    const evaluateNztaLimits = async (tick: boolean) => {
      if (cancelled || endShiftInProgressRef.current || !shiftActiveRef.current) return;
      try {
        const state = tick
          ? await tickWorkedMinutes(companyId, uid, 1)
          : await loadNztaHours(companyId, uid);
        if (cancelled || endShiftInProgressRef.current) return;

        if (exceedsWeeklyHours(state) || state.pendingLimitSignOut === 'weekly70h') {
          if (hasBlockingNztaJob()) {
            await setPendingLimitSignOut(companyId, uid, 'weekly70h');
            return;
          }
          await forceNztaLimitSignOutRef.current?.('weekly70h', NZTA_WEEKLY_LIMIT_SIGNOUT_MESSAGE);
          return;
        }

        if (exceedsMaxShiftHours(state) || state.pendingLimitSignOut === 'shift14h') {
          if (hasBlockingNztaJob()) {
            await setPendingLimitSignOut(companyId, uid, 'shift14h');
            return;
          }
          await forceNztaLimitSignOutRef.current?.('shift14h', NZTA_SHIFT_LIMIT_SIGNOUT_MESSAGE);
          return;
        }

        if (needsBreak(state) && !breakAlertOpen.current) {
          breakAlertOpen.current = true;
          await notifyBreakReminder('Break reminder', NZTA_BREAK_REMINDER_MESSAGE).catch(() => undefined);
          Alert.alert('Break reminder', NZTA_BREAK_REMINDER_MESSAGE, [
            {
              text: 'OK',
              onPress: () => {
                void markBreakReminderShown(companyId, uid);
                breakAlertOpen.current = false;
              },
            },
          ], { cancelable: true, onDismiss: () => {
            void markBreakReminderShown(companyId, uid);
            breakAlertOpen.current = false;
          } });
        }
      } catch (err) {
        console.error('[Driver] NZTA compliance tick failed:', err);
      }
    };

    void evaluateNztaLimits(false);
    const id = setInterval(() => {
      void evaluateNztaLimits(true);
    }, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [shiftActive, hasBlockingNztaJob, driver?.companyId, driver?.uid], 'Driver-nztaTick');

  // When a job clears after a deferred 14h/70h limit, sign out immediately.
  useSafeEffect(() => {
    if (!shiftActive || !driver?.companyId || !driver.uid || hasBlockingNztaJob() || endShiftInProgressRef.current) return;
    let cancelled = false;
    const { companyId, uid } = driver;
    void (async () => {
      const state = await loadNztaHours(companyId, uid);
      if (cancelled || !state.pendingLimitSignOut) return;
      const reason = state.pendingLimitSignOut;
      const message =
        reason === 'weekly70h'
          ? NZTA_WEEKLY_LIMIT_SIGNOUT_MESSAGE
          : NZTA_SHIFT_LIMIT_SIGNOUT_MESSAGE;
      await forceNztaLimitSignOutRef.current?.(reason, message);
    })();
    return () => {
      cancelled = true;
    };
  }, [shiftActive, activeJob, hailActive, paymentJob, hasBlockingNztaJob, driver?.companyId, driver?.uid], 'Driver-nztaDeferredSignOut');

  const sessionEarnings = sumBreakdown(completedJobs);
  const historyEarnings = sumBreakdown(
    jobHistory.filter((j) => j.status === 'completed').map((j) => ({ fare: j.fare, paymentType: j.paymentType })),
  );
  const vehicles = useMemo(
    () => mergeVehicleShiftLocks(rawVehicles, vehicleShiftLocks),
    [rawVehicles, vehicleShiftLocks],
  );
  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const activeVehicleBodyType = activeVehicle?.displayType ?? activeVehicle?.bodyType ?? '—';
  const tariffLocked = !!paymentJob;

  useSafeEffect(() => {
    queuedOffersRef.current = queuedOffers;
  }, [queuedOffers], 'Driver-queuedOffersRef');

  useSafeEffect(() => {
    if (shiftActive && driver?.companyId && driver.id) {
      pruneDriverQueueOnDispatch().catch(() => undefined);
    }
  }, [shiftActive, driver?.companyId, driver?.id], 'Driver-pruneQueueOnShift');

  useSafeEffect(() => {
    if (!shiftActive || !driver?.companyId || !driver.id) {
      setQueuedOffers([]);
      prevQueuedOfferIdsRef.current = new Set();
      return;
    }
    const companyId = driver.companyId;
    const driverId = driver.id;
    try {
      return subscribeDriverQueue(companyId, driverId, activeVehicle, (offers) => {
        const nextIds = new Set(offers.map((o) => o.id));
        const prevIds = prevQueuedOfferIdsRef.current;
        for (const id of prevIds) {
          if (nextIds.has(id)) continue;
          void (async () => {
            try {
              const snap = await get(ref(getDatabaseInstance(), `allbookings/${companyId}/${id}`));
              if (!snap.exists()) {
                Alert.alert('Queued job cancelled', 'A queued booking was cancelled or removed.');
                return;
              }
              const parsed = parseBookingNode(snap.val());
              if (!parsed) return;
              if (parsed.cancelled || (parsed.terminal && !parsed.status.includes('complete'))) {
                Alert.alert('Queued job cancelled', 'A queued booking was cancelled or removed.');
              } else if (isReturnedToDispatchPool(parsed.status)) {
                Alert.alert('Queued job taken back', 'A queued job was returned to dispatch.');
              }
            } catch {
              // non-fatal — queue node removal is enough to drop from UI
            }
          })();
        }
        prevQueuedOfferIdsRef.current = nextIds;
        void (async () => {
          const mapped = offers.map((o) => ({
            ...o,
            queuedAt: o.queuedAt ?? Date.now(),
          }));
          const live = await filterLiveDriverQueueOffers(companyId, driverId, mapped);
          if (live.length < mapped.length) {
            pruneDriverQueueOnDispatch().catch(() => undefined);
          }
          setQueuedOffers(live);
        })();
      });
    } catch (err) {
      console.error('[Driver] driverQueue subscribe failed', err);
    }
  }, [shiftActive, driver?.companyId, driver?.id, activeVehicle?.id], 'Driver-firebaseQueue');

  const offersLockedForEnrouteDispatch = useMemo(
    () => isDispatchEnrouteOffersLocked(activeJob, hailActive, !!meter?.running),
    [activeJob, hailActive, meter?.running],
  );

  const canBrowsePoolOffers =
    shiftActive && !paymentJob && !offersLockedForEnrouteDispatch;
  const canReceivePopupOffer =
    shiftActive && readyForJobs && presenceStatus === 'Online' && !paymentJob;

  useSafeEffect(() => {
    if (!canBrowsePoolOffers || !driver?.companyId) {
      setPoolOffers([]);
      return;
    }
    try {
      return subscribePendingJobs(driver.companyId, activeVehicle, (offers) => {
        const returnedIds = new Set(
          offers
            .filter((offer) => shouldSuppressReturnedPoolOffer(offer, driver.id))
            .map((offer) => offer.id),
        );
        if (returnedIds.size) {
          let broadcastChanged = false;
          for (const id of returnedIds) {
            suppressedOfferIdsRef.current.add(id);
            broadcastChanged = broadcastOffersRef.current.delete(id) || broadcastChanged;
          }
          if (broadcastChanged) {
            setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
          }
          setJobOffer((current) =>
            current && returnedIds.has(current.id) ? null : current,
          );
        }
        setPoolOffers(
          offers.filter(
            (offer) =>
              !suppressedOfferIdsRef.current.has(offer.id) &&
              !shouldSuppressReturnedPoolOffer(offer, driver.id),
          ),
        );
      });
    } catch (err) {
      console.error('[Driver] pendingjobs subscribe failed', err);
    }
  }, [canBrowsePoolOffers, driver?.companyId, activeVehicle?.id], 'Driver-pendingPool');

  const visibleOffers = useMemo(() => {
    if (offersLockedForEnrouteDispatch) return [];
    const map = new Map<string, JobOffer>();
    for (const o of poolOffers) {
      if (suppressedOfferIdsRef.current.has(o.id)) continue;
      if (driver?.id && shouldSuppressReturnedPoolOffer(o, driver.id)) continue;
      map.set(o.id, { ...o, silent: true });
    }
    for (const o of broadcastOffers) {
      if (suppressedOfferIdsRef.current.has(o.id)) continue;
      map.set(o.id, o);
    }
    return Array.from(map.values());
  }, [poolOffers, broadcastOffers, offersLockedForEnrouteDispatch, driver?.id]);

  const upsertBroadcastOffer = (offer: JobOffer) => {
    // A fresh exclusive fanout supersedes any prior local suppression for this ID.
    suppressedOfferIdsRef.current.delete(offer.id);
    broadcastOffersRef.current.set(offer.id, offer);
    setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
  };

  const removeBroadcastOffer = (offerId: string) => {
    // Once dispatch removes/expires an exclusive offer, do not immediately
    // re-add the same booking from pendingjobs as an actionable badge.
    suppressedOfferIdsRef.current.add(offerId);
    broadcastOffersRef.current.delete(offerId);
    setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
    setPoolOffers((prev) => prev.filter((o) => o.id !== offerId));
  };

  const clearBroadcastOffers = () => {
    broadcastOffersRef.current.clear();
    suppressedOfferIdsRef.current.clear();
    setBroadcastOffers([]);
    setPoolOffers([]);
  };

  const reconcileDriverOffers = async (reason = 'reconcile') => {
    if (!driver?.companyId || !driver.id) return;
    const ids = new Set(broadcastOffersRef.current.keys());
    if (jobOfferRef.current?.id) ids.add(jobOfferRef.current.id);
    if (!ids.size) {
      setPoolOffers((prev) =>
        prev.filter(
          (offer) => !shouldSuppressReturnedPoolOffer(offer, driver.id),
        ),
      );
      return;
    }

    const staleIds = await findStaleDirectOfferIds(
      driver.companyId,
      driver.id,
      ids,
    );
    if (!staleIds.length) return;
    console.log(`[Driver] offer reconcile (${reason}) removed`, staleIds);
    const staleSet = new Set(staleIds);
    for (const id of staleIds) {
      suppressedOfferIdsRef.current.add(id);
      broadcastOffersRef.current.delete(id);
    }
    setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
    setPoolOffers((prev) => prev.filter((offer) => !staleSet.has(offer.id)));
    setJobOffer((current) =>
      current && staleSet.has(current.id) ? null : current,
    );
  };
  reconcileOffersRef.current = reconcileDriverOffers;

  useSafeEffect(() => {
    if (!shiftActive) return;
    const id = setInterval(() => {
      const now = Date.now();
      for (const [offerId, offer] of broadcastOffersRef.current) {
        if (offer.expiresAt && offer.expiresAt < now - 5000) {
          removeBroadcastOffer(offerId);
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [shiftActive], 'Driver-staleOffers');

  useSafeEffect(() => {
    if (!isFirebaseReady || !driver?.companyId) {
      setCompanyZones([]);
      companyZonesRef.current = [];
      return;
    }
    return subscribeCompanyZones(driver.companyId, (zones) => {
      companyZonesRef.current = zones;
      setCompanyZones(zones);
    });
  }, [driver?.companyId], 'Driver-companyZones');

  useSafeEffect(() => {
    if (!shiftActive || !isFirebaseReady || !driver?.companyId || !selectedVehicleId) {
      setZone(EMPTY_ZONE);
      return;
    }
    try {
      const onlineRef = ref(
        getDatabaseInstance(),
        `online/${driver.companyId}/${selectedVehicleId}`,
      );
      return onValue(onlineRef, (snap) => {
        try {
          if (!snap.exists()) {
            setZone(EMPTY_ZONE);
            return;
          }
          const parsed = parseZoneFromOnlineNode(snap.val());
          setZone((prev) => ({
            ...parsed,
            name: parsed.name || prev.name,
            position: parsed.position || prev.position,
          }));
        } catch (err) {
          console.error('[Driver] zone listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] zone subscribe failed', err);
    }
  }, [shiftActive, driver?.companyId, selectedVehicleId], 'Driver-zoneQueue');

  useSafeEffect(() => {
    if (!shiftActive || !driver?.companyId || !companyZones.length) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    const applyZoneFromCoords = (lat: number, lng: number) => {
      const hit = findZoneAtCoords(lat, lng, companyZonesRef.current);
      setZone((prev) => {
        const nextName = hit?.name ?? prev.name ?? '';
        const nextPos = prev.position;
        if (driver && selectedVehicleId && hit?.name && hit.name !== prev.name) {
          syncZonePresenceFields(driver, selectedVehicleId, {
            name: hit.name,
            zoneId: hit.id,
            zoneNumber: hit.zoneNumber,
            queuePosition: nextPos > 0 ? nextPos : undefined,
          }).catch(() => undefined);
        }
        return {
          ...prev,
          name: nextName,
        };
      });
    };

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const coords = await getCurrentCoords();
        applyZoneFromCoords(coords.latitude, coords.longitude);
        applyTripGpsSample(coords.latitude, coords.longitude);
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 5000 },
          (loc) => {
            applyZoneFromCoords(loc.coords.latitude, loc.coords.longitude);
            applyTripGpsSample(loc.coords.latitude, loc.coords.longitude);
          },
        );
      } catch (err) {
        console.warn('[Driver] GPS zone detect failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [shiftActive, driver?.companyId, companyZones.length], 'Driver-gpsZone');

  useSafeEffect(() => {
    if (!isFirebaseReady || !driver?.companyId || !selectedVehicleId) {
      if (!readyForJobsRef.current) setPresenceStatus('Offline');
      return;
    }
    try {
      const presenceRef = ref(getDatabaseInstance(), `online/${driver.companyId}/${selectedVehicleId}/current`);
      return onValue(presenceRef, (snap) => {
        try {
          if (!snap.exists()) {
            // Never repair while ending shift or after session lock — server DELETE
            // would otherwise be undone by heartbeat/listener rewrite.
            if (
              shiftActiveRef.current &&
              !endShiftInProgressRef.current &&
              driver?.companyId &&
              selectedVehicleId &&
              !isPresenceSessionEnded(driver.companyId, selectedVehicleId)
            ) {
              console.warn('[Driver] presence node missing during shift — repairing');
              void repairPresenceRef.current?.('listener-missing-node');
            } else {
              setPresenceStatus('Offline');
              setReadyForJobs(false);
              readyForJobsRef.current = false;
            }
            return;
          }
          const data = snap.val() as Record<string, unknown>;
          const rawStatus = String(data.vehiclestatus ?? data.VehicleStatus ?? '').toLowerCase();
          const myId = String(driver.id ?? '');
          const nodeDriverId = String(data.driverid ?? data.driverId ?? '');
          if (nodeDriverId && myId && nodeDriverId !== myId && nodeDriverId !== String(driver.uid)) {
            setPresenceStatus('Offline');
            setReadyForJobs(false);
            readyForJobsRef.current = false;
            return;
          }

          if (rawStatus === 'away' || rawStatus === 'offline') {
            if (awayIntentRef.current !== 'none') {
              setPresenceStatus('Away');
              setReadyForJobs(false);
              readyForJobsRef.current = false;
            }
            return;
          }

          if (isVehicleStatusAvailable(rawStatus)) {
            if (awayIntentRef.current === 'none' && shiftActiveRef.current) {
              setPresenceStatus('Online');
              setReadyForJobs(true);
              readyForJobsRef.current = true;
            }
            return;
          }

          if (rawStatus === 'picking' || rawStatus === 'assigned' || rawStatus === 'busy') {
            if (awayIntentRef.current === 'none') {
              setPresenceStatus('Online');
              setReadyForJobs(false);
              readyForJobsRef.current = false;
            }
          }
        } catch (err) {
          console.error('[Driver] presence listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] presence subscribe failed', err);
    }
  }, [driver?.companyId, driver?.id, driver?.uid, selectedVehicleId], 'Driver-presence');

  const canReceiveJobOffers = canReceivePopupOffer;
  const canListenForOffers = canBrowsePoolOffers;
  const tripInProgress = () => hailActiveRef.current || !!activeJobIdRef.current;
  const blockIfTripInProgress = () => {
    if (!tripInProgress()) return false;
    Alert.alert('Job in progress', TRIP_BLOCK_MSG);
    return true;
  };
  const offersBadgeCount =
    shiftActive && !offersLockedForEnrouteDispatch ? visibleOffers.length : 0;
  const nextQueuedOffer = queuedOffers[0] ?? null;

  const notifyDispatcherChat = useCallback((text: string, dedupeKey?: string) => {
    const body = text.trim() || 'New message from dispatch';
    const key = dedupeKey || body;
    if (lastChatNotifyKeyRef.current === key) return;
    lastChatNotifyKeyRef.current = key;
    void playInAppNotificationSound('general');
    if (!chatTabFocusedRef.current) {
      setInAppBanner({ kind: 'chat', message: body });
      setChatUnreadCount((c) => c + 1);
    }
  }, []);

  const markChatViewed = useCallback(() => {
    chatTabFocusedRef.current = true;
    setChatUnreadCount(0);
  }, []);

  const markChatTabBlurred = useCallback(() => {
    chatTabFocusedRef.current = false;
  }, []);

  const applyIncomingSosAlert = useCallback((alert: IncomingSosAlert) => {
    setIncomingSosAlert(alert);
    setInAppBanner({
      kind: 'sos',
      message: alert.content || `${alert.driverName} needs help`,
      alert,
    });
    void playInAppNotificationSound('alert');
    void notifySosAlert(
      'Driver emergency nearby',
      alert.content || `${alert.driverName} needs help`,
      incomingSosAlertToNotificationData(alert),
    );
  }, []);

  const processIncomingSosNotification = useCallback(async (
    val: Record<string, unknown>,
    source: 'notificationSos' | 'notification',
  ) => {
    const alert = parseIncomingSosAlert(val);
    if (!alert || !driver?.companyId) return;
    const active = await isSosEmergencyActive(driver.companyId, alert.sosDriverId);
    if (!active) {
      console.log('[Driver] ignoring stale SOS notification', {
        sosDriverId: alert.sosDriverId,
        incidentId: alert.incidentId,
        source,
      });
      if (driver.id) {
        await clearSosNotification(driver.id);
        if (source === 'notification') {
          await clearDriverNotification(driver.id);
        }
      }
      return;
    }
    if (driver.id) {
      const responseState = await getDriverSosResponseState(
        driver.companyId,
        alert.sosDriverId,
        driver.id,
      );
      if (responseState === 'arrived_handled') {
        console.log('[Driver] ignoring SOS — responder already marked handled', {
          sosDriverId: alert.sosDriverId,
          source,
        });
        await clearSosNotification(driver.id);
        if (source === 'notification') {
          await clearDriverNotification(driver.id);
        }
        return;
      }
      setIncomingSosResponseCommitted(responseState === 'going_to_help');
    } else {
      setIncomingSosResponseCommitted(false);
    }
    const dedupeKey = `${alert.incidentId}:${alert.timestamp}`;
    if (lastSosAlertRef.current === dedupeKey) return;
    lastSosAlertRef.current = dedupeKey;
    console.log(`[Driver] SOS alert via ${source}`, {
      sosDriverId: alert.sosDriverId,
      incidentId: alert.incidentId,
      driverName: alert.driverName,
    });
    applyIncomingSosAlert(alert);
    if (driver.id) {
      await clearSosNotification(driver.id);
      if (source === 'notification') {
        await clearDriverNotification(driver.id);
      }
    }
  }, [applyIncomingSosAlert, driver?.companyId, driver?.id]);

  const openIncomingSosMap = useCallback(() => {
    if (!incomingSosAlert) return;
    router.push('/sos-alert');
  }, [incomingSosAlert]);

  const handleSosNotificationOpen = useCallback(async (alert: IncomingSosAlert) => {
    if (!driver?.companyId) return;
    const active = await isSosEmergencyActive(driver.companyId, alert.sosDriverId);
    if (!active) {
      if (driver.id) {
        await clearSosNotification(driver.id);
        await clearDriverNotification(driver.id);
      }
      return;
    }
    let responseCommitted = false;
    if (driver.id) {
      const responseState = await getDriverSosResponseState(
        driver.companyId,
        alert.sosDriverId,
        driver.id,
      );
      if (responseState === 'arrived_handled') {
        await clearSosNotification(driver.id);
        await clearDriverNotification(driver.id);
        return;
      }
      responseCommitted = responseState === 'going_to_help';
    }
    setIncomingSosAlert(alert);
    setIncomingSosResponseCommitted(responseCommitted);
    setInAppBanner({
      kind: 'sos',
      message: alert.content || `${alert.driverName} needs help`,
      alert,
    });
    router.push('/sos-alert');
  }, [driver?.companyId, driver?.id]);

  const clearIncomingSosAlert = useCallback(() => {
    setIncomingSosAlert(null);
    setSosResponding(false);
    setIncomingSosResponseCommitted(false);
    setIncomingSosResolved(false);
    setIncomingSosResolvedMessage('');
    setInAppBanner((banner) => (banner?.kind === 'sos' ? null : banner));
  }, []);

  const exitIncomingSosAlertScreen = useCallback(() => {
    clearIncomingSosAlert();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  }, [clearIncomingSosAlert]);

  const markIncomingSosResolved = useCallback((message?: string) => {
    setIncomingSosResolved(true);
    setIncomingSosResolvedMessage(
      message?.trim() || 'Emergency resolved — returning to main screen.',
    );
    setInAppBanner((banner) => (banner?.kind === 'sos' ? null : banner));
  }, []);

  const dismissIncomingSosAlert = useCallback(() => {
    clearIncomingSosAlert();
  }, [clearIncomingSosAlert]);

  const processIncomingSosClosed = useCallback(async (val: Record<string, unknown>) => {
    const closed = parseIncomingSosResolved(val);
    if (!closed) return;
    const active = incomingSosAlertRef.current;
    if (!active || active.sosDriverId !== closed.sosDriverId) return;
    console.log('[Driver] SOS incident closed', {
      sosDriverId: closed.sosDriverId,
      resolution: closed.resolution,
    });
    markIncomingSosResolved(
      closed.resolution === 'false_alarm'
        ? 'False alarm — this emergency is over.'
        : 'Emergency resolved.',
    );
    if (driver?.id) {
      await clearSosNotification(driver.id);
      await clearDriverNotification(driver.id);
    }
  }, [driver?.id, markIncomingSosResolved]);

  useSafeEffect(() => {
    incomingSosAlertRef.current = incomingSosAlert;
  }, [incomingSosAlert], 'Driver-incomingSosAlertRef');

  useSafeEffect(() => {
    if (!shiftActive || !driver?.id || !driver.companyId) return;
    void purgeStaleSosNotifications(driver.companyId, driver.id);
  }, [shiftActive, driver?.id, driver?.companyId], 'Driver-purgeStaleSosNotifications');

  const respondToIncomingSos = useCallback(async () => {
    if (!incomingSosAlert || sosResponding || incomingSosResponseCommitted) return;
    setSosResponding(true);
    try {
      await respondToDriverSos(incomingSosAlert.sosDriverId);
      setIncomingSosResponseCommitted(true);
    } catch (e) {
      Alert.alert(
        'Could not respond',
        e instanceof Error ? e.message : 'Try again',
      );
    } finally {
      setSosResponding(false);
    }
  }, [incomingSosAlert, sosResponding, incomingSosResponseCommitted]);

  const withdrawIncomingSosResponse = useCallback(async () => {
    if (!incomingSosAlert || sosResponding) return;
    setSosResponding(true);
    try {
      if (incomingSosResponseCommitted) {
        await withdrawSosResponse(incomingSosAlert.sosDriverId);
      }
      exitIncomingSosAlertScreen();
    } catch (e) {
      Alert.alert(
        'Could not cancel response',
        e instanceof Error ? e.message : 'Try again',
      );
    } finally {
      setSosResponding(false);
    }
  }, [incomingSosAlert, sosResponding, incomingSosResponseCommitted, exitIncomingSosAlertScreen]);

  const markIncomingSosArrived = useCallback(async () => {
    if (!incomingSosAlert || sosResponding) return;
    setSosResponding(true);
    try {
      if (incomingSosResponseCommitted) {
        await markSosResponderArrived(incomingSosAlert.sosDriverId);
      }
      markIncomingSosResolved('You marked this emergency as handled.');
    } catch (e) {
      Alert.alert(
        'Could not update response',
        e instanceof Error ? e.message : 'Try again',
      );
    } finally {
      setSosResponding(false);
    }
  }, [incomingSosAlert, sosResponding, incomingSosResponseCommitted, markIncomingSosResolved]);

  useSafeEffect(() => {
    if (canListenForOffers) return;
    setJobOffer(null);
    if (!shiftActive) {
      clearBroadcastOffers();
      setQueuedOffers([]);
    }
    lastOfferSeenRef.current = null;
  }, [canListenForOffers, shiftActive], 'Driver-clearOffersWhenOffline');

  const flushQueuedOffer = () => {
    setQueuedOffers((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      if (next) {
        console.log('[Driver] flushQueuedOffer → show', next.id);
        setJobOffer({ ...next, silent: false });
      }
      return rest;
    });
  };

  const releaseQueuedOffersAfterTrip = () => {
    setTimeout(() => {
      showNextQueuedJobAsOffer();
    }, 600);
  };

  const showNextQueuedJobAsOffer = () => {
    if (!driver || !shiftActiveRef.current) return;
    if (hailActiveRef.current || activeJobIdRef.current || paymentJobRef.current) return;

    const q = queuedOffersRef.current[0];
    if (!q) return;

    if (!isValidBookingId(q.id)) {
      console.warn('[Driver] dropping queued job with invalid booking id:', q.id);
      setQueuedOffers((prev) => prev.filter((o) => o.id !== q.id));
      return;
    }

    console.log('[Driver] showNextQueuedJobAsOffer → modal', q.id);
    setJobOffer({ ...q, silent: false, fromQueue: true });
    void alertDriverToOffer({ ...q, silent: false, fromQueue: true });
  };

  const driverHasConfirmedActiveTrip = () =>
    !!(activeJobIdRef.current || hailActiveRef.current || paymentJobRef.current);

  const syncPresenceAfterTripClear = async () => {
    const snap = {
      shiftActive,
      hailActive: hailActiveRef.current,
      activeJobId: activeJobIdRef.current,
      paymentJobId: paymentJobRef.current?.id ?? null,
      awayIntent: awayIntentRef.current,
      hasConfirmedTrip: driverHasConfirmedActiveTrip(),
    };
    console.log('[away-debug] syncPresenceAfterTripClear enter', snap);
    if (!driver || !shiftActive) {
      console.log('[away-debug] syncPresenceAfterTripClear skip — no driver or shift');
      return;
    }
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) {
      console.log('[away-debug] syncPresenceAfterTripClear skip — no vehicleId');
      return;
    }
    if (driverHasConfirmedActiveTrip()) {
      console.log('[away-debug] syncPresenceAfterTripClear → Busy (trip/payment still active)', snap);
      writeOnlinePresence(driver, vehicleId, 'Busy').catch(() => undefined);
      setPresenceStatus('Busy');
      readyForJobsRef.current = false;
      return;
    }
    awayIntentRef.current = 'none';
    console.log('[away-debug] syncPresenceAfterTripClear → Available');
    writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
    setPresenceStatus('Online');
    setReadyForJobs(true);
    readyForJobsRef.current = true;
  };

  const restoreAvailableAfterJobClear = async () => {
    await syncPresenceAfterTripClear();
  };

  const clearHailTripState = () => {
    setHailActive(false);
    hailActiveRef.current = false;
    setHailPickupAddress(null);
    setHailPickupLat(undefined);
    setHailPickupLng(undefined);
  };

  const clearActiveJobInternal = async (opts?: { skipReleaseQueue?: boolean }) => {
    const wasHail = isHailTripJob(activeJobRef.current, hailActiveRef.current);
    stopMeterForJob();
    setMeter(null);
    meterRef.current = null;
    resetTripDisplayTracking();
    setActiveJob(null);
    activeJobIdRef.current = null;
    bookingRawRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
    if (wasHail) {
      clearHailTripState();
    }
    if (!opts?.skipReleaseQueue) {
      releaseQueuedOffersAfterTrip();
    }
  };

  /** Drop cached activeJob when dispatch confirms it is no longer live. */
  const clearStaleActiveJobLocal = async (detail: string, opts?: { silent?: boolean }) => {
    const hadJob = !!activeJobRef.current?.id;
    await clearActiveJobInternal();
    setPaymentJob(null);
    clearPaymentJobRef();
    setCompletionError(null);
    if (shiftActiveRef.current) {
      await restoreAvailableAfterJobClear();
    }
    if (hadJob && !opts?.silent) {
      Alert.alert('Job already closed', detail);
    }
  };

  const handleIncomingOffer = async (val: Record<string, unknown>) => {
    if (!shiftActiveRef.current || paymentJobRef.current || !driver) return;

    const offer = parseJobOffer(val);
    if (!isValidBookingId(offer.id)) {
      console.warn('[Driver] ignored offer without valid booking id:', offer.pickup);
      return;
    }
    if (offer.expiresAt && offer.expiresAt <= Date.now()) {
      console.log('[Driver] ignored expired offer notification:', offer.id);
      suppressedOfferIdsRef.current.add(offer.id);
      broadcastOffersRef.current.delete(offer.id);
      setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
      setPoolOffers((prev) => prev.filter((o) => o.id !== offer.id));
      await clearDriverNotification(driver.id, driver.companyId);
      return;
    }
    const seen = lastOfferSeenRef.current;
    if (seen?.id === offer.id && Date.now() - seen.at < 2500) return;
    lastOfferSeenRef.current = { id: offer.id, at: Date.now() };

    upsertBroadcastOffer(offer);

    if (hailActiveRef.current || activeJobIdRef.current) {
      return;
    }

    const pendingQueue = queuedOffersRef.current[0];
    if (pendingQueue && !jobIdsMatch(pendingQueue.id, offer.id)) {
      console.log('[Driver] ignoring competing offer during queue promotion window:', offer.id);
      return;
    }

    if (!readyForJobsRef.current) {
      console.log(
        `[Driver] offer ${offer.id} on Offer tab — popup deferred until readyForJobs ` +
          `(shift bootstrap / GPS still in progress)`,
      );
      return;
    }

    setJobOffer(offer);
    void alertDriverToOffer(offer);
  };

  // Offers that arrived during Away bootstrap (list only) get a popup once ready.
  useSafeEffect(() => {
    if (!shiftActive || !readyForJobs) return;
    if (jobOfferRef.current?.id) return;
    if (hailActiveRef.current || activeJobIdRef.current || paymentJobRef.current) return;

    let best: JobOffer | null = null;
    for (const o of broadcastOffersRef.current.values()) {
      if (o.expiresAt && o.expiresAt <= Date.now()) continue;
      if (!best || (o.postedAt || 0) > (best.postedAt || 0)) best = o;
    }
    if (!best?.id) return;

    console.log('[Driver] flush deferred offer popup after readyForJobs', best.id);
    setJobOffer({ ...best, silent: false });
    void alertDriverToOffer({ ...best, silent: false });
  }, [shiftActive, readyForJobs], 'Driver-flushDeferredOfferPopup');

  const handleDriverNotification = async (val: Record<string, unknown>) => {
    if (!driver?.id) return;
    const type = readNotificationType(val);
    const jobId = readNotificationJobId(val);
    const eventType = String(val.eventType ?? val.type ?? '').toLowerCase();

    if (eventType === 'assigned' || eventType === 'accepted' || eventType === 'queued') {
      await clearDriverNotification(driver.id);
      return;
    }

    if (eventType === 'sos_resolved') {
      await processIncomingSosClosed(val);
      return;
    }

    if (type === 'driver_sos' || eventType === 'driver_sos') {
      await processIncomingSosNotification(val, 'notification');
      return;
    }

    if (type === 'chat_message' || eventType === 'chat_message') {
      return;
    }

    if (type === 'kicked' || eventType === 'kicked') {
      if (adminForceEndInFlightRef.current) return;
      adminForceEndInFlightRef.current = true;
      void playInAppNotificationSound('alert');
      const msg = String(val.message ?? val.content ?? 'You have been kicked by dispatcher');
      Alert.alert('Signed out', msg);
      await clearDriverNotification(driver.id, driver.companyId);
      try {
        await endShiftAndSignOutRef.current?.({
          force: true,
          reason: 'manual',
          message: msg,
          skipSummary: true,
        });
      } finally {
        adminForceEndInFlightRef.current = false;
      }
      return;
    }

    if (type === 'suspended' || eventType === 'suspended') {
      if (adminForceEndInFlightRef.current) return;
      adminForceEndInFlightRef.current = true;
      void playInAppNotificationSound('alert');
      const untilRaw = val.suspendedUntil;
      const untilStr =
        untilRaw != null && String(untilRaw).trim()
          ? String(untilRaw)
          : '';
      const msg = String(
        val.message ??
          val.content ??
          (untilStr
            ? `You have been suspended by dispatcher until ${untilStr}.`
            : 'You have been suspended by dispatcher.'),
      );
      Alert.alert('Suspended', msg);
      await clearDriverNotification(driver.id, driver.companyId);
      try {
        await endShiftAndSignOutRef.current?.({
          force: true,
          reason: 'manual',
          message: msg,
          skipSummary: true,
        });
      } finally {
        adminForceEndInFlightRef.current = false;
      }
      return;
    }

    if (type === 'job_removed') {
      void playInAppNotificationSound('alert');
      Alert.alert('Job taken back', 'Job has been taken back by dispatcher');
      if (jobId && activeJobIdRef.current && jobIdsMatch(activeJobIdRef.current, jobId)) {
        await clearActiveJobInternal();
        await restoreAvailableAfterJobClear();
      }
      if (jobId) {
        removeBroadcastOffer(jobId);
        setQueuedOffers((prev) => prev.filter((o) => o.id !== jobId));
        setPoolOffers((prev) => prev.filter((o) => o.id !== jobId));
      }
      setJobOffer(null);
      await clearDriverNotification(driver.id);
      return;
    }

    if (type === 'no_show') {
      if (jobId && activeJobIdRef.current === jobId) {
        await clearActiveJobInternal();
        await restoreAvailableAfterJobClear();
      }
      setJobOffer(null);
      await clearDriverNotification(driver.id);
      return;
    }

    if (type === 'job_cancelled') {
      void playInAppNotificationSound('cancel');
      Alert.alert('Job cancelled', 'Job has been cancelled');
      if (jobId && activeJobIdRef.current === jobId) {
        await clearActiveJobInternal();
        await restoreAvailableAfterJobClear();
      }
      if (jobId) {
        removeBroadcastOffer(jobId);
        setQueuedOffers((prev) => prev.filter((o) => o.id !== jobId));
        setPoolOffers((prev) => prev.filter((o) => o.id !== jobId));
      }
      setJobOffer(null);
      await clearDriverNotification(driver.id);
      return;
    }

    if (type === 'job_updated' || val.editNotice) {
      const changes: string[] = [];
      if (val.pickup || val.jobpickup || val.PickAddress) {
        changes.push(`Pickup: ${val.pickup ?? val.jobpickup ?? val.PickAddress}`);
      }
      if (val.dropoff || val.jobdropoff || val.DropAddress) {
        changes.push(`Dropoff: ${val.dropoff ?? val.jobdropoff ?? val.DropAddress}`);
      }
      if (val.notes || val.jobinfo || val.Notes) changes.push(`Notes updated`);
      if (val.Pickingtime || val.pickupTime) changes.push(`Time updated`);
      const name = val.jobname ?? val.Name ?? val.PassengerName ?? val.passengerName;
      if (name) changes.push(`Passenger: ${name}`);
      const phone = val.JobphoneNo ?? val.PhoneNo ?? val.passengerPhone ?? val.phone;
      if (phone) changes.push(`Phone: ${phone}`);
      const fare = readFareFromRecord(val);
      if (fare != null) changes.push(`Fare: $${fare.toFixed(2)}`);
      const tariffName = val.TarriffType ?? val.TariffName ?? val.tariffName;
      if (tariffName) changes.push(`Tariff: ${tariffName}`);
      const pay = readPaymentFromRecord(val);
      if (pay) changes.push(`Payment: ${pay}`);
      void playInAppNotificationSound('update');
      const hailTripNow = isHailTripJob(activeJobRef.current, hailActiveRef.current);
      if (!hailTripNow) {
        Alert.alert('Job updated', changes.length ? changes.join('\n') : String(val.editNotice ?? 'Details changed'));
      } else {
        console.log('[Driver] job_updated during hail — applied silently');
      }

      if (jobId) {
        const tariffHints = readBookingTariffHints(val);
        const tariffMatch = resolveTariffFromList(tariffsListRef.current, tariffHints);
        if (tariffMatch) {
          setSelectedTariffState(tariffMatch);
          storeData(STORAGE_KEYS.selectedTariffId, tariffMatch.id).catch(() => undefined);
        }

        if (activeJobIdRef.current && jobIdsMatch(activeJobIdRef.current, jobId)) {
          setActiveJob((prev) => {
            if (!prev) return prev;
            const merged = patchActiveJobFromNotification(prev, val);
            storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
            return merged;
          });
        }

        setJobOffer((prev) =>
          prev && jobIdsMatch(prev.id, jobId) ? patchJobOfferFromNotification(prev, val) : prev,
        );

        const broadcastPatch = (offer: JobOffer) =>
          jobIdsMatch(offer.id, jobId) ? patchJobOfferFromNotification(offer, val) : offer;
        setBroadcastOffers((prev) => prev.map(broadcastPatch));
        broadcastOffersRef.current.forEach((offer, id) => {
          if (jobIdsMatch(id, jobId)) {
            broadcastOffersRef.current.set(id, patchJobOfferFromNotification(offer, val));
          }
        });
        setQueuedOffers((prev) =>
          prev.map((q) => (jobIdsMatch(q.id, jobId) ? { ...q, ...patchJobOfferFromNotification(q, val) } : q)),
        );
        setPoolOffers((prev) =>
          prev.map((q) => (jobIdsMatch(q.id, jobId) ? patchJobOfferFromNotification(q, val) : q)),
        );
      }
      await clearDriverNotification(driver.id);
      return;
    }

    if (type === 'job_offer' || (isOfferPayload(val) && eventType !== 'assigned' && eventType !== 'accepted' && eventType !== 'queued')) {
      await handleIncomingOffer(val);
      return;
    }
  };

  const processOfferPayload = async (val: Record<string, unknown>) => {
    if (!shiftActiveRef.current) return;
    await handleDriverNotification(val);
  };

  useSafeEffect(() => {
    if (hailActiveRef.current || activeJobIdRef.current) {
      setJobOffer(null);
    }
  }, [hailActive, activeJob?.id], 'Driver-clearOfferModalOnTrip');

  useSafeEffect(() => {
    if (!shiftActive || !isFirebaseReady || !driver?.id) return;
    const handlePayload = async (val: Record<string, unknown> | null) => {
      if (!val) {
        // A removed notification can be the only reconnect signal for an offer
        // that expired while this phone was offline. Verify cached direct offers
        // after Firebase/allbookings has had a moment to settle.
        setTimeout(() => {
          void reconcileOffersRef.current?.('notification-removed');
        }, 500);
        return;
      }
      if (typeof val !== 'object' || Array.isArray(val)) return;
      if (val.type || val.eventType || isOfferPayload(val)) {
        const payload = val as Record<string, unknown>;
        if (!canListenForOffers && !notificationBypassesOfferGate(payload)) {
          const t = readNotificationType(payload);
          if (t !== 'kicked' && t !== 'suspended') return;
        }
        await handleDriverNotification(payload);
        return;
      }
      if (!canListenForOffers) return;
      const payloads = extractOfferPayloads(val);
      for (const payload of payloads) {
        await processOfferPayload(payload);
      }
    };
    try {
      const unsubs: Array<() => void> = [];
      const attach = (path: string) => {
        const notifyRef = ref(getDatabaseInstance(), path);
        const unsub = onValue(notifyRef, async (snap) => {
          try {
            await handlePayload(snap.val() as Record<string, unknown> | null);
          } catch (err) {
            console.error('[Driver] notification listener', path, err);
          }
        });
        unsubs.push(unsub);
      };
      attach(`notification/${driver.id}`);
      if (driver.companyId) {
        attach(`notification/${driver.companyId}/${driver.id}`);
      }
      return () => {
        for (const unsub of unsubs) unsub();
      };
    } catch (err) {
      console.error('[Driver] notification subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, canListenForOffers, driver?.id, driver?.companyId], 'Driver-notification');

  useSafeEffect(() => {
    if (!shiftActive || !isFirebaseReady || !driver?.id) return;
    try {
      const chatRef = ref(getDatabaseInstance(), `notificationChat/${driver.id}`);
      return onValue(chatRef, async (snap) => {
        try {
          const val = snap.val() as Record<string, unknown> | null;
          if (!val || typeof val !== 'object') return;
          const eventType = String(val.eventType ?? val.type ?? '').toLowerCase();
          if (eventType !== 'chat_message') return;
          const body = String(val.content ?? val.message ?? 'New message from dispatch');
          const dedupeKey = String(val.messageId ?? val.timestamp ?? body);
          notifyDispatcherChat(body, dedupeKey);
          await clearChatNotification(driver.id);
        } catch (err) {
          console.error('[Driver] chat notification listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] chat notification subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, driver?.id, notifyDispatcherChat], 'Driver-notificationChat');

  useSafeEffect(() => {
    if (!shiftActive || !driver?.id) return;
    const unsub = subscribeChat(driver.id, (msg) => {
      if (msg.sender !== 'dispatcher') return;
      notifyDispatcherChat(msg.text, msg.id);
      void clearChatNotification(driver.id);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, driver?.id, notifyDispatcherChat], 'Driver-globalChat');

  useSafeEffect(() => {
    if (!shiftActive || !isFirebaseReady || !driver?.id) return;
    console.log('[Driver] notificationSos listener attached', driver.id);
    try {
      const sosRef = ref(getDatabaseInstance(), `notificationSos/${driver.id}`);
      return onValue(sosRef, async (snap) => {
        try {
          const val = snap.val() as Record<string, unknown> | null;
          if (!val || typeof val !== 'object') return;
          if (parseIncomingSosResolved(val)) {
            await processIncomingSosClosed(val);
            return;
          }
          await processIncomingSosNotification(val, 'notificationSos');
        } catch (err) {
          console.error('[Driver] SOS notification listener', err);
        }
      }, (err) => {
        console.error('[Driver] notificationSos permission/error', driver.id, err);
      });
    } catch (err) {
      console.error('[Driver] SOS notification subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, driver?.id, processIncomingSosNotification, processIncomingSosClosed], 'Driver-notificationSos');

  useSafeEffect(() => {
    if (!shiftActive || !isFirebaseReady || !driver?.companyId || !incomingSosAlert?.sosDriverId) {
      return;
    }
    const sosDriverId = incomingSosAlert.sosDriverId;
    try {
      const emergRef = ref(
        getDatabaseInstance(),
        `Emergency/${driver.companyId}/${sosDriverId}`,
      );
      return onValue(emergRef, (snap) => {
        const val = snap.val() as Record<string, unknown> | null;
        if (!val) {
          markIncomingSosResolved('Emergency resolved.');
          return;
        }
        const status = String(val.status ?? '').toLowerCase();
        if (status === 'resolved' || status === 'false_alarm') {
          markIncomingSosResolved(
            status === 'false_alarm'
              ? 'False alarm — this emergency is over.'
              : 'Emergency resolved.',
          );
        }
      }, (err) => {
        console.error('[Driver] SOS emergency watch', sosDriverId, err);
      });
    } catch (err) {
      console.error('[Driver] SOS emergency watch subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, driver?.companyId, incomingSosAlert?.sosDriverId, markIncomingSosResolved], 'Driver-sosEmergencyWatch');

  useSafeEffect(() => {
    if (!driver?.companyId || !activeJob?.id) {
      bookingRawRef.current = null;
      return;
    }
    bookingRawRef.current = null;
    return subscribeBooking(driver.companyId, activeJob.id, (update) => {
      const prevStatus = bookingRawRef.current
        ? String(bookingRawRef.current.Status ?? bookingRawRef.current.status ?? bookingRawRef.current.BookingStatus ?? '')
        : '';
      const poolReturn =
        isReturnedToDispatchPool(update.status) &&
        !(prevStatus && isReturnedToDispatchPool(prevStatus));
      if (
        update.terminal ||
        update.cancelled ||
        update.status === 'removed' ||
        isTerminalBookingStatus(
          String(update.raw.BookingStatus ?? update.raw.Status ?? update.raw.status ?? update.status),
        ) ||
        poolReturn
      ) {
        const expectedLocalComplete =
          localCompletionRef.current ||
          update.status === 'removed' ||
          String(update.raw.BookingStatus ?? update.raw.Status ?? '').toLowerCase().includes('complete');
        if (expectedLocalComplete) {
          localCompletionRef.current = false;
          void clearStaleActiveJobLocal('Trip completed.', { silent: true });
          return;
        }
        if (update.terminal && !update.status.includes('cancel') && update.status !== 'removed') {
          void playInAppNotificationSound('general');
          void clearStaleActiveJobLocal(
            `Job #${activeJob.id} was already completed on dispatch. You can end shift or take new jobs.`,
          );
          return;
        }
        void playInAppNotificationSound('cancel');
        Alert.alert(
          update.cancelled || update.status === 'removed' ? 'Job cancelled' : 'Job taken back',
          update.cancelled || update.status === 'removed'
            ? 'This booking was cancelled or closed by dispatch.'
            : 'This booking was returned to dispatch.',
        );
        void clearStaleActiveJobLocal(
          update.cancelled ? 'This booking was cancelled on dispatch.' : 'This booking was returned to dispatch.',
          { silent: true },
        );
        return;
      }
      const meterStarted = stageAllowsMeter(activeJob?.stage ?? 'pickup');
      const prevRaw = bookingRawRef.current;
      const { allowed, blocked, changes } = diffBookingChanges(
        prevRaw,
        update.raw,
        meterStarted,
      );
      bookingRawRef.current = update.raw;
      const rawSeq = update.raw.updateSeq ?? update.raw._seq ?? update.raw.version;
      const parsedSeq = rawSeq != null ? parseInt(String(rawSeq), 10) : NaN;
      if (!Number.isNaN(parsedSeq) && parsedSeq > 0) {
        setActiveJob((prev) => {
          if (!prev || prev.id !== activeJob.id) return prev;
          if ((prev.updateSeq ?? 0) >= parsedSeq) return prev;
          const merged = { ...prev, updateSeq: parsedSeq };
          storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
          return merged;
        });
      }
      const syncedNotes = collectJobNotes(update.raw);

      if (blocked.length > 0 && !isHailTripJob(activeJobRef.current, hailActiveRef.current)) {
        Alert.alert(
          'Job update blocked',
          `Changes to ${blocked.join(', ')} cannot be applied while passenger is on board. Notes and payment type can still change.`,
        );
      }

      const patch: Partial<ActiveJob> = {};
      if (allowed.pickup) patch.pickup = allowed.pickup;
      if (allowed.dropoff) patch.dropoff = allowed.dropoff;
      if (allowed.passengerName) patch.passengerName = allowed.passengerName;
      if (allowed.passengerPhone) patch.passengerPhone = allowed.passengerPhone;
      if (allowed.notes) patch.notes = allowed.notes;
      if (allowed.paymentType) patch.paymentType = allowed.paymentType as ActiveJob['paymentType'];
      if (syncedNotes.length) {
        patch.allNotes = syncedNotes;
        if (!patch.notes) patch.notes = syncedNotes.map((n) => n.text).join('\n\n');
      }

      const fareFromRaw = readFareFromRecord(update.raw);
      if (fareFromRaw != null && !meterStarted) {
        patch.fixedFare = fareFromRaw;
        patch.estimatedFare = fareFromRaw;
        patch.fare = fareFromRaw;
      }
      if (isFixedPriceBooking(update.raw)) {
        patch.isFixedPrice = true;
      }
      if (!patch.paymentType && prevRaw) {
        const payFromRaw = readPaymentFromRecord(update.raw);
        const prevPay = readPaymentFromRecord(prevRaw);
        if (payFromRaw && payFromRaw !== prevPay) {
          patch.paymentType = payFromRaw as ActiveJob['paymentType'];
        }
      }

      const dispatchTariffId = allowed.tariffId?.trim();
      const dispatchTariffName = allowed.tariffName?.trim();
      const match = resolveTariffFromList(tariffsListRef.current, {
        id: dispatchTariffId,
        name: dispatchTariffName,
      });
      if (match) {
        setSelectedTariffState(match);
        storeData(STORAGE_KEYS.selectedTariffId, match.id).catch(() => undefined);
        if (meterRef.current?.running) {
            const change: TariffChangeRecord = {
              tariffId: match.id,
              tariffName: match.name,
              at: Date.now(),
            };
            setMeter((prev) => {
              if (!prev) return prev;
              const waitMin = prev.waitingMs / 60000;
              const breakdown = calcMeterBreakdown(match, prev.distanceKm, waitMin);
              const next = {
                ...prev,
                tariffId: match.id,
                tariffName: match.name,
                tariffChanges: [...prev.tariffChanges, change],
                breakdown,
                fare: breakdown.total,
              };
              meterRef.current = next;
              storeData(STORAGE_KEYS.meterState, next).catch(() => undefined);
              return next;
            });
            startMeterWatch();
        }
      }
      const fromBooking = resolveTariffFromList(
        tariffsListRef.current,
        readBookingTariffHints(update.raw),
      );
      if (fromBooking && !meterRef.current?.running) {
        setSelectedTariffState(fromBooking);
        storeData(STORAGE_KEYS.selectedTariffId, fromBooking.id).catch(() => undefined);
      }

      if (changes.length === 0 && !syncedNotes.length && !dispatchTariffId && !dispatchTariffName && fareFromRaw == null && !patch.paymentType) return;

      if (Object.keys(patch).length > 0) {
        setActiveJob((prev) => {
          if (!prev) return prev;
          const merged = { ...prev, ...patch };
          storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
          return merged;
        });
      }

      if (changes.length > 0 && blocked.length === 0) {
        void playInAppNotificationSound('update');
        setJobEditNotice(`Job updated:\n${changes.join('\n')}`);
      } else if (changes.some((c) => c.startsWith('Notes') || c.startsWith('Payment'))) {
        setJobEditNotice(changes.filter((c) => c.startsWith('Notes') || c.startsWith('Payment')).join('\n'));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, activeJob?.id, activeJob?.stage], 'Driver-bookingSync');

  useSafeEffect(() => {
    if (!driver?.companyId || !jobOffer?.id) return;
    return subscribeBooking(driver.companyId, jobOffer.id, (update) => {
      const rawOfferedAt = update.raw.offeredAt ?? update.raw.OfferedAt;
      const isStalePoolSnapshot =
        update.terminal &&
        update.status === 'removed' &&
        (rawOfferedAt == null || rawOfferedAt === '');
      if (isStalePoolSnapshot) {
        return;
      }
      if (update.cancelled || (update.terminal && update.status.includes('cancel'))) {
        void playInAppNotificationSound('cancel');
        Alert.alert('Offer cancelled', 'This booking was cancelled by dispatch.');
        setJobOffer(null);
        removeBroadcastOffer(jobOffer.id);
        return;
      }
      if (update.terminal) {
        setJobOffer(null);
        removeBroadcastOffer(jobOffer.id);
        return;
      }
      const { allowed, changes } = diffBookingChanges(null, update.raw, false);
      const offerFare = readFareFromRecord(update.raw);
      if (changes.length === 0 && offerFare == null) return;
      void playInAppNotificationSound('update');
      setJobOffer((prev) => {
        if (!prev || !jobIdsMatch(prev.id, jobOffer.id)) return prev;
        const patch: Partial<JobOffer> = {};
        if (allowed.pickup) patch.pickup = allowed.pickup;
        if (allowed.dropoff) patch.dropoff = allowed.dropoff;
        if (allowed.passengerName) patch.passengerName = allowed.passengerName;
        if (allowed.passengerPhone) patch.passengerPhone = allowed.passengerPhone;
        if (allowed.notes) patch.notes = allowed.notes;
        if (offerFare != null) {
          patch.fixedFare = offerFare;
          patch.estimatedFare = offerFare;
        }
        const pay = readPaymentFromRecord(update.raw);
        if (pay) patch.paymentType = pay as PaymentType;
        return { ...prev, ...patch };
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, jobOffer?.id], 'Driver-offerBookingSync');

  const writeStagePresenceDebounced = async (
    presStatus: FirebaseDriverStatus,
    vehicleId: string,
  ) => {
    const now = Date.now();
    const last = lastStagePresenceWriteRef.current;
    if (last && last.status === presStatus && now - last.at < 2500) return;
    lastStagePresenceWriteRef.current = { status: presStatus, at: now };
    await writeOnlinePresence(driver!, vehicleId, presStatus).catch(() => undefined);
    void syncBgLocationFirebaseStatus(presStatus);
  };

  const setSelectedVehicleId = async (id: string) => {
    const normalized = id.trim().toUpperCase();
    setSelectedVehicleIdState(normalized);
    await storeData(STORAGE_KEYS.selectedVehicle, normalized);
    if (driver?.companyId && driver.uid) {
      update(ref(getDatabaseInstance(), `drivers/${driver.companyId}/${driver.uid}`), {
        vehicleId: normalized,
      }).catch(() => undefined);
    }
  };

  const resolveVehicleId = async (override?: string): Promise<string> => {
    let vehicleId = (override ?? selectedVehicleId ?? driver?.vehicleId ?? '').trim().toUpperCase();
    if (!vehicleId && driver?.companyId && driver.uid) {
      try {
        const snap = await get(ref(getDatabaseInstance(), `drivers/${driver.companyId}/${driver.uid}`));
        if (snap.exists()) {
          vehicleId = String(snap.val()?.vehicleId ?? '').trim().toUpperCase();
        }
      } catch {
        // non-fatal
      }
    }
    return vehicleId;
  };

  const derivePresenceWriteStatus = (): FirebaseDriverStatus => {
    if (awayIntentRef.current !== 'none') return 'Away';
    if (paymentJobRef.current) return 'Busy';
    const job = activeJobRef.current;
    if (job?.stage) {
      const map: Record<JobStage, FirebaseDriverStatus> = {
        pickup: 'Assigned',
        arrived: 'Arrived',
        onboard: 'Active',
        complete: 'Busy',
      };
      return map[job.stage] ?? 'Busy';
    }
    if (hailActiveRef.current) return 'Busy';
    return 'Available';
  };

  const syncBgLocationFirebaseStatus = async (status: FirebaseDriverStatus) => {
    presenceWriteStatusRef.current = status;
    updatePresenceHeartbeatStatus(status);
    try {
      const { updateBackgroundLocationStatus } = await import('@/services/locationService');
      const top = status === 'Assigned' ? 'Picking' : status;
      await updateBackgroundLocationStatus(top);
    } catch {
      // non-fatal
    }
  };

  const repairPresenceIfNeeded = async (reason = 'repair') => {
    if (!driver || !shiftActiveRef.current) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    const status = derivePresenceWriteStatus();
    await syncBgLocationFirebaseStatus(status);
    await repairOnlinePresence(driver, vehicleId, status, reason);
  };
  repairPresenceRef.current = repairPresenceIfNeeded;

  const refreshActiveJobFromServer = async (reason = 'reconcile') => {
    if (!driver?.companyId || !driver.id) return;
    const job = activeJobRef.current;
    if (!job?.id || !isValidBookingId(job.id)) return;
    // Phase 5c — provisional offline hail has no server row until journal flush.
    if (isProvisionalBookingId(job.id) || String(job.id).startsWith('local:')) {
      console.log(`[Driver] ${reason}: skip server refresh for provisional hail ${job.id}`);
      return;
    }
    const hailTrip = isHailTripJob(job, hailActiveRef.current);
    try {
      const server = await resolveServerBookingState(driver.companyId, driver.id, job.id);
      if (!server?.status) {
        if (hailTrip) {
          console.log(`[Driver] ${reason}: skipping stale clear for hail #${job.id} — server row not ready`);
          return;
        }
        console.log(`[Driver] ${reason}: clearing stale local job #${job.id} — absent from server`);
        await clearStaleActiveJobLocal('This booking is no longer assigned to you.');
        return;
      }

      const ownership = localActiveJobLostOnServer(server.status, server.driverId, driver.id);
      if (ownership.lost) {
        if (hailTrip && isReturnedToDispatchPool(server.status)) {
          console.log(`[Driver] ${reason}: hail #${job.id} returned on dispatch — clearing hail trip`);
        }
        console.log(
          `[Driver] ${reason}: clearing stale local job #${job.id} — ${ownership.reason} server=${server.status}`,
        );
        const detail = isTerminalBookingStatus(server.status)
          ? `Job #${job.id} is ${server.status} on dispatch. You can end shift or take new jobs.`
          : 'This booking was returned to dispatch.';
        await clearStaleActiveJobLocal(detail);
        return;
      }

      const serverIdx = serverStatusIndex(server.status);
      const localIdx = ['pickup', 'arrived', 'onboard', 'complete'].indexOf(job.stage);
      let ver = server.version || job.updateSeq;

      if (hailTrip) {
        if (localIdx > serverIdx) {
          const caught = await catchUpJobStagesOnDispatch(job.id, driver.id, job.stage, ver, {
            companyId: driver.companyId,
          });
          ver = caught.version ?? ver;
          if (caught.synced.length > 0) {
            console.log(`[Driver] ${reason}: hail caught up stages → ${caught.synced.join(', ')}`);
          }
        } else if (ver != null && ver !== job.updateSeq) {
          setActiveJob((prev) => {
            if (!prev || prev.id !== job.id) return prev;
            const merged = { ...prev, updateSeq: ver };
            storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
            return merged;
          });
        }
        return;
      }

      if (localIdx > serverIdx) {
        const caught = await catchUpJobStagesOnDispatch(job.id, driver.id, job.stage, ver);
        ver = caught.version ?? ver;
        if (caught.synced.length > 0) {
          console.log(`[Driver] ${reason}: caught up stages → ${caught.synced.join(', ')}`);
        }
      } else if (localIdx < serverIdx) {
        const reconciledStage = localStageFromServerStatus(server.status);
        console.log(`[Driver] ${reason}: local stage ${job.stage} behind server ${server.status} → ${reconciledStage}`);
        setActiveJob((prev) => {
          if (!prev || prev.id !== job.id) return prev;
          const merged = { ...prev, stage: reconciledStage, updateSeq: ver ?? prev.updateSeq };
          storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
          return merged;
        });
      } else {
        setActiveJob((prev) => {
          if (!prev || prev.id !== job.id) return prev;
          if (ver == null || ver === prev.updateSeq) return prev;
          const merged = { ...prev, updateSeq: ver };
          storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
          return merged;
        });
      }
    } catch (err) {
      console.warn(`[Driver] refreshActiveJobFromServer (${reason}) failed:`, err);
    }
  };
  refreshActiveJobRef.current = refreshActiveJobFromServer;

  const applySyncingBanner = async (banner: PendingSyncBanner | null) => {
    setSyncingBanner(banner?.message ?? null);
    await savePendingSyncBanner(banner);
  };

  refreshSyncingBannerRef.current = async () => {
    const resolved = await resolvePendingSyncBanner();
    await applySyncingBanner(resolved);
  };

  flushPendingTripJournalRef.current = async () => {
    // HTTP journal sync — do not wait for RTDB (that dual-gate left Active jobs stuck).
    if (!tripJournalFlushIsAllowed(networkConnectedRef.current)) return;
    await flushTripJournal({
      onHailCreated: async ({ clientTripId, serverJobId, updateSeq, vehicleId, companyId }) => {
        const live = activeJobRef.current;
        if (live?.clientTripId === clientTripId) {
          const bound: ActiveJob = {
            ...live,
            id: serverJobId,
            updateSeq,
            clientTripId,
          };
          setActiveJob(bound);
          activeJobIdRef.current = serverJobId;
          activeJobRef.current = bound;
          persistActiveJobAsync(bound);
        }
        await bindPendingClosedJobServerId({ clientTripId, serverJobId }).catch((err) => {
          console.warn('[Driver] bindPendingClosedJobServerId failed:', err);
        });
        if (driver && companyId && vehicleId) {
          writeOnlinePresence(driver, vehicleId, 'Busy').catch(() => undefined);
          void patchOnlineCurrentJobId(companyId, vehicleId, serverJobId).catch((err) => {
            console.warn('[Driver] patchOnlineCurrentJobId after journal flush failed:', err);
          });
        }
      },
      onStageSynced: async ({ serverJobId, version }) => {
        const live = activeJobRef.current;
        if (!live || String(live.id) !== String(serverJobId) || version == null) return;
        setActiveJob((prev) => {
          if (!prev || String(prev.id) !== String(serverJobId)) return prev;
          const merged = { ...prev, updateSeq: version };
          storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
          return merged;
        });
      },
      onTerminalSynced: async ({ serverJobId, clientTripId, type, payload }) => {
        if (type !== 'Completed') return;
        await bindPendingClosedJobServerId({ clientTripId, serverJobId }).catch(() => undefined);
        await flushPendingClosedJobs({
          only: { serverJobId, clientTripId },
          tripFields: payload,
        }).catch((err) => {
          console.warn('[Driver] flushPendingClosedJobs after terminal failed:', err);
        });
      },
    });
    // Catch any pending closed snapshots whose journal already synced earlier.
    await flushPendingClosedJobs().catch((err) => {
      console.warn('[Driver] flushPendingClosedJobs failed:', err);
    });
    await flushPendingShiftEnds(driver).catch((err) => {
      console.warn('[Driver] flushPendingShiftEnds failed:', err);
    });
    await refreshSyncingBannerRef.current?.();
  };

  useSafeEffect(() => {
    if (!driver?.companyId || !driver.id || !activeJob?.id) return;
    void refreshActiveJobFromServer('active-job-resume');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, activeJob?.id], 'Driver-reconcile-active-job');

  useSafeEffect(() => {
    if (!driver?.companyId || !driver.id || !selectedVehicleId || !activeJob?.id || activeJob.source === 'hail') return;
    return subscribeActiveJobFirebaseWatch(
      driver.companyId,
      selectedVehicleId,
      driver.id,
      activeJob.id,
      (reason) => {
        if (!activeJobIdRef.current || !jobIdsMatch(activeJobIdRef.current, activeJob.id)) return;
        // Presence wipe / offer-node delete are NOT proof the job left this driver.
        // Ghost-presence sweeper deletes online/{cid}/{vid} while allbookings can still
        // show Assigned/Active. Reconcile ownership, then repair presence if still ours.
        // Real withdraws still clear via job_removed / job_cancelled / subscribeBooking /
        // refreshActiveJobFromServer ownership checks.
        console.log(
          `[Driver] active-job Firebase signal (${reason}) for #${activeJob.id} — reconciling ownership (not clearing on presence alone)`,
        );
        void (async () => {
          await refreshActiveJobRef.current?.(`presence-signal:${reason}`);
          if (activeJobIdRef.current && jobIdsMatch(activeJobIdRef.current, activeJob.id)) {
            void repairPresenceRef.current?.(`presence-signal:${reason}`);
          }
        })();
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, driver?.id, selectedVehicleId, activeJob?.id], 'Driver-activeJobFirebaseWatch');

  useSafeEffect(() => {
    if (!driver || !shiftActive || !selectedVehicleId) {
      stopPresenceHeartbeat();
      return;
    }
    const status = derivePresenceWriteStatus();
    startPresenceHeartbeat(driver, selectedVehicleId, status);
    void repairOnlinePresence(driver, selectedVehicleId, status, 'shift-active-resume');
    return () => stopPresenceHeartbeat();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, driver?.id, shiftActive, selectedVehicleId], 'Driver-presence-heartbeat');

  // Mid-offer heal is 10s; idle Available lastSeen normally only refreshes ~15–20s.
  // Stamp every 5s while any exclusive offer is live (modal jobOffer AND/OR
  // broadcastOffers on the Offer tab). Previously only jobOffer was watched, so
  // Offer-tab fanouts that never set the modal left the phone on the 20s idle cadence.
  const broadcastOfferKey = broadcastOffers
    .map((o) => String(o.id || ''))
    .filter(Boolean)
    .sort()
    .join('|');
  useSafeEffect(() => {
    const pending = !!(shiftActive && (jobOffer?.id || broadcastOffers.length > 0));
    const diag = getPresenceWriteDiagnostics();
    console.log(
      `[Presence] offer-pending gate pending=${pending} shift=${shiftActive} ` +
        `jobOffer=${jobOffer?.id ?? 'none'} broadcast=${broadcastOffers.length}` +
        `${broadcastOfferKey ? ` [${broadcastOfferKey}]` : ''} ` +
        `heartbeatCtx=${diag.heartbeatActive ? 'up' : 'down'} ` +
        `modeWas=${diag.offerPendingMode} intervalWas=${diag.heartbeatIntervalMs}ms`,
    );
    setPresenceOfferPending(pending);
    // No cleanup → false: dep churn (broadcast list refresh) must not briefly
    // clear offer-pending before the next effect body re-enables it.
  }, [shiftActive, jobOffer?.id, broadcastOfferKey], 'Driver-offer-presence-heartbeat');

  useSafeEffect(() => {
    if (!driver?.companyId) return;
    const unsubRtdb = subscribeFirebaseRtdbConnected((connected) => {
      updateDispatchConnection('rtdb', connected);
      if (connected) {
        // Presence first so dispatch stops treating this driver as unreachable.
        if (shiftActiveRef.current) {
          void repairPresenceRef.current?.('rtdb-reconnect');
        }
        void (async () => {
          await flushPendingTripJournalRef.current?.();
          if (activeJobRef.current?.id) {
            void refreshActiveJobRef.current?.('rtdb-reconnect');
          }
          void reconcileOffersRef.current?.('rtdb-reconnect');
          // Phase 5d — cancel/no-show queue may only clear when RTDB returns.
          await flushOfflineQueue();
          await refreshSyncingBannerRef.current?.();
        })();
      }
    });
    return unsubRtdb;
  }, [driver?.companyId], 'Driver-presence-rtdb');

  useSafeEffect(() => {
    if (!shiftActive || !driver) return;
    void syncBgLocationFirebaseStatus(derivePresenceWriteStatus());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, activeJob?.stage, hailActive, presenceStatus, readyForJobs, paymentJob], 'Driver-bg-location-status');

  const startShift = async (vehicleIdOverride?: string): Promise<boolean> => {
    if (!driver) return false;

    const vehicleId = (vehicleIdOverride ?? '').trim().toUpperCase();
    if (!vehicleId) {
      Alert.alert('Vehicle required', 'Select a vehicle and confirm before starting your shift.');
      return false;
    }

    try {
      const nztaState = await initializeNztaOnLogin(driver.companyId, driver.uid);
      const lockout = getShiftLockout(nztaState);
      if (lockout.blocked) {
        Alert.alert('Rest period required', lockout.message);
        return false;
      }
    } catch (err) {
      console.error('[Driver] NZTA lockout check failed:', err);
    }

    if (vehicleId !== selectedVehicleId) {
      await setSelectedVehicleId(vehicleId);
    }

    if (driver.companyId) {
      const availability = await assertVehicleAvailableForShift(
        driver.companyId,
        vehicleId,
        driver.id,
        driver.uid,
      );
      if (!availability.ok) {
        Alert.alert('Vehicle in use', availability.message);
        return false;
      }
    }

    setShiftActive(true);
    shiftActiveRef.current = true;
    setReadyForJobs(false);
    readyForJobsRef.current = false;
    awayIntentRef.current = 'none';
    setPresenceStatus('Offline');
    await storeData(STORAGE_KEYS.shiftActive, true);

    try {
      // Bootstrap session (Away — not auto-dispatch eligible). Available is written
      // only after GPS/location + readyForJobs so the first offer cannot land while
      // the popup gate is closed and lastSeen is already aging.
      console.log('[Shift] startShift — profile uid:', driver.uid, 'vehicle:', vehicleId);
      await startShiftOnline(driver, vehicleId);

      // GPS + fresh lastSeen before advertising offerable — same Firebase shape as
      // hail-complete / goAvailable. Previously startShiftOnline wrote Available then
      // awaited GPS enrich while readyForJobs was still false → Offer-tab-only + network bounce.
      let trackingStarted = false;
      try {
        const { startBackgroundTracking } = await import('@/services/locationService');
        console.log('[Shift] location tracking begin (before Available / readyForJobs)');
        trackingStarted = await startBackgroundTracking(
          driver.id,
          driver.companyId,
          vehicleId,
        );
        console.log('[Shift] location tracking result:', trackingStarted);
      } catch (err) {
        console.warn('[Shift] location tracking failed (non-fatal):', err);
      }

      await writeOnlinePresence(driver, vehicleId, 'Available');
      console.log('[Shift] writeOnlinePresence Available done — GPS/lastSeen stamped');

      setPresenceStatus('Online');
      setReadyForJobs(true);
      readyForJobsRef.current = true;
      presenceWriteStatusRef.current = 'Available';
      startPresenceHeartbeat(driver, vehicleId, 'Available');
      void syncBgLocationFirebaseStatus('Available');
      console.log('[Shift] presence Online, readyForJobs=true');

      if (!trackingStarted) {
        Alert.alert(
          'Location optional',
          'You are online and ready for jobs. Enable location when prompted so dispatch can see your position on the map.',
        );
      }
    } catch (err) {
      console.warn('[Shift] Firebase online status write failed:', err);
      Alert.alert('Connection issue', 'Could not register with dispatch. Check your network and try again.');
      setShiftActive(false);
      shiftActiveRef.current = false;
      await storeData(STORAGE_KEYS.shiftActive, false);
      return false;
    }

    console.log('[Shift] scheduling NZTA clock (background)');

    void import('@/services/shiftRuntimeService').then(({ startShiftRuntime }) =>
      startShiftRuntime({
        onForegroundResume: () => {
          void repairPresenceRef.current?.('app-foreground');
          void refreshActiveJobRef.current?.('app-foreground');
          // Soft reconnect often skips NetInfo/RTDB edges; foreground must flush
          // offline completes so dispatch does not stay Active until remount.
          void (async () => {
            await flushPendingTripJournalRef.current?.();
            await flushOfflineQueue();
            await refreshSyncingBannerRef.current?.();
          })();
        },
      }).catch((err) => console.warn('[Shift] shiftRuntime start failed:', err)),
    );

    void import('@/services/nztaService').then(({ startShiftClock }) =>
      startShiftClock(driver.companyId, driver.uid)
        .then(() => console.log('[Shift] NZTA clock started'))
        .catch((err) => console.error('[Driver] startShiftClock', err)),
    );

    if (driver.companyId) {
      update(ref(getDatabaseInstance(), `vehicles/${driver.companyId}/${vehicleId}`), {
        currentDriverId: driver.id,
      })
        .then(() => console.log('[Shift] vehicle currentDriverId updated'))
        .catch(() => undefined);
    }

    console.log('[Shift] startShift complete — safe to navigate to tabs');
    if (activeJobRef.current?.id && isValidBookingId(activeJobRef.current.id)) {
      void refreshActiveJobFromServer('shift-start');
    }
    // After crash/reopen, pending offline completes may still be journalled.
    void (async () => {
      await flushPendingTripJournalRef.current?.();
      await flushOfflineQueue();
      await refreshSyncingBannerRef.current?.();
    })();
    return true;
  };

  const goAway = async () => {
    if (blockIfTripInProgress()) return;
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    awayIntentRef.current = 'manual';
    await writeOnlinePresence(driver, vehicleId, 'Away');
    await syncBgLocationFirebaseStatus('Away');
    setPresenceStatus('Away');
    setReadyForJobs(false);
    readyForJobsRef.current = false;
  };

  const goAvailable = async () => {
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    const wasMissed = awayIntentRef.current === 'missed';
    awayIntentRef.current = 'none';
    await writeOnlinePresence(driver, vehicleId, 'Available');
    await syncBgLocationFirebaseStatus('Available');
    if (wasMissed) {
      await moveDriverToEndOfQueue(driver, vehicleId);
    }
    setPresenceStatus('Online');
    setReadyForJobs(true);
    readyForJobsRef.current = true;
  };

  const setAwayAfterMissedOffer = async () => {
    console.log('[away-debug] setAwayAfterMissedOffer', {
      shiftActive,
      driverId: driver?.id,
      hailActive: hailActiveRef.current,
      activeJobId: activeJobIdRef.current,
      paymentJobId: paymentJobRef.current?.id ?? null,
      stack: new Error().stack?.split('\n').slice(1, 5).join(' | '),
    });
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    awayIntentRef.current = 'missed';
    await writeOnlinePresence(driver, vehicleId, 'Away');
    await syncBgLocationFirebaseStatus('Away');
    setPresenceStatus('Away');
    setReadyForJobs(false);
    readyForJobsRef.current = false;
  };

  const togglePresence = async () => {
    if (presenceStatus === 'Online' && readyForJobs) {
      await goAway();
    } else {
      await goAvailable();
    }
  };

  const endShiftLocal = () => {
    stopPresenceHeartbeat();
    setShiftActive(false);
    shiftActiveRef.current = false;
    awayIntentRef.current = 'none';
    void storeData(STORAGE_KEYS.shiftActive, false);
    void storeData(STORAGE_KEYS.vehicleSessionReady, false);
    setReadyForJobs(false);
    readyForJobsRef.current = false;
    clearBroadcastOffers();
    stopMeterTimers();
    setHailActive(false);
    hailActiveRef.current = false;
    setHailPickupAddress(null);
    setHailPickupLat(undefined);
    setHailPickupLng(undefined);
    setMeter(null);
    meterRef.current = null;
    storeData(STORAGE_KEYS.meterState, null).catch(() => undefined);
    setPresenceStatus('Offline');
    setJobOffer(null);
    setQueuedOffers([]);
    setActiveJob(null);
    activeJobIdRef.current = null;
    setPaymentJob(null);
    clearPaymentJobRef();
    void storeData(STORAGE_KEYS.activeJob, null);
  };

  const endShiftRemote = async (
    driverSnapshot: typeof driver,
    vehicleId: string | null,
    reason: EndShiftReason = 'manual',
  ): Promise<EndShiftSummary | null> => {
    // Local-first: stop writers + NZTA immediately. Network (presence / shiftLogs)
    // is best-effort and journalled for reconnect — never blocks End Shift / log off.
    if (driverSnapshot?.companyId && vehicleId) {
      markPresenceSessionEnded(driverSnapshot.companyId, vehicleId);
    }
    stopPresenceHeartbeat();
    shiftActiveRef.current = false;
    setShiftActive(false);
    setPresenceStatus('Offline');
    setReadyForJobs(false);
    readyForJobsRef.current = false;

    try {
      const { stopBackgroundTracking } = await import('@/services/locationService');
      await stopBackgroundTracking();
    } catch (err) {
      console.warn('[Driver] stopBackgroundTracking failed:', err);
    }

    let summary: EndShiftSummary | null = null;

    if (driverSnapshot?.companyId && driverSnapshot.uid) {
      try {
        const { captureEndShiftSummary } = await import('@/services/nztaService');
        summary = await captureEndShiftSummary(driverSnapshot.companyId, driverSnapshot.uid);
      } catch (err) {
        console.warn('[Driver] captureEndShiftSummary failed:', err);
      }
    }

    // NZTA local persist first (endShiftClock journals shiftLogs if RTDB fails).
    let shiftEndAt = Date.now();
    if (driverSnapshot?.companyId && driverSnapshot.uid) {
      try {
        const { endShiftClock } = await import('@/services/nztaService');
        const nextHours = await endShiftClock(
          driverSnapshot.companyId,
          driverSnapshot.uid,
          driverSnapshot.id,
          reason,
          { vehicleId },
        );
        if (nextHours?.lastShiftEndAt) shiftEndAt = nextHours.lastShiftEndAt;
      } catch (err) {
        console.warn('[Driver] endShiftClock failed (local hours may be incomplete):', err);
      }
    }

    if (driverSnapshot && vehicleId) {
      const likelyOffline =
        networkConnectedRef.current === false || rtdbConnectedRef.current === false;
      let presenceOk = !likelyOffline;
      try {
        await clearOnlinePresence(driverSnapshot, vehicleId);
      } catch (err) {
        console.warn('[Driver] clearOnlinePresence failed:', err);
        presenceOk = false;
      }
      if (driverSnapshot.companyId) {
        try {
          await update(ref(getDatabaseInstance(), `vehicles/${driverSnapshot.companyId}/${vehicleId}`), {
            currentDriverId: null,
          });
        } catch (err) {
          console.warn('[Driver] clear vehicle currentDriverId failed:', err);
          presenceOk = false;
        }
      }
      // clearOnlinePresence swallows many RTDB errors — journal whenever we were offline
      // or an explicit write failed so reconnect can finish the clear.
      if ((!presenceOk || likelyOffline) && driverSnapshot.companyId && driverSnapshot.uid) {
        await journalPresenceClearFailure({
          companyId: driverSnapshot.companyId,
          uid: driverSnapshot.uid,
          driverId: driverSnapshot.id,
          vehicleId,
          reason,
          shiftEndAt,
        }).catch((err) => console.warn('[Driver] journalPresenceClearFailure failed:', err));
      }
    }

    try {
      const { stopShiftRuntime } = await import('@/services/shiftRuntimeService');
      stopShiftRuntime();
    } catch (err) {
      console.warn('[Driver] stopShiftRuntime failed:', err);
    }
    return summary;
  };

  const waitForEndShiftSummaryAck = () =>
    new Promise<void>((resolve) => {
      endShiftSummaryAckRef.current = resolve;
    });

  const acknowledgeEndShiftSummary = () => {
    setEndShiftSummary(null);
    endShiftSummaryAckRef.current?.();
    endShiftSummaryAckRef.current = null;
  };

  const endShift = async () => {
    if (blockIfTripInProgress()) return;
    if (endShiftInProgressRef.current) return;

    endShiftInProgressRef.current = true;
    setEndShiftInProgress(true);
    try {
      const vehicleId = await resolveVehicleId();
      const driverSnapshot = driver;
      try {
        await endShiftRemote(driverSnapshot, vehicleId);
      } catch (err) {
        // Remote is best-effort; always clear local shift offline.
        console.warn('[Driver] endShiftRemote soft-failed:', err);
      }
      endShiftLocal();
    } catch (err) {
      console.error('[Driver] endShift local clear failed:', err);
      Alert.alert('End shift failed', err instanceof Error ? err.message : 'Could not end shift');
    } finally {
      endShiftInProgressRef.current = false;
      setEndShiftInProgress(false);
      setEndShiftSummary(null);
    }
  };

  const endShiftAndSignOut = async (opts?: {
    force?: boolean;
    reason?: EndShiftReason;
    message?: string;
    skipSummary?: boolean;
  }) => {
    if (!opts?.force && blockIfTripInProgress()) return;
    if (endShiftInProgressRef.current) return;

    endShiftInProgressRef.current = true;
    setEndShiftInProgress(true);
    try {
      const vehicleId = await resolveVehicleId();
      const driverSnapshot = driver;
      const reason = opts?.reason ?? 'manual';
      let summary: EndShiftSummary | null = null;
      try {
        summary = await endShiftRemote(driverSnapshot, vehicleId, reason);
      } catch (err) {
        console.warn('[Driver] endShiftRemote soft-failed:', err);
        if (driverSnapshot?.companyId && driverSnapshot.uid) {
          try {
            const { captureEndShiftSummary } = await import('@/services/nztaService');
            summary = await captureEndShiftSummary(driverSnapshot.companyId, driverSnapshot.uid);
          } catch {
            summary = null;
          }
        }
      }

      if (summary && !opts?.skipSummary && !opts?.force) {
        setEndShiftSummary(summary);
        await waitForEndShiftSummaryAck();
      }

      endShiftLocal();
      await signOut();
      router.replace('/(auth)/login');
      if (opts?.message) {
        Alert.alert('Shift limit', opts.message);
      }
    } catch (err) {
      console.error('[Driver] endShiftAndSignOut failed:', err);
      // Last resort: still try local clear + sign-out so driver is not stuck offline.
      try {
        endShiftLocal();
        await signOut();
        router.replace('/(auth)/login');
      } catch (fallbackErr) {
        console.error('[Driver] endShiftAndSignOut fallback failed:', fallbackErr);
        Alert.alert('End shift failed', err instanceof Error ? err.message : 'Could not end shift');
      }
    } finally {
      endShiftInProgressRef.current = false;
      setEndShiftInProgress(false);
      setEndShiftSummary(null);
      endShiftSummaryAckRef.current = null;
    }
  };

  forceNztaLimitSignOutRef.current = async (reason, message) => {
    await endShiftAndSignOut({
      force: true,
      reason,
      message,
      skipSummary: true,
    });
  };

  endShiftAndSignOutRef.current = endShiftAndSignOut;

  const syncJobStageToDispatch = async (
    stage: JobStage,
    jobOverride?: { id: string; updateSeq?: number },
  ) => {
    if (!driver) {
      throw new Error('Driver profile not loaded.');
    }
    const statusMap: Record<JobStage, FirebaseDriverStatus> = {
      pickup: 'Assigned',
      arrived: 'Arrived',
      onboard: 'Active',
      complete: 'Busy',
    };
    const bookingStatusMap: Partial<Record<JobStage, string>> = {
      pickup: 'Assigned',
      arrived: 'Arrived',
      onboard: 'Active',
    };
    const bookingStatus = bookingStatusMap[stage];
    const jobRef = jobOverride ?? activeJob;
    if (!jobRef?.id || !bookingStatus || !isValidBookingId(jobRef.id)) {
      if (jobRef?.id && !isValidBookingId(jobRef.id)) {
        throw new Error(`Invalid booking id: ${jobRef.id}`);
      }
      return;
    }
    // Phase 5c — local: provisional hail waits for journal flush before stage APIs.
    if (isProvisionalBookingId(jobRef.id)) {
      console.log(`[Driver] skip stage sync for provisional booking ${jobRef.id}`);
      return;
    }

    const vehicleId = await resolveVehicleId();

    const { version } = await syncJobStageOnDispatch(
      jobRef.id,
      bookingStatus,
      driver.id,
      jobRef.updateSeq,
    );
    if (version != null && activeJob?.id === jobRef.id) {
      setActiveJob((prev) => {
        if (!prev || prev.id !== jobRef.id) return prev;
        const merged = { ...prev, updateSeq: version };
        storeData(STORAGE_KEYS.activeJob, merged).catch(() => undefined);
        return merged;
      });
    }

    if (vehicleId && shiftActiveRef.current) {
      await writeStagePresenceDebounced(statusMap[stage], vehicleId);
    }
  };

  const acceptOffer = async () => {
    if (!jobOffer || !driver || acceptingOfferRef.current) return;
    if (
      !offerAcceptanceIsAllowed(
        networkConnectedRef.current,
        rtdbConnectedRef.current,
      )
    ) {
      jobOfferRef.current = null;
      setJobOffer(null);
      Alert.alert(
        'Connection lost',
        'Reconnect and wait for a fresh offer before accepting.',
      );
      return;
    }
    acceptingOfferRef.current = true;
    try {
    const offerSnapshot = jobOffer;
    if (!isValidBookingId(offerSnapshot.id)) {
      Alert.alert('Invalid job', 'This offer has no valid booking ID. Ask dispatch to re-send the job.');
      setJobOffer(null);
      return;
    }

    if (offerSnapshot.fromQueue) {
      try {
        const result = await promoteQueuedJob(offerSnapshot.id, driver.id);
        removeBroadcastOffer(offerSnapshot.id);
        setJobOffer(null);
        const job = defaultActiveJob(offerSnapshot);
        job.originalStatus = offerSnapshot.originalStatus ?? 'pending';
        job.updateSeq = result.version;
        const rawSeed = bookingRawSeedFromOffer(job);
        if (rawSeed) bookingRawRef.current = rawSeed;
        setActiveJob(job);
        activeJobIdRef.current = job.id;
        await storeData(STORAGE_KEYS.activeJob, job);
        setQueuedOffers((prev) => prev.filter((o) => o.id !== offerSnapshot.id));
        setPreferredPanelTab('current');
        await captureAcceptLocation(job.id);
        const vehicleId = await resolveVehicleId();
        if (vehicleId) {
          writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
          setPresenceStatus('Busy');
          readyForJobsRef.current = true;
        }
        await clearDriverNotification(driver.id);
        return;
      } catch {
        Alert.alert('Could not start queued job', 'Dispatch did not confirm this queued job. Try again or recall it.');
        return;
      }
    }

    let queued = false;
    let acceptOk = false;
    let acceptResult: { version?: number; booking?: { version?: number } } | null = null;
    try {
      const result = (await acceptJobOffer(offerSnapshot.id, driver.id)) as {
        ok?: boolean;
        queued?: boolean;
        status?: string;
        version?: number;
        booking?: { version?: number };
      };
      acceptResult = result;
      if (result?.ok === false) {
        throw new Error('Accept rejected by dispatch server');
      }
      acceptOk = true;
      queued = !!(result?.queued || result?.status === 'Queued');
    } catch (err) {
      if (isDispatchAcceptRetryable(err)) {
        removeBroadcastOffer(offerSnapshot.id);
        setJobOffer(null);
        Alert.alert(
          'Could not accept',
          'No confirmation from dispatch. Reconnect and wait for a fresh offer — this offer will not be accepted later.',
        );
      } else {
        const msg = err instanceof DispatchApiError
          ? err.message
          : 'Dispatch did not accept this job.';
        Alert.alert('Could not accept', msg);
      }
      return;
    }

    removeBroadcastOffer(offerSnapshot.id);
    setJobOffer(null);

    if (queued) {
      setPreferredPanelTab('queue');
      Alert.alert('Job queued', 'This job is in your Queue until your current trip finishes.');
      return;
    }

    if (!acceptOk) return;

    const job = defaultActiveJob(offerSnapshot);
    job.originalStatus = offerSnapshot.originalStatus ?? 'pending';
    job.updateSeq = acceptResult?.version ?? acceptResult?.booking?.version;
    const rawSeed = bookingRawSeedFromOffer(job);
    if (rawSeed) bookingRawRef.current = rawSeed;
    setActiveJob(job);
    activeJobIdRef.current = job.id;
    await storeData(STORAGE_KEYS.activeJob, job);
    setPreferredPanelTab('current');
    await captureAcceptLocation(job.id);

    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
      syncJobStageToDispatch('pickup');
    }
    await clearDriverNotification(driver.id);
    } finally {
      acceptingOfferRef.current = false;
    }
  };

  const declineOffer = async (opts?: { timedOut?: boolean }) => {
    if (!jobOffer || !driver) return;
    const offerSnapshot = jobOffer;
    const timedOut = !!opts?.timedOut;
    console.log('[away-debug] declineOffer', {
      jobId: offerSnapshot.id,
      timedOut,
      fromQueue: !!offerSnapshot.fromQueue,
      hailActive: hailActiveRef.current,
      activeJobId: activeJobIdRef.current,
      paymentJobId: paymentJobRef.current?.id ?? null,
      awayIntentBefore: awayIntentRef.current,
    });

    if (offerSnapshot.fromQueue) {
      try {
        await recallJobOnDispatch(
          offerSnapshot.id,
          driver.id,
          offerSnapshot.originalStatus ?? 'pending',
        );
      } catch {
        await enqueueOfflineItem({
          type: 'job_update',
          payload: {
            action: 'recall',
            jobId: offerSnapshot.id,
            driverId: driver.id,
            companyId: driver.companyId,
            originalStatus: offerSnapshot.originalStatus ?? 'pending',
          },
        });
      }
      setQueuedOffers((prev) => prev.filter((o) => o.id !== offerSnapshot.id));
      Alert.alert('Job declined', 'Job returned to dispatch for other drivers.');
    } else {
      let driverSetAway = timedOut;
      try {
        const result = (await declineJobOffer(offerSnapshot.id, driver.id, {
          originalStatus: offerSnapshot.originalStatus ?? 'pending',
          timedOut,
        })) as { driverSetAway?: boolean };
        if (result && typeof result.driverSetAway === 'boolean') {
          driverSetAway = result.driverSetAway;
        }
      } catch {
        await enqueueOfflineItem({
          type: 'job_update',
          payload: {
            action: 'decline',
            jobId: offerSnapshot.id,
            driverId: driver.id,
            companyId: driver.companyId,
            originalStatus: offerSnapshot.originalStatus ?? 'pending',
            timedOut: !!timedOut,
          },
        });
        // Offline miss: still Away locally. Server Away only applies if the job was
        // still Offered when the queued decline flushes (not after a network bounce).
        driverSetAway = timedOut;
      }
      removeBroadcastOffer(offerSnapshot.id);
      if (shiftActive && driverSetAway && !driverHasConfirmedActiveTrip()) {
        console.log('[away-debug] declineOffer → setAwayAfterMissedOffer (timed-out exclusive offer)');
        await setAwayAfterMissedOffer();
      } else {
        console.log('[away-debug] declineOffer skip Away', {
          shiftActive,
          timedOut,
          driverSetAway,
          hasTrip: driverHasConfirmedActiveTrip(),
        });
      }
    }

    setJobOffer(null);
    lastOfferSeenRef.current = null;
    await clearDriverNotification(driver.id);
  };

  const pickOfferFromList = async (offerId: string) => {
    const offer = visibleOffers.find((o) => o.id === offerId);
    if (!offer || !driver || acceptingOfferRef.current) return;
    if (
      !offerAcceptanceIsAllowed(
        networkConnectedRef.current,
        rtdbConnectedRef.current,
      )
    ) {
      Alert.alert(
        'Connection lost',
        'Reconnect and wait for a fresh offer before accepting.',
      );
      return;
    }
    acceptingOfferRef.current = true;
    try {
    try {
      const result = (await acceptJobOffer(offer.id, driver.id)) as {
        ok?: boolean;
        queued?: boolean;
        status?: string;
      };
      if (result?.ok === false) {
        throw new Error('Accept rejected by dispatch server');
      }
      if (result?.queued || result?.status === 'Queued') {
        removeBroadcastOffer(offer.id);
        setPreferredPanelTab('queue');
        Alert.alert('Job queued', 'This job is in your Queue until your current trip finishes.');
        return;
      }
    } catch (err) {
      if (isDispatchAcceptRetryable(err)) {
        removeBroadcastOffer(offer.id);
        Alert.alert(
          'Could not accept',
          'No confirmation from dispatch. Reconnect and wait for a fresh offer — this offer will not be accepted later.',
        );
      } else {
        const msg = err instanceof DispatchApiError
          ? err.message
          : 'Dispatch did not accept this job.';
        Alert.alert('Could not accept', msg);
      }
      return;
    }

    removeBroadcastOffer(offer.id);
    const job = defaultActiveJob(offer);
    job.originalStatus = offer.originalStatus ?? 'pending';
    const rawSeed = bookingRawSeedFromOffer(job);
    if (rawSeed) bookingRawRef.current = rawSeed;
    setActiveJob(job);
    activeJobIdRef.current = job.id;
    await storeData(STORAGE_KEYS.activeJob, job);
    setPreferredPanelTab('current');
    await captureAcceptLocation(job.id);

    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
      syncJobStageToDispatch('pickup');
    }
    } finally {
      acceptingOfferRef.current = false;
    }
  };

  const startMeterForJob = () => {
    if (!shouldStartMeterForBooking(bookingRawRef.current, activeJobRef.current)) {
      const fixedFare = readFixedFareAmount(bookingRawRef.current, activeJobRef.current ?? undefined);
      if (fixedFare != null && activeJobRef.current) {
        setActiveJob((prev) => {
          if (!prev) return prev;
          const updated = {
            ...prev,
            fare: fixedFare,
            fixedFare,
            estimatedFare: fixedFare,
            isFixedPrice: true,
          };
          persistActiveJobAsync(updated);
          return updated;
        });
      }
      return;
    }
    const tariffs = tariffsListRef.current;
    const fromBooking = bookingRawRef.current
      ? resolveTariffFromList(tariffs, readBookingTariffHints(bookingRawRef.current))
      : null;
    const tariff =
      fromBooking ??
      resolveTariffForDriver(tariffs, null, selectedTariffRef.current) ??
      selectedTariffRef.current;
    if (!isTariffConfigured(tariff)) {
      Alert.alert('No tariff', 'Select a tariff before starting the meter.');
      return;
    }
    if (tariff.id !== selectedTariffRef.current.id) {
      setSelectedTariffState(tariff);
      storeData(STORAGE_KEYS.selectedTariffId, tariff.id).catch(() => undefined);
    }
    const m = createInitialMeter(tariff);
    setMeter(m);
    meterRef.current = m;
    storeData(STORAGE_KEYS.meterState, m).catch(() => undefined);
    startMeterWatch();
  };

  const stopMeterForJob = () => {
    if (meterStopRef.current) {
      meterStopRef.current();
      meterStopRef.current = null;
    }
    setMeter((prev) => {
      if (!prev) return null;
      const stopped = { ...prev, running: false, finishedAt: Date.now() };
      storeData(STORAGE_KEYS.meterState, stopped).catch(() => undefined);
      return stopped;
    });
  };

  const startMeterWatch = () => {
    if (meterStopRef.current) meterStopRef.current();
    void watchMeter(
      () => selectedTariffRef.current,
      () => meterRef.current,
      (result) => {
        setMeter(result.meter);
        meterRef.current = result.meter;
        storeData(STORAGE_KEYS.meterState, result.meter).catch(() => undefined);
        if (result.autoUnpaused) {
          Alert.alert('Meter unpaused', 'Car is moving — fare is accumulating again.');
        }
      },
    ).then((stop) => {
      meterStopRef.current = stop;
    });
  };

  const advanceStage = async () => {
    if (!activeJob || !driver || completionBusy) return;
    setCompletionBusy(true);
    setCompletionError(null);
    try {
      const order: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];
      const idx = order.indexOf(activeJob.stage);
      const nextStage = order[Math.min(idx + 1, order.length - 1)];

      if (nextStage === 'complete') {
        const now = Date.now();
        const stepTimes: JobStepTimes = { ...activeJob.stepTimes, completeAt: now };
        stopMeterForJob();
        let meterSnapshot = meterRef.current;
        if (meterSnapshot) {
          meterSnapshot = { ...meterSnapshot, running: false, finishedAt: now };
        }
        const updated: ActiveJob = {
          ...activeJob,
          stage: nextStage,
          stepTimes,
          meterSnapshot: meterSnapshot ?? activeJob.meterSnapshot,
          fare: meterSnapshot?.fare ?? activeJob.fare,
          distanceKm: meterSnapshot?.distanceKm ?? activeJob.distanceKm,
        };
        setActiveJob(updated);
        setPaymentJob(updated);
        persistActiveJobAsync(updated);
        const vehicleId = await resolveVehicleId();
        if (vehicleId && shiftActiveRef.current) {
          writeOnlinePresence(driver, vehicleId, 'Busy').catch(() => undefined);
        }
        return;
      }

      if (nextStage === 'arrived' || nextStage === 'onboard') {
        const offline = !dispatchIsConnected(
          networkConnectedRef.current,
          rtdbConnectedRef.current,
        );
        const numericJob = /^\d+$/.test(String(activeJob.id));
        if (offline && numericJob && !isProvisionalBookingId(activeJob.id)) {
          // Phase 5d — optimistic local stage; flush via /api/job/stage on reconnect.
          const vehicleId = (await resolveVehicleId()) || '';
          await ensureDispatchTripJournal({
            jobId: String(activeJob.id),
            companyId: driver.companyId,
            driverId: driver.id,
            vehicleId,
          });
          await appendTripJournalEvent(
            dispatchJournalKey(activeJob.id),
            nextStage === 'arrived' ? 'Arrived' : 'OnBoard',
            { updateSeq: activeJob.updateSeq ?? 0 },
          );
          await applySyncingBanner({ message: 'Syncing…', reason: 'stages', at: Date.now() });
        } else if (!offline) {
          await syncJobStageToDispatch(nextStage, { id: activeJob.id, updateSeq: activeJob.updateSeq });
        } else if (isProvisionalBookingId(activeJob.id)) {
          console.log('[Driver] skip offline stage journal for provisional hail', activeJob.id);
        }
      }

      const now = Date.now();
      const stepTimes: JobStepTimes = { ...activeJob.stepTimes };
      if (nextStage === 'arrived') stepTimes.arrivedAt = now;
      let onboardFixedFare: number | undefined;
      if (nextStage === 'onboard') {
        stepTimes.onboardAt = now;
        if (!shouldStartMeterForBooking(bookingRawRef.current, activeJob)) {
          onboardFixedFare = readFixedFareAmount(bookingRawRef.current, activeJob);
        } else {
          startMeterForJob();
        }
      }

      const updated: ActiveJob = {
        ...activeJob,
        stage: nextStage,
        stepTimes,
        meterSnapshot: activeJob.meterSnapshot,
        fare: onboardFixedFare ?? activeJob.fare,
        fixedFare: onboardFixedFare ?? activeJob.fixedFare,
        estimatedFare: onboardFixedFare ?? activeJob.estimatedFare,
        isFixedPrice: activeJob.isFixedPrice || !shouldStartMeterForBooking(bookingRawRef.current, activeJob),
        distanceKm: activeJob.distanceKm,
      };
      setActiveJob(updated);
      persistActiveJobAsync(updated);
    } catch (err) {
      console.error('[Driver] advanceStage failed:', err);
      const order: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];
      const idx = order.indexOf(activeJob.stage);
      const nextStage = order[Math.min(idx + 1, order.length - 1)];
      const expectedBookingStatus =
        nextStage === 'arrived' ? 'Arrived' : nextStage === 'onboard' ? 'Active' : '';

      if (
        driver.companyId &&
        expectedBookingStatus &&
        (err instanceof StageTransportError || err instanceof DispatchApiError)
      ) {
        const verified = await verifyJobStageOnFirebase(
          driver.companyId,
          activeJob.id,
          expectedBookingStatus,
          activeJob.updateSeq,
        );
        if (verified.verified) {
          const now = Date.now();
          const stepTimes: JobStepTimes = { ...activeJob.stepTimes };
          if (nextStage === 'arrived') stepTimes.arrivedAt = now;
          if (nextStage === 'onboard') {
            stepTimes.onboardAt = now;
            if (shouldStartMeterForBooking(bookingRawRef.current, activeJob)) {
              startMeterForJob();
            }
          }
          const recoveredFixedFare = !shouldStartMeterForBooking(bookingRawRef.current, activeJob)
            ? readFixedFareAmount(bookingRawRef.current, activeJob)
            : undefined;
          const recovered: ActiveJob = {
            ...activeJob,
            stage: nextStage,
            stepTimes,
            meterSnapshot: activeJob.meterSnapshot,
            fare: recoveredFixedFare ?? activeJob.fare,
            fixedFare: recoveredFixedFare ?? activeJob.fixedFare,
            estimatedFare: recoveredFixedFare ?? activeJob.estimatedFare,
            isFixedPrice: activeJob.isFixedPrice || !shouldStartMeterForBooking(bookingRawRef.current, activeJob),
            distanceKm: activeJob.distanceKm,
            ...(verified.updateSeq != null ? { updateSeq: verified.updateSeq } : {}),
          };
          setActiveJob(recovered);
          persistActiveJobAsync(recovered);
          return;
        }
      }

      const msg =
        err instanceof DispatchApiError
          ? `${err.message}${err.errorCode ? ` (${err.errorCode})` : ''}`
          : completionErrorMessage(err);
      setCompletionError(msg);
      Alert.alert('Could not update trip', `${msg}\n\nDispatch was not updated — try again when connected.`);
    } finally {
      setCompletionBusy(false);
    }
  };

  const setPaymentType = (payment: PaymentType) => {
    if (!activeJob) return;
    const updated = { ...activeJob, paymentType: payment };
    setActiveJob(updated);
    storeData(STORAGE_KEYS.activeJob, updated);
  };

  const completeJob = async () => {
    if (!activeJob || completionBusy) return;
    setCompletionBusy(true);
    setCompletionError(null);
    try {
      stopMeterForJob();
      const now = Date.now();
      const stepTimes = { ...activeJob.stepTimes, completeAt: now };
      const meterSnapshot = meterRef.current
        ? { ...meterRef.current, running: false, finishedAt: now }
        : activeJob.meterSnapshot;
      const closed: ActiveJob = {
        ...activeJob,
        stage: 'complete',
        stepTimes,
        meterSnapshot,
        fare: meterSnapshot?.fare ?? activeJob.fare,
      };
      setActiveJob(closed);
      setPaymentJob(closed);
      persistActiveJobAsync(closed);
    } catch (err) {
      console.error('[Driver] completeJob failed:', err);
      const msg = completionErrorMessage(err);
      setCompletionError(msg);
      Alert.alert('Could not open payment', msg);
    } finally {
      setCompletionBusy(false);
    }
  };

  const dismissPayment = () => {
    setPaymentJob(null);
    clearPaymentJobRef();
    setCompletionError(null);
  };

  const finalizePayment = async (
    paymentType: string,
    extras: PaymentExtras,
    totalFare: number,
    tmDetails?: TmPaymentDetails,
  ) => {
    const job = paymentJob ?? activeJob;
    if (!job || !driver?.companyId) {
      throw new Error('No active job to complete.');
    }

    const closed: ActiveJob = {
      ...job,
      stage: 'complete',
      fare: totalFare,
      paymentType: paymentType as PaymentType,
      meterSnapshot: job.meterSnapshot ?? meterRef.current ?? undefined,
      distanceKm: job.meterSnapshot?.distanceKm ?? job.distanceKm,
      durationMin: job.meterSnapshot?.startedAt
        ? Math.round(
            ((job.meterSnapshot.finishedAt ?? Date.now()) - job.meterSnapshot.startedAt) / 60000,
          )
        : job.durationMin,
    };

    const completedAt = Date.now();
    setCompletionError(null);
    localCompletionRef.current = true;
    setJobOffer(null);
    lastOfferSeenRef.current = null;

    const tripCompleteFields = closedJobFieldsForCompleteApi(closed);
    const completePayload = {
      jobId: job.id,
      bookingId: job.id,
      driverId: driver.id,
      companyId: driver.companyId,
      paymentType,
      fare: totalFare,
      totalFare,
      distanceKm: closed.distanceKm,
      distance: closed.distanceKm,
      extras,
      ...(tmDetails ?? {}),
      payload: {
        fare: totalFare,
        totalFare,
        distanceKm: closed.distanceKm,
        distance: closed.distanceKm,
        paymentType,
        extras,
        ...tripCompleteFields,
      },
    };

    const persistClosedJobToFirebase = () => {
      void (async () => {
        const vehicleId = (await resolveVehicleId()) || '';
        const pending = {
          companyId: driver.companyId,
          driverId: driver.id,
          driverName: driver.name,
          vehicleId,
          localJobId: String(job.id),
          clientTripId: job.clientTripId || resolveJournalClientTripId(job) || undefined,
          job: closed,
          paymentType,
          extras,
          totalFare,
          tmDetails,
          completedAt,
        };
        // Always stage full trip snapshot (addresses etc.) so reconnect can retry
        // when the one-shot Firebase write fails offline.
        try {
          await upsertPendingClosedJob(pending);
        } catch (err) {
          console.warn('[Driver] upsertPendingClosedJob failed:', err);
        }
        try {
          await writeClosedJob(
            driver.companyId,
            driver.id,
            closed,
            paymentType,
            extras,
            totalFare,
            tmDetails,
            { driverName: driver.name, vehicleId },
          );
          await removePendingClosedJob({
            localJobId: String(job.id),
            clientTripId: pending.clientTripId,
            serverJobId: String(closed.id),
          });
        } catch (err) {
          console.warn('[Driver] writeClosedJob failed (will retry on flush):', err);
        }
        if (job.id && !String(job.id).startsWith('hail_') && !isProvisionalBookingId(job.id)) {
          try {
            await markBookingCompleted(driver.companyId, job.id, {
              fare: totalFare,
              paymentType,
              driverId: driver.id,
              completedAt,
              distanceKm: closed.distanceKm,
              pickup: closed.pickup,
              dropoff: closed.dropoff,
              passengerName: closed.passengerName,
              passengerPhone: closed.passengerPhone,
            });
          } catch (err) {
            console.warn('[Driver] markBookingCompleted failed:', err);
          }
        }
      })();
    };

    try {
      let completeErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await completeJobPayment(completePayload);
          completeErr = null;
          break;
        } catch (err) {
          completeErr = err;
          const retryableTransport =
            err instanceof StageTransportError && attempt === 0;
          if (!retryableTransport) break;
          console.warn('[Driver] completeJobPayment transport retry after timeout');
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      if (completeErr) throw completeErr;
    } catch (err) {
      console.error('[Driver] completeJobPayment failed:', err);
      let completeFailed = true;
      if (err instanceof DispatchApiError && err.status === 409 && job.id && driver.id) {
        try {
          const catchUpStage = job.stage === 'complete' ? 'onboard' : job.stage;
          await catchUpJobStagesOnDispatch(job.id, driver.id, catchUpStage, job.updateSeq, {
            companyId: driver.companyId,
          });
          await completeJobPayment(completePayload);
          completeFailed = false;
        } catch (retryErr) {
          err = retryErr;
        }
      }
      if (completeFailed) {
        // Phase 5e — journal terminal complete for journalable trips (no offline queue).
        const journalKey = resolveJournalClientTripId(job);
        if (journalKey) {
          try {
            const vehicleId = (await resolveVehicleId()) || '';
            await ensureJournalForJob({
              jobId: String(job.id),
              clientTripId: job.clientTripId,
              companyId: driver.companyId,
              driverId: driver.id,
              vehicleId,
              source: job.source === 'hail' ? 'hail' : 'dispatch',
            });
            await appendTripJournalEvent(journalKey, 'Completed', {
              action: 'complete',
              jobId: job.id,
              bookingId: job.id,
              driverId: driver.id,
              companyId: driver.companyId,
              paymentType,
              fare: totalFare,
              totalFare,
              distanceKm: closed.distanceKm,
              distance: closed.distanceKm,
              extras,
              ...(tmDetails ?? {}),
              ...closedJobFieldsForJournal(closed),
            });
            await applySyncingBanner({ message: 'Syncing…', reason: 'complete', at: Date.now() });
            // Fall through to local clear (same as online success) — do not block payment UI.
            completeFailed = false;
          } catch (journalErr) {
            console.warn('[Driver] journal complete failed; falling back to offline queue', journalErr);
          }
        }
      }
      if (completeFailed) {
        await enqueueOfflineItem({
          type: 'job_update',
          payload: {
            action: 'complete',
            jobId: job.id,
            bookingId: job.id,
            driverId: driver.id,
            companyId: driver.companyId,
            paymentType,
            fare: totalFare,
            totalFare,
            distanceKm: closed.distanceKm,
            distance: closed.distanceKm,
            extras,
            // Preserve payment-specific fields for flush → /api/job/complete
            // (TM / ACC / Stripe / Account / Cash — opaque to the sync layer).
            ...(tmDetails ?? {}),
            ...closedJobFieldsForJournal(closed),
          },
        });
        const msg =
          `Dispatch server did not confirm completion (${completionErrorMessage(err)}). ` +
          'Job saved locally — tap Retry when back online.';
        setCompletionError(msg);
        localCompletionRef.current = false;
        throw new Error(msg);
      }
    }

    persistClosedJobToFirebase();

    void playInAppNotificationSound('general');

    const done: CompletedJob = { ...closed, completedAt };
    setCompletedJobs((prev) => [done, ...prev]);
    setActiveJob(null);
    setPaymentJob(null);
    clearPaymentJobRef();
    setPreferredPanelTab('current');
    setHailActive(false);
    hailActiveRef.current = false;
    setHailPickupAddress(null);
    setHailPickupLat(undefined);
    setHailPickupLng(undefined);
    setMeter(null);
    meterRef.current = null;
    activeJobIdRef.current = null;
    bookingRawRef.current = null;
    localCompletionRef.current = false;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
    refreshJobHistory().catch(() => undefined);

    if (driver && shiftActive) {
      await syncPresenceAfterTripClear();
    }
    releaseQueuedOffersAfterTrip();
  };

  const clearJobLocallyAfterTerminal = async () => {
    const wasHail = isHailTripJob(activeJobRef.current, hailActiveRef.current);
    stopMeterForJob();
    setMeter(null);
    meterRef.current = null;
    setActiveJob(null);
    setPaymentJob(null);
    clearPaymentJobRef();
    activeJobIdRef.current = null;
    bookingRawRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
    if (wasHail) {
      clearHailTripState();
    }
    if (shiftActive) {
      await syncPresenceAfterTripClear();
    }
    releaseQueuedOffersAfterTrip();
  };

  const cancelActiveJobInternal = async () => {
    if (!activeJob || !driver) return;
    try {
      await cancelJobAsDriver(activeJob.id, driver.id, driver.companyId);
    } catch {
      // Phase 5e — journal Cancelled for journalable trips; keep queue only as fallback.
      const journalKey = resolveJournalClientTripId(activeJob);
      let journalled = false;
      if (journalKey) {
        try {
          const vehicleId = (await resolveVehicleId()) || '';
          await ensureJournalForJob({
            jobId: String(activeJob.id),
            clientTripId: activeJob.clientTripId,
            companyId: driver.companyId,
            driverId: driver.id,
            vehicleId,
            source: activeJob.source === 'hail' ? 'hail' : 'dispatch',
          });
          await appendTripJournalEvent(journalKey, 'Cancelled', {
            driverId: driver.id,
            companyId: driver.companyId,
          });
          journalled = true;
        } catch (journalErr) {
          console.warn('[Driver] journal cancel failed; falling back to offline queue', journalErr);
        }
      }
      if (!journalled) {
        await enqueueOfflineItem({
          type: 'job_update',
          payload: {
            action: 'cancel',
            jobId: activeJob.id,
            driverId: driver.id,
            companyId: driver.companyId,
          },
        });
      }
      await applySyncingBanner({ message: 'Syncing cancel…', reason: 'cancel', at: Date.now() });
    }
    await clearJobLocallyAfterTerminal();
  };

  const cancelActiveJob = async () => {
    if (!activeJob || !driver) return;
    await cancelActiveJobInternal();
    Alert.alert('Job cancelled', 'Job closed. You are available for new jobs.');
  };

  const noShowActiveJob = async () => {
    if (!activeJob || !driver) return;
    const jobId = activeJob.id;
    const driverId = driver.id;
    const companyId = driver.companyId;
    console.log('[no-show] POST /api/cancel starting', { jobId, driverId, companyId });
    try {
      await reportNoShow(jobId, driverId, companyId);
      console.log('[no-show] POST /api/cancel OK', { jobId });
    } catch (err) {
      const status = err instanceof DispatchApiError ? err.status : null;
      const errorCode = err instanceof DispatchApiError ? err.errorCode : null;
      const message = err instanceof Error ? err.message : String(err);
      const body = err instanceof DispatchApiError ? err.body : undefined;
      console.error('[no-show] POST /api/cancel FAILED', {
        jobId,
        driverId,
        companyId,
        status,
        errorCode,
        message,
        body,
        errName: err instanceof Error ? err.name : typeof err,
        isNetwork:
          err instanceof TypeError ||
          (err instanceof Error && err.message.toLowerCase().includes('network')),
      });
      // Phase 5e — journal NoShow for journalable trips; keep queue only as fallback.
      const journalKey = resolveJournalClientTripId(activeJob);
      let journalled = false;
      if (journalKey) {
        try {
          const vehicleId = (await resolveVehicleId()) || '';
          await ensureJournalForJob({
            jobId: String(jobId),
            clientTripId: activeJob.clientTripId,
            companyId,
            driverId,
            vehicleId,
            source: activeJob.source === 'hail' ? 'hail' : 'dispatch',
          });
          await appendTripJournalEvent(journalKey, 'NoShow', {
            driverId,
            companyId,
          });
          journalled = true;
        } catch (journalErr) {
          console.warn('[Driver] journal no-show failed; falling back to offline queue', journalErr);
        }
      }
      if (!journalled) {
        await enqueueOfflineItem({
          type: 'job_update',
          payload: {
            action: 'no_show',
            jobId,
            driverId,
            companyId,
          },
        });
      }
      await applySyncingBanner({ message: 'Syncing no-show…', reason: 'no_show', at: Date.now() });
      console.warn('[no-show] queued offline terminal (journal or queue) — flush via /api/cancel', {
        jobId,
        journalled,
      });
    }
    await clearJobLocallyAfterTerminal();
    Alert.alert('No show', 'Job marked as no show. You are available for new jobs.');
  };

  const recallJob = async () => {
    if (!driver) return;
    const job = activeJob;
    if (!job) {
      const q = queuedOffers[0];
      if (!q) return;
      try {
        await recallJobOnDispatch(q.id, driver.id, q.originalStatus ?? 'pending');
      } catch (err) {
        Alert.alert('Recall failed', err instanceof Error ? err.message : 'Could not recall job');
        return;
      }
      setQueuedOffers((prev) => prev.filter((o) => o.id !== q.id));
      Alert.alert('Job recalled', 'Job returned to dispatch.');
      return;
    }

    const arrived =
      job.stage === 'arrived' ||
      job.stage === 'onboard' ||
      job.stage === 'complete' ||
      !!job.stepTimes?.arrivedAt;
    if (arrived) {
      Alert.alert('Cannot recall', 'Recall is only available before arriving at pickup.');
      return;
    }

    try {
      await recallJobOnDispatch(job.id, driver.id, job.originalStatus ?? 'pending');
    } catch (err) {
      Alert.alert('Recall failed', err instanceof Error ? err.message : 'Could not recall job');
      return;
    }

    stopMeterForJob();
    setMeter(null);
    meterRef.current = null;
    setActiveJob(null);
    activeJobIdRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);

    const vehicleId = await resolveVehicleId();
    if (vehicleId && shiftActive) {
      writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
      setPresenceStatus('Online');
      setReadyForJobs(true);
      readyForJobsRef.current = true;
    }
    Alert.alert('Job recalled', 'Job returned to dispatch.');
  };

  const recallQueuedOffer = async (offerId: string) => {
    if (!driver) return;
    const q = queuedOffers.find((o) => o.id === offerId);
    if (!q) return;
    try {
      await recallJobOnDispatch(q.id, driver.id, q.originalStatus ?? 'pending');
    } catch (err) {
      Alert.alert('Recall failed', err instanceof Error ? err.message : 'Could not recall job');
      return;
    }
    setQueuedOffers((prev) => prev.filter((o) => o.id !== offerId));
    Alert.alert('Job recalled', 'Job returned to dispatch.');
  };

  const stopMeterTimers = () => {
    if (meterStopRef.current) {
      meterStopRef.current();
      meterStopRef.current = null;
    }
  };

  const clearOrphanedIdleMeter = async () => {
    if (activeJobRef.current || hailActiveRef.current) return;
    if (!meterRef.current?.running) {
      if (meterRef.current) {
        setMeter(null);
        meterRef.current = null;
        await storeData(STORAGE_KEYS.meterState, null);
      }
      return;
    }
    stopMeterTimers();
    setMeter(null);
    meterRef.current = null;
    await storeData(STORAGE_KEYS.meterState, null);
  };

  useSafeEffect(() => {
    if (activeJob || hailActive) return;
    if (!meter?.running) return;
    void clearOrphanedIdleMeter();
  }, [activeJob, hailActive, meter?.running], 'Driver-clearOrphanedIdleMeter');

  const buildMeterSnapshot = (): MeterState | null => {
    const raw = meterRef.current;
    if (!raw) return null;
    const now = Date.now();
    const waitMin = raw.waitingMs / 60000;
    const breakdown = calcMeterBreakdown(selectedTariff, raw.distanceKm, waitMin);
    return {
      ...raw,
      running: false,
      finishedAt: now,
      breakdown,
      fare: breakdown.total,
    };
  };

  const startHail = async () => {
    if (!shiftActive) {
      Alert.alert('Start shift', 'Start your shift before hailing a passenger.');
      return;
    }
    if (!isTariffConfigured(selectedTariff)) {
      Alert.alert('No tariff configured', 'Ask dispatch to set up tariffs for your company in Firebase.');
      return;
    }
    if (!driver?.companyId) {
      Alert.alert('Not signed in', 'Sign in again before starting a hail trip.');
      return;
    }

    setHailPickupAddress('Locating…');
    setHailActive(true);
    hailActiveRef.current = true;

    let pickup = { address: 'Current location', lat: 0, lng: 0 };
    await new Promise<void>((resolve) => {
      void refreshHailPickupLocation((p) => {
        pickup = p;
        setHailPickupAddress(p.address);
        if (p.lat != null) setHailPickupLat(p.lat);
        if (p.lng != null) setHailPickupLng(p.lng);
        resolve();
      });
    });

    try {
      const vehicleId = await resolveVehicleId();
      if (!vehicleId) {
        throw new Error('No vehicle assigned — select a vehicle before hailing.');
      }

      // Phase 5b — one clientTripId for this hail attempt (retries reuse it).
      let clientTripId =
        (await getData<string>(STORAGE_KEYS.pendingHailClientTripId))?.trim() || '';
      if (!clientTripId) {
        clientTripId = newClientTripId();
        await storeData(STORAGE_KEYS.pendingHailClientTripId, clientTripId);
      }

      const offline = !dispatchIsConnected(
        networkConnectedRef.current,
        rtdbConnectedRef.current,
      );
      const now = Date.now();
      const pickupSnapshot = {
        address: pickup.address,
        lat: pickup.lat,
        lng: pickup.lng,
      };

      let jobId: string;
      let updateSeq: number | undefined;

      if (offline) {
        // Phase 5c — optimistic hail; flush create-or-get on reconnect.
        await createPendingHailJournal({
          clientTripId,
          companyId: driver.companyId,
          driverId: driver.id,
          vehicleId,
          hailCreate: {
            tariffId: selectedTariff.id,
            pickup: pickupSnapshot,
            startedAt: now,
          },
        });
        await storeData(STORAGE_KEYS.pendingHailClientTripId, null);
        await applySyncingBanner({ message: 'Syncing…', reason: 'hail', at: Date.now() });
        jobId = localJobIdFromClientTripId(clientTripId);
        updateSeq = undefined;
      } else {
        const created = await createHailJobOnDispatch({
          companyId: driver.companyId,
          driverId: driver.id,
          vehicleId,
          tariffId: selectedTariff.id,
          pickup: pickupSnapshot,
          clientTripId,
        });
        await storeData(STORAGE_KEYS.pendingHailClientTripId, null);
        jobId = created.jobId;
        updateSeq = created.updateSeq;
      }

      const hailJob: ActiveJob = {
        id: jobId,
        type: 'Taxi',
        pickup: pickup.address,
        dropoff: '',
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        stage: 'onboard',
        startedAt: now,
        distanceKm: 0,
        durationMin: 0,
        fare: 0,
        stepTimes: { hailStartedAt: now, onboardAt: now },
        tariffChanges: [],
        source: 'hail',
        createdBy: 'driver',
        pickupType: 'ASAP',
        bookedAtMs: now,
        expiresAt: now + 86400000,
        updateSeq,
        clientTripId,
      };

      setHailActive(true);
      hailActiveRef.current = true;
      setActiveJob(hailJob);
      activeJobIdRef.current = jobId;
      activeJobRef.current = hailJob;
      persistActiveJobAsync(hailJob);

      const m = createInitialMeter(selectedTariff);
      setMeter(m);
      meterRef.current = m;
      storeData(STORAGE_KEYS.meterState, m).catch(() => undefined);
      startMeterWatch();

      if (!offline) {
        writeOnlinePresence(driver, vehicleId, 'Busy').catch(() => undefined);
        void patchOnlineCurrentJobId(driver.companyId, vehicleId, jobId).catch((err) => {
          console.warn('[Driver] patchOnlineCurrentJobId after hail start failed:', err);
        });
      }
    } catch (err) {
      setHailPickupAddress(null);
      setHailPickupLat(undefined);
      setHailPickupLng(undefined);
      setHailActive(false);
      hailActiveRef.current = false;
      setActiveJob(null);
      activeJobIdRef.current = null;
      activeJobRef.current = null;
      const msg = err instanceof Error ? err.message : 'Could not register hail trip with dispatch.';
      Alert.alert('Could not start hail', msg);
    }
  };

  const endHail = async () => {
    if (!hailActiveRef.current && !hailActive) return;

    const snapshot = buildMeterSnapshot();
    const now = Date.now();
    const liveJob = activeJobRef.current;
    const bookingId = liveJob?.id && /^\d+$/.test(String(liveJob.id)) ? liveJob.id : null;

    if (meterStopRef.current) {
      meterStopRef.current();
      meterStopRef.current = null;
    }

    const hailJob: ActiveJob = liveJob
      ? {
          ...liveJob,
          stage: 'complete',
          pickup: hailPickupAddress || liveJob.pickup,
          dropoff: hailPickupAddress || liveJob.dropoff,
          pickupLat: hailPickupLat ?? liveJob.pickupLat,
          pickupLng: hailPickupLng ?? liveJob.pickupLng,
          startedAt: snapshot?.startedAt ?? liveJob.startedAt,
          distanceKm: snapshot?.distanceKm ?? liveJob.distanceKm,
          durationMin: snapshot?.startedAt
            ? Math.round((now - snapshot.startedAt) / 60000)
            : liveJob.durationMin,
          fare: snapshot?.fare ?? liveJob.fare,
          stepTimes: {
            ...liveJob.stepTimes,
            hailStartedAt: liveJob.stepTimes.hailStartedAt ?? snapshot?.startedAt ?? now,
            hailEndedAt: now,
            completeAt: now,
          },
          tariffChanges: snapshot?.tariffChanges ?? liveJob.tariffChanges,
          meterSnapshot: snapshot,
          expiresAt: now,
        }
      : {
          id: `hail_${snapshot?.startedAt ?? now}`,
          type: 'Taxi',
          pickup: hailPickupAddress || 'Street hail',
          dropoff: hailPickupAddress || 'Street hail',
          pickupLat: hailPickupLat,
          pickupLng: hailPickupLng,
          stage: 'complete',
          startedAt: snapshot?.startedAt ?? now,
          distanceKm: snapshot?.distanceKm ?? 0,
          durationMin: snapshot?.startedAt
            ? Math.round((now - snapshot.startedAt) / 60000)
            : 0,
          fare: snapshot?.fare ?? 0,
          stepTimes: {
            hailStartedAt: snapshot?.startedAt ?? now,
            hailEndedAt: now,
            completeAt: now,
          },
          tariffChanges: snapshot?.tariffChanges ?? [],
          meterSnapshot: snapshot,
          source: 'hail',
          expiresAt: now,
        };

    if (!bookingId) {
      console.warn('[Driver] endHail without dispatch booking ID — payment will stay local only');
    }

    setPaymentJob(hailJob);
    setJobOffer(null);
    lastOfferSeenRef.current = null;
    setActiveJob(null);
    activeJobIdRef.current = null;
    activeJobRef.current = null;
    setHailActive(false);
    hailActiveRef.current = false;
    setMeter(null);
    meterRef.current = null;
    await storeData(STORAGE_KEYS.meterState, null);
    await storeData(STORAGE_KEYS.activeJob, null);
  };

  const endTrip = async () => {
    if (completionBusy) return;
    if (hailActiveRef.current || hailActive) {
      await endHail();
      return;
    }
    if (!meterRef.current?.running && !activeJob) return;

    setCompletionBusy(true);
    setCompletionError(null);
    try {
      const snapshot = buildMeterSnapshot();
      const now = Date.now();

      if (meterStopRef.current) {
        meterStopRef.current();
        meterStopRef.current = null;
      }

      if (activeJob) {
        const stepTimes: JobStepTimes = { ...activeJob.stepTimes, completeAt: now };
        const updated: ActiveJob = {
          ...activeJob,
          stage: 'complete',
          stepTimes,
          meterSnapshot: snapshot ?? activeJob.meterSnapshot,
          fare: snapshot?.fare ?? activeJob.fare,
          distanceKm: snapshot?.distanceKm ?? activeJob.distanceKm,
          durationMin: snapshot?.startedAt
            ? Math.round((now - snapshot.startedAt) / 60000)
            : activeJob.durationMin,
        };
        setActiveJob(updated);
        setPaymentJob(updated);
        setJobOffer(null);
        lastOfferSeenRef.current = null;
        setMeter(null);
        meterRef.current = null;
        persistActiveJobAsync(updated);
        if (snapshot) persistMeterAsync(snapshot);
      }
    } catch (err) {
      console.error('[Driver] endTrip failed:', err);
      const msg = completionErrorMessage(err);
      setCompletionError(msg);
      Alert.alert('Could not end trip', msg);
    } finally {
      setCompletionBusy(false);
    }
  };

  const pauseMeter = () => {
    setMeter((prev) => {
      if (!prev) return prev;
      const pausing = !prev.paused;
      const next: MeterState = {
        ...prev,
        paused: pausing,
        pauseAccumulatedAt: Date.now(),
        pauseAnchorLat: pausing ? prev.lastLat : undefined,
        pauseAnchorLng: pausing ? prev.lastLng : undefined,
      };
      meterRef.current = next;
      storeData(STORAGE_KEYS.meterState, next).catch(() => undefined);
      return next;
    });
  };

  const toggleWaitMeter = () => {
    Alert.alert('Automatic meter', 'Waiting and moving rates switch automatically from GPS speed.');
  };

  const setSelectedTariff = (t: Tariff) => {
    if (paymentJobRef.current) {
      Alert.alert('Tariff locked', 'Tariff cannot be changed during payment.');
      return;
    }
    if (isForbiddenPlaceholderTariffName(t.name)) return;
    const prevId = selectedTariff.id;
    setSelectedTariffState(t);
    storeData(STORAGE_KEYS.selectedTariffId, t.id).catch(() => undefined);

    if (meterRef.current?.running && prevId !== t.id) {
      const change: TariffChangeRecord = { tariffId: t.id, tariffName: t.name, at: Date.now() };
      setMeter((prev) => {
        if (!prev) return prev;
        const waitMin = prev.waitingMs / 60000;
        const breakdown = calcMeterBreakdown(t, prev.distanceKm, waitMin);
        const next = {
          ...prev,
          tariffId: t.id,
          tariffName: t.name,
          tariffChanges: [...prev.tariffChanges, change],
          breakdown,
          fare: breakdown.total,
        };
        meterRef.current = next;
        return next;
      });
      if (activeJob) {
        const changes = [...(activeJob.tariffChanges ?? []), change];
        const updated = { ...activeJob, tariffChanges: changes };
        setActiveJob(updated);
        storeData(STORAGE_KEYS.activeJob, updated).catch(() => undefined);
      }
      startMeterWatch();
    }
  };

  useSafeEffect(() => {
    const t = selectedTariff;
    const prev = prevTariffRatesRef.current;
    const sameId = prev.id === t.id && t.id !== NO_TARIFF_CONFIGURED.id;
    const ratesChanged =
      sameId &&
      (prev.flagFall !== t.flagFall || prev.ratePerKm !== t.ratePerKm || prev.waitingPerMin !== t.waitingPerMin);
    prevTariffRatesRef.current = {
      id: t.id,
      flagFall: t.flagFall,
      ratePerKm: t.ratePerKm,
      waitingPerMin: t.waitingPerMin,
    };
    if (!ratesChanged || !meterRef.current?.running) return;
    setMeter((m) => {
      if (!m?.running) return m;
      const waitMin = m.waitingMs / 60000;
      const breakdown = calcMeterBreakdown(t, m.distanceKm, waitMin);
      const next = {
        ...m,
        tariffId: t.id,
        tariffName: t.name,
        breakdown,
        fare: breakdown.total,
      };
      meterRef.current = next;
      storeData(STORAGE_KEYS.meterState, next).catch(() => undefined);
      return next;
    });
    startMeterWatch();
  }, [selectedTariff.id, selectedTariff.flagFall, selectedTariff.ratePerKm, selectedTariff.waitingPerMin], 'Driver-tariffMeterRefresh');

  useSafeEffect(() => {
    selectedTariffRef.current = selectedTariff;
  }, [selectedTariff], 'Driver-selectedTariffRef');

  useSafeEffect(() => {
    if (activeJob?.stage !== 'pickup') {
      setNearPickup(false);
    }
  }, [activeJob?.stage], 'Driver-clearNearPickupAfterPickup');

  const dismissJobEditNotice = () => setJobEditNotice(null);

  const isAvailableForDisplay =
    presenceStatus === 'Online' && shiftActive && readyForJobs && !paymentJob;
  const isAwayForDisplay = presenceStatus === 'Away' && shiftActive;

  const tripDisplayPhase = useMemo(
    () =>
      resolveTripDisplayPhase({
        shiftActive,
        hasOfferPopup: !!jobOffer && !activeJob && !paymentJob && !hailActive,
        hailActive,
        meterRunning: !!meter?.running,
        activeStage: activeJob?.stage,
        paymentOpen: !!paymentJob,
        tripOnTheWay,
        isAway: isAwayForDisplay,
        isAvailable: isAvailableForDisplay,
      }),
    [
      shiftActive,
      jobOffer,
      activeJob,
      paymentJob,
      hailActive,
      meter?.running,
      tripOnTheWay,
      isAwayForDisplay,
      isAvailableForDisplay,
    ],
  );

  const { label: tripDisplayLabel, color: tripDisplayColor } = useMemo(
    () => tripDisplayStyle(tripDisplayPhase),
    [tripDisplayPhase],
  );

  return (
    <DriverContext.Provider
      value={{
        presenceStatus,
        readyForJobs,
        shiftActive,
        selectedVehicleId,
        vehicles,
        vehiclesLoading,
        zone,
        companyZones,
        jobOffer,
        paymentJob,
        nextQueuedOffer,
        activeJob,
        hailActive,
        hailPickupAddress,
        meter,
        tariffs,
        selectedTariff,
        queuedOffers,
        broadcastOffers,
        visibleOffers,
        pendingOffers: visibleOffers,
        offersLockedForEnrouteDispatch,
        offersBadgeCount,
        preferredPanelTab,
        clearPreferredPanelTab: () => setPreferredPanelTab(null),
        activeVehicle,
        jobEditNotice,
        completedJobs,
        jobHistory,
        jobHistoryLoading,
        sessionEarnings,
        historyEarnings,
        company,
        activeVehicleBodyType,
        isOffline,
        connectionNotice,
        syncingBanner,
        setSelectedVehicleId,
        refreshVehicles,
        refreshJobHistory,
        startShift,
        endShift,
        endShiftAndSignOut,
        endShiftInProgress,
        endShiftSummary,
        acknowledgeEndShiftSummary,
        togglePresence,
        tariffLocked,
        acceptOffer,
        declineOffer,
        advanceStage,
        setPaymentType,
        completeJob,
        finalizePayment,
        dismissPayment,
        completionBusy,
        completionError,
        clearCompletionError: () => setCompletionError(null),
        cancelActiveJob,
        noShowActiveJob,
        recallJob,
        recallQueuedOffer,
        startHail,
        endHail,
        clearOrphanedIdleMeter,
        endTrip,
        pauseMeter,
        toggleWaitMeter,
        setSelectedTariff,
        dismissJobEditNotice,
        pickOfferFromList,
        canReceiveJobOffers,
        goAway,
        goAvailable,
        hasTripInProgress: hailActive || !!activeJob,
        tripDisplayPhase,
        tripDisplayLabel,
        tripDisplayColor,
        nearPickup,
        tripOnTheWay,
        inAppBanner,
        dismissInAppBanner: () => setInAppBanner(null),
        incomingSosAlert,
        incomingSosResolved,
        incomingSosResolvedMessage,
        sosResponding,
        incomingSosResponseCommitted,
        openIncomingSosMap,
        handleSosNotificationOpen,
        respondToIncomingSos,
        withdrawIncomingSosResponse,
        markIncomingSosArrived,
        exitIncomingSosAlertScreen,
        clearIncomingSosAlert,
        dismissIncomingSosAlert,
        chatUnreadCount,
        markChatViewed,
        markChatTabBlurred,
      }}
    >
      {children}
    </DriverContext.Provider>
  );
}

export function useDriver() {
  const ctx = useContext(DriverContext);
  if (!ctx) throw new Error('useDriver must be used within DriverProvider');
  return ctx;
}
