import { useEffect, DependencyList, EffectCallback } from 'react';

/** Runs useEffect body inside try/catch so one bad effect does not crash the app. */
export function useSafeEffect(effect: EffectCallback, deps?: DependencyList, label = 'anonymous') {
  useEffect(() => {
    try {
      return effect();
    } catch (err) {
      console.error(`[useSafeEffect:${label}]`, err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Fire-and-forget async work with centralized error logging. */
export async function runSafeAsync(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[runSafeAsync:${label}]`, err);
  }
}
