/**
 * Hail End Trip must never hang on GPS or crash on lazy chunk load.
 * Coords are best-effort; payment can proceed with placeholders.
 */

/** Cap fresh GPS fix so End Trip cannot wait forever for a satellite lock. */
export const END_HAIL_GPS_TIMEOUT_MS = 3_000;

export type EndHailDropCoords = {
  latitude: number;
  longitude: number;
};

/**
 * Resolve drop coords for endHail: budgeted GPS, never throw to the caller.
 * On timeout/failure returns null so End Trip continues with pickup/placeholder.
 */
export async function resolveEndHailDropCoords(deps: {
  getCurrentCoords: () => Promise<EndHailDropCoords>;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
  timeoutMs?: number;
}): Promise<EndHailDropCoords | null> {
  const ms = deps.timeoutMs ?? END_HAIL_GPS_TIMEOUT_MS;
  try {
    return await deps.withTimeout(deps.getCurrentCoords(), ms, 'endHail.getCurrentCoords');
  } catch {
    return null;
  }
}

/**
 * Full readable End Trip / complete error for Alert + on-screen banner.
 * Prefer message + name + nested cause over a truncated LogBox rejection.
 */
export function formatEndTripError(err: unknown): string {
  if (err == null) return 'Something went wrong ending the trip. Please try again.';

  const parts: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 3 || value == null) return;
    if (typeof value === 'string') {
      const s = value.trim();
      if (s) parts.push(s);
      return;
    }
    if (value instanceof Error) {
      const name = String(value.name || '').trim();
      const msg = String(value.message || '').trim();
      if (name && msg && !msg.startsWith(name)) parts.push(`${name}: ${msg}`);
      else if (msg) parts.push(msg);
      else if (name) parts.push(name);
      const cause = (value as Error & { cause?: unknown }).cause;
      if (cause != null) walk(cause, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      const o = value as { message?: unknown; name?: unknown; code?: unknown; error?: unknown };
      const name = o.name != null ? String(o.name).trim() : '';
      const msg = o.message != null ? String(o.message).trim() : '';
      const code = o.code != null ? String(o.code).trim() : '';
      if (name && msg) parts.push(`${name}: ${msg}`);
      else if (msg) parts.push(msg);
      else if (name) parts.push(name);
      if (code) parts.push(`code=${code}`);
      if (o.error != null) walk(o.error, depth + 1);
    }
  };
  walk(err, 0);

  const unique = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  if (!unique.length) return 'Something went wrong ending the trip. Please try again.';
  // Cap length so Alert stays readable on phone, but keep far more than LogBox truncates.
  const joined = unique.join('\n');
  return joined.length > 900 ? `${joined.slice(0, 900)}…` : joined;
}
