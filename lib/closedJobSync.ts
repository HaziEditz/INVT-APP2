import { firstNonEmptyString } from './jobAddressFields.ts';
import type { ActiveJob, PaymentExtras, TmPaymentDetails } from '../types/index.ts';

/** Flatten stepTimes into Closed Jobs timeline top-level keys. */
export function stepTimesToClosedMirrors(
  stepTimes: ActiveJob['stepTimes'] | undefined,
): Record<string, unknown> {
  if (!stepTimes || typeof stepTimes !== 'object') return {};
  const out: Record<string, unknown> = {};
  if (stepTimes.acceptedAt != null) {
    out.DriverAcceptedAt = new Date(stepTimes.acceptedAt).toISOString();
    out.driverAcceptedAt = stepTimes.acceptedAt;
  }
  if (stepTimes.onWayAt != null) {
    out.OnTheWayAt = new Date(stepTimes.onWayAt).toISOString();
    out.onTheWayAt = stepTimes.onWayAt;
  }
  if (stepTimes.arrivedAt != null) {
    out.ArrivedAt = new Date(stepTimes.arrivedAt).toISOString();
    out.arrivedAt = stepTimes.arrivedAt;
  }
  if (stepTimes.onboardAt != null || stepTimes.hailStartedAt != null) {
    const onboard = stepTimes.onboardAt ?? stepTimes.hailStartedAt!;
    out.OnBoardAt = new Date(onboard).toISOString();
    out.onBoardAt = onboard;
    out.ActiveAt = out.OnBoardAt;
  }
  if (stepTimes.completeAt != null || stepTimes.hailEndedAt != null) {
    const done = stepTimes.completeAt ?? stepTimes.hailEndedAt!;
    out.JobCompleteTime = new Date(done).toISOString();
  }
  return out;
}

/** Fields Closed Jobs / history need that payment-only complete used to drop. */
export type ClosedJobTripFields = {
  pickup: string;
  dropoff: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  passengerName?: string;
  passengerPhone?: string;
  notes?: string;
  type?: ActiveJob['type'];
  source?: ActiveJob['source'];
  stepTimes?: ActiveJob['stepTimes'];
  clientTripId?: string;
};

export type PendingClosedJobRecord = {
  companyId: string;
  driverId: string;
  driverName?: string;
  vehicleId?: string;
  /** Job id at complete time (may be provisional local:… for offline hail). */
  localJobId: string;
  clientTripId?: string;
  job: ActiveJob;
  paymentType: string;
  extras: PaymentExtras;
  totalFare: number;
  tmDetails?: TmPaymentDetails;
  completedAt: number;
};

export function extractClosedJobTripFields(job: ActiveJob): ClosedJobTripFields {
  return {
    pickup: String(job.pickup || ''),
    dropoff: String(job.dropoff || ''),
    pickupLat: job.pickupLat,
    pickupLng: job.pickupLng,
    dropoffLat: job.dropoffLat,
    dropoffLng: job.dropoffLng,
    passengerName: job.passengerName,
    passengerPhone: job.passengerPhone,
    notes: job.notes,
    type: job.type,
    source: job.source,
    stepTimes: job.stepTimes,
    clientTripId: job.clientTripId,
  };
}

function jobVehicleTypeLabel(job: ActiveJob): string | undefined {
  return (
    strOrUndef((job as ActiveJob & { vehicleType?: string }).vehicleType) ??
    strOrUndef(job.vehicleTypeRequired)
  );
}

/** Journal Completed payload extras so flush can rebuild a closed snapshot. */
export function closedJobFieldsForJournal(job: ActiveJob): Record<string, unknown> {
  const f = extractClosedJobTripFields(job);
  const vehicleType = jobVehicleTypeLabel(job);
  const breakdown = job.meterSnapshot?.breakdown;
  return {
    pickup: f.pickup,
    dropoff: f.dropoff,
    pickupAddress: f.pickup,
    dropAddress: f.dropoff,
    PickAddress: f.pickup,
    DropAddress: f.dropoff,
    pickupLat: f.pickupLat,
    pickupLng: f.pickupLng,
    dropoffLat: f.dropoffLat,
    dropoffLng: f.dropoffLng,
    dropLat: f.dropoffLat,
    dropLng: f.dropoffLng,
    finalDropAddress: f.dropoff || undefined,
    passengerName: f.passengerName,
    passengerPhone: f.passengerPhone,
    notes: f.notes,
    type: f.type,
    source: f.source,
    stepTimes: f.stepTimes,
    clientTripId: f.clientTripId,
    meterSnapshot: job.meterSnapshot,
    distanceKm: job.distanceKm,
    durationMin: job.durationMin,
    tariffChanges: job.tariffChanges,
    vehicleType,
    VehicleType: vehicleType,
    accountId: job.accountId,
    accountName: job.accountName,
    Account_id: job.accountId,
    Account_Name: job.accountName,
    jobAccountId: job.accountId,
    jobAccountName: job.accountName,
    fareBreakdown: breakdown,
    FareBreakdown: breakdown,
    flagFall: breakdown?.flagFall,
    distanceCharge: breakdown?.distanceCharge,
    waitingCharge: breakdown?.waitingCharge,
    waitingMinutes: breakdown?.waitingMinutes,
    tariffId: job.meterSnapshot?.tariffId,
    tariffName: job.meterSnapshot?.tariffName,
  };
}

/** HTTP complete payload extras accepted by server whitelist (+ address mirrors). */
export function closedJobFieldsForCompleteApi(job: ActiveJob): Record<string, unknown> {
  const f = extractClosedJobTripFields(job);
  const vehicleType = jobVehicleTypeLabel(job);
  const breakdown = job.meterSnapshot?.breakdown;
  const out: Record<string, unknown> = {
    pickupLat: f.pickupLat,
    pickupLng: f.pickupLng,
    dropLat: f.dropoffLat,
    dropLng: f.dropoffLng,
    finalDropAddress: f.dropoff || undefined,
    // Closed Jobs UI reads DropAddress / PickAddress — send both mirrors.
    ...(f.dropoff
      ? { DropAddress: f.dropoff, dropAddress: f.dropoff, dropoff: f.dropoff }
      : {}),
    ...(f.pickup
      ? { PickAddress: f.pickup, pickAddress: f.pickup, pickup: f.pickup }
      : {}),
    driverComments: f.notes || undefined,
  };
  if (f.stepTimes && typeof f.stepTimes === 'object') {
    out.stepTimes = f.stepTimes;
    Object.assign(out, stepTimesToClosedMirrors(f.stepTimes));
  }
  if (vehicleType) {
    out.VehicleType = vehicleType;
    out.vehicleType = vehicleType;
  }
  if (breakdown && typeof breakdown === 'object') {
    out.fareBreakdown = breakdown;
    out.FareBreakdown = breakdown;
    if (breakdown.flagFall != null) out.flagFall = breakdown.flagFall;
    if (breakdown.distanceCharge != null) out.distanceCharge = breakdown.distanceCharge;
    if (breakdown.waitingCharge != null) {
      out.waitingCharge = breakdown.waitingCharge;
      out.waitingCost = breakdown.waitingCharge;
    }
    if (breakdown.waitingMinutes != null) {
      out.waitingMinutes = breakdown.waitingMinutes;
      out.waitingTimeMinutes = breakdown.waitingMinutes;
    }
  }
  const createdAtMs =
    numOrUndef(job.bookedAtMs) ??
    numOrUndef((job as ActiveJob & { createdAt?: number }).createdAt) ??
    numOrUndef(job.postedAt);
  if (createdAtMs != null) {
    out.createdAt = createdAtMs;
    out.CreatedAt = createdAtMs;
  }
  const tariffId = job.meterSnapshot?.tariffId;
  const tariffName = job.meterSnapshot?.tariffName;
  if (tariffId) out.tariffId = tariffId;
  if (tariffName) out.tariffName = tariffName;
  if (job.tariffChanges?.length) out.tariffChanges = job.tariffChanges;
  return out;
}

export function applyTripFieldsToJob(
  job: ActiveJob,
  fields: Partial<ClosedJobTripFields> | Record<string, unknown> | undefined,
): ActiveJob {
  if (!fields || typeof fields !== 'object') return job;
  const rec = fields as Record<string, unknown>;
  // Empty string must not win over DropAddress / booking backfill (?? treats '' as set).
  const pickup = firstNonEmptyString(
    (fields as ClosedJobTripFields).pickup,
    rec.pickupAddress,
    rec.PickAddress,
    job.pickup,
  );
  const dropoff = firstNonEmptyString(
    (fields as ClosedJobTripFields).dropoff,
    rec.dropAddress,
    rec.DropAddress,
    rec.finalDropAddress,
    job.dropoff,
  );
  const pickupLat =
    numOrUndef((fields as ClosedJobTripFields).pickupLat) ??
    numOrUndef((fields as Record<string, unknown>).pickupLat) ??
    job.pickupLat;
  const pickupLng =
    numOrUndef((fields as ClosedJobTripFields).pickupLng) ??
    numOrUndef((fields as Record<string, unknown>).pickupLng) ??
    job.pickupLng;
  const dropoffLat =
    numOrUndef((fields as ClosedJobTripFields).dropoffLat) ??
    numOrUndef((fields as Record<string, unknown>).dropoffLat) ??
    numOrUndef((fields as Record<string, unknown>).dropLat) ??
    job.dropoffLat;
  const dropoffLng =
    numOrUndef((fields as ClosedJobTripFields).dropoffLng) ??
    numOrUndef((fields as Record<string, unknown>).dropoffLng) ??
    numOrUndef((fields as Record<string, unknown>).dropLng) ??
    job.dropoffLng;

  const meterSnapshot =
    rec.meterSnapshot && typeof rec.meterSnapshot === 'object'
      ? (rec.meterSnapshot as ActiveJob['meterSnapshot'])
      : job.meterSnapshot;
  const vehicleType =
    strOrUndef(rec.vehicleType) ??
    strOrUndef(rec.VehicleType) ??
    (job as ActiveJob & { vehicleType?: string }).vehicleType;
  const accountId =
    strOrUndef(rec.accountId) ??
    strOrUndef(rec.Account_id) ??
    strOrUndef(rec.AccountId) ??
    strOrUndef(rec.jobAccountId) ??
    job.accountId;
  const accountName =
    strOrUndef(rec.accountName) ??
    strOrUndef(rec.Account_Name) ??
    strOrUndef(rec.AccountName) ??
    strOrUndef(rec.jobAccountName) ??
    job.accountName;
  const distanceKm =
    numOrUndef(rec.distanceKm) ??
    numOrUndef(
      meterSnapshot && typeof meterSnapshot === 'object'
        ? (meterSnapshot as { distanceKm?: unknown }).distanceKm
        : undefined,
    ) ??
    job.distanceKm;
  const durationMin = numOrUndef(rec.durationMin) ?? job.durationMin;
  const tariffChanges = Array.isArray(rec.tariffChanges)
    ? (rec.tariffChanges as ActiveJob['tariffChanges'])
    : job.tariffChanges;

  return {
    ...job,
    pickup,
    dropoff,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    passengerName:
      strOrUndef((fields as ClosedJobTripFields).passengerName) ?? job.passengerName,
    passengerPhone:
      strOrUndef((fields as ClosedJobTripFields).passengerPhone) ?? job.passengerPhone,
    notes: strOrUndef((fields as ClosedJobTripFields).notes) ?? job.notes,
    type: ((fields as ClosedJobTripFields).type as ActiveJob['type']) ?? job.type,
    source: ((fields as ClosedJobTripFields).source as ActiveJob['source']) ?? job.source,
    stepTimes:
      ((fields as ClosedJobTripFields).stepTimes as ActiveJob['stepTimes']) ??
      (rec.stepTimes && typeof rec.stepTimes === 'object'
        ? (rec.stepTimes as ActiveJob['stepTimes'])
        : job.stepTimes),
    clientTripId:
      strOrUndef((fields as ClosedJobTripFields).clientTripId) ?? job.clientTripId,
    meterSnapshot,
    distanceKm,
    durationMin,
    tariffChanges,
    ...(vehicleType ? { vehicleType } : {}),
    ...(accountId ? { accountId } : {}),
    ...(accountName ? { accountName } : {}),
  };
}

export function pendingClosedJobMatches(
  row: PendingClosedJobRecord,
  args: { serverJobId?: string; clientTripId?: string; localJobId?: string },
): boolean {
  if (args.clientTripId && row.clientTripId && row.clientTripId === args.clientTripId) {
    return true;
  }
  if (args.localJobId && String(row.localJobId) === String(args.localJobId)) return true;
  if (args.serverJobId && String(row.job.id) === String(args.serverJobId)) return true;
  if (args.serverJobId && String(row.localJobId) === String(args.serverJobId)) return true;
  return false;
}

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}
