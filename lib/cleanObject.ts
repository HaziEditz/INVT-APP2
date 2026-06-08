/** Remove undefined values recursively — Firebase RTDB rejects undefined. */
export function cleanObject<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanObject(item))
      .filter((item) => item !== undefined) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined) continue;
    const cleaned = cleanObject(child);
    if (cleaned !== undefined) {
      out[key] = cleaned;
    }
  }
  return out as T;
}
