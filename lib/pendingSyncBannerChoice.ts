export type PendingSyncBanner = {
  message: string;
  reason: 'cancel' | 'no_show' | 'stages' | 'hail' | 'mixed';
  at: number;
};

/** Pure banner choice from queue actions + journal pending (unit-testable). */
export function choosePendingSyncBanner(
  queueActions: Array<'cancel' | 'no_show' | string>,
  journalPending: boolean,
  at = Date.now(),
): PendingSyncBanner | null {
  const cancelOrNoShow = queueActions.filter((a) => a === 'cancel' || a === 'no_show');
  if (cancelOrNoShow.length && journalPending) {
    return { message: 'Syncing…', reason: 'mixed', at };
  }
  if (cancelOrNoShow.length) {
    const actions = new Set(cancelOrNoShow);
    if (actions.has('no_show') && !actions.has('cancel')) {
      return { message: 'Syncing no-show…', reason: 'no_show', at };
    }
    if (actions.has('cancel') && !actions.has('no_show')) {
      return { message: 'Syncing cancel…', reason: 'cancel', at };
    }
    return { message: 'Syncing…', reason: 'mixed', at };
  }
  if (journalPending) {
    return { message: 'Syncing…', reason: 'stages', at };
  }
  return null;
}
