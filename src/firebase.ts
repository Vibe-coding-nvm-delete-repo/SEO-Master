/**
 * Single Firebase Web SDK app for this SPA.
 * - Firestore: configurable database ID via `VITE_FIRESTORE_DATABASE_ID`.
 *   If omitted, default to this workspace's named DB (`first-db`) so app
 *   data is read from the same database configured in `firebase.json`.
 * - Storage: default bucket from `firebase-applet-config.json` (feedback uploads under `feedback/…`).
 * - Auth: Google + anonymous (for Storage rules on feedback images).
 * - App Check: optional when `VITE_FIREBASE_APPCHECK_SITE_KEY` is set.
 */
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
const DEFAULT_FIRESTORE_DATABASE_ID = 'first-db';
const rawFirestoreDbId = (import.meta.env.VITE_FIRESTORE_DATABASE_ID as string | undefined)?.trim();
const firestoreDbId = rawFirestoreDbId
  ? (rawFirestoreDbId === '(default)' ? null : rawFirestoreDbId)
  : DEFAULT_FIRESTORE_DATABASE_ID;
export const db = firestoreDbId ? getFirestore(app, firestoreDbId) : getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Optional: set VITE_FIREBASE_APPCHECK_SITE_KEY + enable App Check in Firebase Console for extra abuse resistance.
const appCheckKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY as string | undefined;
if (typeof window !== 'undefined' && appCheckKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckKey),
    isTokenAutoRefreshEnabled: true,
  });
}
