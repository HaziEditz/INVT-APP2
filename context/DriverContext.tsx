import React, { createContext, useContext, useRef, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { get, onValue, ref, update } from 'firebase/database';
import { getDatabaseInstance, isFirebaseReady } from '@/lib/firebase';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { collectJobNotes } from '@/lib/jobNotes';
import { loadCompanyInfo } from '@/lib/company';
import { EarningsBreakdown, sumBreakdown } from '@/lib/earnings';
import { HistoryJob, loadDriverJobHistory } from '@/lib/jobHistory';
import { loadDriverVehicles } from '@/lib/vehicles';
import { acceptJobOffer, declineJobOffer, recallJobOnDispatch, reportNoShow } from '@/lib/dispatchApi';
import {
  clearDriverNotification,
  jobIdsMatch,
  readNotificationJobId,
  readNotificationType,
} from '@/lib/driverNotifications';
import { playInAppNotificationSound } from '@/lib/notificationSound';
import { subscribeDriverQueue } from '@/lib/driverQueue';
import { enqueueOfflineItem, flushOfflineQueue, subscribeConnectivity } from '@/services/offlineService';
import { tickWorkedMinutes } from '@/services/nztaService';
import {
  clearOnlinePresence,
  isVehicleStatusAvailable,
  moveDriverToEndOfQueue,
  startShiftOnline,
  writeOnlinePresence,
  FirebaseDriverStatus,
} from '@/services/presenceService';
import { loadCompanyTariffs } from '@/lib/companyTariffs';
import { markBookingCompleted } from '@/lib/allbookings';
import { writeClosedJob } from '@/lib/closedJobs';
import { completeJobPayment } from '@/lib/dispatchApi';
import { CompanyZone, findZoneAtCoords, subscribeCompanyZones } from '@/lib/companyZones';
import { getCurrentCoords, refreshHailPickupLocation } from '@/services/locationService';
import * as Location from 'expo-location';
import {
  diffBookingChanges,
  isReturnedToDispatchPool,
  stageAllowsMeter,
  subscribeBooking,
} from '@/lib/bookingSync';
import { initializeNztaOnLogin } from '@/services/nztaService';
import type { EndShiftSummary } from '@/services/nztaService';
import { createInitialMeter, watchMeter } from '@/services/meterEngine';
import { calcMeterBreakdown, isTariffConfigured, NO_TARIFF_CONFIGURED } from '@/lib/tariffs';
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
  /** @deprecated use broadcastOffers */
  pendingOffers: JobOffer[];
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
  startShift: (vehicleId?: string) => Promise<void>;
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
  cancelActiveJob: () => Promise<void>;
  noShowActiveJob: () => Promise<void>;
  recallJob: () => Promise<void>;
  recallQueuedOffer: (offerId: string) => Promise<void>;
  startHail: () => Promise<void>;
  endHail: () => Promise<void>;
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
}

const DriverContext = createContext<DriverContextValue | null>(null);

const EMPTY_ZONE: ZoneInfo = {
  name: '',
  position: 0,
  totalInQueue: 0,
  nearbyDrivers: 0,
};

import { parseZoneFromOnlineNode } from '@/lib/zoneQueue';

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
  const allNotes = collectJobNotes(val);
  const primaryNote = allNotes.map((n) => n.text).join('\n\n') || undefined;
  const rawFare = val.fare ?? val.jobfare ?? val.jobFare;
  const rawPayment = val.payment ?? val.jobpayment ?? val.paymentType ?? val.PaymentType ?? val.paymentMethod;
  const rawId = val.id ?? val.jobId ?? val.joboffer ?? val.bookingid ?? val.bookingId ?? Date.now();
  const idStr = String(rawId);
  const normalizedId = idStr.includes(',') ? idStr.split(',')[0].trim() : idStr;
  return {
    id: normalizedId,
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
        ? Number(val.fixedFare)
        : rawFare != null && rawFare !== ''
          ? Number(rawFare)
          : undefined,
    estimatedFare:
      val.estimatedFare != null
        ? Number(val.estimatedFare)
        : rawFare != null && rawFare !== ''
          ? Number(rawFare)
          : undefined,
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
  };
}

type AwayIntent = 'none' | 'manual' | 'missed';

const EMPTY_STEP_TIMES: JobStepTimes = {};
const TRIP_BLOCK_MSG = 'Complete your current job first';

function defaultActiveJob(offer: JobOffer): ActiveJob {
  const now = Date.now();
  return {
    ...offer,
    stage: 'pickup',
    startedAt: now,
    distanceKm: 0,
    durationMin: 0,
    fare: offer.fixedFare ?? offer.estimatedFare ?? 0,
    stepTimes: { acceptedAt: now, onWayAt: now },
    tariffChanges: [],
  };
}

function patchJobOfferFromNotification(offer: JobOffer, val: Record<string, unknown>): JobOffer {
  const patch: Partial<JobOffer> = {};
  if (val.pickup || val.jobpickup) patch.pickup = String(val.pickup ?? val.jobpickup);
  if (val.dropoff || val.jobdropoff) patch.dropoff = String(val.dropoff ?? val.jobdropoff);
  if (val.notes || val.jobinfo) patch.notes = String(val.notes ?? val.jobinfo);
  if (val.jobname) patch.passengerName = String(val.jobname);
  if (val.JobphoneNo) patch.passengerPhone = String(val.JobphoneNo);
  return { ...offer, ...patch };
}

function patchActiveJobFromNotification(job: ActiveJob, val: Record<string, unknown>): ActiveJob {
  const patch: Partial<ActiveJob> = {};
  if (val.pickup || val.jobpickup) patch.pickup = String(val.pickup ?? val.jobpickup);
  if (val.dropoff || val.jobdropoff) patch.dropoff = String(val.dropoff ?? val.jobdropoff);
  if (val.notes || val.jobinfo) patch.notes = String(val.notes ?? val.jobinfo);
  if (val.jobname) patch.passengerName = String(val.jobname);
  if (val.JobphoneNo) patch.passengerPhone = String(val.JobphoneNo);
  return { ...job, ...patch };
}

export function DriverProvider({ children }: { children: ReactNode }) {
  const { driver, signOut } = useAuth();
  const [presenceStatus, setPresenceStatus] = useState<PresenceDisplayStatus>('Offline');
  const [readyForJobs, setReadyForJobs] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [selectedVehicleId, setSelectedVehicleIdState] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [zone, setZone] = useState<ZoneInfo>(EMPTY_ZONE);
  const [companyZones, setCompanyZones] = useState<CompanyZone[]>([]);
  const companyZonesRef = useRef<CompanyZone[]>([]);
  const [jobOffer, setJobOffer] = useState<JobOffer | null>(null);
  const [paymentJob, setPaymentJob] = useState<ActiveJob | null>(null);
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
  const [queuedOffers, setQueuedOffers] = useState<QueuedOffer[]>([]);
  const [broadcastOffers, setBroadcastOffers] = useState<JobOffer[]>([]);
  const [preferredPanelTab, setPreferredPanelTab] = useState<MainPanelTab | null>(null);
  const broadcastOffersRef = useRef<Map<string, JobOffer>>(new Map());
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
  const lastOfferSeenRef = useRef<{ id: string; at: number } | null>(null);
  const meterRef = useRef<MeterState | null>(null);
  const meterStopRef = useRef<(() => void) | null>(null);
  const paymentJobRef = useRef(false);
  const bookingRawRef = useRef<Record<string, unknown> | null>(null);

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
    paymentJobRef.current = !!paymentJob;
  }, [paymentJob], 'Driver-paymentRef');

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
          setActiveJob({
            ...j,
            stepTimes: j.stepTimes ?? EMPTY_STEP_TIMES,
            tariffChanges: j.tariffChanges ?? [],
          });
        }
        // Do not restore shift as "online" on launch — driver must confirm vehicle each session.
        await storeData(STORAGE_KEYS.shiftActive, false);
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
          if (connected) await flushOfflineQueue();
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
      setVehicles([]);
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
      setVehicles(list);
      // Pre-select a default for the picker only; shift still requires explicit confirmation.
      if (!selectedVehicleId) {
        const preferred =
          list.find((v) => v.id === driver.vehicleId?.toUpperCase()) ?? list[0];
        if (preferred) await setSelectedVehicleId(preferred.id);
      }
    } catch (err) {
      console.warn('[Driver] refreshVehicles failed:', err);
      setVehicles([]);
    } finally {
      setVehiclesLoading(false);
    }
  };

  useSafeEffect(() => {
    refreshVehicles().catch((err) => console.error('[Driver] refreshVehicles', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.uid, driver?.companyId, driver?.id, driver?.vehicleId], 'Driver-vehicles');

  useSafeEffect(() => {
    if (!driver?.companyId) {
      setTariffsState([]);
      setSelectedTariffState(NO_TARIFF_CONFIGURED);
      return;
    }
    loadCompanyTariffs(driver.companyId)
      .then(async (list) => {
        setTariffsState(list);
        if (list.length === 0) {
          setSelectedTariffState(NO_TARIFF_CONFIGURED);
          return;
        }
        const savedId = await getData<string>(STORAGE_KEYS.selectedTariffId);
        const match = savedId ? list.find((t) => t.id === savedId) : null;
        if (match) setSelectedTariffState(match);
        else setSelectedTariffState(list[0]);
      })
      .catch((err) => {
        console.error('[Driver] loadCompanyTariffs', err);
        setTariffsState([]);
        setSelectedTariffState(NO_TARIFF_CONFIGURED);
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
  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const activeVehicleBodyType = activeVehicle?.displayType ?? activeVehicle?.bodyType ?? '—';
  const tariffLocked = !!paymentJob;

  useSafeEffect(() => {
    if (!shiftActive || !driver?.companyId || !driver.id) {
      setQueuedOffers([]);
      return;
    }
    try {
      return subscribeDriverQueue(driver.companyId, driver.id, activeVehicle, (offers) => {
        setQueuedOffers(
          offers.map((o) => ({
            ...o,
            queuedAt: o.queuedAt ?? Date.now(),
          })),
        );
      });
    } catch (err) {
      console.error('[Driver] driverQueue subscribe failed', err);
    }
  }, [shiftActive, driver?.companyId, driver?.id, activeVehicle?.id], 'Driver-firebaseQueue');

  const upsertBroadcastOffer = (offer: JobOffer) => {
    broadcastOffersRef.current.set(offer.id, offer);
    setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
  };

  const removeBroadcastOffer = (offerId: string) => {
    broadcastOffersRef.current.delete(offerId);
    setBroadcastOffers(Array.from(broadcastOffersRef.current.values()));
  };

  const clearBroadcastOffers = () => {
    broadcastOffersRef.current.clear();
    setBroadcastOffers([]);
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
      setZone((prev) => ({
        ...prev,
        name: hit?.name ?? (prev.name || ''),
      }));
    };

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const coords = await getCurrentCoords();
        applyZoneFromCoords(coords.latitude, coords.longitude);
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 5000 },
          (loc) => applyZoneFromCoords(loc.coords.latitude, loc.coords.longitude),
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
            if (!shiftActiveRef.current) {
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

  const canReceiveJobOffers =
    shiftActive && readyForJobs && presenceStatus === 'Online' && !paymentJob;
  const canListenForOffers = shiftActive && !paymentJob;
  const tripInProgress = () => hailActiveRef.current || !!activeJobIdRef.current;
  const blockIfTripInProgress = () => {
    if (!tripInProgress()) return false;
    Alert.alert('Job in progress', TRIP_BLOCK_MSG);
    return true;
  };
  const offersBadgeCount = shiftActive ? broadcastOffers.length : 0;
  const nextQueuedOffer = canReceiveJobOffers ? (queuedOffers[0] ?? null) : null;

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
      if (hailActiveRef.current || activeJobIdRef.current || paymentJobRef.current) return;
      setQueuedOffers((q) => {
        if (q.length === 0) return q;
        const [next, ...rest] = q;
        setJobOffer({ ...next, silent: false, fromQueue: true });
        return rest;
      });
    }, 600);
  };

  const restoreAvailableAfterJobClear = async () => {
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
      setPresenceStatus('Online');
      setReadyForJobs(true);
      readyForJobsRef.current = true;
    }
  };

  const clearActiveJobInternal = async (opts?: { skipReleaseQueue?: boolean }) => {
    stopMeterForJob();
    setMeter(null);
    meterRef.current = null;
    setActiveJob(null);
    activeJobIdRef.current = null;
    bookingRawRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
    if (!opts?.skipReleaseQueue) {
      releaseQueuedOffersAfterTrip();
    }
  };

  const handleIncomingOffer = async (val: Record<string, unknown>) => {
    if (!shiftActiveRef.current || paymentJobRef.current) return;

    const offer = parseJobOffer(val);
    const seen = lastOfferSeenRef.current;
    if (seen?.id === offer.id && Date.now() - seen.at < 2500) return;
    lastOfferSeenRef.current = { id: offer.id, at: Date.now() };

    upsertBroadcastOffer(offer);

    if (hailActiveRef.current || activeJobIdRef.current) {
      return;
    }

    setPreferredPanelTab('offers');
    setJobOffer(offer);
    void playInAppNotificationSound('offer');
  };

  const handleDriverNotification = async (val: Record<string, unknown>) => {
    if (!driver?.id) return;
    const type = readNotificationType(val);
    const jobId = readNotificationJobId(val);

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
      }
      await clearDriverNotification(driver.id);
      return;
    }

    if (type === 'job_offer' || isOfferPayload(val)) {
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
        update.cancelled ||
        (bookingRawRef.current && isReturnedToDispatchPool(update.status) && !isReturnedToDispatchPool(prevStatus))
      ) {
        void playInAppNotificationSound('cancel');
        Alert.alert(
          update.cancelled ? 'Job cancelled' : 'Job taken back',
          update.cancelled
            ? 'This booking was cancelled by dispatch.'
            : 'This booking was returned to dispatch.',
        );
        void cancelActiveJobInternal();
        void restoreAvailableAfterJobClear();
        return;
      }
      const meterStarted = stageAllowsMeter(activeJob?.stage ?? 'pickup');
      const { allowed, blocked, changes } = diffBookingChanges(
        bookingRawRef.current,
        update.raw,
        meterStarted,
      );
      bookingRawRef.current = update.raw;
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

      if (changes.length === 0 && !syncedNotes.length) return;

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
      if (update.cancelled) {
        void playInAppNotificationSound('cancel');
        Alert.alert('Offer cancelled', 'This booking was cancelled by dispatch.');
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

  useSafeEffect(() => {
    if (!driver?.companyId || queuedOffers.length === 0) return;
    const unsubs = queuedOffers.map((o) =>
      subscribeBooking(driver.companyId!, o.id, (update) => {
        if (!update.cancelled) return;
        Alert.alert('Queued job cancelled', 'A queued booking was cancelled.');
        setQueuedOffers((prev) => prev.filter((q) => q.id !== o.id));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [driver?.companyId, queuedOffers], 'Driver-queuedBookingSync');

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

  const startShift = async (vehicleIdOverride?: string) => {
    if (!driver) return;

    const vehicleId = (vehicleIdOverride ?? '').trim().toUpperCase();
    if (!vehicleId) {
      Alert.alert('Vehicle required', 'Select a vehicle and confirm before starting your shift.');
      return;
    }

    if (vehicleId !== selectedVehicleId) {
      await setSelectedVehicleId(vehicleId);
    }

    if (driver.companyId) {
      try {
        const snap = await get(ref(getDatabaseInstance(), `online/${driver.companyId}/${vehicleId}/current`));
        if (snap.exists()) {
          const data = snap.val() as Record<string, unknown>;
          const existingDriverId = String(data.driverid ?? '');
          const myDriverId = String(driver.id ?? '');
          if (existingDriverId && existingDriverId !== myDriverId && existingDriverId !== driver.uid) {
            Alert.alert(
              'Vehicle in use',
              `${vehicleId} is on shift with another driver. Contact dispatch if this is wrong.`,
            );
            return;
          }
        }
      } catch {
        // non-blocking
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
      console.log('[Shift] presence Online, readyForJobs=true');
    } catch (err) {
      console.warn('[Shift] Firebase online status write failed:', err);
      Alert.alert('Connection issue', 'Could not register with dispatch. Check your network and try again.');
      setShiftActive(false);
      shiftActiveRef.current = false;
      await storeData(STORAGE_KEYS.shiftActive, false);
      return;
    }

    console.log('[Shift] scheduling NZTA clock + location (background)');

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
  };

  const goAway = async () => {
    if (blockIfTripInProgress()) return;
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    awayIntentRef.current = 'manual';
    await writeOnlinePresence(driver, vehicleId, 'Away');
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
    if (wasMissed) {
      await moveDriverToEndOfQueue(driver, vehicleId);
    }
    setPresenceStatus('Online');
    setReadyForJobs(true);
    readyForJobsRef.current = true;
  };

  const setAwayAfterMissedOffer = async () => {
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    awayIntentRef.current = 'missed';
    await writeOnlinePresence(driver, vehicleId, 'Away');
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
    void storeData(STORAGE_KEYS.activeJob, null);
  };

  const endShiftRemote = async (
    driverSnapshot: typeof driver,
    vehicleId: string | null,
  ): Promise<EndShiftSummary | null> => {
    let summary: EndShiftSummary | null = null;

    if (driverSnapshot?.companyId && driverSnapshot.uid) {
      const { captureEndShiftSummary } = await import('@/services/nztaService');
      summary = await captureEndShiftSummary();
    }

    if (driverSnapshot && vehicleId) {
      try {
        await writeOnlinePresence(driverSnapshot, vehicleId, 'Offline');
      } catch {
        // non-fatal
      }
      try {
        await clearOnlinePresence(driverSnapshot, vehicleId);
      } catch {
        // non-fatal
      }
    }

    if (driverSnapshot?.companyId && driverSnapshot.uid) {
      const { endShiftClock } = await import('@/services/nztaService');
      await endShiftClock(driverSnapshot.companyId, driverSnapshot.uid, driverSnapshot.id);
    }
    const { stopBackgroundTracking } = await import('@/services/locationService');
    await stopBackgroundTracking();
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

  const syncJobStageToDispatch = async (stage: JobStage) => {
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    const statusMap: Record<JobStage, FirebaseDriverStatus> = {
      pickup: 'Assigned',
      arrived: 'Arrived',
      onboard: 'Active',
      complete: 'Available',
    };
    writeOnlinePresence(driver, vehicleId, statusMap[stage]).catch(() => undefined);
  };

  const acceptOffer = async () => {
    if (!jobOffer || !driver) return;
    const offerSnapshot = jobOffer;
    let queued = false;
    try {
      const result = (await acceptJobOffer(offerSnapshot.id, driver.id)) as {
        queued?: boolean;
        status?: string;
      };
      queued = !!(result?.queued || result?.status === 'Queued');
    } catch {
      await enqueueOfflineItem({ type: 'job_update', payload: { action: 'accept', jobId: offerSnapshot.id } });
    }

    removeBroadcastOffer(offerSnapshot.id);
    setJobOffer(null);

    if (queued) {
      setPreferredPanelTab('queue');
      Alert.alert('Job queued', 'This job is in your Queue until your current trip finishes.');
      return;
    }

    const job = defaultActiveJob(offerSnapshot);
    job.originalStatus = offerSnapshot.originalStatus ?? 'pending';
    setActiveJob(job);
    activeJobIdRef.current = job.id;
    await storeData(STORAGE_KEYS.activeJob, job);
    setPreferredPanelTab('current');

    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
      syncJobStageToDispatch('pickup');
    }
    await clearDriverNotification(driver.id);
  };

  const declineOffer = async (opts?: { timedOut?: boolean }) => {
    if (!jobOffer || !driver) return;
    const offerSnapshot = jobOffer;
    const timedOut = !!opts?.timedOut;

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
      if (shiftActive && timedOut) {
        await setAwayAfterMissedOffer();
      }
    }

    setJobOffer(null);
    lastOfferSeenRef.current = null;
    await clearDriverNotification(driver.id);
  };

  const pickOfferFromList = async (offerId: string) => {
    const offer = broadcastOffers.find((o) => o.id === offerId);
    if (!offer || !driver) return;

    try {
      const result = (await acceptJobOffer(offer.id, driver.id)) as { queued?: boolean; status?: string };
      if (result?.queued || result?.status === 'Queued') {
        removeBroadcastOffer(offer.id);
        setPreferredPanelTab('queue');
        Alert.alert('Job queued', 'This job is in your Queue until your current trip finishes.');
        return;
      }
    } catch {
      await enqueueOfflineItem({ type: 'job_update', payload: { action: 'accept', jobId: offer.id } });
    }

    removeBroadcastOffer(offer.id);
    const job = defaultActiveJob(offer);
    job.originalStatus = offer.originalStatus ?? 'pending';
    setActiveJob(job);
    activeJobIdRef.current = job.id;
    await storeData(STORAGE_KEYS.activeJob, job);
    setPreferredPanelTab('current');

    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
      syncJobStageToDispatch('pickup');
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
      selectedTariff,
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
    if (!activeJob || !driver) return;
    const order: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];
    const idx = order.indexOf(activeJob.stage);
    const nextStage = order[Math.min(idx + 1, order.length - 1)];
    const now = Date.now();
    const stepTimes: JobStepTimes = { ...activeJob.stepTimes };
    if (nextStage === 'arrived') stepTimes.arrivedAt = now;
    if (nextStage === 'onboard') {
      stepTimes.onboardAt = now;
      startMeterForJob();
    }
    if (nextStage === 'complete') {
      stepTimes.completeAt = now;
      stopMeterForJob();
    }

    let meterSnapshot = meterRef.current;
    if (nextStage === 'complete' && meterSnapshot) {
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
    await storeData(STORAGE_KEYS.activeJob, updated);

    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      if (nextStage === 'onboard') {
        writeOnlinePresence(driver, vehicleId, 'Active').catch(() => undefined);
        syncJobStageToDispatch('onboard');
      } else if (nextStage === 'arrived') {
        writeOnlinePresence(driver, vehicleId, 'Arrived').catch(() => undefined);
        syncJobStageToDispatch('arrived');
      } else if (nextStage === 'complete') {
        writeOnlinePresence(driver, vehicleId, 'Busy').catch(() => undefined);
      } else {
        writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
        syncJobStageToDispatch(nextStage);
      }
    }

    if (nextStage === 'complete') {
      setPaymentJob(updated);
    }
  };

  const setPaymentType = (payment: PaymentType) => {
    if (!activeJob) return;
    const updated = { ...activeJob, paymentType: payment };
    setActiveJob(updated);
    storeData(STORAGE_KEYS.activeJob, updated);
  };

  const completeJob = async () => {
    if (!activeJob) return;
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
    await storeData(STORAGE_KEYS.activeJob, closed);
  };

  const dismissPayment = () => {
    setPaymentJob(null);
  };

  const finalizePayment = async (
    paymentType: string,
    extras: PaymentExtras,
    totalFare: number,
    tmDetails?: TmPaymentDetails,
  ) => {
    const job = paymentJob ?? activeJob;
    if (!job || !driver?.companyId) return;

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

    try {
      await writeClosedJob(
        driver.companyId,
        driver.id,
        closed,
        paymentType,
        extras,
        totalFare,
        tmDetails,
        { driverName: driver.name, vehicleId: await resolveVehicleId() },
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

    try {
      await completeJobPayment({
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
      });
    } catch {
      await enqueueOfflineItem({
        type: 'job_update',
        payload: { action: 'complete', jobId: job.id, paymentType, fare: totalFare, extras },
      });
    }

    const done: CompletedJob = { ...closed, completedAt };
    setCompletedJobs((prev) => [done, ...prev]);
    setActiveJob(null);
    setPaymentJob(null);
    setHailActive(false);
    hailActiveRef.current = false;
    setHailPickupAddress(null);
    setHailPickupLat(undefined);
    setHailPickupLng(undefined);
    setMeter(null);
    meterRef.current = null;
    activeJobIdRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
    refreshJobHistory().catch(() => undefined);

    if (driver && shiftActive) {
      const vehicleId = await resolveVehicleId();
      if (vehicleId) {
        writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
        setPresenceStatus('Online');
        setReadyForJobs(true);
        readyForJobsRef.current = true;
      }
    }
    releaseQueuedOffersAfterTrip();
  };

  const cancelActiveJobInternal = async () => {
    await clearActiveJobInternal();
    await restoreAvailableAfterJobClear();
  };

  const cancelActiveJob = async () => {
    await cancelActiveJobInternal();
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
    stopMeterForJob();
    setMeter(null);
    meterRef.current = null;
    setActiveJob(null);
    activeJobIdRef.current = null;
    bookingRawRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
    if (shiftActive) {
      const vehicleId = await resolveVehicleId();
      if (vehicleId) {
        writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
        setPresenceStatus('Online');
        setReadyForJobs(true);
        readyForJobsRef.current = true;
      }
    }
    releaseQueuedOffersAfterTrip();
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

  const startHail = () => {
    if (!shiftActive) {
      Alert.alert('Start shift', 'Start your shift before hailing a passenger.');
      return;
    }
    if (!isTariffConfigured(selectedTariff)) {
      Alert.alert('No tariff configured', 'Ask dispatch to set up tariffs for your company in Firebase.');
      return;
    }

    setHailPickupAddress('Locating…');
    setHailActive(true);
    hailActiveRef.current = true;

    const m = createInitialMeter(selectedTariff);
    setMeter(m);
    meterRef.current = m;
    storeData(STORAGE_KEYS.meterState, m).catch(() => undefined);
    startMeterWatch();

    if (driver) {
      void resolveVehicleId().then((vehicleId) => {
        if (vehicleId && hailActiveRef.current) {
          writeOnlinePresence(driver, vehicleId, 'Busy').catch(() => undefined);
        }
      });
    }

    void refreshHailPickupLocation((pickup) => {
      if (!hailActiveRef.current) return;
      setHailPickupAddress(pickup.address);
      if (pickup.lat != null && pickup.lng != null) {
        setHailPickupLat(pickup.lat);
        setHailPickupLng(pickup.lng);
      }
    });
  };

  const endHail = async () => {
    if (!hailActiveRef.current && !hailActive) return;

    const snapshot = buildMeterSnapshot();
    const now = Date.now();

    if (meterStopRef.current) {
      meterStopRef.current();
      meterStopRef.current = null;
    }

    const hailJob: ActiveJob = {
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

    setPaymentJob(hailJob);
    setHailActive(false);
    hailActiveRef.current = false;
    setMeter(null);
    meterRef.current = null;
    await storeData(STORAGE_KEYS.meterState, null);
  };

  const endTrip = async () => {
    if (hailActiveRef.current || hailActive) {
      await endHail();
      return;
    }
    if (!meterRef.current?.running && !activeJob) return;

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
      setMeter(null);
      meterRef.current = null;
      await storeData(STORAGE_KEYS.activeJob, updated);
      await storeData(STORAGE_KEYS.meterState, snapshot);
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

  const dismissJobEditNotice = () => setJobEditNotice(null);

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
        pendingOffers: broadcastOffers,
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
        cancelActiveJob,
        noShowActiveJob,
        recallJob,
        recallQueuedOffer,
        startHail,
        endHail,
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
