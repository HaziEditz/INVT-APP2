import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

export type CompanyZone = {
  id: string;
  zoneNumber: number;
  name: string;
  active: boolean;
  boundary: number[][];
};

function boundaryPoints(raw: unknown): unknown[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      return boundaryPoints(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.points)) return o.points;
    if (Array.isArray(o.path)) return o.path;
    return Object.keys(o)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => o[k]);
  }
  return [];
}

function parseBoundary(raw: unknown): number[][] {
  const out: number[][] = [];
  for (const p of boundaryPoints(raw)) {
    if (Array.isArray(p) && p.length >= 2) {
      let lat = Number(p[0]);
      let lng = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
        const swap = lat;
        lat = lng;
        lng = swap;
      }
      out.push([lat, lng]);
      continue;
    }
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const pt = p as Record<string, unknown>;
      const lat = Number(pt.lat ?? pt.Lat ?? pt.latitude);
      const lng = Number(pt.lng ?? pt.Lng ?? pt.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
    }
  }
  return out;
}

function parseZoneNode(id: string, val: unknown): CompanyZone | null {
  if (!val || typeof val !== 'object') return null;
  const z = val as Record<string, unknown>;
  const boundary = parseBoundary(
    z.paths ?? z.boundary ?? z.coordinates ?? z.coords ?? z.polygon,
  );
  if (boundary.length < 3) return null;
  const zoneNumber = Number(z.zoneNumber ?? z.number ?? id);
  const name = String(z.name ?? z.zoneName ?? `Zone ${zoneNumber}`);
  return {
    id,
    zoneNumber: Number.isFinite(zoneNumber) ? zoneNumber : 0,
    name,
    active: z.active !== false,
    boundary,
  };
}

export async function loadCompanyZones(companyId: string): Promise<CompanyZone[]> {
  if (!companyId) return [];
  try {
    const snap = await get(ref(getDatabaseInstance(), `zones/${companyId}`));
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, unknown>;
    return Object.entries(val)
      .map(([key, node]) => parseZoneNode(key, node))
      .filter((z): z is CompanyZone => !!z && z.active)
      .sort((a, b) => a.zoneNumber - b.zoneNumber);
  } catch (err) {
    console.warn('[Zones] loadCompanyZones failed:', err);
    return [];
  }
}

export function subscribeCompanyZones(
  companyId: string,
  onChange: (zones: CompanyZone[]) => void,
): () => void {
  if (!companyId) {
    onChange([]);
    return () => undefined;
  }
  const zoneRef = ref(getDatabaseInstance(), `zones/${companyId}`);
  return onValue(zoneRef, (snap) => {
    if (!snap.exists()) {
      onChange([]);
      return;
    }
    const val = snap.val() as Record<string, unknown>;
    const zones = Object.entries(val)
      .map(([key, node]) => parseZoneNode(key, node))
      .filter((z): z is CompanyZone => !!z && z.active)
      .sort((a, b) => a.zoneNumber - b.zoneNumber);
    onChange(zones);
  });
}

/** Ray-casting point-in-polygon for [lat, lng] vertices. */
export function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0];
    const xi = polygon[i][1];
    const yj = polygon[j][0];
    const xj = polygon[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findZoneAtCoords(
  lat: number,
  lng: number,
  zones: CompanyZone[],
): CompanyZone | null {
  for (const zone of zones) {
    if (pointInPolygon(lat, lng, zone.boundary)) return zone;
  }
  return null;
}
