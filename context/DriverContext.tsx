import React, { createContext, useContext, useRef, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { get, onValue, ref, update } from 'firebase/database';
import { database, isFirebaseReady } from '@/lib/firebase';
import { useSafeEffect } from '@/hooks/useSafeEffect';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
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
import { writeClosedJob } from '@/lib/closedJobs';
import { completeJobPayment } from '@/lib/dispatchApi';
import { calcMeterFare, isTariffConfigured, NO_TARIFF_CONFIGURED } from '@/lib/tariffs';
import { PaymentExtras } from '@/types';
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
  startHail: () => void;
  endHail: () => void;
  pauseMeter: () => void;
  toggleWaitMeter: () => void;
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
  return Object.values(rec).filter(
    (x): x is Record<string, unknown> =>
      !!x && typeof x === 'object' && !Array.isArray(x) && isOfferPayload(x),
  );
}

function parseJobOffer(val: Record<string, unknown>): JobOffer {
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
    notes: val.notes ? String(val.notes) : undefined,
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

const EMPTY_METER: MeterState = {
  running: false,
  paused: false,
  waiting: false,
  startedAt: 0,
  pausedMs: 0,
  waitingMs: 0,
  distanceKm: 0,
  fare: 0,
};

export function DriverProvider({ children }: { children: ReactNode }) {
  const { driver } = useAuth();
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
  const meterTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    void (async () => {
      try {
        const v = await getData<string>(STORAGE_KEYS.selectedVehicle);
        if (v) setSelectedVehicleIdState(v);
        const j = await getData<ActiveJob>(STORAGE_KEYS.activeJob);
        if (j) setActiveJob(j);
        // Do not restore shift as "online" on launch — driver must confirm vehicle each session.
        await storeData(STORAGE_KEYS.shiftActive, false);
        const m = await getData<MeterState>(STORAGE_KEYS.meterState);
        if (m?.running) {
          setMeter(m);
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
  const activeVehicleBodyType = activeVehicle?.bodyType ?? '—';

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
      const zoneRef = ref(database, `online/${driver.companyId}/${selectedVehicleId}/zone`);
      return onValue(zoneRef, (snap) => {
        try {
          if (snap.exists()) {
            setZone(parseZoneNode(snap.val()));
            return;
          }
          get(ref(database, `online/${driver.companyId}/${selectedVehicleId}/current`))
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
      const presenceRef = ref(database, `online/${driver.companyId}/${selectedVehicleId}/current`);
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
    shiftActive && readyForJobs && presenceStatus === 'Online';
  const offersBadgeCount = shiftActive ? pendingOffers.length : 0;
  const nextQueuedOffer = canReceiveJobOffers ? (queuedOffers[0] ?? null) : null;

  useSafeEffect(() => {
    if (canReceiveJobOffers) return;
    setJobOffer(null);
    setQueuedOffers([]);
    lastOfferSeenRef.current = null;
  }, [canReceiveJobOffers], 'Driver-clearOffersWhenOffline');

  const flushQueuedOffer = () => {
    let promoted: QueuedOffer | null = null;
    setQueuedOffers((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      promoted = next ?? null;
      return rest;
    });
    if (promoted) {
      console.log('[Driver] flushQueuedOffer → show', promoted.id);
      setJobOffer({ ...promoted, silent: false });
    }
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
    if (!shiftActiveRef.current || !readyForJobsRef.current) return;

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
      const offerRef = ref(database, `jobOffers/${driver.companyId}/${driver.id}`);
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
      const notifyRef = ref(database, `notification/${driver.id}`);
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

  const setSelectedVehicleId = async (id: string) => {
    const normalized = id.trim().toUpperCase();
    setSelectedVehicleIdState(normalized);
    await storeData(STORAGE_KEYS.selectedVehicle, normalized);
    if (driver?.companyId && driver.uid) {
      update(ref(database, `drivers/${driver.companyId}/${driver.uid}`), {
        vehicleId: normalized,
      }).catch(() => undefined);
    }
  };

  const resolveVehicleId = async (override?: string): Promise<string> => {
    let vehicleId = (override ?? selectedVehicleId ?? driver?.vehicleId ?? '').trim().toUpperCase();
    if (!vehicleId && driver?.companyId && driver.uid) {
      try {
        const snap = await get(ref(database, `drivers/${driver.companyId}/${driver.uid}`));
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
        const snap = await get(ref(database, `online/${driver.companyId}/${vehicleId}/current`));
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
      startShiftClock()
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
      update(ref(database, `vehicles/${driver.companyId}/${vehicleId}`), {
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
    endHailInternal();

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
    const { endShiftClock } = await import('@/services/nztaService');
    await endShiftClock();
    const { stopBackgroundTracking } = await import('@/services/locationService');
    await stopBackgroundTracking();
  };

  const acceptOffer = async () => {
    if (!jobOffer || !driver) return;
    try {
      await acceptJobOffer(jobOffer.id, driver.id);
    } catch {
      await enqueueOfflineItem({ type: 'job_update', payload: { action: 'accept', jobId: jobOffer.id } });
    }
    const job: ActiveJob = {
      ...jobOffer,
      stage: 'pickup',
      startedAt: Date.now(),
      distanceKm: 0,
      durationMin: 0,
      fare: jobOffer.fixedFare ?? 0,
    };
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

    const job: ActiveJob = {
      ...offer,
      stage: 'pickup',
      startedAt: Date.now(),
      distanceKm: 0,
      durationMin: 0,
      fare: offer.fixedFare ?? offer.estimatedFare ?? 0,
    };
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

  const advanceStage = async () => {
    if (!activeJob) return;
    const order: JobStage[] = ['pickup', 'arrived', 'onboard', 'complete'];
    const idx = order.indexOf(activeJob.stage);
    const nextStage = order[Math.min(idx + 1, order.length - 1)];
    const updated = { ...activeJob, stage: nextStage };
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
    setPaymentJob(activeJob.stage === 'complete' ? activeJob : { ...activeJob, stage: 'complete' });
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
    };

    try {
      await writeClosedJob(driver.companyId, driver.id, closed, paymentType, extras, totalFare);
    } catch (err) {
      console.warn('[Driver] writeClosedJob failed:', err);
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

    const done: CompletedJob = { ...closed, completedAt: Date.now() };
    setCompletedJobs((prev) => [done, ...prev]);
    setActiveJob(null);
    setPaymentJob(null);
    activeJobIdRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
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

  const cancelActiveJob = async () => {
    setActiveJob(null);
    activeJobIdRef.current = null;
    await storeData(STORAGE_KEYS.activeJob, null);
    if (driver && shiftActive) {
      const vehicleId = await resolveVehicleId();
      if (vehicleId) writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
    }
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
    if (meterTickRef.current) clearInterval(meterTickRef.current);
    if (waitTickRef.current) clearInterval(waitTickRef.current);
    meterTickRef.current = null;
    waitTickRef.current = null;
  };

  const endHailInternal = () => {
    stopMeterTimers();
    setHailActive(false);
    hailActiveRef.current = false;
    setMeter(null);
    storeData(STORAGE_KEYS.meterState, null).catch(() => undefined);
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
    const m: MeterState = {
      running: true,
      paused: false,
      waiting: false,
      startedAt: Date.now(),
      pausedMs: 0,
      waitingMs: 0,
      distanceKm: 0,
      fare: selectedTariff.flagFall,
    };
    setMeter(m);
    setHailActive(true);
    hailActiveRef.current = true;
    storeData(STORAGE_KEYS.meterState, m).catch(() => undefined);

    stopMeterTimers();
    meterTickRef.current = setInterval(() => {
      setMeter((prev) => {
        if (!prev?.running || prev.paused) return prev;
        const km = prev.distanceKm + 0.008;
        const waitMin = prev.waitingMs / 60000;
        const fare = calcMeterFare(selectedTariff, km, waitMin);
        const next = { ...prev, distanceKm: km, fare };
        storeData(STORAGE_KEYS.meterState, next).catch(() => undefined);
        return next;
      });
    }, 3000);
  };

  const endHail = () => {
    endHailInternal();
    if (queuedOffers.length > 0) flushQueuedOffer();
  };

  const pauseMeter = () => {
    setMeter((prev) => {
      if (!prev) return prev;
      const next = { ...prev, paused: !prev.paused };
      storeData(STORAGE_KEYS.meterState, next).catch(() => undefined);
      return next;
    });
  };

  const toggleWaitMeter = () => {
    setMeter((prev) => {
      if (!prev) return prev;
      const waiting = !prev.waiting;
      if (waiting) {
        waitTickRef.current = setInterval(() => {
          setMeter((m) => {
            if (!m?.waiting) return m;
            const next = { ...m, waitingMs: m.waitingMs + 1000 };
            const fare = calcMeterFare(selectedTariff, next.distanceKm, next.waitingMs / 60000);
            return { ...next, fare };
          });
        }, 1000);
      } else if (waitTickRef.current) {
        clearInterval(waitTickRef.current);
        waitTickRef.current = null;
      }
      return { ...prev, waiting };
    });
  };

  const setSelectedTariff = (t: Tariff) => {
    setSelectedTariffState(t);
    storeData(STORAGE_KEYS.selectedTariffId, t.id).catch(() => undefined);
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
        togglePresence,
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
        endHail,
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
