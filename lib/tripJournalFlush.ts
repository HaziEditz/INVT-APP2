import NetInfo from '@react-native-community/netinfo';
import {
  rememberBusinessAccount,
  resolvePendingAccountFields,
} from '@/lib/accountCache';
import {
  cancelJobAsDriver,
  completeJobPayment,
  createHailJobOnDispatch,
  reportNoShow,
  searchBusinessAccounts,
  syncJobStageOnDispatch,
} from '@/lib/dispatchApi';
import {
  needsHailAddressResolve,
  resolveHailPickupSnapshot,
  resolveReadableAddress,
} from '@/lib/hailAddressResolve';
import { catchUpJobStagesOnDispatch } from '@/lib/jobServerSync';
import { pickTmFieldsFromPayload } from '@/lib/tmPaymentPersist';
import {
  GEOCODE_TIMEOUT_MS,
  isRetryableStageFlushError,
  isRetryableTerminalFlushError,
  journalHasUnsyncedStages,
  localStageHintFromJournalEvents,
  shouldDropTerminalOnFlushError,
} from '@/lib/tripJournalFlushPolicy';
import {
  getTripJournal,
  listPendingHailCreates,
  listPendingStageFlushes,
  listPendingTerminalFlushes,
  markTripJournalEventSynced,
  setTripJournalSyncState,
  upsertTripJournal,
} from '@/services/tripJournalService';
import type { TripJournal } from '@/types';

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
    // Upgrade coord-like dropoff before complete API — hard-timeout so Complete never hangs.
    if (finalDropAddress && needsHailAddressResolve(finalDropAddress) && dropLat != null && dropLng != null) {
      try {
        const { reverseGeocodeCoords } = await import('@/services/locationService');
        finalDropAddress = await resolveReadableAddress(
          { address: finalDropAddress, lat: dropLat, lng: dropLng },
          reverseGeocodeCoords,
          { timeoutMs: GEOCODE_TIMEOUT_MS },
        );
      } catch {
        // keep placeholder
      }
    }
    const driverComments = asString(payload.notes) || asString(payload.driverComments) || undefined;
    const stepTimes =
      payload.stepTimes && typeof payload.stepTimes === 'object'
        ? payload.stepTimes
        : undefined;
    const meterSnapshot =
      payload.meterSnapshot && typeof payload.meterSnapshot === 'object'
        ? (payload.meterSnapshot as Record<string, unknown>)
        : undefined;
    const fareBreakdown =
      (payload.fareBreakdown && typeof payload.fareBreakdown === 'object'
        ? payload.fareBreakdown
        : undefined) ??
      (meterSnapshot?.breakdown && typeof meterSnapshot.breakdown === 'object'
        ? meterSnapshot.breakdown
        : undefined);
    const vehicleType =
      asString(payload.VehicleType) || asString(payload.vehicleType) || undefined;
    const accountIdRaw =
      asString(payload.Account_id) ||
      asString(payload.AccountId) ||
      asString(payload.jobAccountId) ||
      asString(payload.accountId) ||
      undefined;
    const accountNameRaw =
      asString(payload.Account_Name) ||
      asString(payload.AccountName) ||
      asString(payload.jobAccountName) ||
      asString(payload.accountName) ||
      undefined;
    const accountRef =
      asString(payload.accountRef) || asString(payload.AccountRef) || undefined;
    const accountPending =
      payload.accountPending === true ||
      payload.AccountPending === true ||
      (!accountIdRaw && !!(accountNameRaw || accountRef));
    const resolvedAccount = await resolvePendingAccountFields(
      {
        accountId: accountIdRaw,
        accountName: accountNameRaw,
        accountRef,
        accountPending,
      },
      {
        search: searchBusinessAccounts,
        remember: async (hit) => {
          if (companyId) await rememberBusinessAccount(companyId, hit);
        },
      },
    );
    const accountId = resolvedAccount.accountId;
    const accountName = resolvedAccount.accountName;
    const eftposRef =
      asString(payload.eftposRef) ||
      asString(payload.EftposRef) ||
      (extras && typeof extras === 'object'
        ? asString((extras as Record<string, unknown>).eftposRef)
        : undefined);
    const accClaimNo =
      asString(payload.accClaimNo) ||
      asString(payload.AccClaimNo) ||
      (extras && typeof extras === 'object'
        ? asString((extras as Record<string, unknown>).accClaimNo)
        : undefined);
    const accPoNo =
      asString(payload.accPoNo) ||
      asString(payload.AccPoNo) ||
      (extras && typeof extras === 'object'
        ? asString((extras as Record<string, unknown>).accPoNo)
        : undefined);
    const accountFields = {
      paymentMethod: payload.paymentMethod ?? paymentType,
      PaymentMethod: payload.PaymentMethod ?? payload.paymentMethod ?? paymentType,
      PaymentType: payload.PaymentType ?? paymentType,
      paymentType,
      ...(accountId
        ? { Account_id: accountId, AccountId: accountId, jobAccountId: accountId }
        : {}),
      ...(accountName
        ? { Account_Name: accountName, AccountName: accountName, jobAccountName: accountName }
        : {}),
      ...(eftposRef ? { eftposRef, EftposRef: eftposRef } : {}),
      ...(accClaimNo ? { accClaimNo, AccClaimNo: accClaimNo } : {}),
      ...(accPoNo ? { accPoNo, AccPoNo: accPoNo } : {}),
    };
    const tmFields = pickTmFieldsFromPayload(payload, { remainderPaymentType: paymentType });
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
      ...(tmFields || {}),
      accClientId: payload.accClientId,
      accApprovalNo: payload.accApprovalNo,
      accClaimNo,
      accPoNo,
      eftposRef,
      stripeChargeId: payload.stripeChargeId,
      stripePaymentIntentId: payload.stripePaymentIntentId,
      voucherCode: payload.voucherCode,
      voucherDiscount: payload.voucherDiscount,
      tmVoucher: payload.tmVoucher,
      ...accountFields,
      payload: {
        fare,
        totalFare: fare,
        distanceKm,
        distance: distanceKm,
        paymentType,
        extras,
        ...(tmFields || {}),
        accClientId: payload.accClientId,
        accApprovalNo: payload.accApprovalNo,
        accClaimNo,
        accPoNo,
        eftposRef,
        stripeChargeId: payload.stripeChargeId,
        stripePaymentIntentId: payload.stripePaymentIntentId,
        pickupLat,
        pickupLng,
        dropLat,
        dropLng,
        finalDropAddress,
        driverComments,
        stepTimes,
        fareBreakdown,
        FareBreakdown: fareBreakdown,
        VehicleType: vehicleType,
        vehicleType,
        flagFall: payload.flagFall ?? (fareBreakdown as { flagFall?: unknown } | undefined)?.flagFall,
        distanceCharge:
          payload.distanceCharge ??
          (fareBreakdown as { distanceCharge?: unknown } | undefined)?.distanceCharge,
        waitingCharge:
          payload.waitingCharge ??
          (fareBreakdown as { waitingCharge?: unknown } | undefined)?.waitingCharge,
        waitingCost:
          payload.waitingCost ??
          payload.waitingCharge ??
          (fareBreakdown as { waitingCharge?: unknown } | undefined)?.waitingCharge,
        waitingTimeMinutes:
          payload.waitingTimeMinutes ??
          payload.waitingMinutes ??
          (fareBreakdown as { waitingMinutes?: unknown } | undefined)?.waitingMinutes,
        waitingMinutes:
          payload.waitingMinutes ??
          (fareBreakdown as { waitingMinutes?: unknown } | undefined)?.waitingMinutes,
        tariffId: payload.tariffId ?? meterSnapshot?.tariffId,
        tariffName: payload.tariffName ?? meterSnapshot?.tariffName,
        tariffChanges: payload.tariffChanges,
        ...accountFields,
      },
    });
    return;
  }
  throw new Error(`unsupported terminal journal event: ${type}`);
}

async function flushTerminalEventsForJournal(
  journal: TripJournal,
  hooks: TripJournalFlushHooks,
): Promise<number> {
  const jobId = String(journal.serverJobId || '').trim();
  const driverId = String(journal.driverId || '').trim();
  const companyId = String(journal.companyId || '').trim();
  if (!jobId || !/^\d+$/.test(jobId) || !driverId || !companyId) return 0;

  const live = (await getTripJournal(journal.clientTripId)) ?? journal;
  if (journalHasUnsyncedStages(live.events)) {
    console.warn('[trip-journal] skip terminal until stages flush', {
      jobId,
      clientTripId: journal.clientTripId,
    });
    return 0;
  }

  const events = live.events
    .filter(
      (e) =>
        (e.type === 'Completed' || e.type === 'Cancelled' || e.type === 'NoShow') &&
        e.synced !== true,
    )
    .sort((a, b) => a.at - b.at);

  let flushed = 0;
  for (const ev of events) {
    try {
      if (ev.type === 'Completed') {
        // Catch up Arrived/Active before complete (mirrors online finalizePayment).
        const hint = localStageHintFromJournalEvents(live.events);
        const catchUpStage = hint === 'complete' ? 'onboard' : hint;
        if (catchUpStage === 'arrived' || catchUpStage === 'onboard') {
          try {
            const caught = await catchUpJobStagesOnDispatch(
              jobId,
              driverId,
              catchUpStage,
              asNumber(ev.payload?.updateSeq),
              { companyId },
            );
            if (caught.synced.length) {
              console.log('[trip-journal] catch-up before complete', {
                jobId,
                synced: caught.synced,
              });
            }
          } catch (catchErr) {
            console.warn('[trip-journal] catch-up before complete failed:', catchErr);
          }
        }
      }

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
      if (!shouldDropTerminalOnFlushError(ev.type, err)) {
        // Completed: never mark synced on ambiguous failure.
        console.warn('[trip-journal] terminal will retry', { jobId, type: ev.type, error: msg });
        break;
      }
      await markTripJournalEventSynced(journal.clientTripId, ev.id);
      console.warn('[trip-journal] terminal dropped (non-retryable)', {
        jobId,
        type: ev.type,
        error: msg,
      });
    }
  }
  return flushed;
}

/**
 * Phase 5c–5e — flush hail creates, Arrived/OnBoard stages, then terminal events.
 * Does not call /api/syncOfflineTrip (full trip journal enrichment stays deferred).
 */
export async function flushTripJournal(hooks: TripJournalFlushHooks = {}): Promise<number> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  let flushed = 0;
  /** Journals that bound a server job this pass — Complete immediately after create. */
  const justBound: TripJournal[] = [];

  const pendingHail = await listPendingHailCreates();
  for (const journal of pendingHail) {
    const clientTripId = journal.clientTripId;
    const hail = journal.hailCreate;
    if (!hail) continue;

    await setTripJournalSyncState(clientTripId, 'creating', { lastError: undefined });
    try {
      // Offline hail often stores bare "lat, lng" — reverse-geocode on reconnect (hard timeout).
      let pickup = hail.pickup;
      if (needsHailAddressResolve(pickup.address)) {
        try {
          const { reverseGeocodeCoords } = await import('@/services/locationService');
          pickup = await resolveHailPickupSnapshot(pickup, reverseGeocodeCoords, {
            timeoutMs: GEOCODE_TIMEOUT_MS,
          });
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
      const bound = await setTripJournalSyncState(clientTripId, 'synced', {
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
      if (bound) justBound.push(bound);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Hail create: always retry transport / version; permanent API errors fail the row.
      if (isRetryableTerminalFlushError(err)) {
        await setTripJournalSyncState(clientTripId, 'pending', { lastError: msg });
        console.warn('[trip-journal] hail create will retry', { clientTripId, error: msg });
        continue;
      }
      await setTripJournalSyncState(clientTripId, 'failed', { lastError: msg });
      console.warn('[trip-journal] hail create failed permanently', { clientTripId, error: msg });
    }
  }

  // Same flush pass: after hail create binds, attempt Completed immediately
  // (before other journals' stages) so Active jobs are not left orphaned.
  for (const bound of justBound) {
    flushed += await flushTerminalEventsForJournal(bound, hooks);
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
        if (isRetryableStageFlushError(err)) {
          console.warn('[trip-journal] stage will retry', { jobId, type: ev.type, error: msg });
          break;
        }
        // e.g. Arrived when already Active — drop this stage only; keep later events.
        await markTripJournalEventSynced(journal.clientTripId, ev.id);
        console.warn('[trip-journal] stage dropped (non-retryable)', { jobId, type: ev.type, error: msg });
      }
    }
  }

  const pendingTerminals = await listPendingTerminalFlushes();
  const justBoundIds = new Set(justBound.map((j) => j.clientTripId));
  for (const { journal } of pendingTerminals) {
    if (justBoundIds.has(journal.clientTripId)) continue; // already attempted same pass
    flushed += await flushTerminalEventsForJournal(journal, hooks);
  }

  return flushed;
}

/** Exported for hang-simulation tests — geocode budget used by flush/endHail. */
export { GEOCODE_TIMEOUT_MS };
