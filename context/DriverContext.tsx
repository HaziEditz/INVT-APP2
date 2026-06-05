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
import { acceptJobOffer, declineJobOffer } from '@/lib/dispatchApi';
import { tickWorkedMinutes } from '@/services/nztaService';
import { enqueueOfflineItem, flushOfflineQueue, subscribeConnectivity } from '@/services/offlineService';
import { subscribePendingJobs } from '@/lib/pendingJobs';
import {
  clearOnlinePresence,
  isVehicleStatusAvailable,
  moveDriverToEndOfQueue,
  startShiftOnline,
  writeOnlinePresence,
} from '@/services/presenceService';
import { loadCompanyTariffs } from '@/lib/companyTariffs';
import { markBookingCompleted } from '@/lib/allbookings';
import { writeClosedJob } from '@/lib/closedJobs';
import { completeJobPayment } from '@/lib/dispatchApi';
import { reverseGeocodeCurrentAddress } from '@/services/locationService';
import {
  diffBookingChanges,
  stageAllowsMeter,
  subscribeBooking,
} from '@/lib/bookingSync';
import { initializeNztaOnLogin } from '@/services/nztaService';
import { createInitialMeter, watchMeter } from '@/services/meterEngine';
import { calcMeterBreakdown, isTariffConfigured, NO_TARIFF_CONFIGURED } from '@/lib/tariffs';
import { JobStepTimes, PaymentExtras, TariffChangeRecord } from '@/types';
import {
  ActiveJob,
  CompanyInfo,
  CompletedJob,
  JobOffer,
  JobStage,
  MeterState,
  PaymentType,
  PresenceDisplayStatus,
  QueuedOffer,
  Tariff,
  Vehicle,
  ZoneInfo,
} from '@/types';
import { useAuth } from '@/context/AuthContext';

interface DriverContextValue {
  presenceStatus: PresenceDisplayStatus;
  readyForJobs: boolean;
  shiftActive: boolean;
  selectedVehicleId: string;
  vehicles: Vehicle[];
  vehiclesLoading: boolean;
  zone: ZoneInfo;
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
  pendingOffers: JobOffer[];
  offersBadgeCount: number;
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
  togglePresence: () => Promise<void>;
  acceptOffer: () => Promise<void>;
  declineOffer: () => Promise<void>;
  advanceStage: () => Promise<void>;
  setPaymentType: (payment: PaymentType) => void;
  completeJob: () => Promise<void>;
  finalizePayment: (paymentType: string, extras: PaymentExtras, totalFare: number) => Promise<void>;
  dismissPayment: () => void;
  cancelActiveJob: () => Promise<void>;
  noShowActiveJob: () => Promise<void>;
  recallJob: () => Promise<void>;
  startHail: () => Promise<void>;
  endTrip: () => Promise<void>;
  pauseMeter: () => void;
  toggleWaitMeter: () => void;
  tariffLocked: boolean;
  setSelectedTariff: (t: Tariff) => void;
  dismissJobEditNotice: () => void;
  promoteQueuedOffer: (offerId: string) => void;
  pickOfferFromList: (offerId: string) => Promise<void>;
  canReceiveJobOffers: boolean;
  goAway: () => Promise<void>;
  goAvailable: () => Promise<void>;
}

const DriverContext = createContext<DriverContextValue | null>(null);

const EMPTY_ZONE: ZoneInfo = {
  name: '',
  position: 0,
  totalInQueue: 0,
  nearbyDrivers: 0,
};

function parseZoneNode(val: unknown): ZoneInfo {
  if (!val || typeof val !== 'object') return EMPTY_ZONE;
  const z = val as Record<string, unknown>;
  return {
    name: String(z.name ?? z.zonename ?? z.zoneName ?? z.ZoneName ?? '').trim(),
    position: Number(z.position ?? z.queue ?? z.zonequeue ?? z.zoneQueue ?? 0),
    totalInQueue: Number(z.totalInQueue ?? z.total ?? z.queueSize ?? 0),
    nearbyDrivers: Number(z.nearbyDrivers ?? z.nearby ?? 0),
  };
}

function fmtNzDate(d: Date) {
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtNzTime(d: Date) {
  return d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function isOfferPayload(val: Record<string, unknown>): boolean {
  return !!(val.pickup || val.from || val.dropoff || val.to || val.jobId || val.id);
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
  return {
    id: String(val.id ?? val.jobId ?? Date.now()),
    type: (val.type as JobOffer['type']) ?? 'Taxi',
    pickup: String(val.pickup ?? val.from ?? ''),
    dropoff: String(val.dropoff ?? val.to ?? ''),
    passengerName: val.passengerName ? String(val.passengerName) : undefined,
    passengerPhone: val.passengerPhone ? String(val.passengerPhone) : undefined,
    passengerEmail: val.passengerEmail ? String(val.passengerEmail) : undefined,
    fixedFare: val.fixedFare != null ? Number(val.fixedFare) : undefined,
    estimatedFare: val.estimatedFare != null ? Number(val.estimatedFare) : undefined,
    estimatedDistanceKm:
      val.estimatedDistanceKm != null
        ? Number(val.estimatedDistanceKm)
        : val.distanceKm != null
          ? Number(val.distanceKm)
          : undefined,
    paymentType: val.paymentType as PaymentType | undefined,
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
  };
}

type AwayIntent = 'none' | 'manual' | 'missed';

const EMPTY_STEP_TIMES: JobStepTimes = {};

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

export function DriverProvider({ children }: { children: ReactNode }) {
  const { driver, signOut } = useAuth();
  const [presenceStatus, setPresenceStatus] = useState<PresenceDisplayStatus>('Offline');
  const [readyForJobs, setReadyForJobs] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [selectedVehicleId, setSelectedVehicleIdState] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [zone, setZone] = useState<ZoneInfo>(EMPTY_ZONE);
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
  const [pendingOffers, setPendingOffers] = useState<JobOffer[]>([]);
  const awayIntentRef = useRef<AwayIntent>('none');
  const [jobEditNotice, setJobEditNotice] = useState<string | null>(null);
  const shiftActiveRef = useRef(false);
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
    if (!shiftActive || !driver?.companyId || !activeVehicle) {
      setPendingOffers([]);
      return;
    }
    try {
      return subscribePendingJobs(driver.companyId, activeVehicle, setPendingOffers);
    } catch (err) {
      console.error('[Driver] pending jobs subscribe failed', err);
    }
  }, [shiftActive, driver?.companyId, selectedVehicleId, activeVehicle?.id], 'Driver-pendingJobs');

  useSafeEffect(() => {
    if (!shiftActive || !isFirebaseReady || !driver?.companyId || !selectedVehicleId) {
      setZone(EMPTY_ZONE);
      return;
    }
    try {
      const zoneRef = ref(getDatabaseInstance(), `online/${driver.companyId}/${selectedVehicleId}/zone`);
      return onValue(zoneRef, (snap) => {
        try {
          if (snap.exists()) {
            setZone(parseZoneNode(snap.val()));
            return;
          }
          get(ref(getDatabaseInstance(), `online/${driver.companyId}/${selectedVehicleId}/current`))
            .then((cur) => {
              if (!cur.exists()) {
                setZone(EMPTY_ZONE);
                return;
              }
              const d = cur.val() as Record<string, unknown>;
              setZone({
                name: String(d.zonename ?? d.zoneName ?? '').trim(),
                position: Number(d.zonequeue ?? d.zoneQueue ?? 0),
                totalInQueue: 0,
                nearbyDrivers: 0,
              });
            })
            .catch((err) => console.error('[Driver] zone fallback read', err));
        } catch (err) {
          console.error('[Driver] zone listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] zone subscribe failed', err);
    }
  }, [shiftActive, driver?.companyId, selectedVehicleId], 'Driver-zone');

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
  const offersBadgeCount = shiftActive ? pendingOffers.length : 0;
  const nextQueuedOffer = canReceiveJobOffers ? (queuedOffers[0] ?? null) : null;

  useSafeEffect(() => {
    if (canReceiveJobOffers) return;
    setJobOffer(null);
    setQueuedOffers([]);
    lastOfferSeenRef.current = null;
  }, [canReceiveJobOffers], 'Driver-clearOffersWhenOffline');

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

  const enqueueOffer = (offer: JobOffer) => {
    const queued: QueuedOffer = { ...offer, queuedAt: Date.now(), silent: true };
    setQueuedOffers((prev) => {
      const isTaxi = offer.type === 'Taxi';
      if (isTaxi && prev.length >= 1) return prev;
      if (prev.some((o) => o.id === offer.id)) return prev;
      return [...prev, queued];
    });
  };

  const handleIncomingOffer = async (val: Record<string, unknown>) => {
    if (!shiftActiveRef.current || !readyForJobsRef.current || paymentJobRef.current) return;

    const offer = parseJobOffer(val);
    const seen = lastOfferSeenRef.current;
    if (seen?.id === offer.id && Date.now() - seen.at < 2500) return;
    lastOfferSeenRef.current = { id: offer.id, at: Date.now() };

    const onHail = hailActiveRef.current;
    const onJob = !!activeJobIdRef.current;
    const onboard = activeJob?.stage === 'onboard';

    if (onHail || (onJob && !onboard && activeJob?.type === 'Taxi')) {
      enqueueOffer(offer);
      return;
    }

    if (onJob && onboard) {
      enqueueOffer(offer);
      return;
    }

    setJobOffer(offer);
  };

  const processOfferPayload = async (val: Record<string, unknown>) => {
    if (!shiftActiveRef.current || !readyForJobsRef.current) return;

    if (val.editNotice && activeJobIdRef.current === String(val.jobId ?? val.id)) {
      setJobEditNotice(String(val.editNotice));
    }
    if (val.removed || val.declined) return;
    await handleIncomingOffer(val);
  };

  useSafeEffect(() => {
    if (!canReceiveJobOffers || !isFirebaseReady || !driver?.companyId || !driver.id) return;
    try {
      const offerRef = ref(getDatabaseInstance(), `jobOffers/${driver.companyId}/${driver.id}`);
      return onValue(offerRef, async (snap) => {
        try {
          const payloads = extractOfferPayloads(snap.val());
          for (const payload of payloads) {
            await processOfferPayload(payload);
          }
        } catch (err) {
          console.error('[Driver] job offer listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] job offer subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReceiveJobOffers, driver?.companyId, driver?.id, activeJob?.stage], 'Driver-jobOffers');

  useSafeEffect(() => {
    if (!canReceiveJobOffers || !isFirebaseReady || !driver?.id) return;
    try {
      const notifyRef = ref(getDatabaseInstance(), `notification/${driver.id}`);
      return onValue(notifyRef, async (snap) => {
        try {
          const payloads = extractOfferPayloads(snap.val());
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
  }, [canReceiveJobOffers, driver?.id], 'Driver-notification');

  useSafeEffect(() => {
    if (!driver?.companyId || !activeJob?.id) {
      bookingRawRef.current = null;
      return;
    }
    bookingRawRef.current = null;
    return subscribeBooking(driver.companyId, activeJob.id, (update) => {
      if (update.cancelled) {
        Alert.alert('Job cancelled', 'This booking was cancelled by dispatch.');
        void cancelActiveJobInternal();
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
        setJobEditNotice(`Job updated:\n${changes.join('\n')}`);
      } else if (changes.some((c) => c.startsWith('Notes') || c.startsWith('Payment'))) {
        setJobEditNotice(changes.filter((c) => c.startsWith('Notes') || c.startsWith('Payment')).join('\n'));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, activeJob?.id, activeJob?.stage], 'Driver-bookingSync');

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

  const endShift = async () => {
    const vehicleId = await resolveVehicleId();
    setShiftActive(false);
    shiftActiveRef.current = false;
    awayIntentRef.current = 'none';
    await storeData(STORAGE_KEYS.shiftActive, false);
    await storeData(STORAGE_KEYS.vehicleSessionReady, false);
    setReadyForJobs(false);
    readyForJobsRef.current = false;
    setPendingOffers([]);
    stopMeterTimers();
    setHailActive(false);
    hailActiveRef.current = false;
    setHailPickupAddress(null);
    setHailPickupLat(undefined);
    setHailPickupLng(undefined);
    setMeter(null);
    meterRef.current = null;
    storeData(STORAGE_KEYS.meterState, null).catch(() => undefined);

    if (driver && vehicleId) {
      try {
        await writeOnlinePresence(driver, vehicleId, 'Offline');
      } catch {
        // non-fatal
      }
      try {
        await clearOnlinePresence(driver, vehicleId);
      } catch {
        // non-fatal
      }
    }

    setPresenceStatus('Offline');
    setJobOffer(null);
    setQueuedOffers([]);
    setActiveJob(null);
    activeJobIdRef.current = null;
    setPaymentJob(null);
    await storeData(STORAGE_KEYS.activeJob, null);

    if (driver?.companyId && driver.uid) {
      const { endShiftClock } = await import('@/services/nztaService');
      await endShiftClock(driver.companyId, driver.uid, driver.id);
    }
    const { stopBackgroundTracking } = await import('@/services/locationService');
    await stopBackgroundTracking();
  };

  const endShiftAndSignOut = async () => {
    await endShift();
    await signOut();
  };

  const acceptOffer = async () => {
    if (!jobOffer || !driver) return;
    try {
      await acceptJobOffer(jobOffer.id, driver.id);
    } catch {
      await enqueueOfflineItem({ type: 'job_update', payload: { action: 'accept', jobId: jobOffer.id } });
    }
    const job = defaultActiveJob(jobOffer);
    setActiveJob(job);
    activeJobIdRef.current = job.id;
    await storeData(STORAGE_KEYS.activeJob, job);
    setJobOffer(null);

    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
    }
  };

  const declineOffer = async () => {
    if (!jobOffer || !driver) return;
    try {
      await declineJobOffer(jobOffer.id, driver.id);
    } catch {
      await enqueueOfflineItem({ type: 'job_update', payload: { action: 'decline', jobId: jobOffer.id } });
    }
    setJobOffer(null);
    lastOfferSeenRef.current = null;
    if (shiftActive) {
      await setAwayAfterMissedOffer();
    }
  };

  const pickOfferFromList = async (offerId: string) => {
    const offer = pendingOffers.find((o) => o.id === offerId);
    if (!offer || !driver) return;

    const onTrip = hailActiveRef.current || !!activeJobIdRef.current;
    if (onTrip) {
      enqueueOffer(offer);
      return;
    }

    try {
      await acceptJobOffer(offer.id, driver.id);
    } catch {
      await enqueueOfflineItem({ type: 'job_update', payload: { action: 'accept', jobId: offer.id } });
    }

    const job = defaultActiveJob(offer);
    setActiveJob(job);
    activeJobIdRef.current = job.id;
    await storeData(STORAGE_KEYS.activeJob, job);
    setJobOffer(null);

    const vehicleId = await resolveVehicleId();
    if (vehicleId) {
      writeOnlinePresence(driver, vehicleId, 'Assigned').catch(() => undefined);
    }
  };

  const promoteQueuedOffer = (offerId: string) => {
    const offer = queuedOffers.find((o) => o.id === offerId);
    if (!offer) return;
    setQueuedOffers((prev) => prev.filter((o) => o.id !== offerId));
    setJobOffer({ ...offer, silent: false });
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
    if (!activeJob) return;
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
      await writeClosedJob(driver.companyId, driver.id, closed, paymentType, extras, totalFare);
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
        driverId: driver.id,
        companyId: driver.companyId,
        paymentType,
        fare: totalFare,
        extras,
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
    if (queuedOffers.length > 0) {
      setTimeout(flushQueuedOffer, 400);
    }
  };

  const cancelActiveJobInternal = async () => {
    stopMeterForJob();
    setMeter(null);
    meterRef.current = null;
    setActiveJob(null);
    activeJobIdRef.current = null;
    bookingRawRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    await storeData(STORAGE_KEYS.meterState, null);
    if (driver && shiftActive) {
      const vehicleId = await resolveVehicleId();
      if (vehicleId) writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
    }
    if (queuedOffers.length > 0) setTimeout(flushQueuedOffer, 400);
  };

  const cancelActiveJob = async () => {
    await cancelActiveJobInternal();
  };

  const noShowActiveJob = async () => {
    await cancelActiveJob();
    Alert.alert('No show', 'Job marked as no show.');
  };

  const recallJob = async () => {
    if (!activeJob) return;
    const order: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];
    const idx = order.indexOf(activeJob.stage);
    if (idx <= 0) return;
    const updated = { ...activeJob, stage: order[idx - 1] };
    setActiveJob(updated);
    await storeData(STORAGE_KEYS.activeJob, updated);
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

  const startHail = async () => {
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

    try {
      const geo = await reverseGeocodeCurrentAddress();
      setHailPickupAddress(geo.address);
      setHailPickupLat(geo.lat);
      setHailPickupLng(geo.lng);
    } catch {
      setHailPickupAddress('Current location (address unavailable)');
    }

    const m = createInitialMeter(selectedTariff);
    setMeter(m);
    meterRef.current = m;
    storeData(STORAGE_KEYS.meterState, m).catch(() => undefined);
    startMeterWatch();
  };

  const endTrip = async () => {
    if (!meterRef.current?.running && !hailActive && !activeJob) return;

    const snapshot = buildMeterSnapshot();
    const now = Date.now();

    if (meterStopRef.current) {
      meterStopRef.current();
      meterStopRef.current = null;
    }

    if (hailActiveRef.current || hailActive) {
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
      };
      setPaymentJob(hailJob);
      setHailActive(false);
      hailActiveRef.current = false;
      setMeter(null);
      meterRef.current = null;
      await storeData(STORAGE_KEYS.meterState, null);
      return;
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
        pendingOffers,
        offersBadgeCount,
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
        startHail,
        endTrip,
        pauseMeter,
        toggleWaitMeter,
        setSelectedTariff,
        dismissJobEditNotice,
        promoteQueuedOffer,
        pickOfferFromList,
        canReceiveJobOffers,
        goAway,
        goAvailable,
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
