import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import type { OfflineQueueItem } from '@/types';
import { hasPendingTripJournalWork } from '@/services/tripJournalService';
import {
  choosePendingSyncBanner,
  type PendingSyncBanner,
} from '@/lib/pendingSyncBannerChoice';

export type { PendingSyncBanner };
export { choosePendingSyncBanner };

export async function loadPendingSyncBanner(): Promise<PendingSyncBanner | null> {
  return (await getData<PendingSyncBanner>(STORAGE_KEYS.pendingSyncBanner)) ?? null;
}

export async function savePendingSyncBanner(banner: PendingSyncBanner | null): Promise<void> {
  await storeData(STORAGE_KEYS.pendingSyncBanner, banner);
}

/** Recompute banner from offline queue + trip journal (source of truth after flush). */
export async function resolvePendingSyncBanner(): Promise<PendingSyncBanner | null> {
  const queue = (await getData<OfflineQueueItem[]>(STORAGE_KEYS.offlineQueue)) ?? [];
  const actions = queue
    .filter((item) => item.type === 'job_update')
    .map((item) => String(item.payload?.action || ''));
  const journalPending = await hasPendingTripJournalWork();
  return choosePendingSyncBanner(actions, journalPending);
}
