import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onValue, ref } from 'firebase/database';
import { database } from '@/lib/firebase';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { acceptJobOffer, declineJobOffer } from '@/lib/dispatchApi';
import { enqueueOfflineItem, flushOfflineQueue, subscribeConnectivity } from '@/services/offlineService';
import { notifyJobOffer } from '@/services/notificationService';
import { ActiveJob, CompletedJob, JobOffer, JobStage, PaymentType, ZoneInfo } from '@/types';
import { useAuth } from '@/context/AuthContext';

interface DriverContextValue {
  online: boolean;
  shiftActive: boolean;
  selectedVehicleId: string;
  zone: ZoneInfo;
  jobOffer: JobOffer | null;
  activeJob: ActiveJob | null;
  completedJobs: CompletedJob[];
  isOffline: boolean;
  setSelectedVehicleId: (id: string) => void;
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
  const [online, setOnline] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [selectedVehicleId, setSelectedVehicleIdState] = useState('');
  const [zone, setZone] = useState<ZoneInfo>(DEFAULT_ZONE);
  const [jobOffer, setJobOffer] = useState<JobOffer | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [completedJobs, setCompletedJobs] = useState<CompletedJob[]>([]);
  const [isOffline, setIsOffline] = useState(false);

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
    setSelectedVehicleIdState(id);
    await storeData(STORAGE_KEYS.selectedVehicle, id);
  };

  const startShift = async () => {
    setShiftActive(true);
    const { startShiftClock } = await import('@/services/nztaService');
    await startShiftClock();
  };

  const endShift = async () => {
    setShiftActive(false);
    setOnline(false);
    const { endShiftClock } = await import('@/services/nztaService');
    await endShiftClock();
    if (driver) {
      const { stopBackgroundTracking } = await import('@/services/locationService');
      await stopBackgroundTracking(driver.id, driver.companyId);
    }
  };

  const goOnline = async () => {
    if (!driver || !selectedVehicleId) throw new Error('Select a vehicle first');
    setOnline(true);
    const { startBackgroundTracking } = await import('@/services/locationService');
    await startBackgroundTracking(driver.id, driver.companyId);
  };

  const goOffline = async () => {
    setOnline(false);
    if (driver) {
      const { stopBackgroundTracking } = await import('@/services/locationService');
      await stopBackgroundTracking(driver.id, driver.companyId);
    }
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
        online,
        shiftActive,
        selectedVehicleId,
        zone,
        jobOffer,
        activeJob,
        completedJobs,
        isOffline,
        setSelectedVehicleId,
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
