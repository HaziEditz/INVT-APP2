/**
 * config.ts — App-level constants for the BookaWaka Driver App.
 *
 * Server URL:
 *   At runtime, `getServerUrl()` from remoteConfig.ts reads `bwConfig/appSettings`
 *   in Firebase RTDB and uses the `serverUrl` field from there.
 *   BOOKAWAKA_SERVER below is the compile-time fallback only — used if Firebase
 *   is unreachable at startup.
 *
 *   Do NOT read from `links/serviceon` — that path belongs to the legacy 2018
 *   system running on the same Firebase database and must not be changed.
 *
 * Minimum version:
 *   `driverAppMinVersion` in `bwConfig/appSettings` controls the forced-upgrade gate.
 *   The SA portal stores this as a plain integer (e.g. 3).
 *   APP_BUILD is this app's integer build number — bump it with every release.
 *   APP_VERSION is the human-readable semver string shown in the UI.
 */

export const BOOKAWAKA_SERVER = 'https://bookawaka.replit.app';

export const APP_VERSION = '1.4.0';

/**
 * Integer build number — must match the format used by the SA portal's
 * "Driver App Min Version" field in App & Service Configuration.
 * Increment this by 1 with every release distributed to drivers.
 */
export const APP_BUILD = 5;
