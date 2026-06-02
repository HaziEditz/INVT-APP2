import { DISPATCH_API_URL } from '@/constants/theme';
import { auth } from '@/lib/firebase';

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

export async function lookupDriverById(driverId: string, companyId: string) {
  return dispatchPost<{ uid?: string; email?: string }>('/api/lookup-auth-uid', {
    driverId,
    companyId,
  });
}

export async function registerDriver(payload: Record<string, string>) {
  return dispatchPost('/api/register-driver', payload);
}

export async function syncDriverLocation(payload: Record<string, unknown>) {
  return dispatchPost('/api/driver-location', payload);
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
