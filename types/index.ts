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
  /** Single display type from Firebase (not combined). */
  displayType: string;
  vehicleType: string;
  bodyType: string;
  label: string;
  plate: string;
  seatCapacity: number;
  hasFoodService: boolean;
  hasFreightService: boolean;
  isWav: boolean;
}

export type MainPanelTab = 'offers' | 'current' | 'queue';

export type PresenceDisplayStatus = 'Online' | 'Offline' | 'Away';

export interface JobNoteLine {
  label: string;
  text: string;
}

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
  /** All note/instruction lines from dispatch, passenger, website, etc. */
  allNotes?: JobNoteLine[];
  dispatcherName?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  silent?: boolean;
  vehicleTypeRequired?: string;
  passengers?: number;
  serviceTypeRaw?: string;
}

export interface QueuedOffer extends JobOffer {
  queuedAt: number;
}

export interface JobStepTimes {
  acceptedAt?: number;
  onWayAt?: number;
  arrivedAt?: number;
  onboardAt?: number;
  completeAt?: number;
  hailStartedAt?: number;
  hailEndedAt?: number;
}

export interface TariffSnapshot {
  id: string;
  name: string;
  flagFall: number;
  ratePerKm: number;
  waitingPerMin: number;
}

export interface TariffChangeRecord {
  tariffId: string;
  tariffName: string;
  at: number;
  distanceKmAtChange: number;
  waitingMsAtChange: number;
  previousTariffId: string;
  previousTariffName: string;
  previousFlagFall: number;
  previousRatePerKm: number;
  previousWaitingPerMin: number;
  newRatePerKm: number;
  newWaitingPerMin: number;
}

export interface TariffSegmentBreakdown {
  tariffName: string;
  changedAt?: number;
  distanceKm: number;
  waitingMinutes: number;
  ratePerKm: number;
  waitingPerMin: number;
  distanceCharge: number;
  waitingCharge: number;
  rideSubtotal: number;
}

export interface MeterFareBreakdown {
  flagFall: number;
  distanceKm: number;
  distanceCharge: number;
  waitingMinutes: number;
  waitingCharge: number;
  total: number;
  segments?: TariffSegmentBreakdown[];
}

export type MeterMode = 'moving' | 'waiting';

export interface MeterState {
  running: boolean;
  paused: boolean;
  mode: MeterMode;
  startedAt: number;
  finishedAt?: number;
  pausedMs: number;
  pauseAccumulatedAt?: number;
  movingMs: number;
  waitingMs: number;
  distanceKm: number;
  lastLat?: number;
  lastLng?: number;
  pauseAnchorLat?: number;
  pauseAnchorLng?: number;
  tariffId: string;
  tariffName: string;
  startTariff: TariffSnapshot;
  tariffChanges: TariffChangeRecord[];
  breakdown: MeterFareBreakdown;
  fare: number;
}

export interface ActiveJob extends JobOffer {
  stage: JobStage;
  startedAt: number;
  distanceKm: number;
  durationMin: number;
  fare: number;
  stepTimes: JobStepTimes;
  tariffChanges: TariffChangeRecord[];
  meterSnapshot?: MeterState | null;
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
  nightEnabled?: boolean;
  nightStart?: string;
  nightEnd?: string;
  nightFlagFall?: number;
  nightRatePerKm?: number;
  nightWaitingPerMin?: number;
  weekendEnabled?: boolean;
  weekendMultiplier?: number;
  holidayEnabled?: boolean;
  holidayMultiplier?: number;
}

export interface NztaHoursState {
  shiftStartedAt: number | null;
  shiftWindowEndsAt: number | null;
  workedMinutes: number;
  weeklyWorkedMinutes: number;
  breakMinutes: number;
  lastBreakAt: number | null;
  breakReminderShown: boolean;
  breakDeferredUntil: number | null;
  lastShiftEndAt: number | null;
  continuedWindow: boolean;
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
  'ACC',
  'Gift Card',
  'TM',
] as const;

export type DriverPaymentType = (typeof DRIVER_PAYMENT_TYPES)[number];

export interface PaymentRecord {
  paymentType: string;
  amount: number;
  cardNumber?: string;
  cardExpiry?: string;
  cardCvc?: string;
  eftposRef?: string;
  accountNumber?: string;
  accClaimNumber?: string;
  accPurchaseOrder?: string;
  giftCardNumber?: string;
  tmCardNumber?: string;
  tmCardName?: string;
  tmCardExpiry?: string;
  tmCouncilSubsidyPercent?: number;
  tmCouncilCapAmount?: number;
  tmCouncilFarePays?: number;
  tmCouncilPays?: number;
  tmPassengerPays?: number;
  tmHoistCount?: number;
  tmHoistCostPerUnit?: number;
  tmHoistTotal?: number;
  tmPassengerPaymentType?: string;
  tmPassengerCardNumber?: string;
  tmPassengerCardExpiry?: string;
  tmPassengerCardCvc?: string;
  tmPassengerEftposRef?: string;
  tmPassengerAccountNumber?: string;
  tmPassengerAccClaimNumber?: string;
  tmPassengerAccPurchaseOrder?: string;
}

export interface PaymentExtras {
  bikeCarry: number;
  airportFee: number;
  eftposSurcharge: number;
  tolls: number;
  other: number;
  otherNote: string;
  /** Aliases accepted when normalizing from legacy payloads */
  eftposFee?: number;
  bikeFee?: number;
  otherAmount?: number;
}

export function normalizePaymentExtras(extras: Partial<PaymentExtras>): PaymentExtras {
  return {
    eftposSurcharge: extras.eftposSurcharge ?? extras.eftposFee ?? 0,
    airportFee: extras.airportFee ?? 0,
    bikeCarry: extras.bikeCarry ?? extras.bikeFee ?? 0,
    tolls: extras.tolls ?? 0,
    other: extras.other ?? extras.otherAmount ?? 0,
    otherNote: extras.otherNote ?? '',
  };
}

/** Shape stored on closedJobs — all fields always defined. */
export function extrasForFirebase(extras: Partial<PaymentExtras>) {
  const normalized = normalizePaymentExtras(extras);
  return {
    eftposFee: normalized.eftposSurcharge,
    airportFee: normalized.airportFee,
    bikeFee: normalized.bikeCarry,
    otherAmount: normalized.other,
    otherNote: normalized.otherNote,
    tolls: normalized.tolls,
  };
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
