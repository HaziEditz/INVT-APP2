import type { DataSnapshot } from 'firebase/database';
import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import { getData, STORAGE_KEYS } from '@/lib/storage';
import { DriverProfile } from '@/types';

export function normalizeDriverId(id: string): string {
  const s = id.trim();
  const m = s.match(/^([dD])(\d+)$/i);
  if (m) return 'D' + String(parseInt(m[2], 10)).padStart(3, '0');
  return s;
}

export function driverIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizeDriverId(String(a ?? ''));
  const nb = normalizeDriverId(String(b ?? ''));
  if (!na || !nb) return false;
  return na.toLowerCase() === nb.toLowerCase();
}

function extractDriverIdFromRecord(fb: Record<string, unknown> | null | undefined): string {
  if (!fb || typeof fb !== 'object') return '';
  return normalizeDriverId(
    String(fb.id ?? fb.driverId ?? fb.DriverId ?? fb.dispatcherId ?? ''),
  );
}

function forEachChild(snap: DataSnapshot, fn: (child: DataSnapshot) => void): void {
  if (!snap.exists()) return;
  snap.forEach((child) => {
    try {
      fn(child);
    } catch {
      /* skip */
    }
  });
}

/** Resolve D001-style login to Firebase Auth email via drivers tree scan. */
export async function resolveEmailForLogin(loginId: string): Promise<string> {
  const trimmed = loginId.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();

  const idNorm = normalizeDriverId(trimmed);
  const cached = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
  if (cached?.id && driverIdsMatch(cached.id, idNorm) && cached.email?.includes('@')) {
    return cached.email.toLowerCase();
  }

  const database = getDatabaseInstance();
  const driversSnap = await get(ref(database, 'drivers'));
  if (!driversSnap.exists()) {
    throw new Error(`Driver ID "${idNorm}" not found. Try your email or contact your fleet administrator.`);
  }

  let foundEmail = '';
  forEachChild(driversSnap, (levelOne) => {
    if (foundEmail) return;
    forEachChild(levelOne, (levelTwo) => {
      if (foundEmail) return;
      const d = levelTwo.val() as Record<string, unknown> | null;
      if (!d || typeof d !== 'object') return;
      if (driverIdsMatch(extractDriverIdFromRecord(d), idNorm)) {
        const email = String(d.email ?? '').trim();
        if (email.includes('@')) foundEmail = email;
      }
    });
    if (!foundEmail) {
      const d = levelOne.val() as Record<string, unknown> | null;
      if (d && typeof d === 'object' && driverIdsMatch(extractDriverIdFromRecord(d), idNorm)) {
        const email = String(d.email ?? '').trim();
        if (email.includes('@')) foundEmail = email;
      }
    }
  });

  if (foundEmail) return foundEmail.toLowerCase();
  throw new Error(`Driver ID "${idNorm}" not found. Log in with your email once, or contact your administrator.`);
}
