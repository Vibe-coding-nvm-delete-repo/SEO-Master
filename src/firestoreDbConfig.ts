export const WORKSPACE_FIRESTORE_DATABASE_ID = 'first-db';

/**
 * Hard lock Firestore to workspace database.
 * Any env mismatch is ignored so runtime target cannot drift.
 */
export function resolveFirestoreDatabaseId(rawValue: string | null | undefined): string {
  const trimmed = (rawValue ?? '').trim();
  if (!trimmed || trimmed === WORKSPACE_FIRESTORE_DATABASE_ID) {
    return WORKSPACE_FIRESTORE_DATABASE_ID;
  }
  return WORKSPACE_FIRESTORE_DATABASE_ID;
}
