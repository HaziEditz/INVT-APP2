import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

export interface TmConfig {
  councilSubsidyPercent: number;
  councilCapAmount: number;
  hoistCostPerUnit: number;
}

export const DEFAULT_TM_CONFIG: TmConfig = {
  councilSubsidyPercent: 65,
  councilCapAmount: 37.4,
  hoistCostPerUnit: 11.5,
};

export function parseTmConfig(val: unknown): TmConfig {
  if (!val || typeof val !== 'object') return { ...DEFAULT_TM_CONFIG };
  const t = val as Record<string, unknown>;
  return {
    councilSubsidyPercent: Number(t.councilSubsidyPercent ?? DEFAULT_TM_CONFIG.councilSubsidyPercent),
    councilCapAmount: Number(t.councilCapAmount ?? DEFAULT_TM_CONFIG.councilCapAmount),
    hoistCostPerUnit: Number(t.hoistCostPerUnit ?? DEFAULT_TM_CONFIG.hoistCostPerUnit),
  };
}

export async function loadTmConfig(companyId: string): Promise<TmConfig> {
  if (!companyId) return { ...DEFAULT_TM_CONFIG };
  try {
    const database = getDatabaseInstance();
    const snap = await get(ref(database, `companySettings/${companyId}/tmConfig`));
    return parseTmConfig(snap.val());
  } catch (err) {
    console.warn('[TmConfig] load failed:', err);
    return { ...DEFAULT_TM_CONFIG };
  }
}

export function isWavVehicle(bodyType: string): boolean {
  const lower = bodyType.toLowerCase();
  return lower.includes('wav') || lower.includes('wheelchair');
}

export function calcTmSplit(
  tripFare: number,
  config: TmConfig,
): { councilFarePays: number; passengerPays: number } {
  const rate = config.councilSubsidyPercent / 100;
  const councilFarePays = +Math.min(tripFare * rate, config.councilCapAmount).toFixed(2);
  const passengerPays = +(tripFare - councilFarePays).toFixed(2);
  return { councilFarePays, passengerPays };
}
