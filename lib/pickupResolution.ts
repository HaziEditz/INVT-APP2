/**
 * Desk PIN-scope + cash-not-prepaid helpers.
 * Keep in sync with INVT lib/pickupResolution.cjs.
 */

export type PinScopeJobLike = {
  BookingSource?: string;
  bookingSource?: string;
  Source?: string;
  source?: string;
  CreatedBy?: string;
  createdBy?: string;
  WebBooking?: boolean;
  webBooking?: boolean;
  PickupPin?: string;
  pickupPin?: string;
  PaymentType?: string;
  paymentType?: string;
  PaymentMethod?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  PaymentStatus?: string;
  isPrePaid?: boolean;
  isPrepaid?: boolean;
  IsPrePaid?: boolean;
  prepaid?: boolean;
  isAcc?: boolean;
  IsAcc?: boolean;
  isACC?: boolean;
  isTotalMobility?: boolean;
  isTM?: boolean;
  IsTM?: boolean;
  tmUsed?: boolean;
};

function jobPickupPin(job: PinScopeJobLike | null | undefined): string {
  if (!job) return '';
  return String(job.PickupPin || job.pickupPin || '').trim();
}

function recordPay(job: PinScopeJobLike): string {
  return String(job.PaymentType || job.paymentType || job.PaymentMethod || job.paymentMethod || '')
    .trim()
    .toLowerCase();
}

function recordSrc(job: PinScopeJobLike): string {
  return String(job.BookingSource || job.bookingSource || job.Source || job.source || '').trim();
}

export function isPassengerAppBooking(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  const src = recordSrc(job).toLowerCase();
  if (src === 'passengerapp' || src === 'passenger app' || src === 'passenger') return true;
  const created = String(job.CreatedBy || job.createdBy || '')
    .trim()
    .toUpperCase();
  return created === 'APP';
}

export function isWebsiteBooking(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  if (job.WebBooking || job.webBooking) return true;
  const created = String(job.CreatedBy || job.createdBy || '').trim();
  if (/^WEB$/i.test(created)) return true;
  const src = recordSrc(job).toLowerCase();
  return src === 'website' || src === 'web' || src.includes('website');
}

export function isHailBooking(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  if (String(job.BookingSource || '').toLowerCase() === 'hail') return true;
  if (job.source === 'hail') return true;
  return false;
}

/** Dispatch Console / desk / phone booking — never PIN / wrong-pax / no-show group. */
export function isDispatchCreatedBooking(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  if (isPassengerAppBooking(job)) return false;
  if (isWebsiteBooking(job)) return false;
  if (isHailBooking(job)) return false;
  const src = recordSrc(job);
  const srcLower = src.toLowerCase();
  if (/dispatch|desk/.test(srcLower) || srcLower === 'phone' || srcLower.includes('console')) {
    return true;
  }
  if (!src) {
    if (jobPickupPin(job)) return false;
    return true;
  }
  return false;
}

/** Cash / EFTPOS collected at completion — never "already paid". */
export function isCashCollectedAtCompletion(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  if (
    job.isTotalMobility ||
    job.isTM ||
    job.IsTM ||
    job.tmUsed ||
    job.isAcc ||
    job.IsAcc
  ) {
    return false;
  }
  const pay = recordPay(job);
  return pay === 'cash' || pay === 'eftpos';
}

export function isPrepaidUpfrontJob(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  if (isCashCollectedAtCompletion(job)) return false;
  if (
    job.isPrePaid ||
    job.isPrepaid ||
    job.IsPrePaid ||
    job.prepaid ||
    job.isAcc ||
    job.IsAcc ||
    job.isACC ||
    job.isTotalMobility ||
    job.isTM ||
    job.IsTM ||
    job.tmUsed
  ) {
    return true;
  }
  if (String(job.paymentStatus || job.PaymentStatus || '').toLowerCase() === 'paid') {
    return true;
  }
  const pay = recordPay(job);
  return /card|stripe|account|\bacc\b|tm/.test(pay);
}

/** PIN group — Website + Passenger App prepaid only. Desk and cash skip. */
export function needsPickupVerification(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  if (isHailBooking(job)) return false;
  if (isDispatchCreatedBooking(job)) return false;
  if (jobPickupPin(job)) return true;
  if (isPassengerAppBooking(job)) return true;
  return isPrepaidUpfrontJob(job);
}

/** Driver UI "Paid" / "(paid)" — false for cash even if leftover paymentStatus=paid. */
export function jobShowsAsAlreadyPaid(job: PinScopeJobLike | null | undefined): boolean {
  if (!job) return false;
  if (isCashCollectedAtCompletion(job)) return false;
  return isPrepaidUpfrontJob(job);
}
