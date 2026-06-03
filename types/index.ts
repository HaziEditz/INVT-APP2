import { JOB_STAGES, JOB_TYPES, PAYMENT_TYPES } from '@/constants/theme';

export type JobType = (typeof JOB_TYPES)[number];
export type JobStage = (typeof JOB_STAGES)[number];
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export interface DriverProfile {
  uid: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  companyId: string;
  vehicleId: string;
  driverType: JobType | 'Multi';
}

export interface Vehicle {
  id: string;
  label: string;
  plate: string;
}

export type PresenceDisplayStatus = 'Online' | 'Offline' | 'Away';

export interface JobOffer {
  id: string;
  type: JobType;
  pickup: string;
  dropoff: string;
  passengerName?: string;
  passengerPhone?: string;
  fixedFare?: number;
  paymentType?: PaymentType;
  isAcc?: boolean;
  isTotalMobility?: boolean;
  expiresAt: number;
}

export interface ActiveJob extends JobOffer {
  stage: JobStage;
  startedAt: number;
  distanceKm: number;
  durationMin: number;
  fare: number;
}

export interface CompletedJob extends ActiveJob {
  completedAt: number;
}

export interface ChatMessage {
  id: string;
  sender: 'driver' | 'dispatcher';
  text: string;
  timestamp: number;
}

export interface ZoneInfo {
  name: string;
  position: number;
  totalInQueue: number;
  nearbyDrivers: number;
}

export interface PreBookingDraft {
  passengerName: string;
  passengerPhone: string;
  pickup: string;
  dropoff: string;
  scheduledAt: string;
  notes: string;
}

export interface OfflineQueueItem {
  id: string;
  type: 'job_update' | 'location' | 'chat';
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface NztaHoursState {
  shiftStartedAt: number | null;
  workedMinutes: number;
  lastBreakAt: number | null;
  breakReminderShown: boolean;
}
