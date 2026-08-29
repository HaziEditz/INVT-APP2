/** Parse intermediate stops from dispatch / passenger booking fields. */

export type JobStopPoint = {
  address: string;
  lat?: number;
  lng?: number;
};

function pushStop(out: JobStopPoint[], seen: Set<string>, address: string, lat?: number, lng?: number) {
  const a = String(address || '').trim();
  if (!a || seen.has(a)) return;
  seen.add(a);
  out.push({
    address: a,
    lat: typeof lat === 'number' && !Number.isNaN(lat) ? lat : undefined,
    lng: typeof lng === 'number' && !Number.isNaN(lng) ? lng : undefined,
  });
}

function tryList(raw: unknown, out: JobStopPoint[], seen: Set<string>) {
  if (raw == null || raw === '') return;
  let list: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return;
    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        list = JSON.parse(s);
      } catch {
        if (s.includes('@') && /address=/i.test(s)) {
          for (const part of s.split('|')) {
            const m = part.match(/address=([^|]*)/i);
            const latM = part.match(/^(-?\d+(?:\.\d+)?)@(-?\d+(?:\.\d+)?)@/i);
            if (m) pushStop(out, seen, m[1], latM ? Number(latM[1]) : undefined, latM ? Number(latM[2]) : undefined);
          }
          return;
        }
        pushStop(out, seen, s);
        return;
      }
    } else if (s.includes('@') && /address=/i.test(s)) {
      for (const part of s.split('|')) {
        const m = part.match(/address=([^|]*)/i);
        const latM = part.match(/^(-?\d+(?:\.\d+)?)@(-?\d+(?:\.\d+)?)@/i);
        if (m) pushStop(out, seen, m[1], latM ? Number(latM[1]) : undefined, latM ? Number(latM[2]) : undefined);
      }
      return;
    } else {
      pushStop(out, seen, s);
      return;
    }
  }
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item == null) continue;
      if (typeof item === 'string') {
        pushStop(out, seen, item);
        continue;
      }
      if (typeof item === 'object') {
        const o = item as Record<string, unknown>;
        pushStop(
          out,
          seen,
          String(o.address ?? o.Address ?? ''),
          o.lat != null ? Number(o.lat) : o.Lat != null ? Number(o.Lat) : undefined,
          o.lng != null ? Number(o.lng) : o.Lng != null ? Number(o.Lng) : undefined,
        );
      }
    }
  }
}

export function parseJobStopsFromRecord(val: Record<string, unknown>): JobStopPoint[] | undefined {
  const out: JobStopPoint[] = [];
  const seen = new Set<string>();
  tryList(val.Stops ?? val.stops, out, seen);
  tryList(val.nextstopdata ?? val.Nextstopdata, out, seen);
  return out.length ? out : undefined;
}

export function formatStopsSummary(stops: JobStopPoint[] | undefined | null): string {
  if (!stops?.length) return '';
  return stops.map((s) => s.address).join('; ');
}
