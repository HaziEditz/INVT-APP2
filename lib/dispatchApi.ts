import { DISPATCH_API_URL } from '@/constants/theme';
import { getAuthInstance, getDatabaseInstance, ensureAuthUserForRtdbWrite } from '@/lib/firebase';
import { getDispatchConfig } from '@/lib/dispatchConfig';
import { isPresenceSessionEnded } from '@/lib/presenceGuards';
import { update, ref } from 'firebase/database';

export async function dispatchGet<T>(path: string): Promise<T> {
  const token = await getAuthInstance().currentUser?.getIdToken();
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Dispatch GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function dispatchPost<T>(path: string, body: Record<string, unknown>, opts?: { userKey?: string }): Promise<T> {
  const token = await getAuthInstance().currentUser?.getIdToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts?.userKey) headers['X-User-Key'] = opts.userKey;
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Dispatch POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
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

export async function completeJobPayment(payload: Record<string, unknown>) {
  const config = await getDispatchConfig();
  return dispatchPost('/api/job/complete', payload, { userKey: config.passforlink });
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
    const body: Record<string, unknown> = {
      bookingId: bid,
      driverId,
      status,
    };
    if (ver != null && !Number.isNaN(ver)) body.ifVersion = ver;
    const res = await fetch(`${DISPATCH_API_URL}/api/job/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      stale?: boolean;
      version?: number;
      currentVersion?: number;
      currentSeq?: number;
      error?: string;
      error_code?: string;
    };
    return { ...data, httpOk: res.ok, status: res.status };
  };

  let result = await post(ifVersion);
  const retryVer = result.version ?? result.currentVersion ?? result.currentSeq;
  if ((!result.ok || !result.httpOk) && retryVer != null && ifVersion != null) {
    result = await post(retryVer);
  }
  if (!result.ok || !result.httpOk) {
    throw new Error(result.error || `Dispatch stage sync failed for #${bid} → ${status}`);
  }
  return { version: result.version ?? retryVer };
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
    reason: 'No Show',
  });
}
