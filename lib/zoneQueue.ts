import { PresenceDisplayStatus } from '@/types';

export type QueueDisplayInput = {
  shiftActive: boolean;
  hasTripInProgress: boolean;
  presenceStatus: PresenceDisplayStatus;
  readyForJobs: boolean;
  position: number;
  totalInQueue?: number;
  includeTotal?: boolean;
};

export function formatQueuePosition(position: number, totalInQueue?: number, includeTotal = false): string {
  if (position <= 0) return 'In Queue';
  if (includeTotal && totalInQueue && totalInQueue > 0) {
    return `#${position} of ${totalInQueue}`;
  }
  return `#${position}`;
}

/** Queue label for status bars — #N, In Queue, On Trip, or — */
export function formatQueueDisplay(input: QueueDisplayInput): string {
  if (!input.shiftActive) return '—';
  if (input.hasTripInProgress || input.presenceStatus === 'Busy') return 'On Trip';
  if (input.position > 0) {
    return formatQueuePosition(input.position, input.totalInQueue, input.includeTotal);
  }
  if (input.presenceStatus === 'Online' && input.readyForJobs) return 'In Queue';
  if (input.presenceStatus === 'Away') return 'Away';
  return 'In Queue';
}

/** Longer label for zone-queue screen hero */
export function formatQueueHero(input: QueueDisplayInput): string {
  if (!input.shiftActive) return 'Start your shift to join the queue';
  if (input.hasTripInProgress || input.presenceStatus === 'Busy') return 'On trip';
  if (input.position > 0) {
    const base = `You are #${input.position}`;
    return input.totalInQueue && input.totalInQueue > 0 ? `${base} of ${input.totalInQueue}` : base;
  }
  if (input.presenceStatus === 'Online' && input.readyForJobs) return 'In queue — waiting for position';
  if (input.presenceStatus === 'Away') return 'Away — not in queue';
  return 'In queue — waiting for position';
}

export function parseZoneFromOnlineNode(val: unknown): {
  name: string;
  position: number;
  totalInQueue: number;
  nearbyDrivers: number;
} {
  if (!val || typeof val !== 'object') {
    return { name: '', position: 0, totalInQueue: 0, nearbyDrivers: 0 };
  }
  const root = val as Record<string, unknown>;

  const readPosition = (obj: Record<string, unknown> | null | undefined): number => {
    if (!obj) return 0;
    const n = Number(obj.position ?? obj.queue ?? obj.zonequeue ?? obj.zoneQueue ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const readName = (obj: Record<string, unknown> | null | undefined): string => {
    if (!obj) return '';
    return String(obj.name ?? obj.zonename ?? obj.zoneName ?? obj.ZoneName ?? '').trim();
  };

  const zoneChild =
    root.zone && typeof root.zone === 'object' ? (root.zone as Record<string, unknown>) : null;
  const currentChild =
    root.current && typeof root.current === 'object' ? (root.current as Record<string, unknown>) : null;

  const position =
    readPosition(zoneChild) || readPosition(root) || readPosition(currentChild);
  const name = readName(zoneChild) || readName(root) || readName(currentChild);

  const totalInQueue = Number(
    zoneChild?.totalInQueue ??
      zoneChild?.total ??
      root.totalInQueue ??
      root.queueSize ??
      0,
  );
  const nearbyDrivers = Number(
    zoneChild?.nearbyDrivers ?? zoneChild?.nearby ?? root.nearbyDrivers ?? root.nearby ?? 0,
  );

  return {
    name,
    position,
    totalInQueue: Number.isFinite(totalInQueue) ? totalInQueue : 0,
    nearbyDrivers: Number.isFinite(nearbyDrivers) ? nearbyDrivers : 0,
  };
}
