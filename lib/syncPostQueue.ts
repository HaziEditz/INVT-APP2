import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@taxi360_sync_post_queue';
const MAX_QUEUE_SIZE = 500;
const MAX_ATTEMPTS = 50;

export type SyncPostEntry = {
  id: string;
  url: string;
  payload: Record<string, unknown>;
  meta: {
    bookingId: any;
    driverId: any;
    serviceType: string;
    tripCloseTime: string;
  };
  attempts: number;
  lastAttempt: number | null;
  createdAt: number;
};

export async function readSyncPostQueue(): Promise<SyncPostEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SyncPostEntry[];
  } catch {
    return [];
  }
}

async function writeSyncPostQueue(items: SyncPostEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE_SIZE)));
  } catch (e) {
    console.warn('[SyncPostQueue] save failed:', e);
  }
}

export async function enqueueSyncPost(
  url: string,
  payload: Record<string, unknown>,
  meta: SyncPostEntry['meta'],
): Promise<void> {
  const queue = await readSyncPostQueue();
  // De-dup by bookingId so a retry-on-failure doesn't pile up duplicates
  const filtered = queue.filter(q => String(q.meta.bookingId) !== String(meta.bookingId));
  const entry: SyncPostEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    url,
    payload,
    meta,
    attempts: 0,
    lastAttempt: null,
    createdAt: Date.now(),
  };
  filtered.push(entry);
  await writeSyncPostQueue(filtered);
  console.log(`[SyncPostQueue] queued ${meta.bookingId} (${meta.serviceType}) — depth: ${filtered.length}`);
}

export async function syncPostQueueDepth(): Promise<number> {
  return (await readSyncPostQueue()).length;
}

export async function clearSyncPostQueue(): Promise<void> {
  try { await AsyncStorage.removeItem(QUEUE_KEY); } catch {}
}

/**
 * Attempt to re-POST every queued sync entry. Items that succeed are removed.
 * Items that fail have their attempts counter incremented. Items that exceed
 * MAX_ATTEMPTS are dropped to avoid unbounded retention.
 *
 * Safe to call from multiple triggers (foreground, network online, periodic,
 * post-success chain) — uses a per-process lock to prevent concurrent drains.
 */
let _draining = false;
export async function drainSyncPostQueue(): Promise<{ sent: number; remaining: number }> {
  if (_draining) return { sent: 0, remaining: -1 };
  _draining = true;
  try {
    const queue = await readSyncPostQueue();
    if (queue.length === 0) return { sent: 0, remaining: 0 };
    console.log(`[SyncPostQueue] draining ${queue.length} entries`);
    const survivors: SyncPostEntry[] = [];
    let sent = 0;
    for (const item of queue) {
      try {
        const res = await fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        });
        if (res.ok) {
          sent += 1;
          console.log(`[SyncPostQueue] ✓ ${item.meta.bookingId} (attempt ${item.attempts + 1})`);
          continue; // do NOT add to survivors
        }
        item.attempts += 1;
        item.lastAttempt = Date.now();
        if (item.attempts < MAX_ATTEMPTS) survivors.push(item);
        else console.warn(`[SyncPostQueue] ✗ ${item.meta.bookingId} dropped after ${MAX_ATTEMPTS} attempts (HTTP ${res.status})`);
      } catch (e) {
        item.attempts += 1;
        item.lastAttempt = Date.now();
        if (item.attempts < MAX_ATTEMPTS) survivors.push(item);
        else console.warn(`[SyncPostQueue] ✗ ${item.meta.bookingId} dropped after ${MAX_ATTEMPTS} attempts (network)`);
      }
    }
    await writeSyncPostQueue(survivors);
    console.log(`[SyncPostQueue] drain done — sent ${sent}, remaining ${survivors.length}`);
    return { sent, remaining: survivors.length };
  } finally {
    _draining = false;
  }
}
