import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
// getReactNativePersistence is exported by the React Native Firebase bundle at runtime
// but not included in the web TypeScript definitions — suppress the type error.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { getReactNativePersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
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

const isNew = getApps().length === 0;
const app = isNew ? initializeApp(firebaseConfig) : getApps()[0];

function buildAuth() {
  if (!isNew || Platform.OS === 'web') {
    // App already existed or running on web — use getAuth (no re-init)
    return getAuth(app);
  }
  try {
    // Fresh React Native startup — init with AsyncStorage persistence
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactNativeAsyncStorage = require('@react-native-async-storage/async-storage').default;
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch (e) {
    console.warn('[Firebase] Could not set AsyncStorage persistence:', e);
    return getAuth(app);
  }
}

export const auth = buildAuth();
export const database = getDatabase(app);
export default app;
