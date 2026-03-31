import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isMigrationLeaseExpired,
  isOperationLockExpired,
  diagnoseV2State,
  executeRecoveryAction,
} from './collabV2Recovery';
import type {
  ProjectCollabMetaDoc,
  ProjectOperationLockDoc,
  ProjectBaseCommitManifestDoc,
} from './collabV2Types';

// ─── Helpers ───

function makeMeta(overrides: Partial<ProjectCollabMetaDoc> = {}): ProjectCollabMetaDoc {
  return {
    schemaVersion: 2,
    revision: 1,
    datasetEpoch: 1,
    baseCommitId: null,
    commitState: 'ready',
    readMode: 'v2',
    migrationState: 'complete',
    migrationOwnerClientId: null,
    migrationExpiresAt: null,
    updatedAt: new Date().toISOString(),
    updatedByClientId: 'client-a',
    ...overrides,
  };
}

function makeManifest(overrides: Partial<ProjectBaseCommitManifestDoc> = {}): ProjectBaseCommitManifestDoc {
  return {
    id: 'manifest',
    commitId: 'commit-1',
    datasetEpoch: 1,
    commitState: 'ready',
    resultChunkCount: 1,
    clusterChunkCount: 1,
    suggestionChunkCount: 0,
    autoMergeChunkCount: 0,
    groupMergeChunkCount: 0,
    contentHash: 'abc123',
    createdAt: new Date().toISOString(),
    createdByClientId: 'client-a',
    ...overrides,
  };
}

function makeLock(overrides: Partial<ProjectOperationLockDoc> = {}): ProjectOperationLockDoc {
  return {
    type: 'csv-import',
    ownerId: 'client-b',
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'running',
    ...overrides,
  };
}

function makeStorage() {
  const recoveredMeta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-1' });
  return {
    loadCollabMeta: vi.fn().mockResolvedValue(makeMeta({ datasetEpoch: 1 })),
    flipProjectMetaToCommit: vi.fn().mockResolvedValue(recoveredMeta),
    clearMigrationLease: vi.fn().mockResolvedValue(recoveredMeta),
    clearOperationLock: vi.fn().mockResolvedValue(undefined),
  };
}

const CLIENT_ID = 'client-a';

// ─── isMigrationLeaseExpired ───

describe('isMigrationLeaseExpired', () => {
  it('returns true when migrationExpiresAt is null', () => {
    const meta = makeMeta({ migrationExpiresAt: null });
    expect(isMigrationLeaseExpired(meta)).toBe(true);
  });

  it('returns true when migrationExpiresAt is in the past', () => {
    const meta = makeMeta({ migrationExpiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(isMigrationLeaseExpired(meta)).toBe(true);
  });

  it('returns false when migrationExpiresAt is in the future', () => {
    const meta = makeMeta({ migrationExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(isMigrationLeaseExpired(meta)).toBe(false);
  });
});

// ─── isOperationLockExpired ───

describe('isOperationLockExpired', () => {
  it('returns true when lock is expired', () => {
    const lock = makeLock({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(isOperationLockExpired(lock)).toBe(true);
  });

  it('returns false when lock is active', () => {
    const lock = makeLock({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(isOperationLockExpired(lock)).toBe(false);
  });
});

// ─── diagnoseV2State ───

describe('diagnoseV2State', () => {
  // 1. Healthy state
  it('returns healthy for a consistent ready state', () => {
    const meta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const result = diagnoseV2State(meta, manifest, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('healthy');
    expect(result.action.type).toBe('none');
    expect(result.writesBlocked).toBe(false);
  });

  it('returns healthy for idle state with no commit', () => {
    const meta = makeMeta({ commitState: 'idle', baseCommitId: null });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('healthy');
    expect(result.writesBlocked).toBe(false);
  });

  // 2. Stuck writing with ready commit → finalize
  it('diagnoses stuck-writing with ready manifest as finalizable', () => {
    const meta = makeMeta({ commitState: 'writing', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const result = diagnoseV2State(meta, manifest, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('stuck-writing');
    if (result.diagnostic.kind === 'stuck-writing') {
      expect(result.diagnostic.canFinalize).toBe(true);
      expect(result.diagnostic.commitId).toBe('commit-1');
    }
    expect(result.action.type).toBe('finalize-commit');
    if (result.action.type === 'finalize-commit') {
      expect(result.action.commitId).toBe('commit-1');
    }
    expect(result.writesBlocked).toBe(false);
  });

  // 3. Stuck writing with incomplete commit → rollback
  it('diagnoses stuck-writing with incomplete manifest as needing rollback', () => {
    const meta = makeMeta({ commitState: 'writing', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'writing' });
    const result = diagnoseV2State(meta, manifest, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('stuck-writing');
    if (result.diagnostic.kind === 'stuck-writing') {
      expect(result.diagnostic.canFinalize).toBe(false);
    }
    expect(result.action.type).toBe('rollback-to-last-ready');
    expect(result.writesBlocked).toBe(true);
  });

  it('diagnoses stuck-writing with no commitId as needing rollback', () => {
    const meta = makeMeta({ commitState: 'writing', baseCommitId: null });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('stuck-writing');
    expect(result.action.type).toBe('rollback-to-last-ready');
    expect(result.writesBlocked).toBe(true);
  });

  it('diagnoses stuck-writing with missing manifest as needing rollback', () => {
    const meta = makeMeta({ commitState: 'writing', baseCommitId: 'commit-1' });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('missing-commit');
    expect(result.action.type).toBe('rollback-to-last-ready');
    expect(result.writesBlocked).toBe(true);
  });

  // 4. Stale migration lease (own)
  it('diagnoses stale own migration lease', () => {
    const meta = makeMeta({
      migrationState: 'running',
      migrationOwnerClientId: CLIENT_ID,
      migrationExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('stale-migration');
    if (result.diagnostic.kind === 'stale-migration') {
      expect(result.diagnostic.ownerClientId).toBe(CLIENT_ID);
    }
    expect(result.action.type).toBe('clear-migration-lease');
    expect(result.writesBlocked).toBe(true);
  });

  // 4b. Stale migration lease (foreign)
  it('diagnoses stale foreign migration lease', () => {
    const meta = makeMeta({
      migrationState: 'running',
      migrationOwnerClientId: 'client-dead',
      migrationExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('stale-migration');
    if (result.diagnostic.kind === 'stale-migration') {
      expect(result.diagnostic.ownerClientId).toBe('client-dead');
    }
    expect(result.action.type).toBe('clear-migration-lease');
    expect(result.writesBlocked).toBe(true);
  });

  // 5. Active foreign migration (not stuck)
  it('returns healthy with writes blocked for active foreign migration', () => {
    const meta = makeMeta({
      migrationState: 'running',
      migrationOwnerClientId: 'client-other',
      migrationExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('healthy');
    expect(result.diagnostic.detail).toContain('client-other');
    expect(result.action.type).toBe('none');
    expect(result.writesBlocked).toBe(true);
  });

  it('returns healthy with writes allowed for own active migration', () => {
    const meta = makeMeta({
      migrationState: 'running',
      migrationOwnerClientId: CLIENT_ID,
      migrationExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('healthy');
    expect(result.writesBlocked).toBe(false);
  });

  // 6. Failed migration → unrecoverable
  it('diagnoses failed migration as unrecoverable', () => {
    const meta = makeMeta({ migrationState: 'failed' });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('unrecoverable');
    expect(result.action.type).toBe('enter-read-only');
    if (result.action.type === 'enter-read-only') {
      expect(result.action.reason).toBe('Migration failed');
    }
    expect(result.writesBlocked).toBe(true);
  });

  // 7. Missing base commit
  it('diagnoses missing base commit when meta is ready but manifest missing', () => {
    const meta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-gone' });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('missing-commit');
    if (result.diagnostic.kind === 'missing-commit') {
      expect(result.diagnostic.commitId).toBe('commit-gone');
    }
    expect(result.action.type).toBe('enter-read-only');
    expect(result.writesBlocked).toBe(true);
  });

  it('diagnoses missing base commit when manifest is not ready', () => {
    const meta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'writing' });
    const result = diagnoseV2State(meta, manifest, null, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('missing-commit');
    expect(result.action.type).toBe('enter-read-only');
    expect(result.writesBlocked).toBe(true);
  });

  // 8. Stale operation lock
  it('diagnoses stale operation lock', () => {
    const meta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const lock = makeLock({
      ownerId: 'client-dead',
      expiresAt: new Date(Date.now() - 30_000).toISOString(),
    });
    const result = diagnoseV2State(meta, manifest, lock, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('stale-lock');
    if (result.diagnostic.kind === 'stale-lock') {
      expect(result.diagnostic.lock).toBe(lock);
    }
    expect(result.action.type).toBe('clear-stale-lock');
    expect(result.writesBlocked).toBe(false);
  });

  it('returns healthy for active foreign lock', () => {
    const meta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const lock = makeLock({
      ownerId: 'client-other',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = diagnoseV2State(meta, manifest, lock, CLIENT_ID);

    expect(result.diagnostic.kind).toBe('healthy');
    expect(result.diagnostic.detail).toContain('client-other');
    expect(result.writesBlocked).toBe(false);
  });
});

// ─── executeRecoveryAction ───

describe('executeRecoveryAction', () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns result unchanged for action type "none"', async () => {
    const result = diagnoseV2State(makeMeta(), null, null, CLIENT_ID);
    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(executed).toBe(result);
    expect(storage.loadCollabMeta).not.toHaveBeenCalled();
  });

  it('finalizes commit when action is finalize-commit', async () => {
    const meta = makeMeta({ commitState: 'writing', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const result = diagnoseV2State(meta, manifest, null, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(storage.loadCollabMeta).toHaveBeenCalledWith('proj-1');
    expect(storage.flipProjectMetaToCommit).toHaveBeenCalledWith('proj-1', 'commit-1', 1, CLIENT_ID);
    expect(executed.recoveredMeta).not.toBeNull();
    expect(executed.writesBlocked).toBe(false);
  });

  it('blocks writes when finalize-commit fails', async () => {
    storage.flipProjectMetaToCommit.mockRejectedValue(new Error('Firestore write failed'));

    const meta = makeMeta({ commitState: 'writing', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const result = diagnoseV2State(meta, manifest, null, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(executed.writesBlocked).toBe(true);
    expect(executed.action.type).toBe('enter-read-only');
  });

  it('blocks writes when loadCollabMeta returns null during finalize', async () => {
    storage.loadCollabMeta.mockResolvedValue(null);

    const meta = makeMeta({ commitState: 'writing', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const result = diagnoseV2State(meta, manifest, null, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(executed.writesBlocked).toBe(true);
    expect(storage.flipProjectMetaToCommit).not.toHaveBeenCalled();
  });

  it('clears migration lease', async () => {
    const meta = makeMeta({
      migrationState: 'running',
      migrationOwnerClientId: 'client-dead',
      migrationExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(storage.clearMigrationLease).toHaveBeenCalledWith('proj-1', CLIENT_ID);
    expect(executed.recoveredMeta).not.toBeNull();
    expect(executed.writesBlocked).toBe(false);
  });

  it('blocks writes when clearMigrationLease fails', async () => {
    storage.clearMigrationLease.mockRejectedValue(new Error('Firestore error'));

    const meta = makeMeta({
      migrationState: 'running',
      migrationOwnerClientId: 'client-dead',
      migrationExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(executed.writesBlocked).toBe(true);
  });

  it('clears stale operation lock', async () => {
    const meta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const lock = makeLock({
      ownerId: 'client-dead',
      expiresAt: new Date(Date.now() - 30_000).toISOString(),
    });
    const result = diagnoseV2State(meta, manifest, lock, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(storage.clearOperationLock).toHaveBeenCalledWith('proj-1');
    expect(executed.writesBlocked).toBe(false);
  });

  it('tolerates clearOperationLock failure gracefully', async () => {
    storage.clearOperationLock.mockRejectedValue(new Error('Firestore error'));

    const meta = makeMeta({ commitState: 'ready', baseCommitId: 'commit-1' });
    const manifest = makeManifest({ commitId: 'commit-1', commitState: 'ready' });
    const lock = makeLock({
      ownerId: 'client-dead',
      expiresAt: new Date(Date.now() - 30_000).toISOString(),
    });
    const result = diagnoseV2State(meta, manifest, lock, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    // Non-critical failure — returns original result
    expect(executed.writesBlocked).toBe(false);
  });

  it('converts rollback-to-last-ready into enter-read-only', async () => {
    const meta = makeMeta({ commitState: 'writing', baseCommitId: null });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(executed.action.type).toBe('enter-read-only');
    expect(executed.writesBlocked).toBe(true);
  });

  it('passes through enter-read-only unchanged', async () => {
    const meta = makeMeta({ migrationState: 'failed' });
    const result = diagnoseV2State(meta, null, null, CLIENT_ID);

    const executed = await executeRecoveryAction('proj-1', result, CLIENT_ID, storage);

    expect(executed).toBe(result);
    expect(executed.action.type).toBe('enter-read-only');
    expect(executed.writesBlocked).toBe(true);
  });
});
