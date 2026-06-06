/** Recursively strip null/undefined so RTDB set/update never rejects the payload. */
export function sanitizeForFirebase<T>(value: T): T {
  if (value === null || value === undefined) {
    return undefined as T;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForFirebase(item))
      .filter((item) => item !== undefined && item !== null) as T;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if (child === null || child === undefined) return;
      const cleaned = sanitizeForFirebase(child);
      if (cleaned !== null && cleaned !== undefined) {
        result[key] = cleaned;
      }
    });
    return result as T;
  }

  return value;
}
