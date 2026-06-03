import { DISPATCH_API_URL } from '@/constants/theme';
import { auth } from '@/lib/firebase';
import { getDispatchConfig } from '@/lib/dispatchConfig';
import { update, ref } from 'firebase/database';
import { database } from '@/lib/firebase';

export async function dispatchGet<T>(path: string): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Dispatch GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function dispatchPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`${DISPATCH_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

export async function notifyServiceOn(payload: {
  driverId: string;
  companyId: string;
  vehicleId: string;
  logInDate: string;
  logInTime: string;
  userKey?: string;
}) {
  const parms = [
    `DriverId,,${payload.driverId}`,
    `CompanyId,,${payload.companyId}`,
    `VehicleId,,${payload.vehicleId}`,
    `Status,,Available`,
    `LogInDate,,${payload.logInDate}`,
    `LogInTime,,${payload.logInTime}`,
  ].join('&&');

  return legacyDispatchPost({
    action: 'FnServiceON',
    parms,
    userKey: payload.userKey,
  });
}

export interface DriverLocationPayload {
  companyId: string;
  vehicleId: string;
  driverId?: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp?: number;
}

/** GPS heartbeat — writes to Firebase (dispatch reads online/{cid}/{vid}/current). */
export async function syncDriverLocation(payload: DriverLocationPayload) {
  const { companyId, vehicleId, lat, lng } = payload;
  if (!companyId || !vehicleId) return;

  await update(ref(database, `online/${companyId}/${vehicleId}/current`), {
    lat,
    lng,
    Lat: lat,
    Lng: lng,
    hasGps: lat !== 0 || lng !== 0,
    time: new Date().toISOString(),
    lastSeen: Date.now(),
    online: true,
    bgUpdate: true,
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

export async function declineJobOffer(jobId: string, driverId: string) {
  return dispatchPost('/api/job/decline', { jobId, driverId });
}

export async function createPreBooking(payload: Record<string, unknown>) {
  return dispatchPost('/api/pre-booking', payload);
}
