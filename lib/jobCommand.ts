/**
 * jobCommand.ts — POST /api/job/command client.
 *
 * Single front door for driver-initiated lifecycle mutations under the G2/22c
 * contract: accept, decline (cancel by:driver/declined), driver-cancel
 * (cancel by:driver/cancelled_by_driver), and complete.
 *
 * The driver app must NOT write to jobs/, completedJobs/, or any
 * dispatch-owned path for these actions any more — every state change goes
 * through this module and the server publishes the resulting event back via
 * the jobs/ child listener.
 *
 * Out-of-scope here (per Q4 of the locked spec):
 *   - online/{cid}/{vid}/current  (presence + I've Arrived + Start Meter)
 *   - messages / driverMsg / passengerRatings / pendingjobs / rideStatus
 *   - hail-trip completion (legacy /api/job/sync-offline-trip path) — under
 *     review with dispatch dev; if unified later, swap completeHailTrip to
 *     call sendJobCommand('complete') with the central bookingId.
 *
 * Offline behaviour: every command carries a clientRequestId UUID. Failures
 * are queued to AsyncStorage and replayed on .info/connected. The server
 * dedups by (by, bookingId, command, clientRequestId) for 10 minutes, so
 * retry-with-same-UUID is safe (returns dedup:true on the duplicate).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDispatchConfig } from './dispatchApi';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommandVerb = 'accept' | 'cancel' | 'recall' | 'complete';
export type CommandBy = 'driver';

export type CancelDriverReason = 'declined' | 'cancelled_by_driver';

export interface BookingEcho {
  bookingId: number | string;
  status: string;
  version: number;
  updatedAt: number;
  driverId?: string;
  vehicleId?: string;
  passengerName?: string;
  passengerPhone?: string;
  pickupAddress?: string;
  dropAddress?: string;
  fare?: number;
  distance?: number;
  paymentMethod?: string;
  notes?: string;
  bookingSource?: string;
  [k: string]: unknown;
}

export type CommandErrorCode =
  | 'bad_request'
  | 'auth_failed'
  | 'forbidden'
  | 'not_found'
  | 'invalid_transition'
  | 'version_conflict'
  | 'already_terminal'
  | 'server_error'
  | 'network'        // client-side: device offline / fetch threw
  | 'timeout'        // client-side: request aborted by timeout
  | 'parse_error';   // client-side: server returned non-JSON

export interface CommandSuccess {
  ok: true;
  idempotent: boolean;       // true ⟺ server returned dedup:true
  status: string;            // post-mutation booking status
  version: number;           // post-mutation version (use to roll-forward local)
  booking: BookingEcho;
}

export interface CommandFailure {
  ok: false;
  errorCode: CommandErrorCode;
  errorMessage: string;
  httpStatus?: number;
  /**
   * Present on version_conflict, invalid_transition, already_terminal.
   * Caller MUST roll-forward local state to this echo and decide whether
   * to retry (version_conflict) or drop (invalid_transition / already_terminal).
   */
  currentVersion?: number;
  booking?: BookingEcho;
  /** True if the caller should NOT retry — auth/bad_request/forbidden. */
  fatal: boolean;
  /** True if the caller may retry with the same clientRequestId. */
  retryable: boolean;
}

export type CommandResult = CommandSuccess | CommandFailure;

export interface SendJobCommandArgs {
  bookingId: number | string;
  command: CommandVerb;
  payload?: Record<string, unknown>;
  /** Optional optimistic-concurrency lock. Strongly recommended on complete/cancel/recall. */
  ifVersion?: number;
  /**
   * Optional explicit clientRequestId. If omitted, a fresh UUID is generated.
   * Pass an existing UUID when retrying a queued/failed command so the
   * server dedups (returns the cached response with dedup:true).
   */
  clientRequestId?: string;
  /** X-User-Key auth — driver.passforlink. Caller must supply. */
  passforlink: string;
  /** Per-request timeout in ms. Default 8000. */
  timeoutMs?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COMMAND_PATH = '/api/job/command';
const QUEUE_KEY = '@taxi360_job_command_queue';
const QUEUE_MAX_SIZE = 200;
const QUEUE_MAX_ATTEMPTS = 50;
const DEFAULT_TIMEOUT_MS = 8000;

// Error codes the caller should NOT auto-retry (bug-in-client / auth issues).
const FATAL_ERROR_CODES: CommandErrorCode[] = [
  'bad_request',
  'auth_failed',
  'forbidden',
  'not_found',
  'parse_error',
];

// Error codes that may be retried safely with the same clientRequestId.
const RETRYABLE_ERROR_CODES: CommandErrorCode[] = [
  'network',
  'timeout',
  'server_error',
];

// ── UUID v4-ish (Math.random, sufficient for clientRequestId scope) ──────────

export function newClientRequestId(): string {
  // RFC4122 v4 shape using Math.random — fine for ~10-min dedup windows.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Core POST ─────────────────────────────────────────────────────────────────

async function resolveOrigin(): Promise<string | null> {
  try {
    const cfg = await getDispatchConfig();
    return new URL(cfg.baseUrl).origin;
  } catch (e) {
    console.warn('[JobCommand] could not resolve dispatch origin:', e);
    return null;
  }
}

function classifyHttp(status: number, code?: string): CommandErrorCode {
  if (code && [
    'bad_request', 'auth_failed', 'forbidden', 'not_found',
    'invalid_transition', 'version_conflict', 'already_terminal', 'server_error',
  ].includes(code)) {
    return code as CommandErrorCode;
  }
  if (status === 400) return 'bad_request';
  if (status === 401) return 'auth_failed';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'version_conflict';
  if (status === 410) return 'already_terminal';
  if (status >= 500) return 'server_error';
  return 'server_error';
}

/**
 * Send a single command to the dispatch server. Does NOT auto-queue on
 * failure — the caller decides whether to retry inline, queue for later,
 * or surface to the user. Use enqueueAndSendJobCommand() if you want
 * automatic offline-queueing.
 */
export async function sendJobCommand(args: SendJobCommandArgs): Promise<CommandResult> {
  const {
    bookingId,
    command,
    payload,
    ifVersion,
    passforlink,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = args;
  const clientRequestId = args.clientRequestId ?? newClientRequestId();

  if (!passforlink) {
    return {
      ok: false,
      errorCode: 'auth_failed',
      errorMessage: 'missing X-User-Key (driver.passforlink not loaded)',
      fatal: true,
      retryable: false,
    };
  }

  const origin = await resolveOrigin();
  if (!origin) {
    return {
      ok: false,
      errorCode: 'network',
      errorMessage: 'dispatch base URL unavailable',
      fatal: false,
      retryable: true,
    };
  }

  const url = `${origin}${COMMAND_PATH}`;
  const body: Record<string, unknown> = {
    bookingId,
    command,
    by: 'driver' as CommandBy,
    clientRequestId,
  };
  if (typeof ifVersion === 'number') body.ifVersion = ifVersion;
  if (payload && Object.keys(payload).length > 0) body.payload = payload;

  console.log(`[JobCommand] → ${command} booking=${bookingId} v?=${ifVersion ?? '∅'} req=${clientRequestId.slice(0, 8)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Key': passforlink,
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    const code: CommandErrorCode = isTimeout ? 'timeout' : 'network';
    console.warn(`[JobCommand] ✗ ${command} ${code}:`, err?.message ?? err);
    return {
      ok: false,
      errorCode: code,
      errorMessage: isTimeout ? `request timed out after ${timeoutMs}ms` : (err?.message ?? 'network error'),
      fatal: false,
      retryable: true,
    };
  }
  clearTimeout(timer);

  let json: any = null;
  try {
    json = await res.json();
  } catch (e) {
    console.warn(`[JobCommand] ✗ ${command} parse_error HTTP ${res.status}`);
    return {
      ok: false,
      errorCode: 'parse_error',
      errorMessage: `non-JSON response (HTTP ${res.status})`,
      httpStatus: res.status,
      fatal: true,
      retryable: false,
    };
  }

  if (res.ok && json?.ok === true) {
    console.log(`[JobCommand] ✓ ${command} booking=${bookingId} v=${json.version} ${json.dedup ? '(dedup)' : ''}`);
    return {
      ok: true,
      idempotent: json.dedup === true,
      status: String(json.status ?? json.booking?.status ?? ''),
      version: Number(json.version ?? json.booking?.version ?? 0),
      booking: (json.booking ?? {}) as BookingEcho,
    };
  }

  const errorCode = classifyHttp(res.status, json?.error_code);
  const errorMessage = String(json?.error ?? `HTTP ${res.status}`);
  const fatal = FATAL_ERROR_CODES.includes(errorCode);
  const retryable = RETRYABLE_ERROR_CODES.includes(errorCode);

  console.warn(`[JobCommand] ✗ ${command} ${errorCode} (HTTP ${res.status}): ${errorMessage}`);

  return {
    ok: false,
    errorCode,
    errorMessage,
    httpStatus: res.status,
    currentVersion: typeof json?.currentVersion === 'number' ? json.currentVersion : undefined,
    booking: json?.booking as BookingEcho | undefined,
    fatal,
    retryable,
  };
}

// ── Offline queue ────────────────────────────────────────────────────────────

interface QueuedCommand {
  id: string;
  args: Omit<SendJobCommandArgs, 'passforlink' | 'timeoutMs'>;
  attempts: number;
  lastAttempt: number | null;
  createdAt: number;
}

async function readCommandQueue(): Promise<QueuedCommand[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedCommand[];
  } catch {
    return [];
  }
}

async function writeCommandQueue(items: QueuedCommand[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_MAX_SIZE)));
  } catch (e) {
    console.warn('[JobCommand] queue save failed:', e);
  }
}

/**
 * Persist a command for later retry. Used when a fresh POST fails with a
 * retryable error (network/timeout/server_error) — caller can have already
 * applied an optimistic UI update, the queue ensures the server eventually
 * sees the command.
 *
 * Dedup: if the same clientRequestId is already queued, this is a no-op —
 * the existing entry will be replayed.
 */
export async function enqueueCommand(args: SendJobCommandArgs): Promise<void> {
  const clientRequestId = args.clientRequestId ?? newClientRequestId();
  const queue = await readCommandQueue();
  if (queue.some(q => q.args.clientRequestId === clientRequestId)) {
    console.log(`[JobCommand] queue already contains req=${clientRequestId.slice(0, 8)} — skip`);
    return;
  }
  const entry: QueuedCommand = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    args: {
      bookingId: args.bookingId,
      command: args.command,
      payload: args.payload,
      ifVersion: args.ifVersion,
      clientRequestId,
    },
    attempts: 0,
    lastAttempt: null,
    createdAt: Date.now(),
  };
  await writeCommandQueue([...queue, entry]);
  console.log(`[JobCommand] queued ${args.command} booking=${args.bookingId} req=${clientRequestId.slice(0, 8)} — depth: ${queue.length + 1}`);
}

export async function jobCommandQueueDepth(): Promise<number> {
  return (await readCommandQueue()).length;
}

export async function clearJobCommandQueue(): Promise<void> {
  try { await AsyncStorage.removeItem(QUEUE_KEY); } catch {}
}

/**
 * Replay every queued command. Items that succeed (or fail fatally) are
 * removed. Items that fail retryably stay queued with an incremented
 * attempt counter. Items past QUEUE_MAX_ATTEMPTS are dropped to bound
 * disk usage.
 *
 * On version_conflict / invalid_transition / already_terminal the queued
 * command is also dropped — the booking state has moved on, the queued
 * action is no longer valid. Caller listening to jobs/ will already have
 * reconciled local state.
 *
 * Safe to call from multiple triggers (foreground, .info/connected,
 * post-success chain) — per-process lock prevents concurrent drains.
 */
let _draining = false;
export async function drainJobCommandQueue(passforlink: string): Promise<{ sent: number; remaining: number }> {
  if (_draining) return { sent: 0, remaining: -1 };
  if (!passforlink) return { sent: 0, remaining: -1 };
  _draining = true;
  try {
    const queue = await readCommandQueue();
    if (queue.length === 0) return { sent: 0, remaining: 0 };
    console.log(`[JobCommand] draining ${queue.length} queued command(s)`);
    const survivors: QueuedCommand[] = [];
    let sent = 0;

    for (const item of queue) {
      const result: CommandResult = await sendJobCommand({ ...item.args, passforlink });

      if (result.ok) {
        sent += 1;
        continue;
      }
      const fail: CommandFailure = result;

      // Drop fatal errors and "state moved on" errors — no point retrying.
      if (
        fail.fatal
        || fail.errorCode === 'version_conflict'
        || fail.errorCode === 'invalid_transition'
        || fail.errorCode === 'already_terminal'
      ) {
        console.warn(`[JobCommand] dropping queued ${item.args.command} booking=${item.args.bookingId} — ${fail.errorCode}`);
        continue;
      }

      // Retryable — keep with incremented attempts unless we've maxed out.
      item.attempts += 1;
      item.lastAttempt = Date.now();
      if (item.attempts < QUEUE_MAX_ATTEMPTS) {
        survivors.push(item);
      } else {
        console.warn(`[JobCommand] dropping queued ${item.args.command} booking=${item.args.bookingId} after ${QUEUE_MAX_ATTEMPTS} attempts`);
      }
    }

    await writeCommandQueue(survivors);
    console.log(`[JobCommand] drain done — sent ${sent}, remaining ${survivors.length}`);
    return { sent, remaining: survivors.length };
  } finally {
    _draining = false;
  }
}

/**
 * Convenience: try to send a command immediately; on a retryable failure
 * queue it for later .info/connected drain. Returns the original result so
 * the caller can decide whether to apply/rollback optimistic UI.
 *
 * Fatal failures and "state moved on" failures are NOT queued — they're
 * surfaced to the caller verbatim so the UI can roll back.
 */
export async function sendOrQueueJobCommand(args: SendJobCommandArgs): Promise<CommandResult> {
  const clientRequestId = args.clientRequestId ?? newClientRequestId();
  const argsWithId: SendJobCommandArgs = { ...args, clientRequestId };
  const result = await sendJobCommand(argsWithId);
  if (!result.ok && result.retryable) {
    await enqueueCommand(argsWithId);
  }
  return result;
}
