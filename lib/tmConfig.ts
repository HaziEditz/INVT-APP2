import { get, ref, update } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { withTimeout } from '@/lib/asyncTimeout';
import {
  buildTmHoistEntries,
  calcTmPaymentBreakdown,
  calcTmSplit,
  DEFAULT_TM_CONFIG,
  isTmConfigReadyForConfirm,
  mapCouncilRecordToCompanyTmConfig,
  parseTmConfigRecord,
  resolvePrimaryTmCard,
  tmConfigConfirmBlockReason,
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
  isTmConfigReadyForConfirm,
  mapCouncilRecordToCompanyTmConfig,
  parseTmConfigRecord,
  resolvePrimaryTmCard,
  tmConfigConfirmBlockReason,
};

/** Hard ceiling so offline Confirm never hangs on Firebase get(). */
export const TM_CONFIG_FETCH_TIMEOUT_MS = 2_500;

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

/**
 * Load TM settings from cache first, then refresh from Firebase with a hard timeout.
 * Never hangs Confirm offline — returns usable cache (or DEFAULT) if the network stalls.
 */
export async function loadTmConfig(companyId: string): Promise<TmConfig> {
  if (!companyId) return { ...DEFAULT_TM_CONFIG };

  const cached = await loadCachedTmConfig(companyId).catch(() => null);

  try {
    const snap = await withTimeout(
      get(ref(getDatabaseInstance(), `companySettings/${companyId}/tmConfig`)),
      TM_CONFIG_FETCH_TIMEOUT_MS,
      'loadTmConfig',
    );
    if (!snap.exists()) {
      return cached ?? { ...DEFAULT_TM_CONFIG };
    }
    const parsed = parseTmConfigRecord(snap.val() as Record<string, unknown>);
    void saveCachedTmConfig(companyId, parsed).catch(() => {});
    return parsed;
  } catch (err) {
    console.warn('[TmConfig] load failed/timed out — using cache:', err);
    return cached ?? { ...DEFAULT_TM_CONFIG };
  }
}
