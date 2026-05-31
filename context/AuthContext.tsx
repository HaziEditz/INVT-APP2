import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { ref, get, set, update, onValue, off, remove, onDisconnect } from 'firebase/database';
import { auth, database } from '@/lib/firebase';
import { dispatchPost, getDispatchConfig } from '@/lib/dispatchApi';
import { storeData, getData, removeData } from '@/lib/storage';
import { fmtNZDate, fmtNZTime } from '@/lib/timezone';

function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Normalise driver IDs like d001 / D1 → D001 for consistent session storage and login matching */
function normalizeDriverId(id: string | undefined | null): string {
  const s = String(id ?? '').trim();
  if (!s) return '';
  const m = s.match(/^([dD])(\d+)$/i);
  if (m) return 'D' + String(parseInt(m[2], 10)).padStart(3, '0');
  return s;
}

function driverIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizeDriverId(a);
  const nb = normalizeDriverId(b);
  if (!na || !nb) return false;
  return na.toLowerCase() === nb.toLowerCase();
}

function extractDriverIdFromRecord(fb: Record<string, any> | null | undefined): string {
  if (!fb || typeof fb !== 'object') return '';
  return normalizeDriverId(
    String(fb.id ?? fb.driverId ?? fb.DriverId ?? fb.dispatcherId ?? '').trim(),
  );
}

export interface AllowedServices {
  taxi:    boolean;
  food:    boolean;
  freight: boolean;
  tm:      boolean;
  tow:     boolean; // ota22c-cutover-d
}

const DEFAULT_SERVICES: AllowedServices = { taxi: true, food: false, freight: false, tm: false, tow: false };

/** Normalises Firebase allowedServices — handles both new boolean-object and old string-array formats */
export function parseAllowedServices(raw: any): AllowedServices {
  if (!raw) return { ...DEFAULT_SERVICES };
  if (Array.isArray(raw)) {
    // Legacy string-array format e.g. ['taxi', 'food', 'total_mobility']
    const s = raw.map((v: string) => String(v).toLowerCase());
    return {
      taxi:    s.some(v => v === 'taxi'),
      food:    s.some(v => v === 'food' || v.includes('food')),
      freight: s.some(v => v === 'freight' || v.includes('freight')),
      tm:      s.some(v => v === 'tm' || v.includes('mobility')),
      tow:     s.some(v => v === 'tow' || v.includes('tow') || v.includes('recovery')),
    };
  }
  if (typeof raw === 'object') {
    // New boolean-object format e.g. { taxi: true, food: false, freight: false, tm: true, tow: false }
    return {
      taxi:    raw.taxi    !== false, // default true if key missing
      food:    !!raw.food,
      freight: !!raw.freight,
      tm:      !!raw.tm,
      tow:     !!raw.tow,
    };
  }
  return { ...DEFAULT_SERVICES };
}

export interface Driver {
  uid: string;
  id: string;
  name: string;
  email: string;
  companyId: string;
  phone: string;
  vehicleId: string;
  driverType: string;
  passforlink: string;
  link: string;
  allowedServices: AllowedServices;
  approved?: boolean;
  active?: boolean;       // false = deactivated by SA — driver cannot work
  sharedWith?: string[];  // company IDs that may also dispatch jobs to this driver
}

interface AuthContextType {
  driver: Driver | null;
  firebaseUser: User | null;
  isLoading: boolean;
  justSignedIn: boolean;
  wasKicked: boolean;
  clearJustSignedIn: () => void;
  clearKicked: () => void;
  signIn: (loginId: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateVehicleId: (vehicleId: string) => Promise<void>;
  updateDriverId: (driverId: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function isValidDriverSession(saved: Driver | null | undefined): saved is Driver {
  return !!(saved?.uid && saved?.companyId && (saved?.id || saved?.email));
}

async function enrichSessionFromFirebase(saved: Driver, uid: string): Promise<Driver> {
  if (!saved.companyId) return saved;
  try {
    const snap = await get(ref(database, `drivers/${saved.companyId}/${uid}`));
    if (!snap.exists()) return saved;
    const fb = snap.val() as Record<string, any>;
    const remoteId = extractDriverIdFromRecord(fb);
    const remoteVehicleId = String(
      fb.vehicleId ?? fb.VehicleId ?? fb.selectedVehicleId ?? fb.SelectedVehicleid ?? '',
    ).trim();
    const enriched: Driver = { ...saved };
    if (remoteId && remoteId !== uid) enriched.id = remoteId;
    if (remoteVehicleId) enriched.vehicleId = remoteVehicleId;
    if (JSON.stringify(enriched) !== JSON.stringify(saved)) {
      await storeData('driver_session', enriched);
      console.log('[Auth] Session enriched from Firebase — id:', enriched.id, 'vehicleId:', enriched.vehicleId);
    }
    return enriched;
  } catch (err) {
    console.warn('[Auth] Session enrich from Firebase failed:', err);
    return saved;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const [wasKicked, setWasKicked] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  driverRef.current = driver;
  const localSessionIdRef = useRef<string | null>(null);

  // Preload driver_session from AsyncStorage immediately on cold start so the
  // app can restore the driver profile before Firebase Auth finishes resolving.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getData<Driver>('driver_session');
      if (cancelled || !isValidDriverSession(saved)) return;
      if (!saved.allowedServices) saved.allowedServices = parseAllowedServices(null);
      setDriver(saved);
      console.log('[Auth] Preloaded driver_session — id:', saved.id, 'companyId:', saved.companyId);
    })();
    return () => { cancelled = true; };
  }, []);

  // Restore session on app start — pairs AsyncStorage driver_session with persisted Firebase Auth.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        const saved = await getData<Driver>('driver_session');
        if (isValidDriverSession(saved) && saved.uid === user.uid) {
          const storedSessionId = await getData<string>('active_session_id');
          if (storedSessionId) localSessionIdRef.current = storedSessionId;

          if (!saved.allowedServices) saved.allowedServices = parseAllowedServices(null);
          const restored = await enrichSessionFromFirebase(saved, user.uid);
          setDriver(restored);
          console.log('[Auth] Session restored — no login required');
        } else if (!saved) {
          setDriver(null);
        }
      } else {
        setDriver(null);
        await removeData('driver_session');
      }
      setIsLoading(false);
    });
    return unsub;
  }, []);

  // NOTE: We intentionally do NOT re-trigger onboarding on app resume.
  // Presence refresh on resume is handled by DriverContext's AppState listener.

  // Real-time listener: watch drivers/{companyId}/{uid} in Firebase
  // When the owner/admin panel updates vehicleId, driverId, name, etc. the driver app
  // picks up the changes instantly without requiring a re-login.
  useEffect(() => {
    if (!driver?.uid || !driver?.companyId) return;

    const profileRef = ref(database, `drivers/${driver.companyId}/${driver.uid}`);

    const unsubscribe = onValue(profileRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      const remote = snapshot.val() as Record<string, any>;

      // Log ALL raw Firebase fields so we can see exactly what the admin panel writes
      console.log('[Auth] Firebase driver profile raw keys:', Object.keys(remote).join(', '));
      console.log('[Auth] Firebase driver profile raw data:', JSON.stringify(remote));

      // Merge remote fields — remote data wins for vehicleId and id (set by admin panel)
      const current = driverRef.current;
      if (!current) return;

      // assignedVehicles (array) = SA owner panel schema
      // allocatedVehicles (object {"Taxi02": true}) = new Owner Portal schema
      const _liveAssignedArr: string[] = Array.isArray(remote.assignedVehicles) ? remote.assignedVehicles : [];
      const _liveAllocObj = remote.allocatedVehicles;
      const _liveAllocKeys: string[] = (_liveAllocObj && typeof _liveAllocObj === 'object' && !Array.isArray(_liveAllocObj))
        ? Object.entries(_liveAllocObj as Record<string, any>).filter(([, v]) => v === true).map(([k]) => k)
        : [];
      const hasAssignedVehicles = _liveAssignedArr.length > 0 || _liveAllocKeys.length > 0;
      const _liveFirstVehicle = _liveAssignedArr[0] || _liveAllocKeys[0] || '';
      const remoteVehicleId: string = hasAssignedVehicles
        ? (remote.vehicleId        ||
           remote.VehicleId        ||
           remote.SelectedVehicleid ||
           remote.selectedVehicleId ||
           remote.vehicle_id       ||
           _liveFirstVehicle ||
           '')
        : current.vehicleId || '';

      const remoteDriverId: string = extractDriverIdFromRecord(remote);

      const remoteAllowedServices: AllowedServices = remote.allowedServices != null
        ? parseAllowedServices(remote.allowedServices)
        : current.allowedServices ?? parseAllowedServices(null);

      // approved: undefined means not yet checked; true = approved; false = pending
      const remoteApproved: boolean | undefined =
        remote.approved === true  ? true  :
        remote.approved === false ? false :
        current.approved;

      // sharedWith — accept array or Firebase object-style
      const rawSharedWith = remote.sharedWith;
      let remoteSharedWith: string[] | undefined = current.sharedWith;
      if (Array.isArray(rawSharedWith)) {
        remoteSharedWith = rawSharedWith.map(String).filter(Boolean);
      } else if (rawSharedWith && typeof rawSharedWith === 'object') {
        remoteSharedWith = Object.values(rawSharedWith).map(String).filter(Boolean);
      }

      const merged: Driver = {
        ...current,
        // Admin-managed fields — always take from Firebase if present
        id:              remoteDriverId || current.id,
        vehicleId:       remoteVehicleId || current.vehicleId,
        name:            remote.name       || current.name,
        phone:           remote.phone      || current.phone,
        driverType:      remote.driverType || current.driverType,
        allowedServices: remoteAllowedServices,
        approved:        remoteApproved,
        sharedWith:      remoteSharedWith,
      };

      // Only update if something actually changed to avoid loops
      const changed =
        merged.id !== current.id ||
        merged.vehicleId !== current.vehicleId ||
        merged.name !== current.name ||
        merged.phone !== current.phone ||
        merged.driverType !== current.driverType ||
        JSON.stringify(merged.allowedServices) !== JSON.stringify(current.allowedServices) ||
        merged.approved !== current.approved ||
        JSON.stringify(merged.sharedWith) !== JSON.stringify(current.sharedWith);

      if (changed) {
        console.log('[Auth] Driver profile updated from Firebase (owner panel sync):', {
          id: merged.id,
          vehicleId: merged.vehicleId,
        });
        setDriver(merged);
        await storeData('driver_session', merged);
      }
    });

    return () => off(profileRef);
  }, [driver?.uid, driver?.companyId]);

  // ── Real-time SA listener: drivers/{uid}/allowedServices + drivers/{uid}/active ──────────
  // SA-Drivers.aspx writes allowedServices and active to the top-level UID-keyed path.
  // This listener fires whenever SA changes the driver's service permissions or active state,
  // giving instant in-session reflection without requiring a re-login.
  useEffect(() => {
    if (!driver?.uid) return;

    const saRef = ref(database, `drivers/${driver.uid}`);

    onValue(saRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      const sa = snapshot.val() as Record<string, any>;
      const current = driverRef.current;
      if (!current) return;

      const newActive: boolean | undefined =
        sa.active === false ? false :
        sa.active === true  ? true  :
        current.active;

      const newAllowedServices: AllowedServices = sa.allowedServices != null
        ? parseAllowedServices(sa.allowedServices)
        : current.allowedServices;

      const activeChanged = newActive !== current.active;
      const servicesChanged = JSON.stringify(newAllowedServices) !== JSON.stringify(current.allowedServices);

      if (!activeChanged && !servicesChanged) return;

      console.log('[Auth] SA flags updated from Firebase:', { active: newActive, allowedServices: newAllowedServices });

      const merged: Driver = { ...current, active: newActive, allowedServices: newAllowedServices };
      setDriver(merged);
      await storeData('driver_session', merged);
    });

    return () => off(saRef);
  }, [driver?.uid]);

  // ── Session kick detection ────────────────────────────────────────────────────────────────
  // If another device logs in with the same account, Firebase overwrites activeSessionId.
  // This listener detects the mismatch and signs this device out immediately.
  useEffect(() => {
    if (!driver?.uid || !driver?.companyId) return;

    const sessRef = ref(database, `drivers/${driver.companyId}/${driver.uid}/activeSessionId`);
    let firstFire = true;

    const unsub = onValue(sessRef, async (snapshot) => {
      const remoteSessionId = snapshot.val() as string | null;
      const localSessionId  = localSessionIdRef.current;

      // On the very first fire we just confirm our own session — no action needed
      if (firstFire) {
        firstFire = false;
        // If already mismatched on first fire (device came online after being kicked offline)
        if (localSessionId && remoteSessionId && remoteSessionId !== localSessionId) {
          console.log('[Auth] Session mismatch on reconnect — kicking this device');
        } else {
          return;
        }
      }

      // Ignore if no local ID (old install without session tracking) or still matches
      if (!localSessionId || !remoteSessionId || remoteSessionId === localSessionId) return;

      // ─── KICKED ───────────────────────────────────────────────────────────────
      console.log('[Auth] Session kicked — another device signed in with this account');
      localSessionIdRef.current = null;
      setWasKicked(true);

      // Sign out locally — do NOT remove the remote activeSessionId (it belongs to the new device)
      const d = driverRef.current;
      if (d?.companyId && d?.vehicleId) {
        const presPath = ref(database, `online/${d.companyId}/${d.vehicleId}/current`);
        try {
          await onDisconnect(presPath).cancel();
          await remove(presPath);
        } catch { /* best-effort */ }
      }
      await firebaseSignOut(auth);
      setDriver(null);
      setFirebaseUser(null);
      setJustSignedIn(false);
      await removeData('driver_session');
      await removeData('active_session_id');
    });

    return () => off(sessRef);
  }, [driver?.uid, driver?.companyId]);

  // NOTE: A second "numeric-ID" listener (`drivers/{companyId}/{id}`) was removed because it
  // could read another driver's record stored at the same numeric-ID path, corrupting the
  // logged-in driver's profile mid-session and causing presence to be written to the wrong
  // vehicle node on the dispatch map.
  // The UID-keyed listener above (`drivers/{companyId}/{uid}`) is the only authoritative source.

  // ── Driver ID → email resolver ────────────────────────────────────────────
  // Drivers may log in with a short driver ID (e.g. "D001") instead of their
  // full email address.  This resolves the ID to an email so Firebase Auth
  // can authenticate them.
  //
  // Lookup priority:
  //   1. Local AsyncStorage session — no Firebase read, instant, works offline.
  //      Populated automatically on every successful login.
  //   2. Firebase scan of drivers/{companyId}/{uid} nodes — requires auth-level
  //      read rules; will be skipped if rules block it (permission denied).
  //
  // First-ever login MUST use the email address so the local cache is seeded.
  // Every subsequent login on the same device can use the driver ID.
  const resolveDriverIdToEmail = async (driverId: string): Promise<string> => {
    const idNorm = normalizeDriverId(driverId);

    // 1. Local session cache — populated by every successful email login.
    //    No Firebase read required, works completely offline.
    try {
      const cached = await getData<Driver>('driver_session');
      if (cached?.id && driverIdsMatch(cached.id, idNorm) && cached.email?.includes('@')) {
        console.log('[Login] Driver ID resolved from local session cache:', idNorm, '→', cached.email);
        return cached.email;
      }
    } catch (err) {
      console.warn('[Login] Local session cache read failed:', err);
    }

    // 2. Firebase scan (requires auth-level read — may fail with permission denied
    //    if the driver has never logged in with email on this device).
    try {
      const driversSnap = await get(ref(database, 'drivers'));
      if (driversSnap.exists()) {
        let foundEmail = '';
        driversSnap.forEach((levelOne) => {
          if (foundEmail) return;
          levelOne.forEach((levelTwo) => {
            if (foundEmail) return;
            const d = levelTwo.val();
            if (!d || typeof d !== 'object') return;
            const nodeId = extractDriverIdFromRecord(d);
            if (driverIdsMatch(nodeId, idNorm)) {
              const email = String(d.email ?? '').trim();
              if (email.includes('@')) foundEmail = email;
            }
          });
        });
        if (foundEmail) {
          console.log('[Login] Driver ID resolved by Firebase scan:', idNorm, '→', foundEmail);
          return foundEmail;
        }
      }
    } catch (err) {
      // Permission denied = Firebase rules require auth for this read.
      // The driver needs to log in with email once to seed the local cache.
      console.warn('[Login] Firebase driver scan failed (likely permission rules):', (err as Error)?.message ?? err);
    }

    throw Object.assign(
      new Error(
        `Driver ID "${idNorm || driverId.toUpperCase()}" not recognised on this device.\n\nPlease log in with your email address. Once you've signed in with email, you can use your driver ID next time.`,
      ),
      { code: 'app/driver-not-found' },
    );
  };

  const signIn = async (loginId: string, password: string) => {
    // Resolve driver ID → email if the input is not an email address
    const emailToUse = loginId.includes('@')
      ? loginId
      : await resolveDriverIdToEmail(loginId);

    const cred = await signInWithEmailAndPassword(auth, emailToUse, password);
    const user = cred.user;

    const config = await getDispatchConfig();

    const now = new Date();
    const loginDate = fmtNZDate(now);
    const loginTime = fmtNZTime(now);

    // ── Resolve companyId ───────────────────────────────────────────────────────
    // Priority 1: Firebase Auth displayName  (set by owner/admin panel at account creation)
    // Priority 2: Saved session              (avoids re-scan on subsequent logins)
    // Priority 3: Scan drivers/{cId}/{uid}   (fallback for older accounts without displayName)
    // Priority 4: Hard fallback '1216'       (legacy test company — should never be needed)
    let companyIdFromFirebase = user.displayName?.trim() || '';

    if (!companyIdFromFirebase) {
      // Try saved session first (fastest — avoids Firebase scan)
      const prevSession = await getData<Driver>('driver_session');
      if (prevSession?.uid === user.uid && prevSession?.companyId) {
        companyIdFromFirebase = prevSession.companyId;
        console.log('[Login] companyId from saved session:', companyIdFromFirebase);
      } else {
        // Scan drivers/ to find which company node holds this UID
        try {
          const driversRoot = await get(ref(database, 'drivers'));
          if (driversRoot.exists()) {
            driversRoot.forEach((companyNode) => {
              if (companyIdFromFirebase) return;
              const cId = companyNode.key;
              if (!cId) return;
              const driverNode = companyNode.child(user.uid);
              if (driverNode.exists()) {
                const stored = driverNode.val()?.companyId;
                companyIdFromFirebase = stored || cId;
                console.log('[Login] companyId found by UID scan:', companyIdFromFirebase, '(parent key:', cId, ')');
              }
            });
          }
        } catch (scanErr) {
          console.warn('[Login] companyId UID scan failed:', scanErr);
        }
      }
    } else {
      console.log('[Login] companyId from Firebase Auth displayName:', companyIdFromFirebase);
    }

    if (!companyIdFromFirebase) {
      // No company ID found anywhere — sign in will proceed but driver won't receive jobs
      console.error('[Login] companyId could not be resolved — displayName not set, no saved session, and UID not found in drivers/. Contact your fleet administrator.');
      throw new Error('Your account is not linked to a company. Please contact your fleet administrator to set up your account.');
    }

    const parms = `CompanyId,,${companyIdFromFirebase}&&Username,,${user.email ?? loginId}&&password,,doesn'tmatter&&PlayerId,,${user.uid}&&LogInDate,,${loginDate}&&LogInTime,,${loginTime}`;

    let apiDriverId = '';
    let driverName = '';
    let driverPhone = '';
    let driverCompanyId = companyIdFromFirebase;
    let driverType = '';
    let vehicleId = '';

    try {
      console.log('[Login] Dispatch config:', config);
      console.log('[Login] CompanyId (displayName):', companyIdFromFirebase);
      console.log('[Login] Parms:', parms);

      const result = await dispatchPost<any[]>({
        Action: 'FnDriverLogin',
        Parms: parms,
        UserKey: config.passforlink,
      });

      console.log('[Login] FnDriverLogin result:', JSON.stringify(result));

      if (Array.isArray(result) && result.length > 0) {
        const d = result[0];
        apiDriverId = String(d.Id ?? '');
        driverName = `${d.UserFName ?? ''} ${d.UserLName ?? ''}`.trim();
        driverPhone = d.UserPhoneNo ?? '';
        driverCompanyId = String(d.CompanyId ?? companyIdFromFirebase);
        driverType = d.Condition ?? '';
        vehicleId = String(d.SelectedVehicleid ?? d.VehicleId ?? '');
        console.log('[Login] Driver from API:', { apiDriverId, driverName, driverCompanyId });
      } else {
        console.warn('[Login] FnDriverLogin returned empty or non-array:', result);
      }
    } catch (err: any) {
      console.warn('[Login] FnDriverLogin API failed:', err?.message ?? err);
    }

    const resolvedEmail = user.email ?? loginId;

    // Read Firebase driver profile for admin-set fields (vehicleId, allowedServices, etc.)
    let firebaseVehicleId = '';
    let firebaseDriverId = '';
    let firebaseName = '';
    let firebasePhone = '';
    let firebaseAllowedServices: AllowedServices | null = null;
    let firebaseApproved: boolean | undefined = undefined;
    let firebaseSharedWith: string[] | undefined = undefined;

    try {
      const snap = await get(ref(database, `drivers/${driverCompanyId}/${user.uid}`));
      if (snap.exists()) {
        const fb = snap.val() as Record<string, any>;
        console.log('[Login] Firebase raw driver keys:', Object.keys(fb).join(', '));

        // Only trust vehicleId from Firebase if the profile also has assignedVehicles (new owner
        // panel schema). Without assignedVehicles, vehicleId may be stale garbage written by a
        // previous buggy login and should be ignored so the driver goes through onboarding.
        // assignedVehicles (array) = SA owner panel; allocatedVehicles (object) = new Owner Portal
        const _loginAssignedArr: string[] = Array.isArray(fb.assignedVehicles) ? fb.assignedVehicles : [];
        const _loginAllocObj = fb.allocatedVehicles;
        const _loginAllocKeys: string[] = (_loginAllocObj && typeof _loginAllocObj === 'object' && !Array.isArray(_loginAllocObj))
          ? Object.entries(_loginAllocObj as Record<string, any>).filter(([, v]) => v === true).map(([k]) => k)
          : [];
        const hasAssignedVehicles = _loginAssignedArr.length > 0 || _loginAllocKeys.length > 0;
        if (hasAssignedVehicles) {
          firebaseVehicleId =
            fb.vehicleId        ||
            fb.VehicleId        ||
            fb.SelectedVehicleid ||
            fb.selectedVehicleId ||
            fb.vehicle_id       ||
            _loginAssignedArr[0] || _loginAllocKeys[0] ||
            '';
        } else {
          console.log('[Login] No assignedVehicles/allocatedVehicles in profile — ignoring stale vehicleId field');
        }
        firebaseDriverId = extractDriverIdFromRecord(fb);
        firebaseName  = fb.name  || '';
        firebasePhone = fb.phone || '';
        firebaseAllowedServices = parseAllowedServices(fb.allowedServices);
        firebaseApproved = fb.approved === false ? false : (fb.approved === true ? true : undefined);
        // sharedWith can live on the company-keyed profile OR on the top-level drivers/{uid} node
        if (Array.isArray(fb.sharedWith) && fb.sharedWith.length > 0) {
          firebaseSharedWith = fb.sharedWith.map(String).filter(Boolean);
        }
        console.log('[Login] Loaded from Firebase:', { firebaseVehicleId, firebaseDriverId, firebaseAllowedServices, firebaseApproved, hasAssignedVehicles, sharedWith: firebaseSharedWith });
      }
    } catch (err) {
      console.warn('[Login] Could not read Firebase driver profile:', err);
    }

    // ── Read SA-managed flags from top-level drivers/{uid} ──────────────────
    // SA writes allowedServices and active here (keyed by Firebase Auth UID, no company).
    // These take priority over company-scoped values and are the authoritative source
    // for which service types a driver is permitted to do and whether they are active.
    let saActive: boolean | undefined = undefined;
    let saAllowedServices: AllowedServices | null = null;
    try {
      const topSnap = await get(ref(database, `drivers/${user.uid}`));
      if (topSnap.exists()) {
        const top = topSnap.val() as Record<string, any>;

        // active flag — SA deactivation
        if (top.active === false) saActive = false;
        else if (top.active === true) saActive = true;

        // SA-managed allowedServices (overrides company-scoped value)
        if (top.allowedServices != null) {
          saAllowedServices = parseAllowedServices(top.allowedServices);
          console.log('[Login] SA allowedServices from top-level drivers/ path:', saAllowedServices);
        }

        // sharedWith from top-level (if not already found in company-scoped path)
        if (!firebaseSharedWith && top.sharedWith) {
          const raw = top.sharedWith;
          if (Array.isArray(raw)) {
            firebaseSharedWith = raw.map(String).filter(Boolean);
          } else if (typeof raw === 'object' && raw !== null) {
            firebaseSharedWith = Object.values(raw).map(String).filter(Boolean);
          }
          console.log('[Login] sharedWith from top-level drivers/ path:', firebaseSharedWith);
        }

        console.log('[Login] SA flags from top-level drivers/', user.uid, ':', { active: saActive });
      }
    } catch (err) {
      console.warn('[Login] Could not read SA flags from top-level drivers/ path:', err);
    }

    // Block login if SA has deactivated this driver
    if (saActive === false) {
      await firebaseSignOut(auth);
      throw Object.assign(
        new Error('Your driver account has been deactivated by your administrator. Please contact your fleet manager.'),
        { code: 'app/deactivated' },
      );
    }

    // Restore any manually-saved session values as last resort
    const savedSession = await getData<Driver>('driver_session');
    const savedVehicleId = savedSession?.uid === user.uid ? (savedSession.vehicleId || '') : '';
    const savedDriverId  = savedSession?.uid === user.uid
      ? normalizeDriverId(savedSession.id || '')
      : '';

    // Priority: REST API > Firebase admin-set > locally saved (never fall back to Firebase Auth uid)
    const resolvedVehicleId = vehicleId || firebaseVehicleId || savedVehicleId;
    const resolvedDriverId  = normalizeDriverId(apiDriverId || firebaseDriverId || savedDriverId);

    // ── Suspension check (dispatch console schema) ──────────────────────────
    // Dispatch writes { type, message, suspendedUntil, suspendedBy, timestamp }
    // to suspended/{companyId}/{vehicleId}.  Block login if the record exists,
    // type === "suspended", and suspendedUntil is null (indefinite) or in the future.
    if (resolvedVehicleId) {
      try {
        const suspSnap = await get(ref(database, `suspended/${driverCompanyId}/${resolvedVehicleId}`));
        if (suspSnap.exists()) {
          const susp = suspSnap.val() as { type?: string; message?: string; suspendedUntil?: string | null };
          if (susp.type === 'suspended') {
            const isExpired = susp.suspendedUntil != null && new Date(susp.suspendedUntil) <= new Date();
            if (!isExpired) {
              await firebaseSignOut(auth);
              throw Object.assign(
                new Error(susp.message || 'Your account is currently suspended. Please contact your dispatcher.'),
                { code: 'app/suspended' },
              );
            }
          }
        }
      } catch (err: any) {
        if (err?.code === 'app/suspended') throw err; // re-throw so login.tsx handles it
        console.warn('[Login] Could not read suspension record:', err);
      }
    }

    // Track whether vehicleId/driverId came from REST API or just from local/Firebase cache.
    // We only write these back to Firebase if they came from the REST API — otherwise we
    // risk overwriting the admin panel's assignment with a stale cached value.
    const vehicleIdFromApi = !!vehicleId;

    const savedAllowedServices: AllowedServices | null =
      savedSession?.uid === user.uid ? (savedSession.allowedServices ?? null) : null;

    const driverObj: Driver = {
      uid:             user.uid,
      id:              resolvedDriverId,
      name:            driverName || firebaseName || resolvedEmail,
      email:           resolvedEmail,
      companyId:       driverCompanyId,
      phone:           driverPhone || firebasePhone,
      vehicleId:       resolvedVehicleId,
      driverType,
      passforlink:     config.passforlink,
      link:            config.baseUrl ?? '',
      // SA allowedServices (top-level) takes priority over company-scoped value
      allowedServices: saAllowedServices ?? firebaseAllowedServices ?? savedAllowedServices ?? parseAllowedServices(null),
      approved:        firebaseApproved,
      active:          saActive,   // undefined = not set by SA (no restriction); false = deactivated
      sharedWith:      firebaseSharedWith,
    };

    // Generate a fresh session ID for this login — used to detect concurrent logins
    const sessionId = generateSessionId();
    localSessionIdRef.current = sessionId;
    await storeData('active_session_id', sessionId);
    setWasKicked(false); // clear any previous kick banner on successful new login

    setDriver(driverObj);
    setJustSignedIn(true);
    await storeData('driver_session', driverObj);
    console.log('[Login] Session saved — id:', driverObj.id, 'email:', driverObj.email);

    // Merge driver profile into Firebase — use update() so we never blank out
    // fields the admin panel or a previous sign-in already set (especially vehicleId).
    // Only include a field if we actually have a value for it.
    try {
      const profileUpdate: Record<string, any> = {
        uid:             driverObj.uid,
        email:           driverObj.email,
        companyId:       driverObj.companyId,
        lastLogin:       new Date().toISOString(),
        activeSessionId: sessionId, // overwrites any other device's session → kicks them out
      };
      // Only write vehicleId/driverId if they came from the REST API.
      // Never write a vehicleId that came only from Firebase or a saved session —
      // doing so would perpetuate stale values from old buggy logins.
      if (vehicleIdFromApi && driverObj.vehicleId)     profileUpdate.vehicleId   = driverObj.vehicleId;
      if (driverObj.id) {
        profileUpdate.id = driverObj.id;
        profileUpdate.driverId = driverObj.id;
      }
      if (driverObj.name)                              profileUpdate.name        = driverObj.name;
      if (driverObj.phone)                             profileUpdate.phone       = driverObj.phone;
      if (driverObj.driverType)                        profileUpdate.driverType  = driverObj.driverType;

      await update(ref(database, `drivers/${driverObj.companyId}/${user.uid}`), profileUpdate);
      console.log('[Auth] Driver profile merged to Firebase at drivers/', driverObj.companyId, '/', user.uid);

      // Also stamp drivers/{uid}/companyId at the top-level UID-keyed node so the driver is
      // discoverable by admins in other companies who want to add this driver to their sharedWith list.
      // We never write sharedWith here — that is exclusively managed by the owner panel.
      try {
        await update(ref(database, `drivers/${user.uid}`), {
          companyId: driverObj.companyId,
          uid:       user.uid,
          email:     driverObj.email || '',
          ...(driverObj.id ? { id: driverObj.id, driverId: driverObj.id } : {}),
        });
        console.log('[Auth] Top-level driver node stamped at drivers/', user.uid);
      } catch (stampErr) {
        console.warn('[Auth] Could not stamp top-level driver node:', stampErr);
      }
    } catch (err) {
      console.warn('[Auth] Could not sync driver profile to Firebase:', err);
    }
  };

  const updateVehicleId = async (vehicleId: string) => {
    if (!driver) return;
    const updated: Driver = { ...driver, vehicleId };
    setDriver(updated);
    await storeData('driver_session', updated);
    try {
      await set(ref(database, `drivers/${driver.companyId}/${driver.uid}/vehicleId`), vehicleId);
      console.log('[Auth] VehicleId updated in Firebase:', vehicleId);
    } catch (err) {
      console.warn('[Auth] Could not update vehicleId in Firebase:', err);
    }
  };

  const updateDriverId = async (driverId: string) => {
    if (!driver) return;
    const normalized = normalizeDriverId(driverId);
    const updated: Driver = { ...driver, id: normalized };
    setDriver(updated);
    await storeData('driver_session', updated);
    try {
      await update(ref(database, `drivers/${driver.companyId}/${driver.uid}`), {
        id: normalized,
        driverId: normalized,
      });
      console.log('[Auth] DriverId updated in Firebase:', normalized);
    } catch (err) {
      console.warn('[Auth] Could not update driverId in Firebase:', err);
    }
  };

  const updateName = async (name: string) => {
    if (!driver) return;
    const updated: Driver = { ...driver, name };
    setDriver(updated);
    await storeData('driver_session', updated);
    try {
      await set(ref(database, `drivers/${driver.companyId}/${driver.uid}/name`), name);
      console.log('[Auth] Name updated in Firebase:', name);
    } catch (err) {
      console.warn('[Auth] Could not update name in Firebase:', err);
    }
  };

  const signOut = async () => {
    // Remove presence + stale jobs BEFORE clearing driver — we need vehicleId/companyId.
    // IMPORTANT: cancel the onDisconnect handler FIRST so the Firebase SDK reconnect
    // event (triggered by firebaseSignOut) can't re-register it and recreate the node.
    // OTA20 ANR FIX: presence-clear writes are fire-and-forget so the JS
    // thread is freed the instant the user presses Sign Out.  We still kick
    // off the cancel/remove + auth signout, but never block the UI on them.
    const d = driverRef.current;
    if (d?.companyId && d?.vehicleId) {
      // v12-ota22c — dispatch-team recommended sign-out sequence:
      //   1. Set vehiclestatus = "Offline" (top-level) FIRST so dispatch HQ
      //      hits the fast-path and skips the 30s screen-off grace period.
      //      Default.aspx:8243-8255 reads top-level vehiclestatus to decide.
      //   2. Cancel onDisconnect handlers so reconnects can't re-create nodes.
      //   3. Remove the WHOLE online/{cid}/{vid} node (not just /current) so
      //      child_removed fires on the board and the driver disappears.
      const onlinePath = `online/${d.companyId}/${d.vehicleId}`;
      const presPath   = ref(database, `${onlinePath}/current`);
      // 1. Mark Offline first — top-level field that the board reads.
      update(ref(database, onlinePath), { vehiclestatus: 'Offline' }).catch(() => {});
      // 2. Cancel disconnect handlers (presence + any job-return ones).
      onDisconnect(presPath).cancel().catch(() => {});
      onDisconnect(ref(database, onlinePath)).cancel().catch(() => {});
      // 3. Remove the whole node (board's child_removed listener fires).
      //    Tiny delay lets the Offline flag flush first so the fast-path
      //    fires; the remove still runs fire-and-forget so UI isn't blocked.
      setTimeout(() => {
        remove(ref(database, onlinePath)).catch(() => {});
      }, 50);
      if (d.id) {
        remove(ref(database, `jobs/${d.companyId}/${d.vehicleId}/${d.id}`)).catch(() => {});
      }
    }
    localSessionIdRef.current = null;
    // Clear local state IMMEDIATELY so the UI bounces back to login screen
    // without waiting for any network round-trip.
    setDriver(null);
    setFirebaseUser(null);
    removeData('driver_session').catch(() => {});
    removeData('active_session_id').catch(() => {});
    // Defer firebaseSignOut by 500ms so the fire-and-forget presence-remove
    // write above has time to flush before the WebSocket+auth token tear down
    // (otherwise the remove gets dropped → ghost driver in dispatch console).
    // setTimeout itself is non-blocking — UI is already on the login screen.
    setTimeout(() => { firebaseSignOut(auth).catch(() => {}); }, 500);
  };

  const clearJustSignedIn = () => setJustSignedIn(false);
  const clearKicked = () => setWasKicked(false);

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ driver, firebaseUser, isLoading, justSignedIn, wasKicked, clearJustSignedIn, clearKicked, signIn, signOut, resetPassword, updateVehicleId, updateDriverId, updateName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
