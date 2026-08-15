import type { DataSnapshot } from 'firebase/database';
import { get, ref } from 'firebase/database';
import { getDatabaseInstance } from '@/lib/firebase';
import {
  driverIdsMatch,
  extractDriverIdFromRecord,
  looksLikeCompanyId,
  looksLikeFirebaseAuthUid,
  normalizeDriverId,
} from '@/lib/driverIdNormalize';
import { getData, STORAGE_KEYS } from '@/lib/storage';
import { DriverProfile } from '@/types';

export {
  normalizeDriverId,
  driverIdsMatch,
  extractDriverIdFromRecord,
} from '@/lib/driverIdNormalize';

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

type EmailCandidate = {
  email: string;
  companyId: string;
  recordKey: string;
  score: number;
};

function scoreCandidate(companyId: string, recordKey: string, email: string): number {
  let score = 0;
  if (email.includes('@')) score += 10;
  if (looksLikeCompanyId(companyId)) score += 5;
  if (looksLikeFirebaseAuthUid(recordKey)) score += 8;
  if (recordKey.startsWith('-')) score -= 2;
  return score;
}

function collectCandidatesFromDriversTree(
  driversSnap: DataSnapshot,
  idNorm: string,
): EmailCandidate[] {
  const out: EmailCandidate[] = [];

  const pushHit = (companyId: string, recordKey: string, d: Record<string, unknown>) => {
    if (!driverIdsMatch(extractDriverIdFromRecord(d), idNorm)) return;
    const email = String(d.email ?? d.Email ?? '').trim();
    if (!email.includes('@')) return;
    out.push({
      email,
      companyId,
      recordKey,
      score: scoreCandidate(companyId, recordKey, email),
    });
  };

  forEachChild(driversSnap, (levelOne) => {
    const k1 = levelOne.key || '';
    forEachChild(levelOne, (levelTwo) => {
      const d = levelTwo.val() as Record<string, unknown> | null;
      if (!d || typeof d !== 'object') return;
      pushHit(k1, levelTwo.key || '', d);
    });
    const d = levelOne.val() as Record<string, unknown> | null;
    if (d && typeof d === 'object') {
      pushHit(String(d.companyId ?? ''), k1, d);
    }
  });

  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Resolve D001-style login to Firebase Auth email via drivers tree scan.
 * Prefers live RTDB over cached session email (stale cache caused wrong-email
 * sign-in on shared devices). Cache is offline fallback only.
 */
export async function resolveEmailForLogin(loginId: string): Promise<string> {
  const trimmed = loginId.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();

  const idNorm = normalizeDriverId(trimmed);
  if (!/^D\d+$/i.test(idNorm)) {
    throw new Error(
      `Enter a Driver ID like D001 (or email). "${trimmed}" is not a recognized Driver ID.`,
    );
  }

  let liveError: unknown = null;
  try {
    const database = getDatabaseInstance();
    const driversSnap = await get(ref(database, 'drivers'));
    if (driversSnap.exists()) {
      const candidates = collectCandidatesFromDriversTree(driversSnap, idNorm);
      if (candidates.length > 0) {
        return candidates[0].email.toLowerCase();
      }
    }
  } catch (err) {
    liveError = err;
    console.warn('[driverAuth] live drivers lookup failed:', err);
  }

  try {
    const cached = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
    if (cached?.id && driverIdsMatch(cached.id, idNorm) && cached.email?.includes('@')) {
      return cached.email.toLowerCase();
    }
  } catch {
    /* ignore */
  }

  if (liveError) {
    throw new Error(
      `Could not look up Driver ID "${idNorm}" (network error). Try your email, or check connection.`,
    );
  }
  throw new Error(
    `Driver ID "${idNorm}" not found. Log in with your email once, or contact your administrator.`,
  );
}
