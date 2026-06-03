import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  AuthError,
} from 'firebase/auth';
import type { DataSnapshot } from 'firebase/database';
import { get, ref } from 'firebase/database';
import { getAuthInstance, getDatabaseInstance, isFirebaseReady } from '@/lib/firebase';
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
    passforlink: String(fb.passforlink ?? fb.PassForLink ?? ''),
  };
}

function forEachChild(snap: DataSnapshot, fn: (child: DataSnapshot) => void): void {
  if (!snap.exists()) return;
  try {
    snap.forEach((child) => {
      try {
        fn(child);
      } catch (err) {
        console.warn('[Auth] forEachChild callback error:', err);
      }
    });
  } catch (err) {
    console.warn('[Auth] forEachChild failed:', err);
  }
}

function formatSignInError(err: unknown): string {
  const code = (err as AuthError)?.code ?? '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
    return 'Incorrect password. Please try again.';
  }
  if (code === 'auth/user-not-found') return 'No account found. Contact your fleet administrator.';
  if (code === 'auth/invalid-email') return 'Invalid email format.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a moment and try again.';
  if (code === 'auth/user-disabled') return 'This account has been disabled.';
  if (err instanceof Error) return err.message;
  return 'Unable to sign in. Please try again.';
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
  const database = getDatabaseInstance();
  const companySnap = await get(ref(database, `drivers/${companyId}/${uid}`));
  if (companySnap.exists()) {
    const val = companySnap.val();
    if (val && typeof val === 'object') {
      return buildProfileFromFirebase(uid, companyId, val as Record<string, unknown>, driverIdHint);
    }
  }

  try {
    const driversRoot = await get(ref(database, 'drivers'));
    if (!driversRoot.exists()) return null;

    let profile: DriverProfile | null = null;
    forEachChild(driversRoot, (companyNode) => {
      if (profile) return;
      const cId = companyNode.key;
      if (!cId) return;
      const node = companyNode.child(uid);
      if (node.exists()) {
        const val = node.val();
        if (val && typeof val === 'object') {
          profile = buildProfileFromFirebase(uid, cId, val as Record<string, unknown>, driverIdHint);
        }
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
    const database = getDatabaseInstance();
    const driversRoot = await get(ref(database, 'drivers'));
    if (driversRoot.exists()) {
      let found = '';
      forEachChild(driversRoot, (companyNode) => {
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
    const database = getDatabaseInstance();
    const driversSnap = await get(ref(database, 'drivers'));
    if (driversSnap.exists()) {
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
    try {
      const saved = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
      if (saved?.uid && saved.companyId) {
        const profile = await loadDriverProfile(saved.uid, saved.companyId, saved.id);
        if (profile) {
          setDriver(profile);
          await storeData(STORAGE_KEYS.driverSession, profile);
        }
      }
    } catch (err) {
      console.error('[Auth] refreshDriver failed:', err);
    }
  };

  useEffect(() => {
    if (!isFirebaseReady) {
      console.error('[Auth] Firebase not ready — auth listener skipped');
      setLoading(false);
      return;
    }

    let unsub = () => {};
    try {
      const authInstance = getAuthInstance();
      unsub = onAuthStateChanged(authInstance, async (user) => {
        try {
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
        } catch (err) {
          console.error('[Auth] onAuthStateChanged handler failed:', err);
          setLoading(false);
        }
      });
      getData<DriverProfile>(STORAGE_KEYS.driverSession)
        .then((saved) => {
          if (saved) setDriver(saved);
        })
        .catch((err) => console.error('[Auth] restore session failed:', err));
    } catch (err) {
      console.error('[Auth] onAuthStateChanged setup failed:', err);
      setLoading(false);
    }
    return unsub;
  }, []);

  const signIn = async (loginId: string, password: string) => {
    const trimmed = loginId.trim();
    const maskedLogin = trimmed.includes('@')
      ? trimmed.replace(/(.{2}).+(@.+)/, '$1***$2')
      : trimmed;

    try {
      console.log('[Auth] signIn start', { loginId: maskedLogin, hasPassword: !!password });

      if (!trimmed || !password) {
        throw new Error('Enter your email or driver ID and password.');
      }

      if (!isFirebaseReady) {
        throw new Error('Firebase is not ready. Restart the app and try again.');
      }

      const authInstance = getAuthInstance();
      console.log('[Auth] Firebase Auth ready', { appName: authInstance.app?.name });

      const emailToUse = trimmed.includes('@')
        ? trimmed.toLowerCase()
        : await resolveDriverIdToEmail(trimmed);

      console.log('[Auth] signInWithEmailAndPassword', {
        email: emailToUse.replace(/(.{2}).+(@.+)/, '$1***$2'),
      });

      const cred = await signInWithEmailAndPassword(authInstance, emailToUse, password);
      console.log('[Auth] Firebase Auth success', { uid: cred.user.uid });

      const companyId = await resolveCompanyId(cred.user.uid, cred.user.displayName);
      console.log('[Auth] companyId resolved:', companyId);

      const driverIdHint = trimmed.includes('@') ? '' : normalizeDriverId(trimmed);
      const profile = await loadDriverProfile(cred.user.uid, companyId, driverIdHint);

      if (!profile) {
        console.error('[Auth] No driver profile', { companyId, uid: cred.user.uid });
        try {
          await firebaseSignOut(authInstance);
        } catch (signOutErr) {
          console.warn('[Auth] signOut after missing profile failed:', signOutErr);
        }
        throw new Error(
          'Driver profile not found. Your account may not be set up yet — contact your fleet administrator.',
        );
      }

      if (!profile.email && cred.user.email) {
        profile.email = cred.user.email;
      }

      if (!profile.passforlink) {
        try {
          const database = getDatabaseInstance();
          const linksSnap = await get(ref(database, 'links'));
          if (linksSnap.exists()) {
            const links = linksSnap.val() as Record<string, string>;
            profile.passforlink = String(links.passforlink ?? links.PassForLink ?? '');
          }
        } catch (linksErr) {
          console.warn('[Auth] links lookup failed (non-fatal):', linksErr);
        }
      }

      console.log('[Auth] signIn complete', { driverId: profile.id, companyId: profile.companyId });
      setDriver(profile);
      await storeData(STORAGE_KEYS.driverSession, profile);
    } catch (err) {
      const message = formatSignInError(err);
      console.error('[Auth] signIn failed:', {
        message,
        code: (err as AuthError)?.code,
        stack: err instanceof Error ? err.stack : undefined,
        raw: err,
      });
      Alert.alert('Sign In Failed', message);
    }
  };

  const signOut = async () => {
    try {
      console.log('[Auth] signOut');
      if (isFirebaseReady) {
        await firebaseSignOut(getAuthInstance());
      }
      await removeData(STORAGE_KEYS.driverSession);
      setDriver(null);
    } catch (err) {
      console.error('[Auth] signOut failed:', err);
      Alert.alert('Sign Out Failed', err instanceof Error ? err.message : 'Could not sign out');
    }
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
