import { get, onValue, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

export type CompanyZone = {
  id: string;
  zoneNumber: number;
  name: string;
  active: boolean;
  boundary: number[][];
};

function parseBoundary(raw: unknown): number[][] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      if (!Array.isArray(p) || p.length < 2) return null;
      const lat = Number(p[0]);
      const lng = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng] as [number, number];
    })
    .filter((p): p is [number, number] => p !== null);
}

function parseZoneNode(id: string, val: unknown): CompanyZone | null {
  if (!val || typeof val !== 'object') return null;
  const z = val as Record<string, unknown>;
  const boundary = parseBoundary(z.boundary ?? z.coordinates ?? z.polygon);
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
