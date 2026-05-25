import { database } from './firebase';
import { ref, get } from 'firebase/database';

export interface DispatchConfig {
  baseUrl: string;
  passforlink: string;
}

let cachedConfig: DispatchConfig | null = null;

export async function getDispatchConfig(): Promise<DispatchConfig> {
  if (cachedConfig) return cachedConfig;

  const snapshot = await get(ref(database, 'links'));
  if (!snapshot.exists()) {
    throw new Error('Could not fetch dispatch config from Firebase');
  }
  const data = snapshot.val() as Record<string, string>;

  // Log all keys so we can see everything stored in Firebase links
  console.log('[DispatchAPI] Firebase links node keys:', Object.keys(data));
  console.log('[DispatchAPI] Firebase links raw:', JSON.stringify(data));

  // links/serviceon stores e.g. "https://360taxi.co.nz/webservices/api/DriverApp/FnServiceON"
  // Derive base URL by stripping the trailing action name segment
  const serviceonUrl: string = data['serviceon'] ?? '';
  const baseUrl = serviceonUrl.replace(/\/[^/]+$/, '/');

  cachedConfig = {
    baseUrl,
    passforlink: data['passforlink'],
  };

  console.log('[DispatchAPI] serviceon URL:', serviceonUrl);
  console.log('[DispatchAPI] Derived base URL:', baseUrl);
  return cachedConfig;
}

export function clearDispatchConfigCache() {
  cachedConfig = null;
}

// ── DriverStatusChanged → Busy ──────────────────────────────────────────────
// Called the instant the driver taps "Start Meter" or "Begin Trip".
// Posts to the DataProcessor endpoint (different path from the main API) so
// the dispatch board immediately flips the driver from Assigned → Busy and
// shows the active trip in the Active Jobs tab.
export interface DriverBusyPayload {
  driverId:      string;
  vehicleNumber: string;
  lat:           number;
  lng:           number;
  zoneName:      string;
  zoneId:        string | number;
  zoneQueue:     string | number;
}

export async function notifyDriverBusy(payload: DriverBusyPayload): Promise<void> {
  let origin: string;
  try {
    const config = await getDispatchConfig();
    origin = new URL(config.baseUrl).origin;
  } catch {
    return; // can't reach config — skip silently
  }

  const url = `${origin}/DataManager/Data.aspx/DataProcessor`;

  const body = new URLSearchParams();
  body.append('action',        '[DriverStatusChanged]');
  body.append('driverid',      payload.driverId);
  body.append('newstatus',     'Busy');
  body.append('vehiclenumber', payload.vehicleNumber);
  body.append('lat',           String(payload.lat));
  body.append('lng',           String(payload.lng));
  body.append('zonename',      payload.zoneName ?? '');
  body.append('zoneid',        String(payload.zoneId ?? 0));
  body.append('zonequeue',     String(payload.zoneQueue));

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 5000);
  console.log('[DispatchAPI] POST', url, '→ [DriverStatusChanged] Busy — driver:', payload.driverId);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
      signal:  controller.signal,
    });
    const text = await res.text().catch(() => '');
    console.log('[DispatchAPI] [DriverStatusChanged] HTTP', res.status, text.slice(0, 100));
  } catch (err: any) {
    // Best-effort — dispatch server may be offline, never block the driver
    console.warn('[DispatchAPI] [DriverStatusChanged] failed (non-blocking):', err?.message ?? err);
  } finally {
    clearTimeout(timeoutId);
  }
}

interface PostParams {
  Action: string;
  Parms: string;
  UserKey: string;
  Token?: string;
}

export async function dispatchPost<T = unknown>(params: PostParams): Promise<T> {
  const config = await getDispatchConfig();

  // Each action is its own endpoint: baseUrl + ActionName
  const url = config.baseUrl + params.Action;

  const body = new URLSearchParams();
  body.append('Parms', params.Parms);
  body.append('UserKey', params.UserKey);
  if (params.Token) body.append('Token', params.Token);

  console.log('[DispatchAPI] POST', url);
  console.log('[DispatchAPI] Parms:', params.Parms);

  // 5-second timeout — 360taxi.co.nz is permanently offline so we must not
  // let each call hang for the OS-level socket timeout (~60 s). Without this,
  // startup makes 2-3 blocking calls that stall the app for 2+ minutes.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (networkErr: any) {
    const isTimeout = networkErr?.name === 'AbortError';
    console.warn('[DispatchAPI]', params.Action, isTimeout ? 'timed out (5 s)' : 'network error:', networkErr?.message ?? String(networkErr));
    throw networkErr;
  } finally {
    clearTimeout(timeoutId);
  }

  console.log('[DispatchAPI]', params.Action, 'HTTP status:', res.status);
  const text = await res.text();
  console.log('[DispatchAPI] Response:', text.slice(0, 300));

  if (!res.ok) {
    throw new Error(`Dispatch API ${params.Action} returned HTTP ${res.status}: ${text.slice(0, 100)}`);
  }

  if (text.toLowerCase() === 'error') {
    throw new Error(`Dispatch API ${params.Action} returned error`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
