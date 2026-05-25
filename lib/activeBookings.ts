import { getDispatchConfig } from './dispatchApi';

export type ActiveBookingStatus = 'offered' | 'queued' | 'current';

export interface ActiveBooking {
  bookingId: string;
  status: ActiveBookingStatus;
  version: number;
  updatedAt: number;
  jobBookingSrc?: string;
  passengerName?: string;
  passengerPhone?: string;
  pickupAddress?: string;
  dropAddress?: string;
  fare?: number;
  paymentType?: string;
  wheelchair?: boolean;
  passengers?: number;
  notes?: string;
}

export interface ActiveBookingsResponse {
  ok: boolean;
  driverId?: string;
  companyId?: string;
  vehicleId?: string;
  bookings: ActiveBooking[];
  fetchedAt?: number;
}

/**
 * G6 — reconnect rebuild. Called on every Firebase .info/connected → true
 * transition. Dispatch derives companyId + vehicleId server-side from the
 * driver record keyed by X-User-Key (driver.passforlink). Never pass cid/vid
 * as query params — server ignores them per the agreed contract.
 *
 * Returns null on any error (network, auth, parse) — caller must treat that
 * as "skip reconcile this cycle" and rely on the regular Firebase listeners.
 */
export async function fetchActiveBookings(
  passforlink: string,
): Promise<ActiveBookingsResponse | null> {
  if (!passforlink) return null;

  let origin: string;
  try {
    const config = await getDispatchConfig();
    origin = new URL(config.baseUrl).origin;
  } catch {
    return null;
  }

  const url = `${origin}/api/driver/active-bookings`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-User-Key': passforlink, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn('[ActiveBookings] HTTP', res.status);
      return null;
    }
    const json = (await res.json()) as ActiveBookingsResponse;
    if (!json || json.ok !== true || !Array.isArray(json.bookings)) {
      console.warn('[ActiveBookings] malformed response');
      return null;
    }
    return json;
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    console.warn('[ActiveBookings]', isTimeout ? 'timed out' : 'failed:', err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
