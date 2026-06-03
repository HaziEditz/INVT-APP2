import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { get, onValue, ref, update } from 'firebase/database';
import { database } from '@/lib/firebase';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { loadDriverVehicles } from '@/lib/vehicles';
import { acceptJobOffer, declineJobOffer } from '@/lib/dispatchApi';
import { enqueueOfflineItem, flushOfflineQueue, subscribeConnectivity } from '@/services/offlineService';
import { notifyJobOffer } from '@/services/notificationService';
import {
  clearOnlinePresence,
  mapVehicleStatusToDisplay,
  writeOnlinePresence,
} from '@/services/presenceService';
import { ActiveJob, CompletedJob, JobOffer, JobStage, PaymentType, PresenceDisplayStatus, Vehicle, ZoneInfo } from '@/types';
import { useAuth } from '@/context/AuthContext';

interface DriverContextValue {
  presenceStatus: PresenceDisplayStatus;
  shiftActive: boolean;
  selectedVehicleId: string;
  vehicles: Vehicle[];
  vehiclesLoading: boolean;
  zone: ZoneInfo;
  jobOffer: JobOffer | null;
  activeJob: ActiveJob | null;
  completedJobs: CompletedJob[];
  isOffline: boolean;
  setSelectedVehicleId: (id: string) => void;
  refreshVehicles: () => Promise<void>;
  startShift: () => Promise<void>;
  endShift: () => Promise<void>;
  goOnline: () => Promise<void>;
  goOffline: () => Promise<void>;
  acceptOffer: () => Promise<void>;
  declineOffer: () => Promise<void>;
  advanceStage: () => Promise<void>;
  setPaymentType: (payment: PaymentType) => void;
  completeJob: () => Promise<void>;
  pushDemoOffer: () => void;
}

const DriverContext = createContext<DriverContextValue | null>(null);

const DEFAULT_ZONE: ZoneInfo = {
  name: 'City Centre',
  position: 0,
  totalInQueue: 0,
  nearbyDrivers: 0,
};

export function DriverProvider({ children }: { children: ReactNode }) {
  const { driver } = useAuth();
  const [presenceStatus, setPresenceStatus] = useState<PresenceDisplayStatus>('Offline');
  const [shiftActive, setShiftActive] = useState(false);
  const [selectedVehicleId, setSelectedVehicleIdState] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [zone, setZone] = useState<ZoneInfo>(DEFAULT_ZONE);
  const [jobOffer, setJobOffer] = useState<JobOffer | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [completedJobs, setCompletedJobs] = useState<CompletedJob[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const shiftActiveRef = useRef(false);

  useEffect(() => {
    shiftActiveRef.current = shiftActive;
  }, [shiftActive]);

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
    if (!driver?.companyId || !driver.id) return;
    const zoneRef = ref(database, `zones/${driver.companyId}/${driver.id}`);
    return onValue(zoneRef, (snap) => {
      const val = snap.val();
      if (val) {
        setZone({
          name: String(val.name ?? 'Unknown Zone'),
          position: Number(val.position ?? 0),
          totalInQueue: Number(val.totalInQueue ?? 0),
          nearbyDrivers: Number(val.nearbyDrivers ?? 0),
        });
      }
    });
  }, [driver?.companyId, driver?.id]);

  useEffect(() => {
    if (!driver?.companyId || !selectedVehicleId) {
      setPresenceStatus('Offline');
      return;
    }

    const presenceRef = ref(database, `online/${driver.companyId}/${selectedVehicleId}/current`);
    return onValue(presenceRef, (snap) => {
      if (!snap.exists()) {
        setPresenceStatus(shiftActiveRef.current ? 'Away' : 'Offline');
        return;
      }
      const data = snap.val() as Record<string, unknown>;
      const rawStatus = String(data.vehiclestatus ?? data.VehicleStatus ?? '');
      const myId = String(driver.id ?? '');
      const nodeDriverId = String(data.driverid ?? '');
      if (nodeDriverId && myId && nodeDriverId !== myId && nodeDriverId !== String(driver.uid)) {
        setPresenceStatus('Offline');
        return;
      }
      setPresenceStatus(mapVehicleStatusToDisplay(rawStatus));
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

  const resolveVehicleId = async (): Promise<string> => {
    let vehicleId = selectedVehicleId || driver?.vehicleId?.trim().toUpperCase() || '';
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

  const startShift = async () => {
    if (!driver) return;

    const vehicleId = await resolveVehicleId();
    if (!vehicleId) {
      Alert.alert(
        'Vehicle required',
        'Select a vehicle before starting your shift.',
      );
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
      const { startBackgroundTracking } = await import('@/services/locationService');
      await startBackgroundTracking(driver.id, driver.companyId);
    } catch (err) {
      console.warn('[Shift] presence write failed:', err);
      Alert.alert('Shift started', 'Could not register online with dispatch. Check your connection.');
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

    const { endShiftClock } = await import('@/services/nztaService');
    await endShiftClock();
    if (driver) {
      const { stopBackgroundTracking } = await import('@/services/locationService');
      await stopBackgroundTracking(driver.id, driver.companyId);
    }
  };

  const goOnline = async () => {
    if (!driver) throw new Error('Not signed in');
    const vehicleId = await resolveVehicleId();
    if (!vehicleId) throw new Error('Select a vehicle first');
    if (!shiftActive) throw new Error('Start your shift first');

    await writeOnlinePresence(driver, vehicleId, 'Available');
    const { startBackgroundTracking } = await import('@/services/locationService');
    await startBackgroundTracking(driver.id, driver.companyId);
  };

  const goOffline = async () => {
    if (!driver) return;
    const vehicleId = await resolveVehicleId();
    if (vehicleId && shiftActive) {
      await writeOnlinePresence(driver, vehicleId, 'Away');
    } else if (vehicleId) {
      await writeOnlinePresence(driver, vehicleId, 'Offline');
    }
    const { stopBackgroundTracking } = await import('@/services/locationService');
    await stopBackgroundTracking(driver.id, driver.companyId);
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

    if (driver && shiftActive) {
      const vehicleId = await resolveVehicleId();
      if (vehicleId) {
        writeOnlinePresence(driver, vehicleId, 'Available').catch(() => undefined);
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
        shiftActive,
        selectedVehicleId,
        vehicles,
        vehiclesLoading,
        zone,
        jobOffer,
        activeJob,
        completedJobs,
        isOffline,
        setSelectedVehicleId,
        refreshVehicles,
        startShift,
        endShift,
        goOnline,
        goOffline,
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
