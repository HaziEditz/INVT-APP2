import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

export type TmConfig = {
  councilSubsidyPercent: number;
  councilCapAmount: number;
  hoistCostPerUnit: number;
};

const DEFAULT_TM_CONFIG: TmConfig = {
  councilSubsidyPercent: 0,
  councilCapAmount: 0,
  hoistCostPerUnit: 0,
};

/** Load TM settings from `companySettings/{companyId}/tmConfig`. */
export async function loadTmConfig(companyId: string): Promise<TmConfig> {
  if (!companyId) return DEFAULT_TM_CONFIG;
  try {
    const snap = await get(ref(getDatabaseInstance(), `companySettings/${companyId}/tmConfig`));
    if (!snap.exists()) return DEFAULT_TM_CONFIG;
    const d = snap.val() as Record<string, unknown>;
    return {
      councilSubsidyPercent: Number(d.councilSubsidyPercent ?? d.subsidyPercent ?? 0) || 0,
      councilCapAmount: Number(d.councilCapAmount ?? d.capAmount ?? d.subsidyCap ?? 0) || 0,
      hoistCostPerUnit: Number(d.hoistCostPerUnit ?? d.hoistCost ?? 0) || 0,
    };
  } catch (err) {
    console.warn('[TmConfig] load failed:', err);
    return DEFAULT_TM_CONFIG;
  }
}

export function calcTmSplit(
  totalFare: number,
  config: TmConfig,
): { councilPays: number; passengerPays: number } {
  const councilPays = Math.min(
    (totalFare * config.councilSubsidyPercent) / 100,
    config.councilCapAmount,
  );
  const passengerPays = Math.max(0, totalFare - councilPays);
  return { councilPays: +councilPays.toFixed(2), passengerPays: +passengerPays.toFixed(2) };
}
