/**
 * Weak / degrading cellular: NetInfo may still say "connected" while HTTP/RTDB hang.
 * Trip-critical actions must deadline → journal (or fail-fast), not wait on link status alone.
 */

export const STAGE_HTTP_TIMEOUT_MS = 10_000;
export const COMPLETE_HTTP_TIMEOUT_MS = 12_000;
/** Single transport attempt for stage/complete — no nested 45s×2 walls. */
export const STAGE_HTTP_MAX_ATTEMPTS = 1;
export const COMPLETE_HTTP_MAX_ATTEMPTS = 1;
export const AUTH_TOKEN_REFRESH_TIMEOUT_MS = 3_000;
export const HAIL_CREATE_TIMEOUT_MS = 8_000;
/** Cap address enrich before complete so weak RTDB/geocode cannot block payment. */
export const COMPLETE_ENRICH_TIMEOUT_MS = 2_500;
/** Cap Firebase stage verify on transport failure (prefer journal). */
export const STAGE_VERIFY_TIMEOUT_MS = 3_000;

/** Transport / timeout style failures — journal stage/complete instead of blocking UI. */
export function isTransportLikeError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object' && err !== null) {
    const name = String((err as { name?: string }).name || '');
    if (name === 'StageTransportError') return true;
  }
  if (err instanceof Error) {
    const msg = err.message || '';
    if (/timed out after \d+ms/i.test(msg)) return true;
    if (/Network request failed/i.test(msg)) return true;
    if (/Request timed out/i.test(msg)) return true;
  }
  return false;
}

/**
 * Online Arrived/OnBoard: try sync; on transport hang/fail → journal and continue locally.
 * Non-transport errors may still try a short Firebase verify before journaling.
 */
export async function runOnlineStageWithJournalFallback(deps: {
  syncStage: () => Promise<void>;
  journalStage: () => Promise<void>;
  /** Optional short verify when error is not clearly transport (e.g. 409). */
  verifyFirebase?: () => Promise<boolean>;
}): Promise<'synced' | 'journal_fallback' | 'verified'> {
  try {
    await deps.syncStage();
    return 'synced';
  } catch (err) {
    if (isTransportLikeError(err)) {
      await deps.journalStage();
      return 'journal_fallback';
    }
    if (deps.verifyFirebase) {
      try {
        const ok = await deps.verifyFirebase();
        if (ok) return 'verified';
      } catch {
        // fall through to journal
      }
    }
    await deps.journalStage();
    return 'journal_fallback';
  }
}

/**
 * Online complete: one HTTP attempt; on transport fail → journal (no long retry wall).
 * 409 catch-up is optional and must itself be budgeted by the caller.
 */
export async function runOnlineCompleteWithJournalFallback(deps: {
  completePayment: () => Promise<void>;
  journalComplete: () => Promise<void>;
  /** Optional single 409 catch-up; must not hang (caller wraps with timeout). */
  catchUpAndRetry?: () => Promise<void>;
}): Promise<'completed' | 'journal_fallback'> {
  try {
    await deps.completePayment();
    return 'completed';
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status?: number }).status)
        : NaN;
    if (status === 409 && deps.catchUpAndRetry) {
      try {
        await deps.catchUpAndRetry();
        return 'completed';
      } catch {
        // fall through to journal
      }
    }
    // Prefer journal over blocking payment UI — flush retries on reconnect.
    await deps.journalComplete();
    return 'journal_fallback';
  }
}

/**
 * Online hail create: on timeout/transport/any create fail → pending hail journal
 * (same optimistic path as airplane; clientTripId keeps create-or-get idempotent).
 */
export async function runOnlineHailCreateWithJournalFallback<T>(deps: {
  createHail: () => Promise<T>;
  createPendingJournal: () => Promise<void>;
}): Promise<{ mode: 'online'; result: T } | { mode: 'journal_fallback' }> {
  try {
    const result = await deps.createHail();
    return { mode: 'online', result };
  } catch {
    await deps.createPendingJournal();
    return { mode: 'journal_fallback' };
  }
}
