/**
 * Authenticated client for shared platform payment APIs (driver today; passenger later).
 * All network / token work is hard-capped so Tap → trip-complete cannot hang forever.
 */
import Constants from 'expo-constants';
import { getAuthInstance } from '@/lib/firebase';
import { PAYMENTS_API_URL } from '@/constants/theme';
import { withTimeout } from '@/lib/asyncTimeout';
import { AUTH_TOKEN_REFRESH_TIMEOUT_MS } from '@/lib/weakSignalPolicy';

/** Cap SA payment API calls (connection token, create-intent, ledger). */
export const PAYMENTS_API_TIMEOUT_MS = 12_000;

function paymentsBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { paymentsApiUrl?: string };
  return String(extra.paymentsApiUrl || PAYMENTS_API_URL).replace(/\/$/, '');
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error('Not signed in');
  const token = await withTimeout(
    user.getIdToken(true),
    AUTH_TOKEN_REFRESH_TIMEOUT_MS,
    'payments.getIdToken',
  );
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      aborted
        ? `${label} timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : 'Network request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${paymentsBaseUrl()}${path}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    PAYMENTS_API_TIMEOUT_MS,
    path,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((json as { error?: string })?.error || `HTTP ${res.status}`));
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
  clientSecret: string;
  amountCents: number;
  platformFeeCents: number;
  companyNetCents: number;
}> {
  const json = await postJson<{
    paymentIntentId?: string;
    clientSecret?: string | null;
    amountCents?: number;
    platformFeeCents?: number;
    companyNetCents?: number;
  }>('/api/payments/tap/create-intent', {
    ...input,
    clientChannel: 'driver_app',
    currency: 'nzd',
  });
  const clientSecret = String(json.clientSecret || '').trim();
  const paymentIntentId = String(json.paymentIntentId || '').trim();
  if (!clientSecret || !paymentIntentId) {
    throw new Error('create-intent did not return paymentIntentId/clientSecret');
  }
  return {
    paymentIntentId,
    clientSecret,
    amountCents: Math.round(Number(json.amountCents) || input.amountCents),
    platformFeeCents: Math.round(Number(json.platformFeeCents) || 0),
    companyNetCents: Math.round(Number(json.companyNetCents) || 0),
  };
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

/**
 * Explicit opt-in for Stripe's simulated Tap to Pay UI (screen press / long-press).
 * Never derived from __DEV__ — development clients would always simulate and mask real NFC.
 * Production / preview EAS profiles must leave this unset or "0".
 */
export function shouldSimulateTapToPay(): boolean {
  return String(process.env.EXPO_PUBLIC_STRIPE_TERMINAL_SIMULATED || '').trim() === '1';
}
