/**
 * centralJobId.ts — Request a server-generated job ID before creating any booking.
 *
 * All job IDs must now come from the server so data matches across dispatch,
 * driver app, passenger app, food, and freight.
 *
 * Format: {companyId}{YYMMDD}{sequence}  e.g. 6112605011
 *
 * Retries up to 3 times before giving up. Returns a JobIdResult — callers
 * must check `.ok` and handle the error case; no local-ID fallback allowed
 * for trips (createPendingJob may use a local fallback; startHailTrip must not).
 */

import { getServerUrl } from './remoteConfig';

export type JobSource = 'dispatch' | 'hail' | 'passenger' | 'web' | 'food' | 'freight';

export interface CreateJobPayload {
  companyId:  string;
  source:     JobSource;
  driverId?:  string;
  vehicleId?: string;
  passenger?: { name: string; phone: string };
  pickup?:    { address: string; lat?: number; lng?: number };
  dropoff?:   { address: string; lat?: number; lng?: number };
  tariffId?:  string;
  notes?:     string;
}

export interface CreateJobResponse {
  ok:        true;
  jobId:     string;
  createdAt: number;
}

/**
 * Rich result type so callers can show appropriate error messages:
 *  - networkError: true  → device has no internet (show "check your connection")
 *  - networkError: false → device is online but server returned an error
 *  - serverError         → human-readable message from the SA portal, if available
 *  - httpStatus          → raw HTTP status code when the server did respond (e.g. 404, 500)
 */
export type JobIdResult =
  | { ok: true;  jobId: string }
  | { ok: false; networkError: boolean; serverError?: string; httpStatus?: number };

const MAX_ATTEMPTS = 2;   // 2 attempts max — total worst-case ~6s
const TIMEOUT_MS   = 3_000; // OTA21: 3s per attempt — was 4s, even snappier hail-start UX

/**
 * Ask the server for a canonical job ID.
 * Retries up to 3 times on network failure or non-2xx response.
 * Returns a JobIdResult — check `.ok` before using `.jobId`.
 * The caller MUST block the hail-trip operation on failure — no local fallbacks.
 */
export async function requestCentralJobId(
  payload: CreateJobPayload,
): Promise<JobIdResult> {
  let lastNetworkError = true;
  let lastServerError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(`${getServerUrl()}/api/job/create`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
          signal:  controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      // If we got any HTTP response the device definitely has internet
      lastNetworkError = false;

      if (!res.ok) {
        const httpStatus = res.status;
        try {
          const errBody = await res.json();
          lastServerError = errBody.error ?? errBody.message ?? `Server error ${httpStatus}`;
        } catch {
          lastServerError = `Server error ${httpStatus}`;
        }
        console.warn(`[CentralJobId] Server returned HTTP ${httpStatus} (attempt ${attempt}/${MAX_ATTEMPTS}):`, lastServerError);
        if (attempt < MAX_ATTEMPTS) continue;
        return { ok: false, networkError: false, serverError: lastServerError, httpStatus };
      }

      const data: CreateJobResponse = await res.json();
      if (data?.ok && data?.jobId) {
        console.log('[CentralJobId] Server-assigned jobId:', data.jobId);
        return { ok: true, jobId: data.jobId };
      }

      lastServerError = 'Unexpected response from booking server';
      console.warn(`[CentralJobId] Unexpected response (attempt ${attempt}/${MAX_ATTEMPTS}):`, JSON.stringify(data));
      if (attempt < MAX_ATTEMPTS) continue;
      return { ok: false, networkError: false, serverError: lastServerError };

    } catch (err: any) {
      lastNetworkError = true;
      console.warn(`[CentralJobId] Request failed (attempt ${attempt}/${MAX_ATTEMPTS}):`, err?.message);
      if (attempt < MAX_ATTEMPTS) continue;
      return { ok: false, networkError: true };
    }
  }
  return { ok: false, networkError: lastNetworkError, serverError: lastServerError };
}
