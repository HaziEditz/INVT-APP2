/** Numeric dispatch booking IDs (e.g. 8692606166), hail_* legacy, or local: provisional (Phase 5c). */
export function isValidBookingId(id: string | number | undefined | null): boolean {
  const s = String(id ?? '').trim();
  if (!s) return false;
  if (s.startsWith('hail_')) return true;
  if (s.startsWith('local:')) return true;
  return /^\d{8,}$/.test(s);
}

/** True for offline-provisional hail ids that must not hit stage/complete APIs yet. */
export function isProvisionalBookingId(id: string | number | undefined | null): boolean {
  const s = String(id ?? '').trim();
  return s.startsWith('local:') || s.startsWith('hail_');
}

export function localJobIdFromClientTripId(clientTripId: string): string {
  return `local:${String(clientTripId || '').trim()}`;
}

/** Phase 5d — stable trip-journal key for a numeric dispatch booking. */
export function dispatchJournalKey(jobId: string | number): string {
  return `job:${String(jobId || '').trim()}`;
}

/**
 * Phase 5e — journal key for an active job, or null if it cannot be journalled.
 * Prefers clientTripId (hail); falls back to job:{numericId} for dispatch.
 */
export function resolveJournalClientTripId(job: {
  id?: string | number | null;
  clientTripId?: string | null;
}): string | null {
  const clientTripId = String(job.clientTripId ?? '').trim();
  if (clientTripId) return clientTripId;
  const id = String(job.id ?? '').trim();
  if (id.startsWith('local:')) {
    const rest = id.slice('local:'.length).trim();
    return rest || null;
  }
  if (/^\d+$/.test(id) && !isProvisionalBookingId(id)) return dispatchJournalKey(id);
  return null;
}

export function normalizeBookingId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (s.includes(',')) return s.split(',')[0].trim();
  return s;
}
