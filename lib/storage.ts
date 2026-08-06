import AsyncStorage from '@react-native-async-storage/async-storage';

export async function storeData<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function getData<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function removeData(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

/** Per-driver NZTA hours + lockout (never share across drivers on one device). */
export function nztaHoursStorageKey(companyId: string, uid: string): string {
  return `bw_nzta_hours_${String(companyId || '').trim()}_${String(uid || '').trim()}`;
}

export const STORAGE_KEYS = {
  driverSession: 'bw_driver_session',
  offlineQueue: 'bw_offline_queue',
  activeJob: 'bw_active_job',
  /** @deprecated legacy device-wide key — migrate to nztaHoursStorageKey on login */
  nztaHours: 'bw_nzta_hours',
  selectedVehicle: 'bw_selected_vehicle',
  shiftActive: 'bw_shift_active',
  selectedTariffId: 'bw_selected_tariff',
  meterState: 'bw_meter_state',
  vehicleSessionReady: 'bw_vehicle_session_ready',
  /** Phase 5b — pending hail clientTripId until create succeeds (retry-safe). */
  pendingHailClientTripId: 'bw_pending_hail_client_trip_id',
  /** Phase 5c — offline trip journals (hail create + later stage events). */
  tripJournal: 'bw_trip_journal',
  /** Phase 5d — persistent Syncing… banner text until offline flush completes. */
  pendingSyncBanner: 'bw_pending_sync_banner',
  /** Offline complete — full closed-job snapshot (addresses etc.) until Firebase write succeeds. */
  pendingClosedJobs: 'bw_pending_closed_jobs',
  /** Offline end-shift — deferred Firebase shiftLogs + presence clear until reconnect. */
  pendingShiftEnds: 'bw_pending_shift_ends',
  /** Frequent/recent business accounts for offline Account payment (suffix companyId). */
  accountCache: 'bw_account_cache',
  /** Cached TM companySettings/{cid}/tmConfig for offline TM split. */
  tmConfigCache: 'bw_tm_config_cache',
} as const;
