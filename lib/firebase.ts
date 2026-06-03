import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
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

  const isNew = getApps().length === 1;
  if (!isNew) {
    try {
      return getAuth(instance);
    } catch (err) {
      console.warn('[Firebase] getAuth on existing app:', err);
    }
  }

  try {
    if (typeof getReactNativePersistence === 'function') {
      return initializeAuth(instance, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    }
    console.warn('[Firebase] getReactNativePersistence missing — using getAuth');
    return getAuth(instance);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already-initialized') || message.includes('already initialized')) {
      console.log('[Firebase] Auth already initialized, reusing instance');
      return getAuth(instance);
    }
    console.warn('[Firebase] initializeAuth failed, using getAuth:', err);
    return getAuth(instance);
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

export { auth, database };
export default app;
