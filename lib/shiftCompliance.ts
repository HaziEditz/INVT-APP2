// NZ Land Transport compliance hour rules for passenger service drivers.
// All functions are pure — no Firebase / AsyncStorage calls here.

export const DAILY_LIMIT_MS   = 14 * 60 * 60 * 1000;   // 14 hours
export const DAILY_REST_MS    = 10 * 60 * 60 * 1000;   // 10-hour rest after daily shift
export const WEEKLY_LIMIT_MIN = 70 * 60;                // 70 hours (in minutes), rolling 7-day
export const WEEKLY_REST_MS   = 24 * 60 * 60 * 1000;   // 24-hour rest after weekly limit

const NZ_TZ = 'Pacific/Auckland';

export function fmtNZDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString('en-NZ', {
      timeZone: NZ_TZ,
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

export function fmtMs(ms: number): string {
  const totalMins = Math.floor(Math.abs(ms) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function fmtMins(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export interface ShiftBlock {
  blocked: true;
  reason: string;
  availableAt: number;
}
export interface ShiftAllowed { blocked: false }
export type ComplianceResult = ShiftBlock | ShiftAllowed;

export function checkShiftStartCompliance(
  lastShiftEndMs: number | null,
  weeklyWorkMinutes: number,
  dailyWorkMinutes = 0,
): ComplianceResult {
  const now = Date.now();

  // Weekly limit reached: requires 24h rest
  if (weeklyWorkMinutes >= WEEKLY_LIMIT_MIN && lastShiftEndMs !== null) {
    const availableAt = lastShiftEndMs + WEEKLY_REST_MS;
    if (now < availableAt) {
      return {
        blocked: true,
        reason: `You have completed your 70-hour weekly limit. You must rest until ${fmtNZDateTime(availableAt)}.`,
        availableAt,
      };
    }
  }

  // Daily rest (10h): ONLY applies after the driver has hit the 14-hour daily limit.
  // Logging off after a short shift (e.g. 1 hour) does NOT trigger mandatory rest.
  if (lastShiftEndMs !== null && dailyWorkMinutes >= DAILY_LIMIT_MS / 60000) {
    const availableAt = lastShiftEndMs + DAILY_REST_MS;
    if (now < availableAt) {
      const remaining = availableAt - now;
      return {
        blocked: true,
        reason: `You need ${fmtMs(remaining)} more rest before your next shift. You can start at ${fmtNZDateTime(availableAt)}.`,
        availableAt,
      };
    }
  }

  return { blocked: false };
}
