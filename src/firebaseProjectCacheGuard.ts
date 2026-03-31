const FIREBASE_PROJECT_CACHE_KEY = 'kwg_firebase_project';

export function ensureFirebaseProjectCacheGuard(currentProjectId: string, databaseName = 'kwg_database') {
  const stored = localStorage.getItem(FIREBASE_PROJECT_CACHE_KEY);
  if (stored && stored !== currentProjectId) {
    console.log(
      '[MIGRATION] Firebase project changed from',
      stored,
      'to',
      currentProjectId,
      'clearing caches',
    );
    localStorage.clear();
    indexedDB.deleteDatabase(databaseName);
  }
  localStorage.setItem(FIREBASE_PROJECT_CACHE_KEY, currentProjectId);
}
