import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  AuthError,
} from 'firebase/auth';
import { get, ref } from 'firebase/database';
import { auth, database } from '@/lib/firebase';
import { getData, removeData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { DriverProfile } from '@/types';

function normalizeDriverId(id: string) {
  const s = id.trim();
  const m = s.match(/^([dD])(\d+)$/i);
  if (m) return 'D' + String(parseInt(m[2], 10)).padStart(3, '0');
  return s;
}

function driverIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
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

function buildProfileFromFirebase(
  uid: string,
  companyId: string,
  fb: Record<string, unknown>,
  driverIdHint: string,
): DriverProfile {
  return {
    uid,
    id: extractDriverIdFromRecord(fb) || normalizeDriverId(driverIdHint),
    name: String(fb.name ?? 'Driver'),
    email: String(fb.email ?? ''),
    phone: String(fb.phone ?? ''),
    companyId: String(fb.companyId ?? companyId),
    vehicleId: String(fb.vehicleId ?? fb.vehicle ?? ''),
    driverType: (fb.driverType as DriverProfile['driverType']) ?? 'Taxi',
  };
}

interface AuthContextValue {
  driver: DriverProfile | null;
  firebaseUser: User | null;
  loading: boolean;
  signIn: (loginId: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshDriver: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadDriverProfile(
  uid: string,
  companyId: string,
  driverIdHint: string,
): Promise<DriverProfile | null> {
  const companySnap = await get(ref(database, `drivers/${companyId}/${uid}`));
  if (companySnap.exists()) {
    return buildProfileFromFirebase(uid, companyId, companySnap.val(), driverIdHint);
  }

  try {
    const driversRoot = await get(ref(database, 'drivers'));
    if (!driversRoot.exists()) return null;

    let profile: DriverProfile | null = null;
    driversRoot.forEach((companyNode) => {
      if (profile) return;
      const cId = companyNode.key;
      if (!cId) return;
      const node = companyNode.child(uid);
      if (node.exists()) {
        profile = buildProfileFromFirebase(uid, cId, node.val(), driverIdHint);
      }
    });
    return profile;
  } catch (err) {
    console.warn('[Auth] loadDriverProfile scan failed:', err);
    return null;
  }
}

async function resolveCompanyId(uid: string, displayName: string | null): Promise<string> {
  const fromDisplay = displayName?.trim();
  if (fromDisplay) {
    console.log('[Auth] companyId from displayName:', fromDisplay);
    return fromDisplay;
  }

  const saved = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
  if (saved?.uid === uid && saved.companyId) {
    console.log('[Auth] companyId from saved session:', saved.companyId);
    return saved.companyId;
  }

  try {
    const driversRoot = await get(ref(database, 'drivers'));
    if (driversRoot.exists()) {
      let found = '';
      driversRoot.forEach((companyNode) => {
        if (found) return;
        const cId = companyNode.key;
        if (!cId || !companyNode.child(uid).exists()) return;
        const val = companyNode.child(uid).val() as Record<string, unknown> | null;
        found = String(val?.companyId ?? cId);
      });
      if (found) {
        console.log('[Auth] companyId from Firebase scan:', found);
        return found;
      }
    }
  } catch (err) {
    console.warn('[Auth] companyId scan failed:', err);
  }

  const fallback = process.env.EXPO_PUBLIC_COMPANY_ID ?? '860869';
  console.log('[Auth] companyId fallback:', fallback);
  return fallback;
}

async function resolveDriverIdToEmail(driverId: string): Promise<string> {
  const idNorm = normalizeDriverId(driverId);
  console.log('[Auth] resolveDriverIdToEmail:', idNorm);

  const cached = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
  if (cached?.id && driverIdsMatch(cached.id, idNorm) && cached.email?.includes('@')) {
    console.log('[Auth] Driver ID → email from cache:', cached.email);
    return cached.email;
  }

  try {
    const driversSnap = await get(ref(database, 'drivers'));
    if (driversSnap.exists()) {
      let foundEmail = '';
      driversSnap.forEach((levelOne) => {
        if (foundEmail) return;
        levelOne.forEach((levelTwo) => {
          if (foundEmail) return;
          const d = levelTwo.val() as Record<string, unknown> | null;
          if (!d || typeof d !== 'object') return;
          if (driverIdsMatch(extractDriverIdFromRecord(d), idNorm)) {
            const email = String(d.email ?? '').trim();
            if (email.includes('@')) foundEmail = email;
          }
        });
      });
      if (foundEmail) {
        console.log('[Auth] Driver ID → email from Firebase:', foundEmail);
        return foundEmail;
      }
    }
  } catch (err) {
    console.warn('[Auth] Firebase driver scan failed:', err);
  }

  throw new Error(
    `Driver ID "${idNorm}" not found. Log in with your email once, or contact your administrator.`,
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDriver = async () => {
    const saved = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
    if (saved?.uid && saved.companyId) {
      const profile = await loadDriverProfile(saved.uid, saved.companyId, saved.id);
      if (profile) {
        setDriver(profile);
        await storeData(STORAGE_KEYS.driverSession, profile);
      }
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      console.log('[Auth] onAuthStateChanged:', user?.uid ?? 'signed out');
      setFirebaseUser(user);
      if (!user) {
        setDriver(null);
        setLoading(false);
        return;
      }
      const saved = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
      const companyId = await resolveCompanyId(user.uid, user.displayName);
      const profile = await loadDriverProfile(user.uid, companyId, saved?.id ?? '');
      if (profile) {
        if (!profile.email && user.email) profile.email = user.email;
        setDriver(profile);
        await storeData(STORAGE_KEYS.driverSession, profile);
      } else if (saved?.uid === user.uid) {
        setDriver(saved);
      }
      setLoading(false);
    });
    getData<DriverProfile>(STORAGE_KEYS.driverSession).then((saved) => {
      if (saved) setDriver(saved);
    });
    return unsub;
  }, []);

  const signIn = async (loginId: string, password: string) => {
    const trimmed = loginId.trim();
    console.log('[Auth] signIn called', {
      loginId: trimmed.includes('@') ? trimmed : trimmed,
      hasPassword: !!password,
    });

    if (!trimmed || !password) {
      throw new Error('Enter your email or driver ID and password.');
    }

    const emailToUse = trimmed.includes('@')
      ? trimmed
      : await resolveDriverIdToEmail(trimmed);

    console.log('[Auth] signInWithEmailAndPassword →', emailToUse);

    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, emailToUse, password);
    } catch (err) {
      const authErr = err as AuthError;
      console.error('[Auth] Firebase Auth error:', authErr.code, authErr.message);
      throw err;
    }

    console.log('[Auth] Firebase Auth success, uid:', cred.user.uid);

    const companyId = await resolveCompanyId(cred.user.uid, cred.user.displayName);
    const driverIdHint = trimmed.includes('@') ? '' : normalizeDriverId(trimmed);
    const profile = await loadDriverProfile(cred.user.uid, companyId, driverIdHint);

    if (!profile) {
      console.error('[Auth] No driver profile at drivers/', companyId, '/', cred.user.uid);
      await firebaseSignOut(auth);
      throw new Error(
        'Driver profile not found. Your account may not be set up yet — contact your fleet administrator.',
      );
    }

    if (!profile.email && cred.user.email) {
      profile.email = cred.user.email;
    }

    console.log('[Auth] Driver profile loaded:', profile.id, profile.companyId);
    setDriver(profile);
    await storeData(STORAGE_KEYS.driverSession, profile);
  };

  const signOut = async () => {
    console.log('[Auth] signOut');
    await firebaseSignOut(auth);
    await removeData(STORAGE_KEYS.driverSession);
    setDriver(null);
  };

  return (
    <AuthContext.Provider value={{ driver, firebaseUser, loading, signIn, signOut, refreshDriver }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
