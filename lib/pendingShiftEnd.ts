import { update, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { writeShiftEndLog } from '@/lib/shiftLogs';
import {
  buildPendingShiftEnd,
  markPendingShiftEndSynced,
  pendingShiftEndStillOpen,
  type PendingShiftEndReason,
  type PendingShiftEndRecord,
} from '@/lib/shiftEndPolicy';
import { getData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { clearOnlinePresence } from '@/services/presenceService';
import type { DriverProfile } from '@/types';

async function loadAll(): Promise<PendingShiftEndRecord[]> {
  const rows = (await getData<PendingShiftEndRecord[]>(STORAGE_KEYS.pendingShiftEnds)) ?? [];
  return Array.isArray(rows) ? rows : [];
}

async function saveAll(rows: PendingShiftEndRecord[]): Promise<void> {
  await storeData(STORAGE_KEYS.pendingShiftEnds, rows);
}

export async function listPendingShiftEnds(): Promise<PendingShiftEndRecord[]> {
  return loadAll();
}

export async function enqueuePendingShiftEnd(
  args: Parameters<typeof buildPendingShiftEnd>[0],
): Promise<PendingShiftEndRecord> {
  const row = buildPendingShiftEnd(args);
  if (!row.companyId || !row.uid || !row.driverId) return row;
  if (!row.needsShiftLog && !row.needsPresenceClear) return row;

  const rows = await loadAll();
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    rows[idx] = {
      ...rows[idx],
      ...row,
      needsShiftLog: rows[idx].needsShiftLog || row.needsShiftLog,
      needsPresenceClear: rows[idx].needsPresenceClear || row.needsPresenceClear,
    };
  } else {
    rows.push(row);
  }
  await saveAll(rows);
  return row;
}

export async function journalShiftEndLogFailure(args: {
  companyId: string;
  uid: string;
  driverId: string;
  vehicleId?: string | null;
  reason: PendingShiftEndReason;
  shiftEndAt: number;
  shiftStartAt?: number;
  sessionStartedAt?: number;
  workedMinutes: number;
  weeklyWorkedMinutes?: number;
}): Promise<void> {
  await enqueuePendingShiftEnd({
    ...args,
    needsShiftLog: true,
    needsPresenceClear: false,
  });
}

export async function journalPresenceClearFailure(args: {
  companyId: string;
  uid: string;
  driverId: string;
  vehicleId: string;
  reason?: PendingShiftEndReason;
  shiftEndAt?: number;
}): Promise<void> {
  await enqueuePendingShiftEnd({
    companyId: args.companyId,
    uid: args.uid,
    driverId: args.driverId,
    vehicleId: args.vehicleId,
    reason: args.reason ?? 'manual',
    shiftEndAt: args.shiftEndAt ?? Date.now(),
    workedMinutes: 0,
    needsShiftLog: false,
    needsPresenceClear: true,
  });
}

/** Flush deferred shift-end log + presence clear when back online. */
export async function flushPendingShiftEnds(driver?: DriverProfile | null): Promise<number> {
  const rows = await loadAll();
  if (!rows.length) return 0;

  let flushed = 0;
  const nextRows: PendingShiftEndRecord[] = [];

  for (const row of rows) {
    let current: PendingShiftEndRecord | null = row;

    if (current.needsShiftLog) {
      try {
        await writeShiftEndLog(current.companyId, current.uid, {
          shiftEndAt: current.shiftEndAt,
          shiftStartAt: current.shiftStartAt,
          sessionStartedAt: current.sessionStartedAt,
          workedMinutes: current.workedMinutes,
          weeklyWorkedMinutes: current.weeklyWorkedMinutes,
          driverId: current.driverId,
          vehicleId: current.vehicleId ?? undefined,
        });
        current = markPendingShiftEndSynced(current, { shiftLog: true });
        flushed += 1;
      } catch (err) {
        console.warn('[pendingShiftEnd] shift log flush failed:', err);
      }
    }

    if (current?.needsPresenceClear && current.vehicleId) {
      try {
        const profile: DriverProfile = driver && driver.uid === current.uid
          ? driver
          : {
              uid: current.uid,
              id: current.driverId,
              name: '',
              email: '',
              phone: '',
              companyId: current.companyId,
              vehicleId: current.vehicleId,
              driverType: 'Taxi',
            };
        await clearOnlinePresence(profile, current.vehicleId);
        if (current.companyId) {
          await update(ref(getDatabaseInstance(), `vehicles/${current.companyId}/${current.vehicleId}`), {
            currentDriverId: null,
          }).catch(() => undefined);
        }
        current = current ? markPendingShiftEndSynced(current, { presence: true }) : null;
        flushed += 1;
      } catch (err) {
        console.warn('[pendingShiftEnd] presence clear flush failed:', err);
      }
    }

    if (current && pendingShiftEndStillOpen(current)) {
      nextRows.push(current);
    }
  }

  await saveAll(nextRows);
  return flushed;
}
