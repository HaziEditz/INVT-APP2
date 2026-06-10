import { get, orderByChild, limitToLast, query, ref, push, set } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';

export type ShiftLogEntry = {
  shiftEndAt: number;
  shiftStartAt?: number;
  workedMinutes?: number;
  weeklyWorkedMinutes?: number;
  driverId?: string;
};

/** Firebase RTDB rejects `undefined`; coerce missing fields to null. */
function sanitizeForFirebase(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function loadLastShiftEnd(
  companyId: string,
  uid: string,
): Promise<ShiftLogEntry | null> {
  if (!companyId || !uid) return null;
  try {
    const database = getDatabaseInstance();
    const q = query(
      ref(database, `shiftLogs/${companyId}/${uid}`),
      orderByChild('shiftEndAt'),
      limitToLast(1),
    );
    const snap = await get(q);
    if (!snap.exists()) return null;
    let latest: ShiftLogEntry | null = null;
    snap.forEach((child) => {
      const v = child.val() as Record<string, unknown>;
      const entry: ShiftLogEntry = {
        shiftEndAt: Number(v.shiftEndAt ?? v.endedAt ?? 0),
        shiftStartAt: v.shiftStartAt != null ? Number(v.shiftStartAt) : undefined,
        workedMinutes: v.workedMinutes != null ? Number(v.workedMinutes) : undefined,
        weeklyWorkedMinutes:
          v.weeklyWorkedMinutes != null ? Number(v.weeklyWorkedMinutes) : undefined,
      };
      if (entry.shiftEndAt && (!latest || entry.shiftEndAt > latest.shiftEndAt)) {
        latest = entry;
      }
    });
    return latest;
  } catch (err) {
    console.warn('[ShiftLogs] loadLastShiftEnd failed:', err);
    return null;
  }
}

export async function writeShiftEndLog(
  companyId: string,
  uid: string,
  payload: ShiftLogEntry,
): Promise<void> {
  if (!companyId || !uid) return;
  const database = getDatabaseInstance();
  const entryRef = push(ref(database, `shiftLogs/${companyId}/${uid}`));
  const record = sanitizeForFirebase({
    shiftEndAt: payload.shiftEndAt || Date.now(),
    shiftStartAt: payload.shiftStartAt ?? null,
    workedMinutes: payload.workedMinutes ?? null,
    weeklyWorkedMinutes: payload.weeklyWorkedMinutes ?? null,
    driverId: payload.driverId ?? null,
    loggedAt: Date.now(),
  });
  await set(entryRef, record);
}
