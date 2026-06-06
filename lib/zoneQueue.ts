import { ZoneInfo } from '@/types';

const OFFLINE_STATUSES = new Set(['away', 'offline', 'off', 'inactive']);

type ParsedOnlineDriver = {
  vehicleId: string;
  zoneName: string;
  queuePos: number;
  waitSince: number;
  available: boolean;
};

function parseOnlineVehicle(vehicleId: string, vehNode: unknown): ParsedOnlineDriver | null {
  if (!vehNode || typeof vehNode !== 'object') return null;
  const v = vehNode as Record<string, unknown>;
  const current =
    v.current && typeof v.current === 'object' ? (v.current as Record<string, unknown>) : null;
  if (!current) return null;

  const isLive = current.online === true;
  const sessionStatus = String(current.vehiclestatus ?? current.VehicleStatus ?? '').toLowerCase();
  const rootStatus = String(v.vehiclestatus ?? v.VehicleStatus ?? '').toLowerCase();
  const status = (isLive ? sessionStatus : rootStatus) || sessionStatus || rootStatus;
  if (!status || OFFLINE_STATUSES.has(status)) return null;

  const available = status === 'available';
  const zoneName = String(
    current.zonename ??
      current.zoneName ??
      current.Zonename ??
      v.zonename ??
      v.zoneName ??
      v.zone ??
      '',
  ).trim();

  const queuePos = Number(
    v.zonequeue ?? v.zoneQueue ?? v.queue ?? current.zonequeue ?? current.zoneQueue ?? 0,
  );
  const waitSince = Number(v.queueWaitSince ?? current.queueWaitSince ?? current.lastSeen ?? 0);

  return { vehicleId, zoneName, queuePos, waitSince, available };
}

/** Rank available drivers in the same zone from online/{companyId}. */
export function computeZoneQueueFromOnline(
  onlineData: unknown,
  myVehicleId: string,
  myZoneName: string,
): Pick<ZoneInfo, 'position' | 'totalInQueue'> {
  const zoneName = myZoneName.trim();
  if (!zoneName || !onlineData || typeof onlineData !== 'object') {
    return { position: 0, totalInQueue: 0 };
  }

  const zoneKey = zoneName.toLowerCase();
  const entries: ParsedOnlineDriver[] = [];

  Object.entries(onlineData as Record<string, unknown>).forEach(([vehicleId, vehNode]) => {
    const parsed = parseOnlineVehicle(vehicleId, vehNode);
    if (!parsed?.available) return;
    if (parsed.zoneName.trim().toLowerCase() !== zoneKey) return;
    entries.push(parsed);
  });

  if (entries.length === 0) {
    return { position: 1, totalInQueue: 1 };
  }

  entries.sort((a, b) => {
    const aq = a.queuePos > 0 ? a.queuePos : Number.MAX_SAFE_INTEGER;
    const bq = b.queuePos > 0 ? b.queuePos : Number.MAX_SAFE_INTEGER;
    if (aq !== bq) return aq - bq;
    if (a.waitSince !== b.waitSince) return a.waitSince - b.waitSince;
    return a.vehicleId.localeCompare(b.vehicleId);
  });

  let idx = entries.findIndex((e) => e.vehicleId === myVehicleId);
  if (idx < 0) {
    entries.push({
      vehicleId: myVehicleId,
      zoneName,
      queuePos: Number.MAX_SAFE_INTEGER,
      waitSince: Date.now(),
      available: true,
    });
    entries.sort((a, b) => {
      const aq = a.queuePos > 0 && a.queuePos < Number.MAX_SAFE_INTEGER ? a.queuePos : a.waitSince;
      const bq = b.queuePos > 0 && b.queuePos < Number.MAX_SAFE_INTEGER ? b.queuePos : b.waitSince;
      return aq - bq;
    });
    idx = entries.findIndex((e) => e.vehicleId === myVehicleId);
  }

  return {
    position: idx >= 0 ? idx + 1 : 0,
    totalInQueue: entries.length,
  };
}
