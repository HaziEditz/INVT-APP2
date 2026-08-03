import NetInfo from '@react-native-community/netinfo';
import {
  cancelJobAsDriver,
  completeJobPayment,
  createHailJobOnDispatch,
  DispatchApiError,
  reportNoShow,
  syncJobStageOnDispatch,
} from '@/lib/dispatchApi';
import {
  needsHailAddressResolve,
  resolveHailPickupSnapshot,
  resolveReadableAddress,
} from '@/lib/hailAddressResolve';
import {
  getTripJournal,
  listPendingHailCreates,
  listPendingStageFlushes,
  listPendingTerminalFlushes,
  markTripJournalEventSynced,
  setTripJournalSyncState,
  upsertTripJournal,
} from '@/services/tripJournalService';

export type TripJournalFlushHooks = {
  /** Called after server assigns numeric jobId for a journalled hail. */
  onHailCreated?: (args: {
    clientTripId: string;
    serverJobId: string;
    updateSeq: number;
    vehicleId: string;
    companyId: string;
  }) => void | Promise<void>;
  /** Called after a stage event flush updates version (optional UI sync). */
  onStageSynced?: (args: {
    serverJobId: string;
    status: string;
    version?: number;
  }) => void | Promise<void>;
  /** Called after a terminal event (complete/cancel/no-show) syncs. */
  onTerminalSynced?: (args: {
    serverJobId: string;
    clientTripId: string;
    type: 'Completed' | 'Cancelled' | 'NoShow';
    payload?: Record<string, unknown>;
  }) => void | Promise<void>;
};

function isRetryableFlushError(err: unknown): boolean {
  if (!(err instanceof DispatchApiError)) return true;
  if (err.status >= 500) return true;
  if (err.status === 0 || err.status === 408 || err.status === 429) return true;
  // Version conflicts — retry with rolled-forward version next reconnect.
  if (err.errorCode === 'version_conflict') return true;
  return false;
}

function stageStatusForEvent(type: string): string | null {
  if (type === 'Arrived') return 'Arrived';
  if (type === 'OnBoard') return 'Active';
  return null;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asString(v: unknown): string {
  return String(v ?? '').trim();
}

async function flushTerminalEvent(args: {
  jobId: string;
  driverId: string;
  companyId: string;
  type: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { jobId, driverId, companyId, type, payload = {} } = args;
  if (type === 'Cancelled') {
    await cancelJobAsDriver(jobId, driverId, companyId);
    return;
  }
  if (type === 'NoShow') {
    await reportNoShow(jobId, driverId, companyId);
    return;
  }
  if (type === 'Completed') {
    const fare = asNumber(payload.fare ?? payload.totalFare) ?? 0;
    const distanceKm = asNumber(payload.distanceKm ?? payload.distance) ?? 0;
    const paymentType = asString(payload.paymentType) || 'Cash';
    const extras =
      payload.extras && typeof payload.extras === 'object'
        ? (payload.extras as Record<string, unknown>)
        : undefined;
    const pickupLat = asNumber(payload.pickupLat);
    const pickupLng = asNumber(payload.pickupLng);
    const dropLat = asNumber(payload.dropLat ?? payload.dropoffLat);
    const dropLng = asNumber(payload.dropLng ?? payload.dropoffLng);
    let finalDropAddress =
      asString(payload.finalDropAddress) ||
      asString(payload.dropoff) ||
      asString(payload.DropAddress) ||
      asString(payload.dropAddress) ||
      undefined;
    // Upgrade coord-like dropoff before complete API (finalDropAddress whitelist).
    if (finalDropAddress && needsHailAddressResolve(finalDropAddress) && dropLat != null && dropLng != null) {
      try {
        const { reverseGeocodeCoords } = await import('@/services/locationService');
        finalDropAddress = await resolveReadableAddress(
          { address: finalDropAddress, lat: dropLat, lng: dropLng },
          reverseGeocodeCoords,
        );
      } catch {
        // keep placeholder
      }
    }
    const driverComments = asString(payload.notes) || asString(payload.driverComments) || undefined;
    await completeJobPayment({
      jobId,
      bookingId: jobId,
      driverId,
      companyId,
      paymentType,
      fare,
      totalFare: fare,
      distanceKm,
      distance: distanceKm,
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
        pickupLat,
        pickupLng,
        dropLat,
        dropLng,
        finalDropAddress,
        driverComments,
      },
    });
    return;
  }
  throw new Error(`unsupported terminal journal event: ${type}`);
}

/**
 * Phase 5c–5e — flush hail creates, Arrived/OnBoard stages, then terminal events.
 * Does not call /api/syncOfflineTrip (full trip journal enrichment stays deferred).
 */
export async function flushTripJournal(hooks: TripJournalFlushHooks = {}): Promise<number> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  let flushed = 0;

  const pendingHail = await listPendingHailCreates();
  for (const journal of pendingHail) {
    const clientTripId = journal.clientTripId;
    const hail = journal.hailCreate;
    if (!hail) continue;

    await setTripJournalSyncState(clientTripId, 'creating', { lastError: undefined });
    try {
      // Offline hail often stores bare "lat, lng" — reverse-geocode on reconnect.
      let pickup = hail.pickup;
      if (needsHailAddressResolve(pickup.address)) {
        try {
          const { reverseGeocodeCoords } = await import('@/services/locationService');
          pickup = await resolveHailPickupSnapshot(pickup, reverseGeocodeCoords);
          if (pickup.address !== hail.pickup.address) {
            const live = await getTripJournal(clientTripId);
            if (live?.hailCreate) {
              await upsertTripJournal({
                ...live,
                hailCreate: { ...live.hailCreate, pickup },
              });
            }
          }
        } catch (geoErr) {
          console.warn('[trip-journal] hail pickup reverse-geocode failed:', geoErr);
        }
      }
      const created = await createHailJobOnDispatch({
        companyId: journal.companyId,
        driverId: journal.driverId,
        vehicleId: journal.vehicleId,
        tariffId: hail.tariffId,
        pickup,
        clientTripId,
      });
      await setTripJournalSyncState(clientTripId, 'synced', {
        serverJobId: created.jobId,
        lastError: undefined,
      });
      await hooks.onHailCreated?.({
        clientTripId,
        serverJobId: created.jobId,
        updateSeq: created.updateSeq,
        vehicleId: journal.vehicleId,
        companyId: journal.companyId,
      });
      flushed += 1;
      console.log('[trip-journal] flushed hail create', {
        clientTripId,
        jobId: created.jobId,
        existing: !!created.existing,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRetryableFlushError(err)) {
        await setTripJournalSyncState(clientTripId, 'pending', { lastError: msg });
        console.warn('[trip-journal] hail create will retry', { clientTripId, error: msg });
        continue;
      }
      await setTripJournalSyncState(clientTripId, 'failed', { lastError: msg });
      console.warn('[trip-journal] hail create failed permanently', { clientTripId, error: msg });
    }
  }

  const pendingStages = await listPendingStageFlushes();
  for (const { journal, events } of pendingStages) {
    const jobId = String(journal.serverJobId || '').trim();
    const driverId = String(journal.driverId || '').trim();
    if (!jobId || !driverId) continue;

    let version: number | undefined;
    for (const ev of events) {
      const fromPayload = ev.payload?.updateSeq;
      if (typeof fromPayload === 'number' && Number.isFinite(fromPayload)) {
        version = fromPayload;
        break;
      }
    }

    for (const ev of events) {
      const status = stageStatusForEvent(ev.type);
      if (!status) continue;
      try {
        const result = await syncJobStageOnDispatch(jobId, status, driverId, version);
        if (result.version != null) version = result.version;
        await markTripJournalEventSynced(journal.clientTripId, ev.id);
        await hooks.onStageSynced?.({ serverJobId: jobId, status, version });
        flushed += 1;
        console.log('[trip-journal] flushed stage', {
          jobId,
          type: ev.type,
          status,
          version,
          idempotent: !!result.idempotent,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRetryableFlushError(err)) {
          console.warn('[trip-journal] stage will retry', { jobId, type: ev.type, error: msg });
          break;
        }
        // Terminal: drop this event so we do not loop forever.
        await markTripJournalEventSynced(journal.clientTripId, ev.id);
        console.warn('[trip-journal] stage dropped (terminal)', { jobId, type: ev.type, error: msg });
      }
    }
  }

  const pendingTerminals = await listPendingTerminalFlushes();
  for (const { journal, events } of pendingTerminals) {
    const jobId = String(journal.serverJobId || '').trim();
    const driverId = String(journal.driverId || '').trim();
    const companyId = String(journal.companyId || '').trim();
    if (!jobId || !driverId || !companyId) continue;

    for (const ev of events) {
      try {
        await flushTerminalEvent({
          jobId,
          driverId,
          companyId,
          type: ev.type,
          payload: ev.payload,
        });
        await markTripJournalEventSynced(journal.clientTripId, ev.id);
        if (ev.type === 'Completed' || ev.type === 'Cancelled' || ev.type === 'NoShow') {
          await hooks.onTerminalSynced?.({
            serverJobId: jobId,
            clientTripId: journal.clientTripId,
            type: ev.type,
            payload: ev.payload,
          });
        }
        flushed += 1;
        console.log('[trip-journal] flushed terminal', { jobId, type: ev.type });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRetryableFlushError(err)) {
          console.warn('[trip-journal] terminal will retry', { jobId, type: ev.type, error: msg });
          break;
        }
        await markTripJournalEventSynced(journal.clientTripId, ev.id);
        console.warn('[trip-journal] terminal dropped (terminal err)', {
          jobId,
          type: ev.type,
          error: msg,
        });
      }
    }
  }

  return flushed;
}
