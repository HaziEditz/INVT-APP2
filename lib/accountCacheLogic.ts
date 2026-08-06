import type { DriverAccountSearchHit } from './dispatchApi';

export type CachedBusinessAccount = {
  id: string;
  name: string;
  accountCode?: string;
  lastUsedAt: number;
};

export const MAX_CACHED_ACCOUNTS = 40;

export function normalizeAccountQuery(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

/** Filter cached accounts by name or account code (substring, case-insensitive). */
export function filterCachedAccounts(
  entries: CachedBusinessAccount[],
  query: string,
): CachedBusinessAccount[] {
  const q = normalizeAccountQuery(query);
  if (q.length < 1) return [];
  return entries
    .filter((e) => {
      const name = normalizeAccountQuery(e.name);
      const code = normalizeAccountQuery(e.accountCode || '');
      const id = normalizeAccountQuery(e.id);
      return name.includes(q) || code.includes(q) || id.includes(q);
    })
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** Upsert by id; keep most-recently-used first; cap list size. */
export function upsertCachedAccount(
  entries: CachedBusinessAccount[],
  hit: { id: string; name: string; accountCode?: string },
  nowMs = Date.now(),
  max = MAX_CACHED_ACCOUNTS,
): CachedBusinessAccount[] {
  const id = String(hit.id || '').trim();
  if (!id) return entries.slice();
  const name = String(hit.name || '').trim() || id;
  const accountCode = String(hit.accountCode || '').trim() || undefined;
  const next: CachedBusinessAccount = {
    id,
    name,
    ...(accountCode ? { accountCode } : {}),
    lastUsedAt: nowMs,
  };
  const rest = entries.filter((e) => e.id !== id);
  return [next, ...rest].slice(0, max);
}

export function cachedAccountToSearchHit(e: CachedBusinessAccount): DriverAccountSearchHit {
  return {
    Id: e.id,
    Name: e.name,
    ...(e.accountCode ? { AccountCode: e.accountCode } : {}),
  };
}

/** Prefer exact code/name match, else first hit. */
export function pickBestAccountMatch(
  hits: DriverAccountSearchHit[],
  query: string,
): DriverAccountSearchHit | null {
  if (!hits.length) return null;
  const q = normalizeAccountQuery(query);
  if (!q) return hits[0] ?? null;
  const exactCode = hits.find(
    (h) => normalizeAccountQuery(String(h.AccountCode || '')) === q,
  );
  if (exactCode) return exactCode;
  const exactName = hits.find((h) => normalizeAccountQuery(String(h.Name || '')) === q);
  if (exactName) return exactName;
  const includes = hits.find((h) => {
    const name = normalizeAccountQuery(String(h.Name || ''));
    const code = normalizeAccountQuery(String(h.AccountCode || ''));
    return name.includes(q) || code.includes(q);
  });
  return includes || hits[0] || null;
}

export type PendingAccountFields = {
  accountId?: string;
  accountName?: string;
  accountPending?: boolean;
  accountRef?: string;
};

/**
 * Resolve free-text / pending Account fields against live search on reconnect.
 * Returns unresolved=true when still no id (caller may still complete with name only).
 */
export async function resolvePendingAccountFields(
  fields: PendingAccountFields,
  opts: {
    search: (query: string) => Promise<DriverAccountSearchHit[]>;
    remember?: (hit: { id: string; name: string; accountCode?: string }) => Promise<void>;
  },
): Promise<PendingAccountFields & { unresolved?: boolean }> {
  const accountId = String(fields.accountId || '').trim();
  const accountName = String(fields.accountName || '').trim();
  const accountRef = String(fields.accountRef || '').trim();
  if (accountId) {
    return {
      accountId,
      ...(accountName ? { accountName } : {}),
      accountPending: false,
    };
  }
  const pending = !!fields.accountPending || (!accountId && !!(accountName || accountRef));
  if (!pending) {
    return {
      ...(accountName ? { accountName } : {}),
      accountPending: false,
    };
  }
  const query = accountRef || accountName;
  if (!query) {
    return { accountPending: true, unresolved: true };
  }
  try {
    const hits = await opts.search(query);
    const best = pickBestAccountMatch(hits, query);
    if (!best) {
      return {
        ...(accountName ? { accountName } : {}),
        ...(accountRef ? { accountRef } : {}),
        accountPending: true,
        unresolved: true,
      };
    }
    const id = String(best.Id ?? '').trim();
    const name = String(best.Name || '').trim() || accountName || query;
    const accountCode = String(best.AccountCode || '').trim() || undefined;
    if (id && opts.remember) {
      await opts.remember({ id, name, ...(accountCode ? { accountCode } : {}) });
    }
    return {
      accountId: id || undefined,
      accountName: name,
      accountPending: !id,
      unresolved: !id,
    };
  } catch {
    return {
      ...(accountName ? { accountName } : {}),
      ...(accountRef ? { accountRef } : {}),
      accountPending: true,
      unresolved: true,
    };
  }
}
