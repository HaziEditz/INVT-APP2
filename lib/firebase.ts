import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Auth,
  User,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  signInAnonymously,
} from 'firebase/auth';
import { Database, getDatabase } from 'firebase/database';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: 'AIzaSyDIVSI_GRYG0hCPvc9h80QXZMxwZoejctQ',
  authDomain: 'bookawaka2026-564e1.firebaseapp.com',
  databaseURL: 'https://bookawaka2026-564e1-default-rtdb.firebaseio.com',
  projectId: 'bookawaka2026-564e1',
  storageBucket: 'bookawaka2026-564e1.firebasestorage.app',
  messagingSenderId: '909621127467',
  appId: '1:909621127467:web:504f502a533ca0a216fd6e',
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let database: Database | undefined;
let initError: string | null = null;

function initAuth(instance: FirebaseApp): Auth {
  if (Platform.OS === 'web') {
    return getAuth(instance);
  }

  try {
    return initializeAuth(instance, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already-initialized') || message.includes('already initialized')) {
      console.log('[Firebase] Auth already initialized, reusing instance');
      return getAuth(instance);
    }
    console.warn('[Firebase] initializeAuth failed:', err);
    throw err;
  }
}

function initializeFirebase(): void {
  if (app && auth && database) return;

  const isNewApp = getApps().length === 0;
  const firebaseApp = isNewApp ? initializeApp(firebaseConfig) : getApps()[0];
  app = firebaseApp;
  auth = initAuth(firebaseApp);
  database = getDatabase(firebaseApp);
  initError = null;
  console.log('[Firebase] initialized', {
    platform: Platform.OS,
    auth: !!auth?.app,
    database: !!database?.app,
  });
}

try {
  initializeFirebase();
} catch (err) {
  initError = err instanceof Error ? err.message : String(err);
  console.error('[Firebase] fatal init error:', err);
}

export const isFirebaseReady = !!app && !!auth && !!database;

export function getAuthInstance(): Auth {
  if (!auth) {
    throw new Error(initError ?? 'Firebase Auth is not initialized. Restart the app and try again.');
  }
  return auth;
}

export function getDatabaseInstance(): Database {
  if (!database) {
    throw new Error(initError ?? 'Firebase Database is not initialized.');
  }
  return database;
}

/**
 * RTDB writes require an authenticated Firebase user. Logs UID and falls back to
 * anonymous sign-in only when currentUser is missing.
 *
 * @deprecated Prefer requireDriverAuthForRtdbWrite for end-shift / ownership paths.
 * Anonymous fallback will break under Phase 1+ RTDB rules (anonymous UID cannot own
 * online/{cid}/{vehicleId} or shiftLogs/{cid}/{driverUid}).
 */
export async function ensureAuthUserForRtdbWrite(context: string): Promise<User> {
  const authInstance = getAuthInstance();
  let user = authInstance.currentUser;

  if (user) {
    const provider = user.isAnonymous
      ? 'anonymous'
      : user.providerData[0]?.providerId ?? 'password/email';
    console.log(`[Firebase Auth] ${context} — uid: ${user.uid} (${provider})`);
    return user;
  }

  console.warn(`[Firebase Auth] ${context} — currentUser is null, signing in anonymously`);
  const cred = await signInAnonymously(authInstance);
  user = cred.user;
  console.log(`[Firebase Auth] ${context} — anonymous uid: ${user.uid}`);
  return user;
}

export class DriverAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverAuthRequiredError';
  }
}

/**
 * Require the real driver Auth session for ownership-scoped RTDB writes.
 * Never signs in anonymously — callers must journal and retry after re-login.
 */
export async function requireDriverAuthForRtdbWrite(
  expectedUid: string,
  context: string,
): Promise<User> {
  const authInstance = getAuthInstance();
  const user = authInstance.currentUser;
  const want = String(expectedUid || '').trim();

  if (user && !user.isAnonymous && (!want || user.uid === want)) {
    console.log(`[Firebase Auth] ${context} — uid: ${user.uid} (driver)`);
    return user;
  }

  if (!user) {
    console.warn(
      `[Firebase Auth] ${context} — currentUser is null (no anonymous fallback; journal for retry)`,
    );
  } else if (user.isAnonymous) {
    console.warn(
      `[Firebase Auth] ${context} — refusing anonymous uid=${user.uid} for driver write want=${want || '?'}`,
    );
  } else {
    console.warn(
      `[Firebase Auth] ${context} — uid mismatch have=${user.uid} want=${want || '?'}`,
    );
  }

  throw new DriverAuthRequiredError(
    `Driver auth required for ${context} (need ${want || 'driver uid'}, have ${user?.uid ?? 'null'})`,
  );
}

export { auth, database };
export default app;
