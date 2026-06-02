import NetInfo from '@react-native-community/netinfo';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { OfflineQueueItem } from '@/types';
import { dispatchPost } from '@/lib/dispatchApi';

export async function enqueueOfflineItem(item: Omit<OfflineQueueItem, 'id' | 'createdAt'>) {
  const queue = (await getData<OfflineQueueItem[]>(STORAGE_KEYS.offlineQueue)) ?? [];
  const next: OfflineQueueItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  queue.push(next);
  await storeData(STORAGE_KEYS.offlineQueue, queue);
  return next;
}

export async function flushOfflineQueue() {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return 0;

  const queue = (await getData<OfflineQueueItem[]>(STORAGE_KEYS.offlineQueue)) ?? [];
  if (!queue.length) return 0;

  const remaining: OfflineQueueItem[] = [];
  for (const item of queue) {
    try {
      await dispatchPost('/api/offline-sync', { type: item.type, payload: item.payload });
    } catch {
      remaining.push(item);
    }
  }
  await storeData(STORAGE_KEYS.offlineQueue, remaining);
  return queue.length - remaining.length;
}

export function subscribeConnectivity(onChange: (online: boolean) => void) {
  return NetInfo.addEventListener((state) => {
    onChange(!!state.isConnected);
  });
}
