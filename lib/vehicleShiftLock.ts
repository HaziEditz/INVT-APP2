import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { Vehicle } from '@/types';

const LOGGED_OUT_STATUSES = new Set(['offline', 'loggedout', 'logoff', 'inactive']);

export type VehicleShiftLock = {
  vehicleId: string;
  inUse: boolean;
  occupantDriverId?: string;
  occupantName?: string;
};

function normVehicleId(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Normalize driver id / uid for comparison (numeric ids as canonical string). */
export function normDriverRef(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const n = parseInt(s, 10);
  if (!Number.isNaN(n) && String(n) === s) return String(n);
  return s.toLowerCase();
}

export function driverIdentityKeys(driverId?: string, uid?: string): Set<string> {
  const keys = new Set<string>();
  for (const raw of [driverId, uid]) {
    const k = normDriverRef(raw);
    if (k) keys.add(k);
  }
  return keys;
}

function resolveOnlineDriverId(rec: Record<string, unknown>, current: Record<string, unknown>): string {
  return String(
    rec.driverid ??
      rec.driverId ??
      rec.DriverId ??
      current.driverId ??
      current.driverid ??
      current.DriverId ??
      '',
  ).trim();
}

function resolveOnlineDriverName(rec: Record<string, unknown>, current: Record<string, unknown>): string {
  return String(
    rec.drivername ??
      rec.driverName ??
      rec.DriverName ??
      current.drivername ??
      current.driverName ??
      '',
  ).trim();
}

/** Stray post-sign-out node — no bound driver. */
export function isGhostOnlineNode(
  rec: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  const driverId = resolveOnlineDriverId(rec, current);
  const driverName = resolveOnlineDriverName(rec, current);
  if (driverId || driverName) return false;

  const status = String(rec.vehiclestatus ?? rec.VehicleStatus ?? current.vehiclestatus ?? '')
    .trim()
    .toLowerCase();
  if (status === 'available') return true;

  const hasGps = !!(rec.lat || rec.lng || current.lat || current.lng || rec.Lat || current.Lat);
  const lastSeenRaw = rec.lastSeen ?? current.lastSeen;
  if (!hasGps && (lastSeenRaw == null || lastSeenRaw === '' || Number(lastSeenRaw) === 0)) {
    return true;
  }
  return false;
}

/** Firebase online/{cid}/{vid} after shift end / sign-out. */
export function isLoggedOutOnlineNode(
  rec: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  const statuses = [
    rec.vehiclestatus,
    rec.VehicleStatus,
    rec.status,
    current.vehiclestatus,
    current.VehicleStatus,
    current.currentstatus,
    current.status,
  ];
  for (const raw of statuses) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s && LOGGED_OUT_STATUSES.has(s)) return true;
  }
  if (rec.online === false && current.online === false) return true;
  if (rec.shiftStarted === false && current.shiftStarted === false) {
    const hasLiveTrip = !!(current.currentJobId || current.jobId || rec.currentJobId || rec.jobId);
    if (!hasLiveTrip) return true;
  }
  return false;
}

/** True when any driver appears to be on shift with this vehicle. */
export function isVehicleShiftActive(
  rec: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  if (isLoggedOutOnlineNode(rec, current)) return false;
  if (isGhostOnlineNode(rec, current)) return false;

  if (rec.shiftStarted === true || current.shiftStarted === true) return true;
  if (rec.online === true || current.online === true) return true;

  const occupant = resolveOnlineDriverId(rec, current);
  if (occupant) return true;

  const status = String(
    rec.vehiclestatus ?? rec.VehicleStatus ?? current.vehiclestatus ?? current.VehicleStatus ?? '',
  )
    .trim()
    .toLowerCase();
  return !!status && !LOGGED_OUT_STATUSES.has(status);
}

export function evaluateVehicleShiftLock(
  vehicleId: string,
  rec: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
  myKeys: Set<string>,
  registryDriverId?: string,
): VehicleShiftLock {
  const vid = normVehicleId(vehicleId);
  const base = rec ?? {};
  const cur = current ?? {};

  const occupantFromOnline = resolveOnlineDriverId(base, cur);
  const occupantFromRegistry = String(registryDriverId ?? '').trim();
  const occupantDriverId = occupantFromOnline || occupantFromRegistry;
  const occupantName = resolveOnlineDriverName(base, cur);

  const onlineActive = isVehicleShiftActive(base, cur);
  const hasOnlineRecord = Object.keys(base).length > 0 || Object.keys(cur).length > 0;
  const registryOnlyActive = !hasOnlineRecord && !!occupantFromRegistry;
  const shiftActive = onlineActive || registryOnlyActive;

  if (!shiftActive) {
    return { vehicleId: vid, inUse: false };
  }

  if (occupantDriverId) {
    const mine = [...myKeys].some((k) => k === normDriverRef(occupantDriverId));
    if (mine) return { vehicleId: vid, inUse: false };
  }

  return {
    vehicleId: vid,
    inUse: true,
    occupantDriverId: occupantDriverId || undefined,
    occupantName: occupantName || undefined,
  };
}

export async function fetchVehicleShiftLocks(
  companyId: string,
  vehicleIds: string[],
  myDriverId: string,
  myUid: string,
): Promise<Map<string, VehicleShiftLock>> {
  const locks = new Map<string, VehicleShiftLock>();
  if (!companyId || vehicleIds.length === 0) return locks;

  const wanted = new Set(vehicleIds.map(normVehicleId));
  const myKeys = driverIdentityKeys(myDriverId, myUid);
  const db = getDatabaseInstance();

  let registry: Record<string, Record<string, unknown>> = {};
  try {
    const regSnap = await get(ref(db, `vehicles/${companyId}`));
    if (regSnap.exists()) {
      regSnap.forEach((child) => {
        const key = child.key?.toUpperCase();
        if (key) registry[key] = (child.val() ?? {}) as Record<string, unknown>;
      });
    }
  } catch {
    // non-fatal — online nodes are authoritative
  }

  try {
    const onlineSnap = await get(ref(db, `online/${companyId}`));
    if (!onlineSnap.exists()) {
      for (const vid of wanted) {
        const reg = registry[vid];
        const regDriver = reg ? String(reg.currentDriverId ?? reg.CurrentDriverId ?? '').trim() : '';
        locks.set(vid, evaluateVehicleShiftLock(vid, null, null, myKeys, regDriver || undefined));
      }
      return locks;
    }

    const seen = new Set<string>();
    onlineSnap.forEach((child) => {
      const vid = normVehicleId(child.key ?? '');
      if (!wanted.has(vid)) return;
      seen.add(vid);
      const rec = (child.val() ?? {}) as Record<string, unknown>;
      const current = (rec.current as Record<string, unknown>) ?? {};
      const reg = registry[vid];
      const regDriver = reg ? String(reg.currentDriverId ?? reg.CurrentDriverId ?? '').trim() : '';
      locks.set(vid, evaluateVehicleShiftLock(vid, rec, current, myKeys, regDriver || undefined));
    });

    for (const vid of wanted) {
      if (seen.has(vid)) continue;
      const reg = registry[vid];
      const regDriver = reg ? String(reg.currentDriverId ?? reg.CurrentDriverId ?? '').trim() : '';
      locks.set(vid, evaluateVehicleShiftLock(vid, null, null, myKeys, regDriver || undefined));
    }
  } catch (err) {
    console.warn('[VehicleShiftLock] fetch failed:', err);
  }

  return locks;
}

export function subscribeVehicleShiftLocks(
  companyId: string,
  vehicleIds: string[],
  myDriverId: string,
  myUid: string,
  onChange: (locks: Map<string, VehicleShiftLock>) => void,
): () => void {
  if (!companyId || vehicleIds.length === 0) {
    onChange(new Map());
    return () => undefined;
  }

  const wanted = new Set(vehicleIds.map(normVehicleId));
  const myKeys = driverIdentityKeys(myDriverId, myUid);
  const db = getDatabaseInstance();
  let registry: Record<string, Record<string, unknown>> = {};
  let onlineVal: Record<string, unknown> = {};

  const emit = () => {
    const locks = new Map<string, VehicleShiftLock>();
    for (const vid of wanted) {
      const rec = (onlineVal[vid] as Record<string, unknown> | undefined) ?? null;
      const current = rec ? ((rec.current as Record<string, unknown>) ?? {}) : null;
      const reg = registry[vid];
      const regDriver = reg ? String(reg.currentDriverId ?? reg.CurrentDriverId ?? '').trim() : '';
      locks.set(vid, evaluateVehicleShiftLock(vid, rec, current, myKeys, regDriver || undefined));
    }
    onChange(locks);
  };

  const regRef = ref(db, `vehicles/${companyId}`);
  const onlineRef = ref(db, `online/${companyId}`);

  void get(regRef)
    .then((snap) => {
      registry = {};
      if (snap.exists()) {
        snap.forEach((child) => {
          const key = child.key?.toUpperCase();
          if (key) registry[key] = (child.val() ?? {}) as Record<string, unknown>;
        });
      }
      emit();
    })
    .catch(() => emit());

  const unsubOnline = onValue(onlineRef, (snap) => {
    onlineVal = {};
    if (snap.exists()) {
      snap.forEach((child) => {
        const key = child.key?.toUpperCase();
        if (key && wanted.has(key)) {
          onlineVal[key] = child.val() as Record<string, unknown>;
        }
      });
    }
    emit();
  });

  const unsubReg = onValue(regRef, (snap) => {
    registry = {};
    if (snap.exists()) {
      snap.forEach((child) => {
        const key = child.key?.toUpperCase();
        if (key) registry[key] = (child.val() ?? {}) as Record<string, unknown>;
      });
    }
    emit();
  });

  return () => {
    unsubOnline();
    unsubReg();
  };
}

export function mergeVehicleShiftLocks(
  vehicles: Vehicle[],
  locks: Map<string, VehicleShiftLock>,
): Vehicle[] {
  return vehicles.map((v) => {
    const lock = locks.get(v.id.toUpperCase());
    if (!lock?.inUse) {
      return { ...v, inUseByOther: false, inUseDriverLabel: undefined };
    }
    return {
      ...v,
      inUseByOther: true,
      inUseDriverLabel: lock.occupantName || lock.occupantDriverId || 'another driver',
    };
  });
}

export async function assertVehicleAvailableForShift(
  companyId: string,
  vehicleId: string,
  myDriverId: string,
  myUid: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const vid = normVehicleId(vehicleId);
  const locks = await fetchVehicleShiftLocks(companyId, [vid], myDriverId, myUid);
  const lock = locks.get(vid);
  if (!lock?.inUse) return { ok: true };

  const who = lock.occupantName || lock.occupantDriverId || 'another driver';
  return {
    ok: false,
    message: `${vid} is on shift with ${who}. Wait until they end their shift before using this vehicle.`,
  };
}
