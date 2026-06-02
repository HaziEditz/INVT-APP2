import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { get, ref } from 'firebase/database';
import { auth, database } from '@/lib/firebase';
import { lookupDriverById } from '@/lib/dispatchApi';
import { getData, removeData, storeData, STORAGE_KEYS } from '@/lib/storage';
import { DriverProfile } from '@/types';

function normalizeDriverId(id: string) {
  const s = id.trim();
  const m = s.match(/^([dD])(\d+)$/i);
  if (m) return 'D' + String(parseInt(m[2], 10)).padStart(3, '0');
  return s;
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

async function loadDriverProfile(uid: string, companyId: string, driverId: string): Promise<DriverProfile | null> {
  const snap = await get(ref(database, `drivers/${companyId}/${uid}`));
  const fb = snap.val();
  if (!fb) return null;
  return {
    uid,
    id: normalizeDriverId(String(fb.id ?? fb.driverId ?? driverId)),
    name: String(fb.name ?? 'Driver'),
    email: String(fb.email ?? ''),
    phone: String(fb.phone ?? ''),
    companyId,
    vehicleId: String(fb.vehicleId ?? fb.vehicle ?? ''),
    driverType: fb.driverType ?? 'Taxi',
  };
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
      setFirebaseUser(user);
      if (!user) {
        setDriver(null);
        setLoading(false);
        return;
      }
      const saved = await getData<DriverProfile>(STORAGE_KEYS.driverSession);
      if (saved?.uid === user.uid) {
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
    const isEmail = trimmed.includes('@');

    if (isEmail) {
      const cred = await signInWithEmailAndPassword(auth, trimmed, password);
      const companyId = process.env.EXPO_PUBLIC_COMPANY_ID ?? '860869';
      const profile = await loadDriverProfile(cred.user.uid, companyId, '');
      if (!profile) throw new Error('Driver profile not found');
      setDriver(profile);
      await storeData(STORAGE_KEYS.driverSession, profile);
      return;
    }

    const driverId = normalizeDriverId(trimmed);
    const companyId = process.env.EXPO_PUBLIC_COMPANY_ID ?? '860869';
    const lookup = await lookupDriverById(driverId, companyId);
    if (!lookup.email) throw new Error('Driver ID not found');
    const cred = await signInWithEmailAndPassword(auth, lookup.email, password);
    const profile = await loadDriverProfile(cred.user.uid, companyId, driverId);
    if (!profile) throw new Error('Driver profile not found');
    setDriver(profile);
    await storeData(STORAGE_KEYS.driverSession, profile);
  };

  const signOut = async () => {
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
