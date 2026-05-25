/**
 * remoteConfig.ts — Reads runtime config from Firebase RTDB `bwConfig/appSettings`.
 *
 * Fields consumed:
 *   serverUrl           — BookaWaka API base URL (overrides hardcoded fallback)
 *   driverAppMinVersion — Minimum allowed build number.
 *                         The SA portal stores this as an integer (e.g. 3).
 *                         A semver string (e.g. "1.2.0") is also accepted as a
 *                         fallback format.
 *
 * Call `initRemoteConfig()` once at startup (before any API calls).
 * All API callers use `getServerUrl()` — returns cached value or fallback immediately.
 */

import { ref, get } from 'firebase/database';
import { database } from './firebase';

const PRODUCTION_SERVER = 'https://bookawaka-superadmin.replit.app';
const FALLBACK_SERVER = PRODUCTION_SERVER;

let _serverUrl: string = FALLBACK_SERVER;
let _minBuild: number | null = null;      // integer from SA portal (preferred)
let _minSemver: string | null = null;     // semver string fallback
let _initialized = false;

function semverLessThan(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false;
}

export async function initRemoteConfig(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  try {
    const snap = await Promise.race([
      get(ref(database, 'bwConfig/appSettings')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000)
      ),
    ]);

    if (!snap.exists()) {
      console.log('[RemoteConfig] bwConfig/appSettings not found — using defaults');
      return;
    }

    const data = snap.val() as Record<string, unknown>;

    // v22av: harden the URL guard. Firebase bwConfig/appSettings.serverUrl
    // was pointing at a Replit DEV PREVIEW URL ("*.spock.replit.dev" /
    // "*.replit.dev") — those only respond while the workspace is awake.
    // When it slept every /api/job/sync-offline-trip POST died, so completed
    // trips stayed "pending upload" forever even though the driver had
    // internet. Now we reject any dev preview URL and fall back to the
    // hardcoded PRODUCTION_SERVER. Only accept overrides that look like a
    // real production hostname.
    const rawUrl = typeof data.serverUrl === 'string' ? data.serverUrl.trim().replace(/\/$/, '') : '';
    const isDevPreview = rawUrl.includes('.replit.dev') || rawUrl.includes('.spock.') || rawUrl.includes('-00-');
    const isLegacyBad  = rawUrl.includes('bookawaka.replit.app'); // legacy bad host
    if (rawUrl && !isDevPreview && !isLegacyBad) {
      _serverUrl = rawUrl;
      console.log('[RemoteConfig] serverUrl (from Firebase):', _serverUrl);
    } else if (rawUrl) {
      console.warn('[RemoteConfig] Ignoring non-production serverUrl override:', rawUrl, '→ using', _serverUrl);
    }

    // Minimum version — SA portal stores as integer (e.g. 3)
    // Also accepts semver string (e.g. "1.2.0") for flexibility
    const raw = data.driverAppMinVersion;
    if (typeof raw === 'number' && !isNaN(raw)) {
      _minBuild = Math.floor(raw);
      console.log('[RemoteConfig] driverAppMinVersion (integer):', _minBuild);
    } else if (typeof raw === 'string' && raw.trim()) {
      const asInt = parseInt(raw.trim(), 10);
      if (!isNaN(asInt) && !raw.includes('.')) {
        // Plain integer stored as string — e.g. "3"
        _minBuild = asInt;
        console.log('[RemoteConfig] driverAppMinVersion (integer string):', _minBuild);
      } else {
        // Semver string — e.g. "1.2.0"
        _minSemver = raw.trim();
        console.log('[RemoteConfig] driverAppMinVersion (semver):', _minSemver);
      }
    }
  } catch (err: any) {
    console.warn('[RemoteConfig] Could not read bwConfig/appSettings (using defaults):', err?.message);
  }
}

export function getServerUrl(): string {
  return _serverUrl;
}

/**
 * Check whether the running app is below the minimum required version.
 *
 * @param currentBuild  APP_BUILD integer from config.ts
 * @param currentSemver APP_VERSION string from config.ts (fallback comparison)
 */
export function isUpdateRequired(currentBuild: number, currentSemver: string): boolean {
  // Prefer integer build comparison (SA portal format)
  if (_minBuild !== null) {
    return currentBuild < _minBuild;
  }
  // Fall back to semver string comparison
  if (_minSemver !== null) {
    return semverLessThan(currentSemver, _minSemver);
  }
  return false;
}
