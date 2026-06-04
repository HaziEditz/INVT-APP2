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

export const STORAGE_KEYS = {
  driverSession: 'bw_driver_session',
  offlineQueue: 'bw_offline_queue',
  activeJob: 'bw_active_job',
  nztaHours: 'bw_nzta_hours',
  selectedVehicle: 'bw_selected_vehicle',
  shiftActive: 'bw_shift_active',
  selectedTariffId: 'bw_selected_tariff',
  meterState: 'bw_meter_state',
  vehicleSessionReady: 'bw_vehicle_session_ready',
} as const;
