import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { signOut as firebaseSignOut, onAuthStateChanged, User } from 'firebase/auth';
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

interface AuthContextValue {
  driver: DriverProfile | null;
  firebaseUser: User | null;
  loading: boolean;
  profileLoading: boolean;
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
  if (fromDisplay) return fromDisplay;

  const saved = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
  if (saved?.uid === uid && saved.companyId) return saved.companyId;

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
      if (found) return found;
    }
  } catch (err) {
    console.warn('[Auth] companyId scan failed:', err);
  }

  return process.env.EXPO_PUBLIC_COMPANY_ID ?? '860869';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const refreshDriver = async () => {
    if (!isFirebaseReady) return;

    const user = getAuthInstance().currentUser;
    if (!user) {
      setDriver(null);
      return;
    }

    setProfileLoading(true);
    try {
      const saved = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
      const companyId = await resolveCompanyId(user.uid, user.displayName);
      const profile = await loadDriverProfile(user.uid, companyId, saved?.id ?? '');

      if (!profile) {
        setDriver(null);
        Alert.alert(
          'Profile Not Found',
          'Your driver profile could not be loaded. Contact your fleet administrator.',
        );
        return;
      }

      if (!profile.email && user.email) profile.email = user.email;

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

      setDriver(profile);
      await storeData(STORAGE_KEYS.driverSession, profile);
    } catch (err) {
      console.error('[Auth] refreshDriver failed:', err);
      Alert.alert(
        'Profile Error',
        err instanceof Error ? err.message : 'Could not load your driver profile.',
      );
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (!isFirebaseReady) {
      setLoading(false);
      return;
    }

    let unsub = () => {};
    try {
      const authInstance = getAuthInstance();
      unsub = onAuthStateChanged(authInstance, (user) => {
        setFirebaseUser(user);
        if (!user) {
          setDriver(null);
          setLoading(false);
          return;
        }

        getData<DriverProfile>(STORAGE_KEYS.driverSession)
          .then((saved) => {
            if (saved?.uid === user.uid) setDriver(saved);
          })
          .catch((err) => console.warn('[Auth] restore cached session failed:', err))
          .finally(() => setLoading(false));
      });
    } catch (err) {
      console.error('[Auth] onAuthStateChanged setup failed:', err);
      setLoading(false);
    }
    return unsub;
  }, []);

  const signOut = async () => {
    try {
      if (isFirebaseReady) {
        await firebaseSignOut(getAuthInstance());
      }
      await removeData(STORAGE_KEYS.driverSession);
      await removeData(STORAGE_KEYS.vehicleSessionReady);
      await removeData(STORAGE_KEYS.shiftActive);
      setDriver(null);
      setFirebaseUser(null);
    } catch (err) {
      console.error('[Auth] signOut failed:', err);
      Alert.alert('Sign Out Failed', err instanceof Error ? err.message : 'Could not sign out');
    }
  };

  return (
    <AuthContext.Provider
      value={{ driver, firebaseUser, loading, profileLoading, signOut, refreshDriver }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
