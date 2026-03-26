/**
 * Single Firebase Web SDK app for this SPA.
 * - Firestore: hard-locked to workspace DB (`first-db`).
 *   `VITE_FIRESTORE_DATABASE_ID` is accepted only for diagnostics; any value
 *   other than `first-db` is ignored and logged.
 * - Storage: default bucket from `firebase-applet-config.json` (feedback uploads under `feedback/…`).
 * - Auth: Google + anonymous (for Storage rules on feedback images).
 * - App Check: optional when `VITE_FIREBASE_APPCHECK_SITE_KEY` is set.
 */
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { resolveFirestoreDatabaseId, WORKSPACE_FIRESTORE_DATABASE_ID } from './firestoreDbConfig';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
const rawFirestoreDbId = (import.meta.env.VITE_FIRESTORE_DATABASE_ID as string | undefined)?.trim();
const firestoreDbId = resolveFirestoreDatabaseId(rawFirestoreDbId);

if (rawFirestoreDbId && rawFirestoreDbId !== WORKSPACE_FIRESTORE_DATABASE_ID) {
  console.error(
    `[FIREBASE] Ignoring invalid VITE_FIRESTORE_DATABASE_ID="${rawFirestoreDbId}". ` +
    `This app is locked to "${WORKSPACE_FIRESTORE_DATABASE_ID}".`
  );
}

export const db = getFirestore(app, firestoreDbId);
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
