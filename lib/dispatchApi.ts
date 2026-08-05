import { DISPATCH_API_URL } from '@/constants/theme';
import { withTimeout } from '@/lib/asyncTimeout';
import { getAuthInstance, getDatabaseInstance, ensureAuthUserForRtdbWrite } from '@/lib/firebase';
import { getDispatchConfig } from '@/lib/dispatchConfig';
import { isPresenceSessionEnded } from '@/lib/presenceGuards';
import { loadLiveMeterPresenceFields } from '@/lib/liveMeterPresence';
import { getData, STORAGE_KEYS } from '@/lib/storage';
import {
  AUTH_TOKEN_REFRESH_TIMEOUT_MS,
  COMPLETE_HTTP_MAX_ATTEMPTS,
  COMPLETE_HTTP_TIMEOUT_MS,
  HAIL_CREATE_TIMEOUT_MS,
  STAGE_HTTP_MAX_ATTEMPTS,
  STAGE_HTTP_TIMEOUT_MS,
} from '@/lib/weakSignalPolicy';
import type { DriverProfile } from '@/types';
import { update, ref } from 'firebase/database';

export class DispatchApiError extends Error {
  status: number;
  errorCode?: string;
  body: Record<string, unknown>;

  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DispatchApiError';
    this.status = status;
    this.body = body;
    this.errorCode = String(body.error_code ?? body.errorCode ?? '');
  }
}

/** Thrown when the stage POST fails at the transport layer (timeout, abort, network). */
export class StageTransportError extends Error {
  cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StageTransportError';
    this.cause = cause;
  }
}

/** Weak-signal budgets — see lib/weakSignalPolicy.ts (was 45s×retries). */
const STAGE_FETCH_TIMEOUT_MS = STAGE_HTTP_TIMEOUT_MS;
const COMPLETE_FETCH_TIMEOUT_MS = COMPLETE_HTTP_TIMEOUT_MS;

/** True when a failed accept should be queued for offline retry (network/5xx only). */
export function isDispatchAcceptRetryable(err: unknown): boolean {
  if (err instanceof DispatchApiError) {
    if (err.status === 409 || err.status === 410 || err.status === 404) return false;
    const code = err.errorCode || '';
    if (
      code === 'invalid_transition' ||
      code === 'accept_in_flight' ||
      code === 'status_changed' ||
      code === 'queue_full' ||
      code === 'driver_ineligible' ||
      code === 'cancel_in_flight'
    ) {
      return false;
    }
    if (err.status >= 500) return true;
    return false;
  }
  return true;
}

async function refreshAuthToken(): Promise<string | undefined> {
  const user = getAuthInstance().currentUser;
  if (!user) return undefined;
  try {
    return await withTimeout(
      user.getIdToken(true),
      AUTH_TOKEN_REFRESH_TIMEOUT_MS,
      'getIdToken(true)',
    );
  } catch {
    // Force-refresh can hang on weak cellular — use cached token.
    try {
      return await withTimeout(
        user.getIdToken(false),
        AUTH_TOKEN_REFRESH_TIMEOUT_MS,
        'getIdToken(cached)',
      );
    } catch {
      return undefined;
    }
  }
}

async function loadDriverSession(): Promise<DriverProfile | null> {
  try {
    return await getData<DriverProfile>(STORAGE_KEYS.driverSession);
  } catch {
    return null;
  }
}

/** Per-driver passforlink from profile session; falls back to global links node. */
async function resolveDriverUserKey(): Promise<string | undefined> {
  const session = await loadDriverSession();
  const fromProfile = String(session?.passforlink ?? '').trim();
  if (fromProfile) return fromProfile;
  try {
    const config = await getDispatchConfig();
    const fromLinks = String(config.passforlink ?? '').trim();
    return fromLinks || undefined;
  } catch {
    return undefined;
  }
}

async function withDriverIdentity(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const session = await loadDriverSession();
  const out = { ...body };
  if (!out.driverId && session?.id) out.driverId = session.id;
  if (!out.companyId && session?.companyId) out.companyId = session.companyId;
  if (!out.driverName && session?.name) out.driverName = session.name;
  if (!out.phone && session?.phone) out.phone = session.phone;
  return out;
}

async function driverApiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await refreshAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const userKey = await resolveDriverUserKey();
  if (userKey) headers['X-User-Key'] = userKey;
  return headers;
}

async function parseJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new StageTransportError(
      aborted ? `Request timed out after ${timeoutMs}ms` : 'Network request failed',
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function driverApiPost<T extends Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
  opts?: { includeDriverIdentity?: boolean },
): Promise<T> {
  const headers = await driverApiHeaders();
  const payload = opts?.includeDriverIdentity === false ? body : await withDriverIdentity(body);
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await parseJsonBody(res);
  if (!res.ok || data.ok === false) {
    throw new DispatchApiError(
      String(data.error || `Dispatch POST ${path} failed: ${res.status}`),
      res.status,
      data,
    );
  }
  return data as T;
}

export async function driverApiGet<T extends Record<string, unknown>>(path: string): Promise<T> {
  const headers = await driverApiHeaders();
  const res = await fetch(`${DISPATCH_API_URL}${path}`, { headers });
  const data = await parseJsonBody(res);
  if (!res.ok || data.ok === false) {
    throw new DispatchApiError(
      String(data.error || `Dispatch GET ${path} failed: ${res.status}`),
      res.status,
      data,
    );
  }
  return data as T;
}

export async function dispatchGet<T>(path: string): Promise<T> {
  return driverApiGet(path) as Promise<T>;
}

export async function dispatchPost<T>(path: string, body: Record<string, unknown>, opts?: { userKey?: string }): Promise<T> {
  const headers = await driverApiHeaders();
  if (opts?.userKey) headers['X-User-Key'] = opts.userKey;
  if (path === '/api/cancel') {
    console.log('[dispatchPost] /api/cancel request', {
      hasUserKey: !!headers['X-User-Key'],
      hasAuthBearer: !!headers.Authorization,
      cancelledBy: body.cancelledBy,
      bookingId: body.bookingId,
      noShow: body.noShow,
    });
  }
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await parseJsonBody(res);
  if (!res.ok) {
    if (path === '/api/cancel') {
      console.error('[dispatchPost] /api/cancel response error', {
        status: res.status,
        error: data.error,
        error_code: data.error_code,
        hasUserKey: !!headers['X-User-Key'],
      });
    }
    throw new DispatchApiError(
      String(data.error || `Dispatch POST ${path} failed: ${res.status}`),
      res.status,
      data,
    );
  }
  return data as T;
}

/** Legacy DriverApp API — POST to links/serviceon base + action name. */
export async function legacyDispatchPost(params: {
  action: string;
  parms: string;
  userKey?: string;
}): Promise<string> {
  const config = await getDispatchConfig();
  const url = config.baseUrl + params.action;
  const body = new URLSearchParams();
  body.append('Parms', params.parms);
  body.append('UserKey', params.userKey ?? config.passforlink ?? '');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Legacy dispatch ${params.action} HTTP ${res.status}`);
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Legacy FnServiceON — no longer called. Shift start uses Firebase
 * `online/{companyId}/{vehicleId}` via startShiftOnline() in presenceService.
 */
export async function notifyServiceOn(_payload: {
  driverId: string;
  companyId: string;
  vehicleId: string;
  logInDate: string;
  logInTime: string;
  userKey?: string;
}): Promise<string> {
  return '';
}

export interface DriverLocationPayload {
  companyId: string;
  vehicleId: string;
  driverId?: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp?: number;
  /** Top-level vehiclestatus for dispatch zone sync (defaults to Available). */
  vehiclestatus?: string;
}

/** GPS heartbeat — writes parent + online/{cid}/{vid}/current so dispatch sync sees status + GPS. */
export async function syncDriverLocation(payload: DriverLocationPayload) {
  const { companyId, vehicleId, lat, lng, driverId, vehiclestatus = 'Available' } = payload;
  if (!companyId || !vehicleId) return;
  if (isPresenceSessionEnded(companyId, vehicleId)) return;
  if (!String(driverId ?? '').trim()) {
    console.warn('[syncDriverLocation] skipped — missing driverId (would create identity-less ghost node)');
    return;
  }

  const onlinePath = `online/${companyId}/${vehicleId}`;
  await ensureAuthUserForRtdbWrite(`syncDriverLocation → ${onlinePath}`);
  if (isPresenceSessionEnded(companyId, vehicleId)) return;
  const now = Date.now();
  const topStatus = vehiclestatus === 'Assigned' ? 'Picking' : vehiclestatus;
  const parsedDriverId = driverId
    ? (() => {
        const numeric = parseInt(driverId, 10);
        return Number.isNaN(numeric) ? driverId : numeric;
      })()
    : undefined;

  const meterFields = await loadLiveMeterPresenceFields();

  await update(ref(getDatabaseInstance(), onlinePath), {
    vehiclestatus: topStatus,
    VehicleStatus: topStatus,
    lastSeen: now,
    lat,
    lng,
    ...(parsedDriverId != null
      ? { driverid: parsedDriverId, driverId }
      : {}),
  });

  await update(ref(getDatabaseInstance(), `${onlinePath}/current`), {
    lat,
    lng,
    Lat: lat,
    Lng: lng,
    hasGps: lat !== 0 || lng !== 0,
    time: new Date().toISOString(),
    lastSeen: now,
    online: true,
    bgUpdate: true,
    vehiclestatus: topStatus,
    VehicleStatus: topStatus,
    ...meterFields,
  });
}

export async function lookupDriverById(driverId: string, companyId: string) {
  return dispatchPost<{ uid?: string; email?: string }>('/api/lookup-auth-uid', {
    driverId,
    companyId,
  });
}

export async function registerDriver(payload: Record<string, string>) {
  return dispatchPost('/api/register-driver', payload);
}

export async function acceptJobOffer(jobId: string, driverId: string) {
  return dispatchPost('/api/job/accept', { jobId, driverId });
}

export async function declineJobOffer(
  jobId: string,
  driverId: string,
  opts?: { originalStatus?: string; timedOut?: boolean },
) {
  return dispatchPost('/api/job/decline', {
    jobId,
    bookingId: jobId,
    driverId,
    originalStatus: opts?.originalStatus ?? 'pending',
    timedOut: !!opts?.timedOut,
  });
}

export async function recallJobOnDispatch(jobId: string, driverId: string, originalStatus?: string) {
  return dispatchPost<{ ok: boolean; restoredStatus?: string }>('/api/job/recall', {
    jobId,
    bookingId: jobId,
    driverId,
    originalStatus: originalStatus ?? 'pending',
  });
}

export async function createPreBooking(payload: Record<string, unknown>) {
  return dispatchPost('/api/pre-booking', payload);
}

/** Phase 5b — UUID for hail create-or-get / offline journal. */
export function newClientTripId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function createHailJobOnDispatch(params: {
  companyId: string;
  driverId: string;
  vehicleId: string;
  tariffId: string;
  pickup: { address: string; lat?: number; lng?: number };
  dropoff?: { address: string; lat?: number; lng?: number };
  /** Phase 5b — client UUID for idempotent create-or-get (retries / offline journal). */
  clientTripId: string;
  /** Vehicle type from the driver's selected vehicle (Closed Job / dispatch). */
  vehicleType?: string;
}): Promise<{ jobId: string; bookingId: number; updateSeq: number; clientTripId: string; existing?: boolean }> {
  const body: Record<string, unknown> = {
    companyId: params.companyId,
    source: 'hail',
    driverId: params.driverId,
    vehicleId: params.vehicleId,
    tariffId: params.tariffId,
    clientTripId: params.clientTripId,
    pickup: {
      address: params.pickup.address,
      lat: params.pickup.lat ?? 0,
      lng: params.pickup.lng ?? 0,
    },
    // Hail destination is unknown until End Trip — never mirror pickup as DropAddress
    // (dispatch Active card would otherwise show pickup as dropoff).
    dropoff: params.dropoff?.address?.trim()
      ? {
          address: params.dropoff.address.trim(),
          lat: params.dropoff.lat ?? 0,
          lng: params.dropoff.lng ?? 0,
        }
      : { address: '', lat: 0, lng: 0 },
    passengers: 1,
  };
  const vehicleType = String(params.vehicleType || '').trim();
  if (vehicleType) {
    body.vehicleType = vehicleType;
    body.VehicleType = vehicleType;
  }

  // Single timed attempt — DriverContext journals pending hail on transport timeout.
  const headers = await driverApiHeaders();
  const payload = await withDriverIdentity(body);
  const res = await fetchWithTimeout(
    `${DISPATCH_API_URL}/api/job/create`,
    { method: 'POST', headers, body: JSON.stringify(payload) },
    HAIL_CREATE_TIMEOUT_MS,
  );
  const data = await parseJsonBody(res);
  if (!res.ok || data.ok === false) {
    throw new DispatchApiError(
      String(data.error || `Dispatch hail create failed: ${res.status}`),
      res.status,
      data,
    );
  }
  const jobId = String(data.jobId ?? data.bookingId ?? '').trim();
  if (!jobId || !/^\d+$/.test(jobId)) {
    throw new Error('Dispatch server did not return a valid booking ID');
  }
  return {
    jobId,
    bookingId: parseInt(jobId, 10),
    updateSeq: 1,
    clientTripId: String(data.clientTripId || params.clientTripId),
    existing: !!(data.existing || data.idempotent),
  };
}

export type DriverAccountSearchHit = {
  Id: string | number;
  Name: string;
  PhoneNo?: string;
  Email?: string;
  AccountCode?: string;
  Type?: string;
};

/** Business-account search for hail Account payment (company-scoped). */
export async function searchBusinessAccounts(
  query: string,
): Promise<DriverAccountSearchHit[]> {
  const data = await driverApiPost<{
    ok?: boolean;
    accounts?: DriverAccountSearchHit[];
  }>('/api/driver/search-accounts', { query: String(query || '').trim() });
  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function completeJobPayment(payload: Record<string, unknown>) {
  const headers = await driverApiHeaders();
  const body = await withDriverIdentity(payload);
  let lastErr: unknown;
  for (let attempt = 0; attempt < COMPLETE_HTTP_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${DISPATCH_API_URL}/api/job/complete`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        COMPLETE_FETCH_TIMEOUT_MS,
      );
      const data = await parseJsonBody(res);
      if (!res.ok || data.ok === false) {
        throw new DispatchApiError(
          String(data.error || `Dispatch complete failed: ${res.status}`),
          res.status,
          data,
        );
      }
      return data;
    } catch (err) {
      lastErr = err;
      const retryableTransport =
        err instanceof StageTransportError && attempt < COMPLETE_HTTP_MAX_ATTEMPTS - 1;
      if (!retryableTransport) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Dispatch complete failed');
}

export interface ActiveBookingRow {
  bookingId: number;
  status: string;
  bookingStatus: string;
  version: number;
}

export async function fetchDriverActiveBookings(driverId: string): Promise<ActiveBookingRow[]> {
  const path = `/api/driver/active-bookings?driverId=${encodeURIComponent(driverId)}`;
  const mapRows = (data: {
    ok?: boolean;
    bookings?: Array<{
      bookingId: number;
      status: string;
      version?: number;
      bookingStatus?: string;
    }>;
  }): ActiveBookingRow[] => {
    const rows = data.bookings ?? [];
    return rows.map((b) => ({
      bookingId: b.bookingId,
      status: String(b.status || ''),
      bookingStatus: String(b.bookingStatus || b.status || ''),
      version: parseInt(String(b.version ?? 0), 10) || 0,
    }));
  };

  try {
    return mapRows(await driverApiGet(path));
  } catch (err) {
    // Edge/proxy 502/503 while Node is overloaded — one immediate retry.
    if (err instanceof DispatchApiError && (err.status === 502 || err.status === 503)) {
      return mapRows(await driverApiGet(path));
    }
    throw err;
  }
}

export async function syncJobStageOnDispatch(
  bookingId: string | number,
  status: string,
  driverId: string,
  ifVersion?: number,
): Promise<{ version?: number; idempotent?: boolean }> {
  const bid = parseInt(String(bookingId), 10);
  if (!bid || !driverId) {
    throw new Error('syncJobStageOnDispatch: bookingId and driverId required');
  }

  const body: Record<string, unknown> = {
    bookingId: bid,
    driverId,
    status,
    clientRequestId: `stage-${bid}-${status}-${ifVersion ?? 0}`,
  };
  if (ifVersion != null && !Number.isNaN(ifVersion)) body.ifVersion = ifVersion;

  const headers = await driverApiHeaders();
  let lastErr: unknown;
  for (let attempt = 0; attempt < STAGE_HTTP_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${DISPATCH_API_URL}/api/job/stage`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        STAGE_FETCH_TIMEOUT_MS,
      );
      const data = await parseJsonBody(res);
      if (res.ok && data.ok !== false) {
        const version =
          parseInt(String(data.version ?? data.currentVersion ?? data.currentSeq ?? ''), 10) || undefined;
        return {
          version: version != null && !Number.isNaN(version) ? version : undefined,
          idempotent: data.idempotent === true,
        };
      }
      throw new DispatchApiError(
        String(data.error || `Dispatch stage sync failed for #${bid} → ${status}`),
        res.status,
        data,
      );
    } catch (err) {
      lastErr = err;
      const retryableTransport =
        err instanceof StageTransportError && attempt < STAGE_HTTP_MAX_ATTEMPTS - 1;
      if (!retryableTransport) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Dispatch stage sync failed for #${bid}`);
}

export async function pruneDriverQueueOnDispatch(opts?: { dryRun?: boolean }): Promise<{ removed?: unknown[] }> {
  return driverApiPost('/api/driver/prune-queue', { dryRun: !!opts?.dryRun });
}

export async function promoteQueuedJob(bookingId: string, driverId: string) {
  const bid = parseInt(bookingId, 10);
  if (!bid) throw new Error('promoteQueuedJob: invalid bookingId');
  const res = await fetch(`${DISPATCH_API_URL}/api/job/promote-queued`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: bid, driverId }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    version?: number;
    alreadyStatus?: string;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Promote queued failed for #${bookingId}`);
  }
  return data;
}

export async function reportNoShow(jobId: string, driverId: string, companyId: string) {
  return dispatchPost('/api/cancel', {
    bookingId: jobId,
    driverId,
    companyId,
    cancelledBy: 'driver',
    noShow: true,
    terminalKind: 'No Show',
    reason: 'No Show',
  });
}

export async function cancelJobAsDriver(
  jobId: string,
  driverId: string,
  companyId: string,
  opts?: { terminalKind?: 'Cancelled' | 'No Show' },
) {
  const terminalKind = opts?.terminalKind ?? 'Cancelled';
  return dispatchPost('/api/cancel', {
    bookingId: jobId,
    driverId,
    companyId,
    cancelledBy: 'driver',
    forceTerminal: true,
    terminalKind,
    reason: terminalKind === 'No Show' ? 'No Show' : 'Cancelled by driver',
  });
}

/** Trigger emergency SOS — requires X-User-Key (driver passforlink). */
export async function triggerDriverSos(payload: {
  lat: number;
  lng: number;
  phone?: string;
  driverName?: string;
  vehiclenumber?: string;
}) {
  return driverApiPost<{ ok: boolean; sosId?: string; status?: string }>('/api/driver/sos', payload);
}

/** Cancel an active SOS signal. */
export async function cancelDriverSos() {
  return driverApiPost<{ ok: boolean; cleared?: boolean }>('/api/driver/sos/cancel', {});
}

/** Nearby driver is going to help an active SOS. */
export async function respondToDriverSos(sosDriverId: string) {
  return driverApiPost<{ ok: boolean; sosId?: string; responderId?: string }>('/api/sos/respond', {
    sosId: sosDriverId,
  });
}

/** Nearby driver withdraws from an SOS they committed to respond to. */
export async function withdrawSosResponse(sosDriverId: string) {
  return driverApiPost<{ ok: boolean; sosId?: string; responderId?: string }>('/api/sos/respond/withdraw', {
    sosId: sosDriverId,
  });
}

/** Nearby driver marked arrived / handled — clears their responder commitment. */
export async function markSosResponderArrived(sosDriverId: string) {
  return driverApiPost<{ ok: boolean; sosId?: string; responderId?: string }>('/api/sos/respond/arrived', {
    sosId: sosDriverId,
  });
}

/** Send a chat message to dispatch. */
export async function sendDriverMessage(message: string) {
  return driverApiPost<{ ok: boolean; messageId?: number }>('/api/driver/message', { message });
}
