import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

export interface DispatchConfig {
  baseUrl: string;
  passforlink: string;
  serviceonUrl: string;
}

let cached: DispatchConfig | null = null;

/** Reads legacy dispatch URLs from Firebase RTDB `links` (same as Driver Portal). */
export async function getDispatchConfig(): Promise<DispatchConfig> {
  if (cached) return cached;

  const snapshot = await get(ref(getDatabaseInstance(), 'links'));
  if (!snapshot.exists()) {
    throw new Error('Dispatch links not found in Firebase');
  }
  const data = snapshot.val() as Record<string, string>;
  const serviceonUrl = String(data.serviceon ?? '').trim();
  if (!serviceonUrl) {
    throw new Error('links/serviceon missing in Firebase');
  }
  const baseUrl = serviceonUrl.replace(/\/[^/]+$/, '/');
  cached = {
    baseUrl,
    serviceonUrl,
    passforlink: String(data.passforlink ?? data.PassForLink ?? ''),
  };
  return cached;
}

export function clearDispatchConfigCache() {
  cached = null;
}
