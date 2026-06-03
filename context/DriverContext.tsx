import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { get, onValue, ref, update } from 'firebase/database';
import { database } from '@/lib/firebase';
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
import {
  ActiveJob,
  CompanyInfo,
  CompletedJob,
  JobOffer,
  JobStage,
  PaymentType,
  PresenceDisplayStatus,
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
  acceptOffer: () => Promise<void>;
  declineOffer: () => Promise<void>;
  advanceStage: () => Promise<void>;
  setPaymentType: (payment: PaymentType) => void;
  completeJob: () => Promise<void>;
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
  const shiftActiveRef = useRef(false);
  const readyForJobsRef = useRef(false);

  useEffect(() => {
    shiftActiveRef.current = shiftActive;
  }, [shiftActive]);

  useEffect(() => {
    readyForJobsRef.current = readyForJobs;
  }, [readyForJobs]);

  useEffect(() => {
    getData<string>(STORAGE_KEYS.selectedVehicle).then((v) => v && setSelectedVehicleIdState(v));
    getData<ActiveJob>(STORAGE_KEYS.activeJob).then((j) => j && setActiveJob(j));
  }, []);

  useEffect(() => {
    const unsub = subscribeConnectivity(async (connected) => {
      setIsOffline(!connected);
      if (connected) await flushOfflineQueue();
    });
    return unsub;
  }, []);

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

  useEffect(() => {
    refreshVehicles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.uid, driver?.companyId, driver?.id, driver?.vehicleId]);

  useEffect(() => {
    if (!driver?.companyId) {
      setCompany(null);
      return;
    }
    loadCompanyInfo(driver.companyId, driver.uid).then(setCompany);
  }, [driver?.companyId, driver?.uid]);

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

  useEffect(() => {
    refreshJobHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.companyId, driver?.id]);

  useEffect(() => {
    if (!shiftActive) return;
    const id = setInterval(() => {
      tickWorkedMinutes(1).catch(() => undefined);
    }, 60000);
    return () => clearInterval(id);
  }, [shiftActive]);

  const sessionEarnings = sumBreakdown(completedJobs);
  const historyEarnings = sumBreakdown(
    jobHistory.filter((j) => j.status === 'completed').map((j) => ({ fare: j.fare, paymentType: j.paymentType })),
  );
  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const activeVehicleBodyType = activeVehicle?.bodyType ?? '—';

  useEffect(() => {
    if (!driver?.companyId || !selectedVehicleId) {
      setZone(EMPTY_ZONE);
      return;
    }

    const zoneRef = ref(database, `online/${driver.companyId}/${selectedVehicleId}/zone`);
    return onValue(zoneRef, (snap) => {
      if (snap.exists()) {
        setZone(parseZoneNode(snap.val()));
        return;
      }
      get(ref(database, `online/${driver.companyId}/${selectedVehicleId}/current`)).then((cur) => {
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
      });
    });
  }, [driver?.companyId, selectedVehicleId]);

  useEffect(() => {
    if (!driver?.companyId || !selectedVehicleId) {
      if (!readyForJobsRef.current) setPresenceStatus('Offline');
      return;
    }

    const presenceRef = ref(database, `online/${driver.companyId}/${selectedVehicleId}/current`);
    return onValue(presenceRef, (snap) => {
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
    });
  }, [driver?.companyId, driver?.id, driver?.uid, selectedVehicleId]);

  useEffect(() => {
    if (!driver?.companyId || !driver.id) return;
    const offerRef = ref(database, `jobOffers/${driver.companyId}/${driver.id}`);
    return onValue(offerRef, async (snap) => {
      const val = snap.val();
      if (!val) return;
      const offer: JobOffer = {
        id: String(val.id ?? val.jobId ?? Date.now()),
        type: val.type ?? 'Taxi',
        pickup: String(val.pickup ?? val.from ?? ''),
        dropoff: String(val.dropoff ?? val.to ?? ''),
        passengerName: val.passengerName,
        passengerPhone: val.passengerPhone,
        fixedFare: val.fixedFare,
        paymentType: val.paymentType,
        isAcc: !!val.isAcc,
        isTotalMobility: !!val.isTotalMobility,
        expiresAt: Number(val.expiresAt ?? Date.now() + 30000),
      };
      setJobOffer(offer);
      await notifyJobOffer('New Job Offer', `${offer.type}: ${offer.pickup}`);
    });
  }, [driver?.companyId, driver?.id]);

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

  const endShift = async () => {
    const vehicleId = await resolveVehicleId();
    setShiftActive(false);
    setReadyForJobs(false);

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
    await storeData(STORAGE_KEYS.activeJob, null);
    refreshJobHistory().catch(() => undefined);

    if (driver && shiftActive) {
      const vehicleId = await resolveVehicleId();
      if (vehicleId) {
        writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
        setPresenceStatus('Online');
        setReadyForJobs(true);
      }
    }
  };

  const pushDemoOffer = () => {
    setJobOffer({
      id: `demo-${Date.now()}`,
      type: 'Taxi',
      pickup: '123 Dee Street, Invercargill',
      dropoff: 'Invercargill Airport',
      passengerName: 'Demo Passenger',
      expiresAt: Date.now() + 30000,
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
        acceptOffer,
        declineOffer,
        advanceStage,
        setPaymentType,
        completeJob,
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
