/** Hard ceiling for any single RTDB write during end-shift. */
export const END_SHIFT_RTDB_TIMEOUT_MS = 4_000;

/** Race a promise against a hard deadline — rejects if the op hangs (e.g. offline RTDB). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

/** Best-effort remote write: never hang past `ms`; returns false on timeout/error. */
export async function attemptWithTimeout(
  promise: Promise<unknown>,
  ms: number,
  label: string,
): Promise<boolean> {
  try {
    await withTimeout(promise, ms, label);
    return true;
  } catch (err) {
    console.warn(`[timeout] ${label} failed:`, err);
    return false;
  }
}
