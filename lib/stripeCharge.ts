/**
 * stripeCharge.ts
 * Client-side helper that talks to the local Stripe charge server (port 5002).
 * In production the same server runs on the deployed container.
 */

import { Platform } from 'react-native';

// The charge server always runs on port 5002 alongside Metro.
// On device/Expo Go use $REPLIT_DEV_DOMAIN via the tunnel, on web use localhost.
const BASE_URL =
  Platform.OS === 'web'
    ? 'http://localhost:5002'
    : (() => {
        const domain = process.env.EXPO_PUBLIC_REPLIT_DOMAIN ?? '';
        if (domain) return `https://${domain.replace(':5000', '').replace(/\/$/, '')}:5002`;
        return 'http://localhost:5002';
      })();

export interface ChargeParams {
  amountCents: number;    // e.g. 2350 for $23.50
  currency?: string;      // default 'nzd'
  cardNumber: string;     // full 16-digit number
  expMonth: number;       // 1–12
  expYear: number;        // 4-digit year e.g. 2028
  cvc?: string;           // 3 or 4 digits
  description?: string;   // e.g. "Taxi fare job #123"
  companyId?: string;     // R11: company ID for per-company Stripe key lookup
}

export interface ChargeResult {
  success: boolean;
  paymentIntentId?: string;
  status?: string;
  error?: string;
  code?: string;
  declineCode?: string;
}

export async function chargeCard(params: ChargeParams): Promise<ChargeResult> {
  try {
    const res = await fetch(`${BASE_URL}/api/stripe/charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error ?? 'Payment failed', code: data.code, declineCode: data.declineCode };
    }
    return { success: true, paymentIntentId: data.paymentIntentId, status: data.status };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Network error — could not reach payment server' };
  }
}

/**
 * Fetch the payment configuration for a company from our stripe server.
 * Returns whether Stripe is configured and the publishable key if available.
 * R11: Uses company-specific Stripe keys fetched from Firebase via the server.
 */
export async function getPaymentConfig(companyId: string): Promise<{ configured: boolean; publishableKey?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/payment-config?cid=${encodeURIComponent(companyId)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { configured: false };
    const data = await res.json();
    return {
      configured: !!data.publishableKey,
      publishableKey: data.publishableKey ?? undefined,
    };
  } catch {
    return { configured: false };
  }
}

/** Luhn check — validates card number is structurally correct */
export function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'eftpos' | 'unknown';

/** Detect card brand from number prefix */
export function detectCardBrand(num: string): CardBrand {
  const d = num.replace(/\D/g, '');
  if (/^4/.test(d)) return 'visa';
  if (/^(51|52|53|54|55|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^6(011|22|4|5)/.test(d)) return 'discover';
  if (/^(61|62|63|64)/.test(d)) return 'eftpos';  // EFTPOS Australia/NZ range
  return 'unknown';
}

/** Format card number with spaces: 4-4-4-4 or 4-6-5 for Amex */
export function formatCardNumber(raw: string, brand: CardBrand): string {
  const digits = raw.replace(/\D/g, '');
  if (brand === 'amex') {
    const p1 = digits.slice(0, 4);
    const p2 = digits.slice(4, 10);
    const p3 = digits.slice(10, 15);
    return [p1, p2, p3].filter(Boolean).join(' ');
  }
  return digits.match(/.{1,4}/g)?.join(' ') ?? digits;
}

/** Max card number length (digits only) */
export function cardMaxLength(brand: CardBrand): number {
  return brand === 'amex' ? 15 : 16;
}

export interface OcrCardResult {
  success: boolean;
  cardNumber?: string;
  expiry?: string;
  name?: string;
  error?: string;
  message?: string;
}

/** Send a base64 card photo to the OCR endpoint and extract card fields */
export async function ocrCard(imageBase64: string): Promise<OcrCardResult> {
  try {
    const res = await fetch(`${BASE_URL}/api/ocr/card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error, message: data.message };
    }
    return { success: true, cardNumber: data.cardNumber, expiry: data.expiry, name: data.name };
  } catch (err: any) {
    return { success: false, error: 'Network error', message: 'Could not reach the OCR server.' };
  }
}
