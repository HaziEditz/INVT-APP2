import { JOB_STAGES, JOB_TYPES, PAYMENT_TYPES } from '@/constants/theme';

export type JobType = (typeof JOB_TYPES)[number];
export type JobStage = (typeof JOB_STAGES)[number];
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export type HomeMode = 'offline' | 'waiting' | 'dispatch' | 'hail' | 'payment';

export interface DriverProfile {
  uid: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  companyId: string;
  vehicleId: string;
  driverType: JobType | 'Multi';
  passforlink?: string;
}

export interface Vehicle {
  id: string;
  number: string;
  vehicleType: string;
  bodyType: string;
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
  passengerEmail?: string;
  fixedFare?: number;
  estimatedFare?: number;
  estimatedDistanceKm?: number;
  paymentType?: PaymentType;
  isAcc?: boolean;
  isTotalMobility?: boolean;
  expiresAt: number;
  source?: string;
  notes?: string;
  dispatcherName?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  silent?: boolean;
}

export interface QueuedOffer extends JobOffer {
  queuedAt: number;
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

export interface Tariff {
  id: string;
  name: string;
  flagFall: number;
  ratePerKm: number;
  waitingPerMin: number;
}

export interface MeterState {
  running: boolean;
  paused: boolean;
  waiting: boolean;
  startedAt: number;
  pausedMs: number;
  waitingMs: number;
  distanceKm: number;
  fare: number;
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
  breakMinutes: number;
  lastBreakAt: number | null;
  breakReminderShown: boolean;
  breakDeferredUntil: number | null;
}

export interface CompanyInfo {
  id: string;
  name: string;
}

export const STAGE_LABELS: Record<JobStage, string> = {
  pickup: 'On Way',
  arrived: 'Arrived',
  onboard: 'On Board',
  complete: 'Complete',
};

export const DRIVER_PAYMENT_TYPES = [
  'Cash',
  'Card',
  'EFTPOS',
  'Account',
  'TM',
  'ACC',
] as const;

export type DriverPaymentType = (typeof DRIVER_PAYMENT_TYPES)[number];

export interface PaymentExtras {
  bikeCarry: number;
  airportFee: number;
  eftposSurcharge: number;
  tolls: number;
  other: number;
  otherNote?: string;
}

export interface PreBookingForm {
  passengerName: string;
  passengerPhone: string;
  passengerEmail: string;
  pickup: string;
  dropoff: string;
  scheduledAt: string;
  paymentType: string;
  vehicleType: string;
  notes: string;
}
