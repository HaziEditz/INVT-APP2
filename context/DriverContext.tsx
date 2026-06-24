import React, { createContext, useContext, useMemo, useRef, useState, ReactNode } from 'react';
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
import { acceptJobOffer, cancelJobAsDriver, completeJobPayment, createHailJobOnDispatch, declineJobOffer, DispatchApiError, isDispatchAcceptRetryable, promoteQueuedJob, pruneDriverQueueOnDispatch, recallJobOnDispatch, reportNoShow, StageTransportError, syncJobStageOnDispatch } from '@/lib/dispatchApi';
import {
  catchUpJobStagesOnDispatch,
  isTerminalBookingStatus,
  localStageFromServerStatus,
  resolveServerBookingState,
  serverStatusIndex,
} from '@/lib/jobServerSync';
import { isValidBookingId, normalizeBookingId } from '@/lib/bookingId';
import {
  clearChatNotification,
  clearDriverNotification,
  clearSosNotification,
  jobIdsMatch,
  readNotificationJobId,
  readNotificationType,
} from '@/lib/driverNotifications';
import { playInAppNotificationSound, alertDriverToOffer } from '@/lib/notificationSound';
import { subscribeDriverQueue, filterLiveDriverQueueOffers } from '@/lib/driverQueue';
import { subscribePendingJobs } from '@/lib/pendingJobs';
import { enqueueOfflineItem, flushOfflineQueue, subscribeConnectivity } from '@/services/offlineService';
import { tickWorkedMinutes } from '@/services/nztaService';
import {
  clearOnlinePresence,
  isVehicleStatusAvailable,
  markPresenceSessionEnded,
  moveDriverToEndOfQueue,
  repairOnlinePresence,
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
import { markBookingCompleted } from '@/lib/allbookings';
import { writeClosedJob } from '@/lib/closedJobs';
import { CompanyZone, findZoneAtCoords, subscribeCompanyZones } from '@/lib/companyZones';
import { getCurrentCoords, refreshHailPickupLocation } from '@/services/locationService';
import * as Location from 'expo-location';
import {
  diffBookingChanges,
  isReturnedToDispatchPool,
  parseBookingNode,
  stageAllowsMeter,
  subscribeBooking,
  verifyJobStageOnFirebase,
} from '@/lib/bookingSync';
import { initializeNztaOnLogin } from '@/services/nztaService';
import type { EndShiftSummary } from '@/services/nztaService';
import { createInitialMeter, watchMeter } from '@/services/meterEngine';
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
  | { kind: 'sos'; message: string };

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
    fixedFare:
      val.fixedFare != null
        ? parseFiniteFare(val.fixedFare)
        : parseFiniteFare(rawFare),
    estimatedFare:
      val.estimatedFare != null
        ? parseFiniteFare(val.estimatedFare)
        : parseFiniteFare(rawFare),
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
    dispatcherName: val.dispatcherName ? String(val.dispatcherName) : undefined,
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

function patchJobOfferFromNotification(offer: JobOffer, val: Record<string, unknown>): JobOffer {
  const patch: Partial<JobOffer> = { ...parseSchedulingMetaFromRecord(val) };
  if (val.pickup || val.jobpickup) patch.pickup = String(val.pickup ?? val.jobpickup);
  if (val.dropoff || val.jobdropoff) patch.dropoff = String(val.dropoff ?? val.jobdropoff);
  if (val.notes || val.jobinfo) patch.notes = String(val.notes ?? val.jobinfo);
  if (val.jobname) patch.passengerName = String(val.jobname);
  if (val.JobphoneNo || val.PhoneNo || val.passengerPhone) {
    patch.passengerPhone = String(val.JobphoneNo ?? val.PhoneNo ?? val.passengerPhone);
  }
  return { ...offer, ...patch };
}

function patchActiveJobFromNotification(job: ActiveJob, val: Record<string, unknown>): ActiveJob {
  const patch: Partial<ActiveJob> = { ...parseSchedulingMetaFromRecord(val) };
  if (val.pickup || val.jobpickup) patch.pickup = String(val.pickup ?? val.jobpickup);
  if (val.dropoff || val.jobdropoff) patch.dropoff = String(val.dropoff ?? val.jobdropoff);
  if (val.notes || val.jobinfo) patch.notes = String(val.notes ?? val.jobinfo);
  if (val.jobname) patch.passengerName = String(val.jobname);
  if (val.JobphoneNo || val.PhoneNo || val.passengerPhone) {
    patch.passengerPhone = String(val.JobphoneNo ?? val.PhoneNo ?? val.passengerPhone);
  }
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
  const [hailActive, setHailActive] = useState(false);
  const [hailPickupAddress, setHailPickupAddress] = useState<string | null>(null);
  const [hailPickupLat, setHailPickupLat] = useState<number | undefined>();
  const [hailPickupLng, setHailPickupLng] = useState<number | undefined>();
  const [meter, setMeter] = useState<MeterState | null>(null);
  const [tariffs, setTariffsState] = useState<Tariff[]>([]);
  const [selectedTariff, setSelectedTariffState] = useState<Tariff>(NO_TARIFF_CONFIGURED);
  const [inAppBanner, setInAppBanner] = useState<DriverInAppBannerState | null>(null);
  const [queuedOffers, setQueuedOffers] = useState<QueuedOffer[]>([]);
  const [broadcastOffers, setBroadcastOffers] = useState<JobOffer[]>([]);
  const [poolOffers, setPoolOffers] = useState<JobOffer[]>([]);
  const [preferredPanelTab, setPreferredPanelTab] = useState<MainPanelTab | null>(null);
  const broadcastOffersRef = useRef<Map<string, JobOffer>>(new Map());
  const queuedOffersRef = useRef<QueuedOffer[]>([]);
  const awayIntentRef = useRef<AwayIntent>('none');
  const [jobEditNotice, setJobEditNotice] = useState<string | null>(null);
  const [endShiftInProgress, setEndShiftInProgress] = useState(false);
  const [endShiftSummary, setEndShiftSummary] = useState<EndShiftSummary | null>(null);
  const shiftActiveRef = useRef(false);
  const endShiftInProgressRef = useRef(false);
  const endShiftSummaryAckRef = useRef<(() => void) | null>(null);
  const readyForJobsRef = useRef(false);
  const hailActiveRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);
  const activeJobRef = useRef<ActiveJob | null>(null);
  const presenceWriteStatusRef = useRef<FirebaseDriverStatus>('Available');
  const lastStagePresenceWriteRef = useRef<{ status: FirebaseDriverStatus; at: number } | null>(null);
  const prevQueuedOfferIdsRef = useRef<Set<string>>(new Set());
  const repairPresenceRef = useRef<((reason?: string) => Promise<void>) | null>(null);
  const refreshActiveJobRef = useRef<((reason?: string) => Promise<void>) | null>(null);
  const lastOfferSeenRef = useRef<{ id: string; at: number } | null>(null);
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
    paymentJobRef.current = paymentJob;
  }, [paymentJob], 'Driver-paymentRef');

  const clearPaymentJobRef = () => {
    paymentJobRef.current = null;
  };

  useSafeEffect(() => {
    meterRef.current = meter;
  }, [meter], 'Driver-meterRef');

  useSafeEffect(() => {
    if (!driver?.companyId || !driver.uid) return;
    initializeNztaOnLogin(driver.companyId, driver.uid).catch((err) =>
      console.error('[Driver] initializeNztaOnLogin', err),
    );
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
        // Do not restore shift as "online" on launch — driver must confirm vehicle each session.
        await storeData(STORAGE_KEYS.shiftActive, false);
        if (j && isValidBookingId(j.id)) {
          // Mid-job reload: force vehicle re-confirm + startShift so dispatch API sync runs.
          await storeData(STORAGE_KEYS.vehicleSessionReady, false);
        }
        const m = await getData<MeterState>(STORAGE_KEYS.meterState);
        if (m?.running && m.mode && m.breakdown) {
          setMeter(m);
          meterRef.current = m;
          setHailActive(true);
        }
      } catch (err) {
        console.error('[Driver] hydrate storage failed:', err);
      }
    })();
  }, [], 'Driver-hydrate');

  useSafeEffect(() => {
    try {
      const unsub = subscribeConnectivity(async (connected) => {
        try {
          setIsOffline(!connected);
          if (connected) {
            await flushOfflineQueue();
            if (activeJobRef.current?.id) {
              void refreshActiveJobRef.current?.('netinfo-reconnect');
            }
            if (shiftActiveRef.current) {
              void repairPresenceRef.current?.('netinfo-reconnect');
            }
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

      if (!tariffInitialPickDoneRef.current) {
        tariffInitialPickDoneRef.current = true;
        void (async () => {
          const savedId = await getData<string>(STORAGE_KEYS.selectedTariffId);
          const latest = tariffsListRef.current;
          if (latest.length === 0) return;
          const match = savedId ? latest.find((t) => t.id === savedId) : null;
          setSelectedTariffState(match ?? latest[0]);
        })();
        return;
      }

      setSelectedTariffState((prev) => {
        if (prev.id === NO_TARIFF_CONFIGURED.id) return list[0];
        const refreshed = list.find((t) => t.id === prev.id);
        return refreshed ?? list[0];
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

  useSafeEffect(() => {
    if (!shiftActive) return;
    const id = setInterval(() => {
      tickWorkedMinutes(1).catch((err) => console.error('[Driver] tickWorkedMinutes', err));
    }, 60000);
    return () => clearInterval(id);
  }, [shiftActive], 'Driver-nztaTick');

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
        setPoolOffers(offers);
      });
    } catch (err) {
      console.error('[Driver] pendingjobs subscribe failed', err);
    }
  }, [canBrowsePoolOffers, driver?.companyId, activeVehicle?.id], 'Driver-pendingPool');

  const visibleOffers = useMemo(() => {
    if (offersLockedForEnrouteDispatch) return [];
    const map = new Map<string, JobOffer>();
    for (const o of poolOffers) {
      map.set(o.id, { ...o, silent: true });
    }
    for (const o of broadcastOffers) {
      map.set(o.id, o);
    }
    return Array.from(map.values());
  }, [poolOffers, broadcastOffers, offersLockedForEnrouteDispatch]);

  const upsertBroadcastOffer = (offer: JobOffer) => {
    broadcastOffersRef.current.set(offer.id, offer);
    setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
  };

  const removeBroadcastOffer = (offerId: string) => {
    broadcastOffersRef.current.delete(offerId);
    setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
    setPoolOffers((prev) => prev.filter((o) => o.id !== offerId));
  };

  const clearBroadcastOffers = () => {
    broadcastOffersRef.current.clear();
    setBroadcastOffers([]);
    setPoolOffers([]);
  };

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
            if (shiftActiveRef.current) {
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

  const clearActiveJobInternal = async (opts?: { skipReleaseQueue?: boolean }) => {
    stopMeterForJob();
    setMeter(null);
    meterRef.current = null;
    resetTripDisplayTracking();
    setActiveJob(null);
    activeJobIdRef.current = null;
    bookingRawRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
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
    if (!shiftActiveRef.current || paymentJobRef.current) return;

    const offer = parseJobOffer(val);
    if (!isValidBookingId(offer.id)) {
      console.warn('[Driver] ignored offer without valid booking id:', offer.pickup);
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
      return;
    }

    setJobOffer(offer);
    void alertDriverToOffer(offer);
  };

  const handleDriverNotification = async (val: Record<string, unknown>) => {
    if (!driver?.id) return;
    const type = readNotificationType(val);
    const jobId = readNotificationJobId(val);
    const eventType = String(val.eventType ?? val.type ?? '').toLowerCase();

    if (eventType === 'assigned' || eventType === 'accepted' || eventType === 'queued') {
      await clearDriverNotification(driver.id);
      return;
    }

    if (type === 'driver_sos' || eventType === 'driver_sos') {
      return;
    }

    if (type === 'chat_message' || eventType === 'chat_message') {
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
      if (val.pickup || val.jobpickup) changes.push(`Pickup: ${val.pickup ?? val.jobpickup}`);
      if (val.dropoff || val.jobdropoff) changes.push(`Dropoff: ${val.dropoff ?? val.jobdropoff}`);
      if (val.notes || val.jobinfo) changes.push(`Notes updated`);
      if (val.Pickingtime || val.pickupTime) changes.push(`Time updated`);
      void playInAppNotificationSound('update');
      Alert.alert('Job updated', changes.length ? changes.join('\n') : String(val.editNotice ?? 'Details changed'));

      if (jobId) {
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
    if (!canListenForOffers || !isFirebaseReady || !driver?.id) return;
    try {
      const notifyRef = ref(getDatabaseInstance(), `notification/${driver.id}`);
      return onValue(notifyRef, async (snap) => {
        try {
          const val = snap.val();
          if (!val) return;
          if (typeof val === 'object' && !Array.isArray(val) && (val.type || val.eventType || isOfferPayload(val as Record<string, unknown>))) {
            await handleDriverNotification(val as Record<string, unknown>);
            return;
          }
          const payloads = extractOfferPayloads(val);
          for (const payload of payloads) {
            await processOfferPayload(payload);
          }
        } catch (err) {
          console.error('[Driver] notification listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] notification subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canListenForOffers, driver?.id], 'Driver-notification');

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
          void playInAppNotificationSound('general');
          setInAppBanner({
            kind: 'chat',
            message: String(val.content ?? val.message ?? 'New message from dispatch'),
          });
          await clearChatNotification(driver.id);
        } catch (err) {
          console.error('[Driver] chat notification listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] chat notification subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, driver?.id], 'Driver-notificationChat');

  useSafeEffect(() => {
    if (!shiftActive || !isFirebaseReady || !driver?.id) return;
    try {
      const sosRef = ref(getDatabaseInstance(), `notificationSos/${driver.id}`);
      return onValue(sosRef, async (snap) => {
        try {
          const val = snap.val() as Record<string, unknown> | null;
          if (!val || typeof val !== 'object') return;
          const eventType = String(val.eventType ?? val.type ?? '').toLowerCase();
          if (eventType !== 'driver_sos') return;
          void playInAppNotificationSound('alert');
          setInAppBanner({
            kind: 'sos',
            message: String(val.content ?? `${val.driverName ?? 'A driver'} has triggered SOS`),
          });
          await clearSosNotification(driver.id);
        } catch (err) {
          console.error('[Driver] SOS notification listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] SOS notification subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftActive, driver?.id], 'Driver-notificationSos');

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
      if (
        update.terminal ||
        update.cancelled ||
        isTerminalBookingStatus(
          String(update.raw.BookingStatus ?? update.raw.Status ?? update.raw.status ?? update.status),
        ) ||
        (bookingRawRef.current && isReturnedToDispatchPool(update.status) && !isReturnedToDispatchPool(prevStatus))
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
      const { allowed, blocked, changes } = diffBookingChanges(
        bookingRawRef.current,
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

      if (blocked.length > 0) {
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

      const dispatchTariffId = allowed.tariffId?.trim();
      const dispatchTariffName = allowed.tariffName?.trim();
      if (dispatchTariffId || dispatchTariffName) {
        const match =
          tariffsListRef.current.find((t) => dispatchTariffId && t.id === dispatchTariffId) ??
          tariffsListRef.current.find((t) => dispatchTariffName && t.name === dispatchTariffName);
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
      }

      if (changes.length === 0 && !syncedNotes.length && !dispatchTariffId && !dispatchTariffName) return;

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
      if (changes.length === 0) return;
      void playInAppNotificationSound('update');
      setJobOffer((prev) => {
        if (!prev || !jobIdsMatch(prev.id, jobOffer.id)) return prev;
        const patch: Partial<JobOffer> = {};
        if (allowed.pickup) patch.pickup = allowed.pickup;
        if (allowed.dropoff) patch.dropoff = allowed.dropoff;
        if (allowed.passengerName) patch.passengerName = allowed.passengerName;
        if (allowed.passengerPhone) patch.passengerPhone = allowed.passengerPhone;
        if (allowed.notes) patch.notes = allowed.notes;
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
    try {
      const server = await resolveServerBookingState(driver.companyId, driver.id, job.id);
      if (!server?.status) {
        console.warn(`[Driver] ${reason}: job #${job.id} not found on server`);
        return;
      }

      if (isTerminalBookingStatus(server.status)) {
        console.log(`[Driver] ${reason}: clearing stale local job #${job.id} — server=${server.status}`);
        await clearStaleActiveJobLocal(
          `Job #${job.id} is ${server.status} on dispatch. You can end shift or take new jobs.`,
        );
        return;
      }

      const serverIdx = serverStatusIndex(server.status);
      const localIdx = ['pickup', 'arrived', 'onboard', 'complete'].indexOf(job.stage);
      let ver = server.version || job.updateSeq;

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

  useSafeEffect(() => {
    if (!driver?.companyId || !driver.id || !activeJob?.id) return;
    void refreshActiveJobFromServer('active-job-resume');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, activeJob?.id], 'Driver-reconcile-active-job');

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

  useSafeEffect(() => {
    if (!driver?.companyId) return;
    const unsubRtdb = subscribeFirebaseRtdbConnected((connected) => {
      if (connected) {
        if (activeJobRef.current?.id) {
          void refreshActiveJobRef.current?.('rtdb-reconnect');
        }
        if (shiftActiveRef.current) {
          void repairPresenceRef.current?.('rtdb-reconnect');
        }
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
      console.log('[Shift] startShift — profile uid:', driver.uid, 'vehicle:', vehicleId);
      await startShiftOnline(driver, vehicleId);
      console.log('[Shift] startShiftOnline done — enrich runs in background');
      setPresenceStatus('Online');
      setReadyForJobs(true);
      readyForJobsRef.current = true;
      presenceWriteStatusRef.current = 'Available';
      startPresenceHeartbeat(driver, vehicleId, 'Available');
      void syncBgLocationFirebaseStatus('Available');
      console.log('[Shift] presence Online, readyForJobs=true');
    } catch (err) {
      console.warn('[Shift] Firebase online status write failed:', err);
      Alert.alert('Connection issue', 'Could not register with dispatch. Check your network and try again.');
      setShiftActive(false);
      shiftActiveRef.current = false;
      await storeData(STORAGE_KEYS.shiftActive, false);
      return false;
    }

    console.log('[Shift] scheduling NZTA clock + location (background)');

    void import('@/services/shiftRuntimeService').then(({ startShiftRuntime }) =>
      startShiftRuntime({
        onForegroundResume: () => {
          void repairPresenceRef.current?.('app-foreground');
          void refreshActiveJobRef.current?.('app-foreground');
        },
      }).catch((err) => console.warn('[Shift] shiftRuntime start failed:', err)),
    );

    void import('@/services/nztaService').then(({ startShiftClock }) =>
      startShiftClock(driver.companyId, driver.uid)
        .then(() => console.log('[Shift] NZTA clock started'))
        .catch((err) => console.error('[Driver] startShiftClock', err)),
    );

    void import('@/services/locationService').then(async ({ startBackgroundTracking }) => {
      try {
        console.log('[Shift] location tracking begin');
        const trackingStarted = await startBackgroundTracking(driver.id, driver.companyId, vehicleId);
        console.log('[Shift] location tracking result:', trackingStarted);
        if (!trackingStarted) {
          Alert.alert(
            'Location optional',
            'You are online and ready for jobs. Enable location when prompted so dispatch can see your position on the map.',
          );
        }
      } catch (err) {
        console.warn('[Shift] location tracking failed (non-fatal):', err);
      }
    });

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
  ): Promise<EndShiftSummary | null> => {
    // Synchronous lock before any await — blocks in-flight GPS/status-only writes.
    if (driverSnapshot?.companyId && vehicleId) {
      markPresenceSessionEnded(driverSnapshot.companyId, vehicleId);
    }

    let summary: EndShiftSummary | null = null;

    if (driverSnapshot?.companyId && driverSnapshot.uid) {
      const { captureEndShiftSummary } = await import('@/services/nztaService');
      summary = await captureEndShiftSummary();
    }

    // Stop heartbeat + GPS before Firebase delete — otherwise a final location
    // tick can recreate online/{cid}/{vid} as Available after sign-out.
    stopPresenceHeartbeat();
    const { stopBackgroundTracking } = await import('@/services/locationService');
    await stopBackgroundTracking();

    if (driverSnapshot && vehicleId) {
      try {
        await clearOnlinePresence(driverSnapshot, vehicleId);
      } catch (err) {
        console.warn('[Driver] clearOnlinePresence failed:', err);
      }
      if (driverSnapshot.companyId) {
        update(ref(getDatabaseInstance(), `vehicles/${driverSnapshot.companyId}/${vehicleId}`), {
          currentDriverId: null,
        }).catch(() => undefined);
      }
    }

    if (driverSnapshot?.companyId && driverSnapshot.uid) {
      const { endShiftClock } = await import('@/services/nztaService');
      await endShiftClock(driverSnapshot.companyId, driverSnapshot.uid, driverSnapshot.id);
    }
    const { stopShiftRuntime } = await import('@/services/shiftRuntimeService');
    stopShiftRuntime();
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
      await endShiftRemote(driverSnapshot, vehicleId);
      endShiftLocal();
    } catch (err) {
      console.error('[Driver] endShift failed:', err);
      Alert.alert('End shift failed', err instanceof Error ? err.message : 'Could not end shift');
    } finally {
      endShiftInProgressRef.current = false;
      setEndShiftInProgress(false);
      setEndShiftSummary(null);
    }
  };

  const endShiftAndSignOut = async () => {
    if (blockIfTripInProgress()) return;
    if (endShiftInProgressRef.current) return;

    endShiftInProgressRef.current = true;
    setEndShiftInProgress(true);
    try {
      const vehicleId = await resolveVehicleId();
      const driverSnapshot = driver;
      const summary = await endShiftRemote(driverSnapshot, vehicleId);

      if (summary) {
        setEndShiftSummary(summary);
        await waitForEndShiftSummaryAck();
      }

      endShiftLocal();
      await signOut();
      router.replace('/(auth)/login');
    } catch (err) {
      console.error('[Driver] endShiftAndSignOut failed:', err);
      Alert.alert('End shift failed', err instanceof Error ? err.message : 'Could not end shift');
    } finally {
      endShiftInProgressRef.current = false;
      setEndShiftInProgress(false);
      setEndShiftSummary(null);
      endShiftSummaryAckRef.current = null;
    }
  };

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
        await enqueueOfflineItem({ type: 'job_update', payload: { action: 'accept', jobId: offerSnapshot.id } });
        Alert.alert('Could not accept', 'The server did not confirm this job. It was queued for retry when you are back online.');
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
          payload: { action: 'recall', jobId: offerSnapshot.id },
        });
      }
      setQueuedOffers((prev) => prev.filter((o) => o.id !== offerSnapshot.id));
      Alert.alert('Job declined', 'Job returned to dispatch for other drivers.');
    } else {
      try {
        await declineJobOffer(offerSnapshot.id, driver.id, {
          originalStatus: offerSnapshot.originalStatus ?? 'pending',
          timedOut,
        });
      } catch {
        await enqueueOfflineItem({ type: 'job_update', payload: { action: 'decline', jobId: offerSnapshot.id } });
      }
      removeBroadcastOffer(offerSnapshot.id);
      if (shiftActive && timedOut && !driverHasConfirmedActiveTrip()) {
        console.log('[away-debug] declineOffer → setAwayAfterMissedOffer (timed-out broadcast offer)');
        await setAwayAfterMissedOffer();
      } else {
        console.log('[away-debug] declineOffer skip Away', {
          shiftActive,
          timedOut,
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
        await enqueueOfflineItem({ type: 'job_update', payload: { action: 'accept', jobId: offer.id } });
        Alert.alert('Could not accept', 'The server did not confirm this job. It was queued for retry when you are back online.');
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
    if (!isTariffConfigured(selectedTariff)) {
      Alert.alert('No tariff', 'Select a tariff before starting the meter.');
      return;
    }
    const m = createInitialMeter(selectedTariff);
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
        await syncJobStageToDispatch(nextStage, { id: activeJob.id, updateSeq: activeJob.updateSeq });
      }

      const now = Date.now();
      const stepTimes: JobStepTimes = { ...activeJob.stepTimes };
      if (nextStage === 'arrived') stepTimes.arrivedAt = now;
      if (nextStage === 'onboard') {
        stepTimes.onboardAt = now;
        startMeterForJob();
      }

      const updated: ActiveJob = {
        ...activeJob,
        stage: nextStage,
        stepTimes,
        meterSnapshot: activeJob.meterSnapshot,
        fare: activeJob.fare,
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
            startMeterForJob();
          }
          const recovered: ActiveJob = {
            ...activeJob,
            stage: nextStage,
            stepTimes,
            meterSnapshot: activeJob.meterSnapshot,
            fare: activeJob.fare,
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
      },
    };

    const persistClosedJobToFirebase = () => {
      void (async () => {
        try {
          const vehicleId = await resolveVehicleId();
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
        } catch (err) {
          console.warn('[Driver] writeClosedJob failed:', err);
        }
        if (job.id && !String(job.id).startsWith('hail_')) {
          try {
            await markBookingCompleted(driver.companyId, job.id, {
              fare: totalFare,
              paymentType,
              driverId: driver.id,
              completedAt,
              distanceKm: closed.distanceKm,
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
        await enqueueOfflineItem({
          type: 'job_update',
          payload: { action: 'complete', jobId: job.id, paymentType, fare: totalFare, extras },
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
      await enqueueOfflineItem({
        type: 'job_update',
        payload: { action: 'cancel', jobId: activeJob.id },
      });
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
    try {
      await reportNoShow(activeJob.id, driver.id, driver.companyId);
    } catch {
      await enqueueOfflineItem({
        type: 'job_update',
        payload: { action: 'no_show', jobId: activeJob.id },
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

      const { jobId, updateSeq } = await createHailJobOnDispatch({
        companyId: driver.companyId,
        driverId: driver.id,
        vehicleId,
        tariffId: selectedTariff.id,
        pickup,
      });

      const now = Date.now();
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

      writeOnlinePresence(driver, vehicleId, 'Busy').catch(() => undefined);
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
