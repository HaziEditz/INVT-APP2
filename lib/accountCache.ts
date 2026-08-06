import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import type { DriverAccountSearchHit } from '@/lib/dispatchApi';
import {
  cachedAccountToSearchHit,
  filterCachedAccounts,
  type CachedBusinessAccount,
  type PendingAccountFields,
  pickBestAccountMatch,
  resolvePendingAccountFields,
  upsertCachedAccount,
} from '@/lib/accountCacheLogic';

export type { CachedBusinessAccount, PendingAccountFields, DriverAccountSearchHit };
export {
  cachedAccountToSearchHit,
  filterCachedAccounts,
  pickBestAccountMatch,
  resolvePendingAccountFields,
  upsertCachedAccount,
};

export type AccountCacheStore = {
  get: <T>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T) => Promise<void>;
};

const defaultStore: AccountCacheStore = {
  get: getData,
  set: storeData,
};

export function accountCacheStorageKey(companyId: string): string {
  return `${STORAGE_KEYS.accountCache}_${String(companyId || '').trim()}`;
}

export async function loadAccountCache(
  companyId: string,
  store: AccountCacheStore = defaultStore,
): Promise<CachedBusinessAccount[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  const rows = await store.get<CachedBusinessAccount[]>(accountCacheStorageKey(cid));
  return Array.isArray(rows) ? rows.filter((e) => e && e.id) : [];
}

export async function rememberBusinessAccount(
  companyId: string,
  hit: { id: string; name: string; accountCode?: string },
  store: AccountCacheStore = defaultStore,
): Promise<void> {
  const cid = String(companyId || '').trim();
  if (!cid || !String(hit.id || '').trim()) return;
  const prev = await loadAccountCache(cid, store);
  const next = upsertCachedAccount(prev, hit);
  await store.set(accountCacheStorageKey(cid), next);
}

export async function searchCachedAccounts(
  companyId: string,
  query: string,
  store: AccountCacheStore = defaultStore,
): Promise<CachedBusinessAccount[]> {
  const entries = await loadAccountCache(companyId, store);
  return filterCachedAccounts(entries, query);
}
