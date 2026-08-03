import type { ActiveJob, PaymentExtras, TmPaymentDetails } from '@/types';

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

/** Journal Completed payload extras so flush can rebuild a closed snapshot. */
export function closedJobFieldsForJournal(job: ActiveJob): Record<string, unknown> {
  const f = extractClosedJobTripFields(job);
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
  };
}

/** HTTP complete payload extras accepted by server whitelist (+ address mirrors). */
export function closedJobFieldsForCompleteApi(job: ActiveJob): Record<string, unknown> {
  const f = extractClosedJobTripFields(job);
  return {
    pickupLat: f.pickupLat,
    pickupLng: f.pickupLng,
    dropLat: f.dropoffLat,
    dropLng: f.dropoffLng,
    finalDropAddress: f.dropoff || undefined,
    driverComments: f.notes || undefined,
  };
}

export function applyTripFieldsToJob(
  job: ActiveJob,
  fields: Partial<ClosedJobTripFields> | Record<string, unknown> | undefined,
): ActiveJob {
  if (!fields || typeof fields !== 'object') return job;
  const pickup = String(
    (fields as ClosedJobTripFields).pickup ??
      (fields as Record<string, unknown>).pickupAddress ??
      (fields as Record<string, unknown>).PickAddress ??
      job.pickup ??
      '',
  );
  const dropoff = String(
    (fields as ClosedJobTripFields).dropoff ??
      (fields as Record<string, unknown>).dropAddress ??
      (fields as Record<string, unknown>).DropAddress ??
      (fields as Record<string, unknown>).finalDropAddress ??
      job.dropoff ??
      '',
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
      ((fields as ClosedJobTripFields).stepTimes as ActiveJob['stepTimes']) ?? job.stepTimes,
    clientTripId:
      strOrUndef((fields as ClosedJobTripFields).clientTripId) ?? job.clientTripId,
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
