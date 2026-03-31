import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({
      collectionRef,
      constraints,
    })),
    runTransaction: vi.fn(),
    setDoc: vi.fn(),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(() => Promise.resolve()),
    })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  };
});

const storageMocks = vi.hoisted(() => ({
  buildProjectDataPayloadFromChunkDocs: vi.fn(),
  loadFromIDB: vi.fn(),
  sanitizeJsonForFirestore: vi.fn((value: unknown) => value),
  saveToIDB: vi.fn(() => Promise.resolve()),
}));

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('./projectStorage', () => storageMocks);

import {
  buildBaseCommitManifest,
  commitRevisionedDocChanges,
  isProjectCanonicalCacheEntry,
  loadBaseCommit,
  loadCanonicalCacheFromIDB,
  loadCanonicalEpoch,
  saveCanonicalCacheToIDB,
  CLIENT_SCHEMA_VERSION,
  type ProjectBaseSnapshot,
} from './projectCollabV2';
import type { ProjectDataPayload } from './projectStorage';

function makeBaseSnapshot(datasetEpoch = 9): ProjectBaseSnapshot {
  return {
    results: [],
    clusterSummary: [],
    tokenSummary: [],
    stats: null,
    datasetStats: null,
    autoGroupSuggestions: [],
    autoMergeRecommendations: [],
    groupMergeRecommendations: [],
    updatedAt: '2026-03-30T00:00:00.000Z',
    datasetEpoch,
  };
}

function makePayload(datasetEpoch = 9): ProjectDataPayload {
  return {
    results: [],
    clusterSummary: [],
    tokenSummary: [],
    groupedClusters: [],
    approvedGroups: [],
    stats: null,
    datasetStats: null,
    blockedTokens: [],
    blockedKeywords: [],
    labelSections: [],
    activityLog: [],
    tokenMergeRules: [],
    autoGroupSuggestions: [],
    autoMergeRecommendations: [],
    groupMergeRecommendations: [],
    updatedAt: '2026-03-30T00:00:00.000Z',
    lastSaveId: datasetEpoch,
  };
}

describe('projectCollabV2 storage contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.store.clear();
  });

  it('rejects a base commit load when chunk counts do not match the manifest', async () => {
    const base = makeBaseSnapshot();
    const manifest = buildBaseCommitManifest('commit_9', base, {
      clientId: 'client-a',
      commitState: 'ready',
      saveId: base.datasetEpoch,
    });

    firestoreMocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => manifest,
    });
    firestoreMocks.getDocs.mockResolvedValueOnce({
      docs: [
        {
          data: () => ({ type: 'results' }),
        },
      ],
    });

    await expect(loadBaseCommit('project-1', 'commit_9')).resolves.toBeNull();
  });

  it('loads a ready base commit and reconstructs the base snapshot', async () => {
    const base = makeBaseSnapshot();
    const manifest = buildBaseCommitManifest('commit_9', base, {
      clientId: 'client-a',
      commitState: 'ready',
      saveId: base.datasetEpoch,
    });

    firestoreMocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => manifest,
    });
    firestoreMocks.getDocs.mockResolvedValueOnce({
      docs: [],
    });
    storageMocks.buildProjectDataPayloadFromChunkDocs.mockReturnValueOnce(makePayload(base.datasetEpoch));

    await expect(loadBaseCommit('project-1', 'commit_9')).resolves.toEqual({
      manifest: expect.objectContaining({
        commitId: 'commit_9',
        commitState: 'ready',
      }),
      base: expect.objectContaining({
        datasetEpoch: base.datasetEpoch,
      }),
    });
  });

  it('rejects a base commit load when chunk ids do not match the manifest exactly', async () => {
    const base = makeBaseSnapshot();
    const manifest = {
      ...buildBaseCommitManifest('commit_9', base, {
        clientId: 'client-a',
        commitState: 'ready',
        saveId: base.datasetEpoch,
      }),
      resultChunkIds: ['results_0'],
      resultChunkCount: 1,
    };

    firestoreMocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => manifest,
    });
    firestoreMocks.getDocs.mockResolvedValueOnce({
      docs: [
        {
          data: () => ({ id: 'results_1', type: 'results' }),
        },
      ],
    });

    await expect(loadBaseCommit('project-1', 'commit_9')).resolves.toBeNull();
  });

  it('ignores non-v2 meta in loadCanonicalEpoch', async () => {
    await expect(
      loadCanonicalEpoch('project-1', {
        schemaVersion: 2,
        migrationState: 'complete',
        datasetEpoch: 9,
        baseCommitId: 'commit_9',
        commitState: 'ready',
        lastMigratedAt: '2026-03-30T00:00:00.000Z',
        migrationOwnerClientId: null,
        migrationStartedAt: null,
        migrationHeartbeatAt: null,
        migrationExpiresAt: null,
        readMode: 'legacy',
        requiredClientSchema: CLIENT_SCHEMA_VERSION,
        revision: 1,
        updatedAt: '2026-03-30T00:00:00.000Z',
        updatedByClientId: 'client-a',
        lastMutationId: null,
      }),
    ).resolves.toBeNull();
  });

  it('returns null instead of falling back to legacy mutable reads when the active V2 commit cannot be loaded', async () => {
    const meta = {
      schemaVersion: 2 as const,
      migrationState: 'complete' as const,
      datasetEpoch: 9,
      baseCommitId: 'commit_9',
      commitState: 'ready' as const,
      lastMigratedAt: '2026-03-30T00:00:00.000Z',
      migrationOwnerClientId: null,
      migrationStartedAt: null,
      migrationHeartbeatAt: null,
      migrationExpiresAt: null,
      readMode: 'v2' as const,
      requiredClientSchema: CLIENT_SCHEMA_VERSION,
      revision: 1,
      updatedAt: '2026-03-30T00:00:00.000Z',
      updatedByClientId: 'client-a',
      lastMutationId: null,
    };

    firestoreMocks.getDoc.mockImplementation(async (ref: { path: string }) => {
      if (ref.path.endsWith('base_commits/commit_9')) {
        return { exists: () => false, data: () => undefined };
      }
      if (ref.path.endsWith('collab/meta')) {
        return { exists: () => true, data: () => meta };
      }
      return { exists: () => false, data: () => undefined };
    });
    firestoreMocks.getDocs.mockResolvedValue({
      docs: [],
      empty: true,
    });

    await expect(loadCanonicalEpoch('project-1', meta)).resolves.toBeNull();
  });

  it('returns ack data from compare-and-set revisioned writes', async () => {
    const change = {
      kind: 'upsert' as const,
      id: 'group-1',
      expectedRevision: 2,
      datasetEpoch: 9,
      mutationId: 'm-1',
      value: {
        groupName: 'Alpha Group',
        status: 'grouped' as const,
        datasetEpoch: 9,
        clusterTokens: ['alpha'],
        revision: 2,
        updatedAt: '2026-03-30T00:00:00.000Z',
        updatedByClientId: 'client-a',
        lastMutationId: null,
      },
    };

    firestoreMocks.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: any) => Promise<void>) => {
      const tx = {
        get: vi.fn(async (ref: { path: string }) => {
          const data = firestoreMocks.store.get(ref.path);
          return {
            exists: () => data != null,
            data: () => data,
          };
        }),
        set: vi.fn((ref: { path: string }, data: unknown) => {
          firestoreMocks.store.set(ref.path, data);
        }),
        delete: vi.fn((ref: { path: string }) => {
          firestoreMocks.store.delete(ref.path);
        }),
      };

      firestoreMocks.store.set('projects/project-1/groups/9::group-1', { revision: 2 });
      await callback(tx);
    });

    await expect(commitRevisionedDocChanges('project-1', 'groups', [change], 'client-a')).resolves.toEqual([
      expect.objectContaining({
        kind: 'upsert',
        id: 'group-1',
        revision: 3,
        lastMutationId: 'm-1',
        value: expect.objectContaining({
          id: 'group-1',
          datasetEpoch: 9,
          revision: 3,
          updatedByClientId: 'client-a',
          lastMutationId: 'm-1',
        }),
      }),
    ]);
  });

  it('tags canonical IDB cache entries with schema, epoch, and commit identity', async () => {
    const payload = makePayload(9);
    const meta = {
      datasetEpoch: 9,
      baseCommitId: 'commit_9',
    };

    await saveCanonicalCacheToIDB('project-1', payload, meta);
    expect(storageMocks.saveToIDB).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        schemaVersion: CLIENT_SCHEMA_VERSION,
        datasetEpoch: 9,
        baseCommitId: 'commit_9',
        cachedAt: expect.any(String),
        payload,
      }),
    );

    storageMocks.loadFromIDB.mockResolvedValueOnce({
      schemaVersion: CLIENT_SCHEMA_VERSION,
      datasetEpoch: 9,
      baseCommitId: 'commit_9',
      cachedAt: '2026-03-30T00:00:00.000Z',
      payload,
    });

    await expect(loadCanonicalCacheFromIDB('project-1')).resolves.toEqual(
      expect.objectContaining({
        schemaVersion: CLIENT_SCHEMA_VERSION,
        datasetEpoch: 9,
        baseCommitId: 'commit_9',
        payload,
      }),
    );
    const cachedEntry = storageMocks.saveToIDB.mock.calls[0] as unknown as [string, unknown] | undefined;
    expect(isProjectCanonicalCacheEntry(cachedEntry?.[1])).toBe(true);
  });
});
