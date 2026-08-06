import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import {
  buildTmHoistEntries,
  calcTmPaymentBreakdown,
  calcTmSplit,
  DEFAULT_TM_CONFIG,
  mapCouncilRecordToCompanyTmConfig,
  parseTmConfigRecord,
  resolvePrimaryTmCard,
  type TmConfig,
  type TmHoistEntry,
  type TmPaymentBreakdown,
} from '@/lib/tmConfigLogic';

export type { TmConfig, TmHoistEntry, TmPaymentBreakdown };
export {
  buildTmHoistEntries,
  calcTmPaymentBreakdown,
  calcTmSplit,
  DEFAULT_TM_CONFIG,
  mapCouncilRecordToCompanyTmConfig,
  parseTmConfigRecord,
  resolvePrimaryTmCard,
};

export function tmConfigStorageKey(companyId: string): string {
  return `${STORAGE_KEYS.tmConfigCache}_${String(companyId || '').trim()}`;
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
  if (!companyId) return { ...DEFAULT_TM_CONFIG };
  try {
    const snap = await get(ref(getDatabaseInstance(), `companySettings/${companyId}/tmConfig`));
    if (!snap.exists()) {
      const cached = await loadCachedTmConfig(companyId);
      return cached ?? { ...DEFAULT_TM_CONFIG };
    }
    const parsed = parseTmConfigRecord(snap.val() as Record<string, unknown>);
    void saveCachedTmConfig(companyId, parsed).catch(() => {});
    return parsed;
  } catch (err) {
    console.warn('[TmConfig] load failed:', err);
    const cached = await loadCachedTmConfig(companyId).catch(() => null);
    return cached ?? { ...DEFAULT_TM_CONFIG };
  }
}
