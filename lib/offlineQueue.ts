import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@taxi360_offline_queue';
const MAX_GPS_ENTRIES = 5;   // keep only last 5 GPS pings
const MAX_QUEUE_SIZE = 200;  // safety cap — prevent unbounded growth

export type WriteOp = 'set' | 'update' | 'remove' | 'push';

export type QueuedWrite = {
  id: string;
  type: 'gps' | 'jobStatus' | 'jobComplete' | 'chat' | 'presence' | 'hailComplete' | 'generic';
  path: string;
  op: WriteOp;
  data?: Record<string, unknown>;
  timestamp: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function readQueue(): Promise<QueuedWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedWrite[];
  } catch {
    return [];
  }
}

async function saveQueue(q: QueuedWrite[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (e) {
    console.warn('[OfflineQueue] Failed to save queue:', e);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function enqueueWrite(
  type: QueuedWrite['type'],
  path: string,
  op: WriteOp,
  data?: Record<string, unknown>,
): Promise<void> {
  const queue = await readQueue();

  // For GPS: evict older GPS entries so they don't pile up; keep last N
  const pruned = type === 'gps'
    ? queue.filter(q => q.type !== 'gps').concat(
        queue.filter(q => q.type === 'gps').slice(-(MAX_GPS_ENTRIES - 1))
      )
    : queue;

  const entry: QueuedWrite = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    path,
    op,
    data,
    timestamp: Date.now(),
  };

  const next = [...pruned, entry].slice(-MAX_QUEUE_SIZE);
  await saveQueue(next);
  console.log(`[OfflineQueue] Enqueued ${type} (${op}) @ ${path} — queue length: ${next.length}`);
}

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
    console.log('[OfflineQueue] Queue cleared');
  } catch (e) {
    console.warn('[OfflineQueue] Failed to clear queue:', e);
  }
}

/**
 * Overwrite the queue with a specific set of items.
 * Used by flushQueue to preserve items that failed — instead of clearing
 * everything unconditionally, only succeeded items are removed.
 */
export async function rewriteQueue(items: QueuedWrite[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    console.log(`[OfflineQueue] Queue rewritten — ${items.length} item(s) retained for retry`);
  } catch (e) {
    console.warn('[OfflineQueue] Failed to rewrite queue:', e);
  }
}

export async function queueLength(): Promise<number> {
  const q = await readQueue();
  return q.length;
}
