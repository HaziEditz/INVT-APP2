/**
 * Authenticated client for shared platform payment APIs (driver today; passenger later).
 */
import Constants from 'expo-constants';
import { getAuthInstance } from '@/lib/firebase';
import { PAYMENTS_API_URL } from '@/constants/theme';

function paymentsBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { paymentsApiUrl?: string };
  return String(extra.paymentsApiUrl || PAYMENTS_API_URL).replace(/\/$/, '');
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error('Not signed in');
  const token = await user.getIdToken(true);
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${paymentsBaseUrl()}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(json?.error || `HTTP ${res.status}`));
  }
  return json as T;
}

export async function fetchTerminalConnectionToken(): Promise<string> {
  const json = await postJson<{ secret?: string }>('/api/payments/terminal/connection-token', {});
  if (!json.secret) throw new Error('No connection token secret returned');
  return json.secret;
}

export async function createTapPaymentIntent(input: {
  amountCents: number;
  companyId: string;
  bookingId?: string | null;
  driverId?: string | null;
}): Promise<{
  paymentIntentId: string;
  clientSecret: string | null;
  amountCents: number;
  platformFeeCents: number;
  companyNetCents: number;
}> {
  return postJson('/api/payments/tap/create-intent', {
    ...input,
    clientChannel: 'driver_app',
    currency: 'nzd',
  });
}

export async function recordTapLedger(input: {
  paymentIntentId: string;
  companyId: string;
  amountCents: number;
  bookingId?: string | null;
  driverId?: string | null;
  chargeId?: string | null;
}): Promise<void> {
  await postJson('/api/payments/tap/record-ledger', {
    ...input,
    clientChannel: 'driver_app',
  });
}
