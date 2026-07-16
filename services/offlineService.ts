import NetInfo from '@react-native-community/netinfo';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import {
  acceptJobOffer,
  cancelJobAsDriver,
  completeJobPayment,
  declineJobOffer,
  DispatchApiError,
  recallJobOnDispatch,
  reportNoShow,
} from '@/lib/dispatchApi';
import type { DriverProfile, OfflineQueueItem } from '@/types';

type JobUpdateAction =
  | 'accept'
  | 'decline'
  | 'recall'
  | 'complete'
  | 'cancel'
  | 'no_show';

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

async function loadSessionDriver(): Promise<DriverProfile | null> {
  try {
    return (await getData<DriverProfile>(STORAGE_KEYS.driverSession)) ?? null;
  } catch {
    return null;
  }
}

/** Errors that mean the action cannot succeed on retry — drop from queue. */
function isTerminalFlushError(err: unknown): boolean {
  if (!(err instanceof DispatchApiError)) return false;
  if (err.status === 404 || err.status === 410) return true;
  const code = err.errorCode || '';
  return (
    code === 'not_found' ||
    code === 'invalid_transition' ||
    code === 'already_terminal' ||
    code === 'status_changed' ||
    code === 'idempotent'
  );
}

async function flushJobUpdate(
  payload: Record<string, unknown>,
  session: DriverProfile | null,
): Promise<void> {
  const action = asString(payload.action) as JobUpdateAction;
  const jobId = asString(payload.jobId ?? payload.bookingId);
  const driverId = asString(payload.driverId) || asString(session?.id);
  const companyId = asString(payload.companyId) || asString(session?.companyId);

  if (!jobId) {
    throw new Error('offline job_update missing jobId');
  }

  switch (action) {
    case 'accept': {
      if (!driverId) throw new Error('offline accept missing driverId');
      await acceptJobOffer(jobId, driverId);
      return;
    }
    case 'decline': {
      if (!driverId) throw new Error('offline decline missing driverId');
      await declineJobOffer(jobId, driverId, {
        originalStatus: asString(payload.originalStatus) || 'pending',
        timedOut: !!payload.timedOut,
      });
      return;
    }
    case 'recall': {
      if (!driverId) throw new Error('offline recall missing driverId');
      await recallJobOnDispatch(
        jobId,
        driverId,
        asString(payload.originalStatus) || 'pending',
      );
      return;
    }
    case 'complete': {
      // Rebuild the same shape finalizePayment sends to /api/job/complete.
      // Payment type (Cash/Card/TM/Account/Stripe/ACC/…) is opaque payload —
      // sync must not branch on it.
      const fare = asNumber(payload.fare ?? payload.totalFare);
      const distanceKm = asNumber(payload.distanceKm ?? payload.distance);
      const paymentType = asString(payload.paymentType) || 'Cash';
      const extras =
        payload.extras && typeof payload.extras === 'object'
          ? (payload.extras as Record<string, unknown>)
          : undefined;

      const completePayload: Record<string, unknown> = {
        jobId,
        bookingId: jobId,
        driverId: driverId || undefined,
        companyId: companyId || undefined,
        paymentType,
        fare,
        totalFare: fare,
        distanceKm,
        distance: distanceKm,
        extras,
        // TM / ACC / Stripe fields were spread onto the queued payload at enqueue time.
        councilPays: payload.councilPays,
        passengerPays: payload.passengerPays,
        tmCardNumber: payload.tmCardNumber,
        tmCardName: payload.tmCardName,
        tmCardExpiry: payload.tmCardExpiry,
        accClientId: payload.accClientId,
        accApprovalNo: payload.accApprovalNo,
        accClaimNo: payload.accClaimNo,
        stripeChargeId: payload.stripeChargeId,
        stripePaymentIntentId: payload.stripePaymentIntentId,
        voucherCode: payload.voucherCode,
        voucherDiscount: payload.voucherDiscount,
        tmVoucher: payload.tmVoucher,
        paymentMethod: payload.paymentMethod ?? paymentType,
        payload: {
          fare,
          totalFare: fare,
          distanceKm,
          distance: distanceKm,
          paymentType,
          extras,
          councilPays: payload.councilPays,
          passengerPays: payload.passengerPays,
          tmCardNumber: payload.tmCardNumber,
          tmCardName: payload.tmCardName,
          tmCardExpiry: payload.tmCardExpiry,
          accClientId: payload.accClientId,
          accApprovalNo: payload.accApprovalNo,
          accClaimNo: payload.accClaimNo,
          stripeChargeId: payload.stripeChargeId,
          stripePaymentIntentId: payload.stripePaymentIntentId,
        },
      };

      await completeJobPayment(completePayload);
      return;
    }
    case 'cancel': {
      if (!driverId || !companyId) {
        throw new Error('offline cancel missing driverId/companyId');
      }
      await cancelJobAsDriver(jobId, driverId, companyId);
      return;
    }
    case 'no_show': {
      if (!driverId || !companyId) {
        throw new Error('offline no_show missing driverId/companyId');
      }
      await reportNoShow(jobId, driverId, companyId);
      return;
    }
    default:
      throw new Error(`unsupported offline job_update action: ${action || '(empty)'}`);
  }
}

/**
 * Replay queued driver actions against the real dispatch endpoints.
 * Historically this posted to `/api/offline-sync`, which does not exist —
 * the server’s `/api/syncOfflineTrip` is a different full-trip journal API.
 */
export async function enqueueOfflineItem(item: Omit<OfflineQueueItem, 'id' | 'createdAt'>) {
  const queue = (await getData<OfflineQueueItem[]>(STORAGE_KEYS.offlineQueue)) ?? [];
  const next: OfflineQueueItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  queue.push(next);
  await storeData(STORAGE_KEYS.offlineQueue, queue);
  return next;
}

export async function flushOfflineQueue() {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  const queue = (await getData<OfflineQueueItem[]>(STORAGE_KEYS.offlineQueue)) ?? [];
  if (!queue.length) return 0;

  const session = await loadSessionDriver();
  const remaining: OfflineQueueItem[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      if (item.type === 'job_update') {
        await flushJobUpdate(item.payload ?? {}, session);
        flushed += 1;
        console.log('[offline-sync] flushed job_update', {
          id: item.id,
          action: item.payload?.action,
          jobId: item.payload?.jobId,
        });
      } else {
        // location / chat were never wired to a server endpoint — drop stale entries.
        console.warn('[offline-sync] dropping unsupported queue item type', {
          id: item.id,
          type: item.type,
        });
        flushed += 1;
      }
    } catch (err) {
      if (isTerminalFlushError(err)) {
        console.warn('[offline-sync] dropping terminal failure', {
          id: item.id,
          action: item.payload?.action,
          jobId: item.payload?.jobId,
          error: err instanceof Error ? err.message : String(err),
          errorCode: err instanceof DispatchApiError ? err.errorCode : undefined,
          status: err instanceof DispatchApiError ? err.status : undefined,
        });
        flushed += 1;
        continue;
      }
      console.warn('[offline-sync] will retry later', {
        id: item.id,
        action: item.payload?.action,
        jobId: item.payload?.jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      remaining.push(item);
    }
  }

  await storeData(STORAGE_KEYS.offlineQueue, remaining);
  return flushed;
}

export function subscribeConnectivity(onChange: (online: boolean) => void) {
  return NetInfo.addEventListener((state) => {
    onChange(!!state.isConnected);
  });
}
