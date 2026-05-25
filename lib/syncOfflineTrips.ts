/**
 * syncOfflineTrips.ts — Upload unsynced trip journals + summaries to the server.
 *
 * v12-ota22k: data-integrity hardening.
 *   - REAL FARE DATA IS NEVER AUTO-DELETED. The previous 4xx-drop logic was too
 *     aggressive — a transient auth glitch or a server config issue would
 *     silently lose driver pay. Now we keep retrying every reconnect, forever.
 *   - Per-trip attempt counter persisted across app restarts (tj:attempts:{jobId}).
 *   - Every failure is logged to Sentry with full context (jobId, status, body)
 *     and saved locally as `tj:lastError:{jobId}` so the driver can see it on
 *     the Profile "Review Stuck Uploads" screen.
 *   - The only way a trip leaves the queue is:
 *       (a) a successful 2xx upload, or
 *       (b) the driver explicitly clears that ONE trip from the Review screen.
 *
 * v12-ota22j (preserved): switched to /api/job/sync-offline-trip with the SA-
 * portal payload shape (BookingId/CompanyId/TotalFare/etc) — same shape that
 * completeJob uses for live trips at DriverContext.tsx:3719.
 */

import {
  getPendingTripIds,
  getJournalEntries,
  getTripSummary,
  markTripSynced,
  incrementTripAttempts,
  recordTripError,
} from './tripJournal';

export interface SyncDriverInfo {
  driverId:     string;
  companyId:    string;
  vehicleId:    string;
  serverOrigin: string;
  adminKey?:    string;
}

// Lazy Sentry — never throw if it fails to load (web/Expo Go).
function reportToSentry(jobId: string, msg: string, extras: Record<string, any>) {
  try {
    const Sentry = require('@sentry/react-native');
    Sentry.captureMessage(`[OfflineSync] ${msg} for ${jobId}`, {
      level: 'warning',
      tags:  { jobId, syncFailure: 'true' },
      extra: extras,
    });
  } catch {}
}

/**
 * Attempt to upload all pending trips to the server.
 *
 * @returns Number of trips successfully uploaded this run.
 *
 * Trips that fail are kept in storage with attempt counter + last error
 * recorded — they will retry on the next reconnect / shift start / completion.
 * Real fare data is never silently deleted.
 */
export async function uploadPendingTrips(info: SyncDriverInfo): Promise<number> {
  const pendingIds = await getPendingTripIds();
  if (!pendingIds.length) return 0;

  let uploaded = 0;
  const url = `${info.serverOrigin}/api/job/sync-offline-trip`;

  for (const jobId of pendingIds) {
    const [entries, summary] = await Promise.all([
      getJournalEntries(jobId),
      getTripSummary(jobId),
    ]);

    // Truly empty record (no journal AND no summary) — no fare at risk,
    // safe to mark synced so the count goes down.
    if (!entries.length && !summary) {
      await markTripSynced(jobId);
      continue;
    }

    // Build the SA-portal payload shape — same shape the live completeJob path
    // POSTs at DriverContext.tsx:3719. Falls back gracefully if summary missing.
    const fareTotal      = summary?.fare?.total           ?? 0;
    const fareBase       = summary?.fare?.base            ?? 0;
    const fareTime       = summary?.fare?.timeCharge      ?? 0;
    const fareDistance   = summary?.fare?.distanceCharge  ?? 0;
    const fareExtras     = summary?.fare?.extras          ?? 0;
    const fareCurrency   = summary?.fare?.currency        ?? 'NZD';
    const distanceKm     = summary?.distance_km           ?? 0;
    const dropAddress    = summary?.dropoffAddress        ?? '';
    const status         = summary?.status                ?? 'Completed';

    const payload = {
      BookingId:    jobId,
      CompanyId:    info.companyId,
      DriverId:     info.driverId,
      VehicleId:    info.vehicleId,
      TotalFare:    fareTotal,
      FareBase:     fareBase,
      FareTime:     fareTime,
      FareDistance: fareDistance,
      FareExtras:   fareExtras,
      JobDistance:  distanceKm,
      FareCurrency: fareCurrency,
      DropLatLng:   '',
      DropAddress:  dropAddress,
      Status:       status,
      // Optional rich data — server may consume these for richer reconciliation
      events:       entries,
      tripSummary:  summary,
      adminKey:     info.adminKey ?? '',
    };

    // AbortSignal.timeout() is not available in React Native's Hermes engine.
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 15_000);

    let httpStatus  = 0;
    let respBody    = '';
    let errorMsg    = '';

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });

      clearTimeout(timeoutId);
      httpStatus = res.status;

      if (res.ok) {
        await markTripSynced(jobId);
        uploaded++;
        console.log('[SyncOffline] ✓ Uploaded trip', jobId, '— HTTP', res.status, '— $' + fareTotal.toFixed(2));
        continue;
      }

      // Non-OK response — capture body for diagnostics
      try {
        respBody = (await res.text()).slice(0, 500);
      } catch { /* ignore */ }
      errorMsg = `HTTP ${res.status}`;
    } catch (err: any) {
      clearTimeout(timeoutId);
      errorMsg = err?.message ?? 'network error';
    }

    // Failure path — record it but DO NOT delete the trip.
    const attempts = await incrementTripAttempts(jobId);
    await recordTripError(jobId, {
      status:  httpStatus,
      message: errorMsg,
      body:    respBody,
      when:    new Date().toISOString(),
    });

    // Spam control: log to Sentry on attempts 1, 3, 10, 25, then every 50.
    if (attempts === 1 || attempts === 3 || attempts === 10 ||
        attempts === 25 || attempts % 50 === 0) {
      reportToSentry(jobId, `Upload failed (${attempts} attempts)`, {
        httpStatus,
        errorMsg,
        respBody:    respBody.slice(0, 200),
        fare:        fareTotal,
        currency:    fareCurrency,
        companyId:   info.companyId,
        vehicleId:   info.vehicleId,
        driverId:    info.driverId,
        savedAt:     summary?.savedAt,
        payment:     summary?.payment?.method,
      });
    }

    console.warn(
      '[SyncOffline] ✗ Trip', jobId,
      '— attempt', attempts,
      '— ' + errorMsg,
      '— $' + fareTotal.toFixed(2),
      '— KEPT for retry (real fare data is never auto-deleted)'
    );
  }

  return uploaded;
}
