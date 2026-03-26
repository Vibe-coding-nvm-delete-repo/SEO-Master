import { describe, expect, it } from 'vitest';
import { resolveFirestoreDatabaseId, WORKSPACE_FIRESTORE_DATABASE_ID } from './firestoreDbConfig';

describe('resolveFirestoreDatabaseId', () => {
  it('uses workspace named database when env is missing', () => {
    expect(resolveFirestoreDatabaseId(undefined)).toBe(WORKSPACE_FIRESTORE_DATABASE_ID);
    expect(resolveFirestoreDatabaseId(null)).toBe(WORKSPACE_FIRESTORE_DATABASE_ID);
    expect(resolveFirestoreDatabaseId('')).toBe(WORKSPACE_FIRESTORE_DATABASE_ID);
    expect(resolveFirestoreDatabaseId('   ')).toBe(WORKSPACE_FIRESTORE_DATABASE_ID);
  });

  it('keeps workspace db when env matches', () => {
    expect(resolveFirestoreDatabaseId('first-db')).toBe('first-db');
    expect(resolveFirestoreDatabaseId('  first-db  ')).toBe('first-db');
  });

  it('ignores invalid env values and still returns workspace db', () => {
    expect(resolveFirestoreDatabaseId('(default)')).toBe('first-db');
    expect(resolveFirestoreDatabaseId('analytics-db')).toBe('first-db');
  });
});
