import { get, ref } from 'firebase/database';
import { database } from '@/lib/firebase';
import { Vehicle } from '@/types';

function normVehicleId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.toUpperCase() : null;
}

function collectIdsFromField(raw: unknown, into: string[]) {
  if (!raw) return;
  if (Array.isArray(raw)) {
    raw.forEach((v) => {
      const n = normVehicleId(v);
      if (n) into.push(n);
    });
    return;
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const valuesLookLikeIds = Object.values(obj).every(
      (v) => typeof v === 'boolean' || v === null || v === undefined,
    );
    if (valuesLookLikeIds) {
      Object.entries(obj).forEach(([k, v]) => {
        if (v) {
          const n = normVehicleId(k);
          if (n) into.push(n);
        }
      });
    } else {
      Object.values(obj).forEach((v) => {
        const n = normVehicleId(v);
        if (n) into.push(n);
      });
    }
  }
}

function extractAllocatedIds(profile: Record<string, unknown>): string[] {
  const allocated: string[] = [];
  collectIdsFromField(profile.allocatedVehicles, allocated);
  collectIdsFromField(profile.assignedVehicles, allocated);
  collectIdsFromField(profile.assignedVehicleIds, allocated);
  collectIdsFromField(profile.vehicles, allocated);

  if (profile.vehicleIds && typeof profile.vehicleIds === 'object' && !Array.isArray(profile.vehicleIds)) {
    Object.entries(profile.vehicleIds as Record<string, unknown>).forEach(([k, v]) => {
      if (v) {
        const n = normVehicleId(k);
        if (n) allocated.push(n);
      }
    });
  }

  const single = profile.vehicleId ?? profile.VehicleId ?? profile.SelectedVehicleid ?? profile.vehicle_id;
  const n = normVehicleId(single);
  if (n) allocated.push(n);

  return [...new Set(allocated)].filter(Boolean);
}

async function loadVehicleDetails(companyId: string, ids: string[]): Promise<Vehicle[]> {
  if (!ids.length) return [];

  const snap = await get(ref(database, `vehicles/${companyId}`));
  const registry: Record<string, Record<string, unknown>> = {};
  if (snap.exists()) {
    snap.forEach((child) => {
      const key = child.key;
      if (key) registry[key.toUpperCase()] = (child.val() ?? {}) as Record<string, unknown>;
    });
  }

  return ids.map((id) => {
    const upper = id.toUpperCase();
    const meta = registry[upper] ?? registry[id] ?? {};
    const label =
      String(meta.name ?? meta.label ?? meta.make ?? meta.model ?? '').trim() || id;
    const plate = String(meta.plate ?? meta.registration ?? meta.plateNumber ?? meta.number ?? '').trim();
    return { id: upper, label, plate: plate || '—' };
  });
}

export async function loadDriverVehicles(
  companyId: string,
  uid: string,
  driverIdHint?: string,
  fallbackVehicleId?: string,
): Promise<Vehicle[]> {
  const allocated: string[] = [];

  const profileSnap = await get(ref(database, `drivers/${companyId}/${uid}`));
  if (profileSnap.exists()) {
    allocated.push(...extractAllocatedIds(profileSnap.val() as Record<string, unknown>));
  }

  if (driverIdHint && driverIdHint !== uid) {
    try {
      const altSnap = await get(ref(database, `drivers/${companyId}/${driverIdHint}`));
      if (altSnap.exists()) {
        allocated.push(...extractAllocatedIds(altSnap.val() as Record<string, unknown>));
      }
    } catch {
      // non-fatal
    }
  }

  const unique = [...new Set(allocated)].filter(Boolean);

  if (unique.length === 0) {
    try {
      const allSnap = await get(ref(database, `vehicles/${companyId}`));
      if (allSnap.exists()) {
        allSnap.forEach((child) => {
          const vId = normVehicleId(child.key ?? '');
          if (vId) unique.push(vId);
        });
      }
    } catch (err) {
      console.warn('[Vehicles] company registry load failed:', err);
    }
  }

  const last = normVehicleId(fallbackVehicleId ?? '');
  if (last && !unique.includes(last)) unique.push(last);

  const sorted = [...new Set(unique)].sort();
  return loadVehicleDetails(companyId, sorted);
}
