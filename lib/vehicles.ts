import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
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

/** Uppercase vehicle IDs from driver profile — assignedVehicles array is canonical. */
export function extractAssignedVehicleIds(profile: Record<string, unknown>): string[] {
  const allocated: string[] = [];
  // Canonical field from Owner Panel / SA: assignedVehicles (uppercase string array).
  collectIdsFromField(profile.assignedVehicles, allocated);
  // Legacy Owner Panel object-map field — read until all profiles are re-saved.
  collectIdsFromField(profile.allocatedVehicles, allocated);
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

function extractVehicleNumber(id: string, meta: Record<string, unknown>): string {
  const fromMeta = String(
    meta.vehicleNumber ?? meta.VehicleNumber ?? meta.number ?? meta.callSign ?? meta.callsign ?? '',
  ).trim();
  if (fromMeta) return fromMeta.replace(/\D/g, '') || fromMeta;

  const digits = id.match(/(\d+)/);
  if (digits) return digits[1];
  return id;
}

/** Single vehicle type string from Firebase — prefer explicit type fields, never combine. */
function extractDisplayType(meta: Record<string, unknown>): string {
  const raw = String(
    meta.vehicleType ??
      meta.VehicleType ??
      meta.bodyType ??
      meta.BodyType ??
      meta.vehicleClass ??
      meta.class ??
      meta.type ??
      'Taxi',
  ).trim();
  if (!raw) return 'Taxi';
  const lower = raw.toLowerCase();
  if (lower.includes('wav') || lower.includes('wheelchair')) return 'WAV';
  if (lower.includes('van') || lower.includes('minibus')) return 'Van';
  if (lower.includes('sedan') || lower.includes('saloon')) return 'Sedan';
  if (lower.includes('suv')) return 'SUV';
  if (lower.includes('food')) return 'Food';
  if (lower.includes('freight')) return 'Freight';
  if (lower.includes('tow')) return 'Tow';
  if (lower.includes('taxi') || lower.includes('cab')) return 'Taxi';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function extractServiceType(meta: Record<string, unknown>): string {
  const display = extractDisplayType(meta);
  const lower = display.toLowerCase();
  if (lower.includes('food')) return 'Food';
  if (lower.includes('freight')) return 'Freight';
  if (lower.includes('tow')) return 'Tow';
  return 'Taxi';
}

function extractBodyType(meta: Record<string, unknown>): string {
  return extractDisplayType(meta);
}

async function loadVehicleDetails(companyId: string, ids: string[]): Promise<Vehicle[]> {
  if (!ids.length) return [];

  const snap = await get(ref(getDatabaseInstance(), `vehicles/${companyId}`));
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
    const number = extractVehicleNumber(upper, meta);
    const vehicleType = extractServiceType(meta);
    const bodyType = extractBodyType(meta);
    const plate = String(meta.plate ?? meta.registration ?? meta.plateNumber ?? '').trim();
    const seatCapacity =
      parseInt(String(meta.seatCapacity ?? meta.capacity ?? meta.SeatCapacity ?? '4'), 10) || 4;
    const vLower = vehicleType.toLowerCase();
    const bodyLower = bodyType.toLowerCase();
    const displayType = extractDisplayType(meta);
    return {
      id: upper,
      number,
      displayType,
      vehicleType,
      bodyType: displayType,
      label: number,
      plate: plate || '—',
      seatCapacity,
      hasFoodService: vLower.includes('food') || meta.foodService === true || meta.hasFood === true,
      hasFreightService:
        vLower.includes('freight') || meta.freightService === true || meta.hasFreight === true,
      isWav: bodyLower.includes('wav') || meta.wav === true || meta.isWav === true,
    };
  });
}

/** Body class for profile display: Sedan, Van, WAV */
export async function loadVehicleBodyType(companyId: string, vehicleId: string): Promise<string> {
  if (!companyId || !vehicleId) return '—';
  try {
    const upper = vehicleId.trim().toUpperCase();
    const snap = await get(ref(getDatabaseInstance(), `vehicles/${companyId}/${upper}`));
    if (snap.exists()) {
      return extractBodyType((snap.val() ?? {}) as Record<string, unknown>);
    }
  } catch {
    // non-fatal
  }
  return 'Sedan';
}

export async function loadDriverVehicles(
  companyId: string,
  uid: string,
  driverIdHint?: string,
  fallbackVehicleId?: string,
): Promise<Vehicle[]> {
  const allocated: string[] = [];

  const profileSnap = await get(ref(getDatabaseInstance(), `drivers/${companyId}/${uid}`));
  if (profileSnap.exists()) {
    allocated.push(...extractAssignedVehicleIds(profileSnap.val() as Record<string, unknown>));
  }

  if (driverIdHint && driverIdHint !== uid) {
    try {
      const altSnap = await get(ref(getDatabaseInstance(), `drivers/${companyId}/${driverIdHint}`));
      if (altSnap.exists()) {
        allocated.push(...extractAssignedVehicleIds(altSnap.val() as Record<string, unknown>));
      }
    } catch {
      // non-fatal
    }
  }

  const unique = [...new Set(allocated)].filter(Boolean);

  if (unique.length === 0) {
    try {
      const allSnap = await get(ref(getDatabaseInstance(), `vehicles/${companyId}`));
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
