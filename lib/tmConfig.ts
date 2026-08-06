import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';

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

export function tmConfigStorageKey(companyId: string): string {
  return `${STORAGE_KEYS.tmConfigCache}_${String(companyId || '').trim()}`;
}

export function parseTmConfigRecord(d: Record<string, unknown> | null | undefined): TmConfig {
  if (!d || typeof d !== 'object') return { ...DEFAULT_TM_CONFIG };
  return {
    councilSubsidyPercent: Number(d.councilSubsidyPercent ?? d.subsidyPercent ?? 0) || 0,
    councilCapAmount: Number(d.councilCapAmount ?? d.capAmount ?? d.subsidyCap ?? 0) || 0,
    hoistCostPerUnit: Number(d.hoistCostPerUnit ?? d.hoistCost ?? 0) || 0,
  };
}

export async function loadCachedTmConfig(companyId: string): Promise<TmConfig | null> {
  const cid = String(companyId || '').trim();
  if (!cid) return null;
  const raw = await getData<TmConfig>(tmConfigStorageKey(cid));
  if (!raw || typeof raw !== 'object') return null;
  return parseTmConfigRecord(raw as unknown as Record<string, unknown>);
}

export async function saveCachedTmConfig(companyId: string, config: TmConfig): Promise<void> {
  const cid = String(companyId || '').trim();
  if (!cid) return;
  await storeData(tmConfigStorageKey(cid), config);
}

/** Load TM settings from `companySettings/{companyId}/tmConfig` (falls back to local cache). */
export async function loadTmConfig(companyId: string): Promise<TmConfig> {
  if (!companyId) return DEFAULT_TM_CONFIG;
  try {
    const snap = await get(ref(getDatabaseInstance(), `companySettings/${companyId}/tmConfig`));
    if (!snap.exists()) {
      const cached = await loadCachedTmConfig(companyId);
      return cached ?? DEFAULT_TM_CONFIG;
    }
    const parsed = parseTmConfigRecord(snap.val() as Record<string, unknown>);
    void saveCachedTmConfig(companyId, parsed).catch(() => {});
    return parsed;
  } catch (err) {
    console.warn('[TmConfig] load failed:', err);
    const cached = await loadCachedTmConfig(companyId).catch(() => null);
    return cached ?? DEFAULT_TM_CONFIG;
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
