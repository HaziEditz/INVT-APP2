import { DISPATCH_API_URL } from '@/constants/theme';
import { getAuthInstance, getDatabaseInstance, ensureAuthUserForRtdbWrite } from '@/lib/firebase';
import { getDispatchConfig } from '@/lib/dispatchConfig';
import { isPresenceSessionEnded } from '@/lib/presenceGuards';
import { loadLiveMeterPresenceFields } from '@/lib/liveMeterPresence';
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

async function refreshAuthToken(): Promise<string | undefined> {
  try {
    const user = getAuthInstance().currentUser;
    if (!user) return undefined;
    return await user.getIdToken(true);
  } catch {
    return getAuthInstance().currentUser?.getIdToken().catch(() => undefined);
  }
}

async function driverApiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await refreshAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const config = await getDispatchConfig();
    if (config.passforlink) headers['X-User-Key'] = config.passforlink;
  } catch {
    // non-fatal — some endpoints resolve driver via body driverId
  }
  return headers;
}

async function parseJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function driverApiPost<T extends Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const headers = await driverApiHeaders();
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await parseJsonBody(res);
  if (!res.ok) {
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

export async function createHailJobOnDispatch(params: {
  companyId: string;
  driverId: string;
  vehicleId: string;
  tariffId: string;
  pickup: { address: string; lat?: number; lng?: number };
  dropoff?: { address: string; lat?: number; lng?: number };
}): Promise<{ jobId: string; bookingId: number; updateSeq: number }> {
  const body: Record<string, unknown> = {
    companyId: params.companyId,
    source: 'hail',
    driverId: params.driverId,
    vehicleId: params.vehicleId,
    tariffId: params.tariffId,
    pickup: {
      address: params.pickup.address,
      lat: params.pickup.lat ?? 0,
      lng: params.pickup.lng ?? 0,
    },
    dropoff: {
      address: (params.dropoff ?? params.pickup).address,
      lat: (params.dropoff ?? params.pickup).lat ?? 0,
      lng: (params.dropoff ?? params.pickup).lng ?? 0,
    },
    passengers: 1,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await dispatchPost<{ ok?: boolean; jobId?: string | number; bookingId?: number }>(
        '/api/job/create',
        body,
      );
      const jobId = String(data.jobId ?? data.bookingId ?? '').trim();
      if (!jobId || !/^\d+$/.test(jobId)) {
        throw new Error('Dispatch server did not return a valid booking ID');
      }
      return { jobId, bookingId: parseInt(jobId, 10), updateSeq: 1 };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not create hail job on dispatch');
}

export async function completeJobPayment(payload: Record<string, unknown>) {
  return driverApiPost('/api/job/complete', payload);
}

export interface ActiveBookingRow {
  bookingId: number;
  status: string;
  bookingStatus: string;
  version: number;
}

export async function fetchDriverActiveBookings(driverId: string): Promise<ActiveBookingRow[]> {
  const data = await driverApiGet<{
    ok?: boolean;
    bookings?: Array<{
      bookingId: number;
      status: string;
      version?: number;
    }>;
  }>(`/api/driver/active-bookings?driverId=${encodeURIComponent(driverId)}`);
  const rows = data.bookings ?? [];
  return rows.map((b) => ({
    bookingId: b.bookingId,
    status: String(b.status || ''),
    bookingStatus: String((b as { bookingStatus?: string }).bookingStatus || b.status || ''),
    version: parseInt(String(b.version ?? 0), 10) || 0,
  }));
}

export async function syncJobStageOnDispatch(
  bookingId: string | number,
  status: string,
  driverId: string,
  ifVersion?: number,
): Promise<{ version?: number }> {
  const bid = parseInt(String(bookingId), 10);
  if (!bid || !driverId) {
    throw new Error('syncJobStageOnDispatch: bookingId and driverId required');
  }

  const post = async (ver?: number) => {
    const body: Record<string, unknown> = { bookingId: bid, driverId, status };
    if (ver != null && !Number.isNaN(ver)) body.ifVersion = ver;
    const headers = await driverApiHeaders();
    const res = await fetch(`${DISPATCH_API_URL}/api/job/stage`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await parseJsonBody(res);
    const retryVer =
      parseInt(String(data.version ?? data.currentVersion ?? data.currentSeq ?? ''), 10) || undefined;
    return {
      ...data,
      httpOk: res.ok,
      status: res.status,
      retryVer: Number.isNaN(retryVer!) ? undefined : retryVer,
    };
  };

  let result = await post(ifVersion);
  if ((!result.ok || !result.httpOk) && result.retryVer != null) {
    result = await post(result.retryVer);
  }
  if ((!result.ok || !result.httpOk) && ifVersion != null) {
    result = await post(undefined);
  }
  if (!result.ok || !result.httpOk) {
    throw new DispatchApiError(
      String(result.error || `Dispatch stage sync failed for #${bid} → ${status}`),
      result.status as number,
      result as Record<string, unknown>,
    );
  }
  const version =
    parseInt(String(result.version ?? result.retryVer ?? ''), 10) || undefined;
  return { version: Number.isNaN(version!) ? undefined : version };
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
