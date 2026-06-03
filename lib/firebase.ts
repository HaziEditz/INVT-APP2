import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, initializeAuth, Auth } from 'firebase/auth';
import { getDatabase, Database } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

let app: FirebaseApp;
let auth: Auth;
let database: Database;

try {
  const isNew = getApps().length === 0;
  app = isNew ? initializeApp(firebaseConfig) : getApps()[0];

  if (!isNew || Platform.OS === 'web') {
    auth = getAuth(app);
  } else {
    try {
      // @ts-expect-error RN persistence export
      const { getReactNativePersistence } = require('firebase/auth');
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch (persistErr) {
      console.warn('[Firebase] RN persistence failed, using default auth:', persistErr);
      auth = getAuth(app);
    }
  }

  database = getDatabase(app);
  console.log('[Firebase] initialized');
} catch (err) {
  console.error('[Firebase] fatal init error:', err);
  const isNew = getApps().length === 0;
  app = isNew ? initializeApp(firebaseConfig) : getApps()[0];
  auth = getAuth(app);
  database = getDatabase(app);
}

export const isFirebaseReady = !!app && !!auth && !!database;
export { auth, database };
export default app;
