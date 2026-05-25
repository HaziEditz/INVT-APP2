import * as Sentry from '@sentry/react-native';
import { AppState } from 'react-native';

const SLOW_TAP_MS = 250;
const SLOW_FRAME_MS = 200;
const SLOW_LISTENER_MS = 150;

// Anti-flood: a single shared rate limiter for ALL perf reports so the
// monitor itself can never spam Sentry. At most one report per BUCKET_MS
// per (kind:name) bucket, and at most MAX_REPORTS_PER_SESSION total.
const BUCKET_MS = 10_000;
const MAX_REPORTS_PER_SESSION = 200;

let totalReports = 0;
const bucketLastReport: Record<string, number> = {};

function shouldReport(bucket: string): boolean {
  if (totalReports >= MAX_REPORTS_PER_SESSION) return false;
  const now = Date.now();
  const last = bucketLastReport[bucket] || 0;
  if (now - last < BUCKET_MS) return false;
  bucketLastReport[bucket] = now;
  totalReports += 1;
  return true;
}

export function instrumentTap<T extends (...args: any[]) => any>(name: string, fn: T): T {
  return ((...args: any[]) => {
    const t0 = Date.now();
    let result: any;
    try {
      result = fn(...args);
    } catch (err) {
      try {
        Sentry.captureException(err, { tags: { tapName: name, kind: 'tap-error' } });
      } catch {}
      throw err;
    }
    const sync = Date.now() - t0;
    if (sync >= SLOW_TAP_MS && shouldReport(`tap:${name}`)) {
      try {
        Sentry.captureMessage(`Slow tap: ${name} (${sync}ms sync)`, {
          level: 'warning',
          tags: { tapName: name, kind: 'slow-tap', durationMs: String(sync) },
        });
      } catch {}
    }
    if (result && typeof result.then === 'function') {
      result.then(
        () => {
          const total = Date.now() - t0;
          if (total >= SLOW_TAP_MS * 2 && shouldReport(`tapAsync:${name}`)) {
            try {
              Sentry.captureMessage(`Slow async tap: ${name} (${total}ms total)`, {
                level: 'warning',
                tags: { tapName: name, kind: 'slow-tap-async', durationMs: String(total) },
              });
            } catch {}
          }
        },
        (err: any) => {
          try {
            Sentry.captureException(err, { tags: { tapName: name, kind: 'tap-promise-rejection' } });
          } catch {}
        }
      );
    }
    return result;
  }) as T;
}

// Drop-in helper to measure how long a synchronous block (e.g. the
// synchronous portion of a Firebase listener callback) holds the JS thread.
// Call this at the very top of the callback. It records t0 and schedules
// a microtask that runs immediately after the synchronous work completes,
// reporting to Sentry if total sync duration exceeds SLOW_LISTENER_MS.
export function markSyncBlock(name: string) {
  const t0 = Date.now();
  queueMicrotask(() => {
    const dur = Date.now() - t0;
    if (dur >= SLOW_LISTENER_MS && shouldReport(`listener:${name}`)) {
      try {
        Sentry.captureMessage(`Slow listener: ${name} (${dur}ms sync)`, {
          level: 'warning',
          tags: { kind: 'slow-listener', listenerName: name, durationMs: String(dur) },
        });
      } catch {}
    }
  });
}

let jsMonitorStarted = false;
export function startJsThreadMonitor() {
  if (jsMonitorStarted) return;
  jsMonitorStarted = true;
  let last = Date.now();
  let worstLagInWindow = 0;
  let suppressNext = false;

  // When the app comes back to foreground after being backgrounded, the next
  // setTimeout fires immediately with a huge gap (= entire background time).
  // Mark a suppression flag so that single tick is ignored, and reset `last`
  // to now so subsequent gaps are real foreground-only durations.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      suppressNext = true;
      last = Date.now();
    }
  });

  const tick = () => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    const lag = gap - 1000;

    if (suppressNext) {
      suppressNext = false;
      setTimeout(tick, 1000);
      return;
    }

    // Skip while app is backgrounded — OS throttles timers and produces
    // false-positive lag spikes on every wake. Also reject any lag larger
    // than 30s as definitely a background/sleep artefact rather than a real
    // JS-thread block (no realistic synchronous block lasts that long).
    const appActive = AppState.currentState === 'active';
    if (appActive && lag >= SLOW_FRAME_MS && lag < 30_000) {
      if (lag > worstLagInWindow) worstLagInWindow = lag;
      if (shouldReport('js-thread-block')) {
        const reportedLag = worstLagInWindow;
        worstLagInWindow = 0;
        try {
          Sentry.captureMessage(`JS thread blocked ~${reportedLag}ms`, {
            level: 'warning',
            tags: { kind: 'js-thread-block', lagMs: String(reportedLag) },
          });
        } catch {}
      }
    }
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);
}
