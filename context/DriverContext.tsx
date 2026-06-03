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
import { acceptJobOffer, declineJobOffer, notifyServiceOn } from '@/lib/dispatchApi';
import { tickWorkedMinutes } from '@/services/nztaService';
import { enqueueOfflineItem, flushOfflineQueue, subscribeConnectivity } from '@/services/offlineService';
import { notifyJobOffer } from '@/services/notificationService';
import {
  clearOnlinePresence,
  mapVehicleStatusToDisplay,
  writeOnlinePresence,
} from '@/services/presenceService';
import { calcMeterFare, DEFAULT_TARIFFS } from '@/lib/tariffs';
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
  activeJob: ActiveJob | null;
  hailActive: boolean;
  meter: MeterState | null;
  tariffs: Tariff[];
  selectedTariff: Tariff;
  queuedOffers: QueuedOffer[];
  offersBadgeCount: number;
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
  pushDemoOffer: () => void;
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

function parseJobOffer(val: Record<string, unknown>): JobOffer {
  return {
    id: String(val.id ?? val.jobId ?? Date.now()),
    type: (val.type as JobOffer['type']) ?? 'Taxi',
    pickup: String(val.pickup ?? val.from ?? ''),
    dropoff: String(val.dropoff ?? val.to ?? ''),
    passengerName: val.passengerName ? String(val.passengerName) : undefined,
    passengerPhone: val.passengerPhone ? String(val.passengerPhone) : undefined,
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
  };
}

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
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [completedJobs, setCompletedJobs] = useState<CompletedJob[]>([]);
  const [jobHistory, setJobHistory] = useState<HistoryJob[]>([]);
  const [jobHistoryLoading, setJobHistoryLoading] = useState(false);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [hailActive, setHailActive] = useState(false);
  const [meter, setMeter] = useState<MeterState | null>(null);
  const [tariffs] = useState<Tariff[]>(DEFAULT_TARIFFS);
  const [selectedTariff, setSelectedTariffState] = useState<Tariff>(DEFAULT_TARIFFS[0]);
  const [queuedOffers, setQueuedOffers] = useState<QueuedOffer[]>([]);
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
        const shift = await getData<boolean>(STORAGE_KEYS.shiftActive);
        if (shift) {
          setShiftActive(true);
          shiftActiveRef.current = true;
          setReadyForJobs(true);
          readyForJobsRef.current = true;
          setPresenceStatus('Online');
        }
        const tariffId = await getData<string>(STORAGE_KEYS.selectedTariffId);
        const t = DEFAULT_TARIFFS.find((x) => x.id === tariffId);
        if (t) setSelectedTariffState(t);
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
      if (list.length === 1 && !selectedVehicleId) {
        await setSelectedVehicleId(list[0].id);
      } else if (driver.vehicleId && list.some((v) => v.id === driver.vehicleId.toUpperCase())) {
        if (!selectedVehicleId) await setSelectedVehicleId(driver.vehicleId.toUpperCase());
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
    if (!isFirebaseReady || !driver?.companyId || !selectedVehicleId) {
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
  }, [driver?.companyId, selectedVehicleId], 'Driver-zone');

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
            if (readyForJobsRef.current || shiftActiveRef.current) {
              setPresenceStatus('Online');
              return;
            }
            setPresenceStatus('Offline');
            return;
          }
          const data = snap.val() as Record<string, unknown>;
          const rawStatus = String(data.vehiclestatus ?? data.VehicleStatus ?? '');
          const myId = String(driver.id ?? '');
          const nodeDriverId = String(data.driverid ?? '');
          if (nodeDriverId && myId && nodeDriverId !== myId && nodeDriverId !== String(driver.uid)) {
            setPresenceStatus('Offline');
            setReadyForJobs(false);
            return;
          }
          const mapped = mapVehicleStatusToDisplay(rawStatus);
          setPresenceStatus(mapped);
          if (mapped === 'Online' && shiftActiveRef.current) {
            setReadyForJobs(true);
          }
        } catch (err) {
          console.error('[Driver] presence listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] presence subscribe failed', err);
    }
  }, [driver?.companyId, driver?.id, driver?.uid, selectedVehicleId], 'Driver-presence');

  const offersBadgeCount = queuedOffers.length;

  const flushQueuedOffer = () => {
    setQueuedOffers((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      setJobOffer({ ...next, silent: false });
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
    const offer = parseJobOffer(val);
    const seen = lastOfferSeenRef.current;
    if (seen?.id === offer.id && Date.now() - seen.at < 2500) return;
    lastOfferSeenRef.current = { id: offer.id, at: Date.now() };

    const onHail = hailActiveRef.current;
    const onJob = !!activeJobIdRef.current;
    const onboard = activeJob?.stage === 'onboard';

    if (onHail || (onJob && !onboard && activeJob?.type === 'Taxi')) {
      enqueueOffer(offer);
      await notifyJobOffer('Queued offer', `${offer.type} waiting in queue`);
      return;
    }

    if (onJob && onboard) {
      enqueueOffer(offer);
      return;
    }

    setJobOffer(offer);
    await notifyJobOffer('New Job Offer', `${offer.type}: ${offer.pickup}`);
  };

  useSafeEffect(() => {
    if (!isFirebaseReady || !driver?.companyId || !driver.id) return;
    try {
      const offerRef = ref(database, `jobOffers/${driver.companyId}/${driver.id}`);
      return onValue(offerRef, async (snap) => {
        try {
          const val = snap.val();
          if (!val || typeof val !== 'object') return;
          if (val.editNotice && activeJobIdRef.current === String(val.jobId ?? val.id)) {
            setJobEditNotice(String(val.editNotice));
          }
          if (val.removed || val.declined) return;
          await handleIncomingOffer(val as Record<string, unknown>);
        } catch (err) {
          console.error('[Driver] job offer listener', err);
        }
      });
    } catch (err) {
      console.error('[Driver] job offer subscribe failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, driver?.id, activeJob?.stage], 'Driver-jobOffers');

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

    const vehicleId = await resolveVehicleId(vehicleIdOverride);
    if (!vehicleId) {
      Alert.alert('Vehicle required', 'Select a vehicle to start your shift.');
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
    setReadyForJobs(true);
    readyForJobsRef.current = true;
    setPresenceStatus('Online');
    await storeData(STORAGE_KEYS.shiftActive, true);
    const { startShiftClock } = await import('@/services/nztaService');
    await startShiftClock();

    try {
      await writeOnlinePresence(driver, vehicleId, 'Available', true);
      setPresenceStatus('Online');
      setReadyForJobs(true);
    } catch (err) {
      console.warn('[Shift] Firebase presence write failed:', err);
      Alert.alert('Connection issue', 'Could not register with dispatch. Check your network and try again.');
      setShiftActive(false);
      shiftActiveRef.current = false;
      await storeData(STORAGE_KEYS.shiftActive, false);
      return;
    }

    const now = new Date();
    notifyServiceOn({
      driverId: driver.id,
      companyId: driver.companyId,
      vehicleId,
      logInDate: fmtNzDate(now),
      logInTime: fmtNzTime(now),
      userKey: driver.passforlink,
    }).catch((err) => console.warn('[Shift] FnServiceON failed (non-blocking):', err));

    const { startBackgroundTracking } = await import('@/services/locationService');
    const trackingStarted = await startBackgroundTracking(driver.id, driver.companyId, vehicleId);
    if (!trackingStarted) {
      Alert.alert(
        'Location optional',
        'You are online and ready for jobs. Enable location when prompted so dispatch can see your position on the map.',
      );
    }

    if (driver.companyId) {
      update(ref(database, `vehicles/${driver.companyId}/${vehicleId}`), {
        currentDriverId: driver.id,
      }).catch(() => undefined);
    }
  };

  const togglePresence = async () => {
    if (!driver || !shiftActive) return;
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) return;
    if (presenceStatus === 'Online') {
      await writeOnlinePresence(driver, vehicleId, 'Away');
      setPresenceStatus('Away');
      setReadyForJobs(false);
      readyForJobsRef.current = false;
    } else {
      await writeOnlinePresence(driver, vehicleId, 'Available');
      setPresenceStatus('Online');
      setReadyForJobs(true);
      readyForJobsRef.current = true;
    }
  };

  const endShift = async () => {
    const vehicleId = await resolveVehicleId();
    setShiftActive(false);
    shiftActiveRef.current = false;
    await storeData(STORAGE_KEYS.shiftActive, false);
    setReadyForJobs(false);
    readyForJobsRef.current = false;
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
  };

  const setPaymentType = (payment: PaymentType) => {
    if (!activeJob) return;
    const updated = { ...activeJob, paymentType: payment };
    setActiveJob(updated);
    storeData(STORAGE_KEYS.activeJob, updated);
  };

  const completeJob = async () => {
    if (!activeJob) return;
    const done: CompletedJob = { ...activeJob, stage: 'complete', completedAt: Date.now() };
    setCompletedJobs((prev) => [done, ...prev]);
    setActiveJob(null);
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

  const pushDemoOffer = () => {
    setJobOffer({
      id: `demo-${Date.now()}`,
      type: 'Taxi',
      pickup: '123 Dee Street, Invercargill',
      dropoff: 'Invercargill Airport',
      passengerName: 'Demo Passenger',
      passengerPhone: '021 000 0000',
      estimatedFare: 28.5,
      estimatedDistanceKm: 8.2,
      paymentType: 'Cash',
      source: 'Dispatch',
      dispatcherName: 'Demo Dispatch',
      expiresAt: Date.now() + 45000,
    });
  };

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
        activeJob,
        hailActive,
        meter,
        tariffs,
        selectedTariff,
        queuedOffers,
        offersBadgeCount,
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
        pushDemoOffer,
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
