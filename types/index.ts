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
  /** Another driver is currently on shift with this vehicle. */
  inUseByOther?: boolean;
  inUseDriverLabel?: string;
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
  /** Dispatch fixed-price job — meter must stay off. */
  isFixedPrice?: boolean;
  /** Dispatch tariff selection (empty / "0" / Automatic = driver keeps own). */
  tariffId?: string;
  tariffName?: string;
  paymentType?: PaymentType;
  /** Business account Firebase/key id (Account_id / jobAccountId). */
  accountId?: string;
  /** Business account display name (Account_Name / jobAccountName). */
  accountName?: string;
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
  originalStatus?: 'pending' | 'manual';
  /** Why dispatch returned this booking to the pool. */
  returnReason?: string;
  /** Last driver who held the exclusive offer. */
  lastOfferDriverId?: string;
  queuedAt?: number;
  postedAt?: number;
  /** Set when promoted from Queue tab after trip ends. */
  fromQueue?: boolean;
  /** Customer-requested pickup time (unix ms). */
  pickupTimeMs?: number;
  /** When the booking entered the system (unix ms). */
  bookedAtMs?: number;
  /** ASAP vs pre-booked LATER pickup. */
  pickupType?: 'ASAP' | 'LATER';
  /** Who created the booking (CreatedBy / BookingSource detail). */
  createdBy?: string;
  dispatchBeforeMinutes?: number;
  notifyDispatchAt?: string;
  bookingType?: string;
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

export interface TariffChangeRecord {
  tariffId: string;
  tariffName: string;
  at: number;
}

export interface MeterFareBreakdown {
  flagFall: number;
  distanceKm: number;
  distanceCharge: number;
  waitingMinutes: number;
  waitingCharge: number;
  total: number;
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
  tariffChanges: TariffChangeRecord[];
  breakdown: MeterFareBreakdown;
  fare: number;
  /** GPS trail sampled during the trip (for closed-job route map). */
  routePoints?: { lat: number; lng: number; at: number }[];
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
  /** Vehicle type on the assigned vehicle (hail / closed-job snapshot). */
  vehicleType?: string;
  /** Server updateSeq — used for optimistic stage sync retries. */
  updateSeq?: number;
  /** Phase 5b — client UUID for hail create-or-get / offline journal. */
  clientTripId?: string;
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

export type NztaLockoutReason = 'shift_rest' | 'weekly_rest' | null;
export type NztaLimitSignOutReason = 'shift14h' | 'weekly70h';

export interface NztaHoursState {
  shiftStartedAt: number | null;
  shiftWindowEndsAt: number | null;
  /** When this online stint began (may differ from shiftStartedAt under continuedWindow). */
  sessionStartedAt: number | null;
  workedMinutes: number;
  weeklyWorkedMinutes: number;
  /** Monday 00:00 local ms for the active weekly bucket */
  weekStartedAt: number | null;
  breakMinutes: number;
  lastBreakAt: number | null;
  breakReminderShown: boolean;
  breakDeferredUntil: number | null;
  lastShiftEndAt: number | null;
  /** Prior shift start — used to resume the same 14h clock after a short rest */
  lastShiftStartAt: number | null;
  lastWorkedMinutes: number;
  continuedWindow: boolean;
  /** Hard lockout after 14h or 70h auto sign-out */
  lockoutUntil: number | null;
  lockoutReason: NztaLockoutReason;
  /** Limit hit while on a job — sign out when Free */
  pendingLimitSignOut: NztaLimitSignOutReason | null;
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

/** Phase 5c–5e offline trip journal event types. */
export type TripJournalEventType =
  | 'HailCreate'
  | 'Arrived'
  | 'OnBoard'
  | 'MeterOn'
  | 'Completed'
  | 'Cancelled'
  | 'NoShow';

export type TripJournalSyncState = 'pending' | 'creating' | 'synced' | 'failed';

export interface TripJournalEvent {
  id: string;
  type: TripJournalEventType;
  at: number;
  isoTimestamp: string;
  payload?: Record<string, unknown>;
  synced?: boolean;
}

export interface TripJournalHailCreate {
  tariffId: string;
  pickup: { address: string; lat?: number; lng?: number };
  startedAt: number;
}

/** Persistent offline trip record keyed by clientTripId. */
export interface TripJournal {
  clientTripId: string;
  localJobId: string;
  serverJobId?: string;
  companyId: string;
  driverId: string;
  vehicleId: string;
  source: 'hail' | 'dispatch';
  syncState: TripJournalSyncState;
  createdAt: number;
  updatedAt: number;
  hailCreate?: TripJournalHailCreate;
  events: TripJournalEvent[];
  lastError?: string;
}

export interface CompanyInfo {
  id: string;
  name: string;
}

export const STAGE_LABELS: Record<JobStage, string> = {
  pickup: 'Accepted',
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
  hoistCount?: number;
  hoistCost?: number;
  /** EFTPOS transaction reference (optional). */
  eftposRef?: string;
  /** ACC claim number. */
  accClaimNo?: string;
  /** ACC purchase order number. */
  accPoNo?: string;
}

/** Per-passenger hoist use (1× council rate each), Phase 2A.2. */
export interface TmHoistEntryDetails {
  cardNumber: string;
  cardExpiry?: string;
  /** Cardholder / passenger name for council trip Client field. */
  cardName?: string;
  amount: number;
}

export interface TmPaymentDetails {
  /** Driver UI grand total (meter subsidy + hoist). Claim persist uses tmSubsidyFare instead. */
  councilPays: number;
  /** Passenger collect amount (meter share only; hoist is never passenger-paid). */
  passengerPays: number;
  /** Meter + extras only (no hoist) — base for %/cap split. */
  meterFare?: number;
  /** Meter %/cap subsidy only — written to tmSubsidy / tmCouncilPays on persist. */
  tmSubsidyFare?: number;
  /** Hoist fee — 100% council. */
  hoistTotal?: number;
  tmSubsidyHoist?: number;
  hoistCount?: number;
  /** One entry per hoist use / wheelchair passenger card. */
  tmHoists?: TmHoistEntryDetails[];
  tmCardNumber?: string;
  tmCardName?: string;
  tmCardExpiry?: string;
  /** Grand total (meter + hoist). */
  totalFare: number;
  /** Council id for claims (from company tmConfig.sourceCouncilId or card). */
  councilId?: string;
}

export const TM_PASSENGER_PAYMENT_TYPES = [
  'Cash',
  'Card',
  'EFTPOS',
  'Account',
  'ACC',
] as const;

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
