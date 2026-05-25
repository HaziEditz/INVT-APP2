// ─── Shared timezone utilities ────────────────────────────────────────────────
// The company timezone is currently hardcoded to Pacific/Auckland because
// Bookawaka's first tenant (companyId 620611) is based in NZ.
//
// Multi-tenant roadmap: store `timezone` as an IANA string in the company's
// Firebase record (companies/{companyId}/timezone). Fetch it on login and pass
// it through DriverContext / AuthContext so every helper here uses the right tz.
// ─────────────────────────────────────────────────────────────────────────────

export const COMPANY_TZ = 'Pacific/Auckland';

// ── Display helpers ───────────────────────────────────────────────────────────
// All display helpers accept a Date, epoch-ms number, or ISO string.

function toDate(val: Date | number | string): Date {
  if (val instanceof Date) return val;
  return new Date(val);
}

/** Short time — "2:30 pm" */
export function fmtTime(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    return toDate(val).toLocaleTimeString('en-NZ', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return String(val); }
}

/** Short date — "5 May 2026" */
export function fmtDate(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    return toDate(val).toLocaleDateString('en-NZ', {
      timeZone: tz, day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return String(val); }
}

/** Date + time — "5 May 2026, 2:30 pm" */
export function fmtDateTime(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    return toDate(val).toLocaleString('en-NZ', {
      timeZone: tz,
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return String(val); }
}

/** "Mon", "Tue", … or "5 May" for older dates — for chat headers */
export function fmtChatDateHeader(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    const d = toDate(val);
    const now = new Date();
    const diffDays = Math.floor(
      (now.setHours(0,0,0,0) - new Date(d.toLocaleDateString('en-CA', { timeZone: tz })).getTime()) / 86400000
    );
    if (diffDays === 0) {
      return toDate(now).toLocaleDateString('en-NZ', {
        timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
      });
    }
    if (diffDays < 7) return d.toLocaleDateString('en-NZ', { timeZone: tz, weekday: 'long' });
    return d.toLocaleDateString('en-NZ', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return String(val); }
}

/** Chat message timestamp: "2:30 pm" today, "Mon" this week, "5 May" older */
export function fmtChatTimestamp(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    const d = toDate(val);
    const nowMs = Date.now();
    const diffMs = nowMs - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 1) return fmtTime(d, tz);
    if (diffDays < 7) return d.toLocaleDateString('en-NZ', { timeZone: tz, weekday: 'short' });
    return d.toLocaleDateString('en-NZ', { timeZone: tz, day: 'numeric', month: 'short' });
  } catch { return ''; }
}

/** "DD/MM/YYYY HH:MM:SS am" — matches the format the existing dispatcher expects */
export function fmtNZRecord(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    return toDate(val).toLocaleString('en-NZ', {
      timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return new Date().toISOString(); }
}

/** "DD/MM/YYYY" — for stored shift date fields that the dispatcher reads */
export function fmtNZDate(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    return toDate(val).toLocaleDateString('en-NZ', {
      timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return toDate(val).toISOString().slice(0, 10); }
}

/** "HH:MM am/pm" — for stored shift startTime/endTime fields */
export function fmtNZTime(val: Date | number | string, tz = COMPANY_TZ): string {
  try {
    return toDate(val).toLocaleTimeString('en-NZ', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return toDate(val).toISOString().slice(11, 16); }
}

/** Today's date as "Monday, 5 May" — for shift/chat headers */
export function fmtTodayHeading(tz = COMPANY_TZ): string {
  try {
    return new Date().toLocaleDateString('en-NZ', {
      timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
    });
  } catch { return new Date().toLocaleDateString(); }
}
