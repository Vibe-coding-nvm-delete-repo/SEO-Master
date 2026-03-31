import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const batchSetCalls: Array<{ ref: { path: string }; data: unknown }> = [];
  const batchDeleteCalls: Array<{ ref: { path: string } }> = [];
  return {
    store,
    batchSetCalls,
    batchDeleteCalls,
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
    writeBatch: vi.fn(() => {
      const batch = {
        set: vi.fn((ref: { path: string }, data: unknown) => {
          batchSetCalls.push({ ref, data });
        }),
        delete: vi.fn((ref: { path: string }) => {
          batchDeleteCalls.push({ ref });
        }),
        commit: vi.fn(() => Promise.resolve()),
      };
      return batch;
    }),
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
  saveBaseCommitToFirestore,
  isProjectCanonicalCacheEntry,
  loadBaseCommit,
  loadCollabEntitiesFromFirestore,
  loadCanonicalCacheFromIDB,
  loadCanonicalEpoch,
  loadCanonicalProjectState,
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
    firestoreMocks.batchSetCalls.length = 0;
    firestoreMocks.batchDeleteCalls.length = 0;
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

    firestoreMocks.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
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
      return callback(tx);
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

  it('returns one ack per change even if transaction callback is retried', async () => {
    const change = {
      kind: 'upsert' as const,
      id: 'group-1',
      expectedRevision: 2,
      datasetEpoch: 9,
      mutationId: 'm-retry',
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

    let callbackAttempts = 0;
    firestoreMocks.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
      const makeTx = () => ({
        get: vi.fn(async () => ({
          exists: () => true,
          data: () => ({ revision: 2 }),
        })),
        set: vi.fn(),
        delete: vi.fn(),
      });
      callbackAttempts += 1;
      await callback(makeTx());
      callbackAttempts += 1;
      return callback(makeTx());
    });

    const acknowledgements = await commitRevisionedDocChanges('project-1', 'groups', [change], 'client-a');
    expect(callbackAttempts).toBe(2);
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]).toMatchObject({
      kind: 'upsert',
      id: 'group-1',
      revision: 3,
      lastMutationId: 'm-retry',
    });
  });

  it('keeps strict V2 mode when canonical commit is unavailable and never calls legacy loader', async () => {
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
      revision: 9,
      updatedAt: '2026-03-30T00:00:00.000Z',
      updatedByClientId: 'client-a',
      lastMutationId: null,
    };

    firestoreMocks.getDoc.mockImplementation(async (ref: { path: string }) => {
      if (ref.path.endsWith('collab/meta')) {
        return { exists: () => true, data: () => meta };
      }
      if (ref.path.endsWith('base_commits/commit_9')) {
        return { exists: () => false, data: () => undefined };
      }
      return { exists: () => false, data: () => undefined };
    });
    firestoreMocks.getDocs.mockResolvedValue({ docs: [], empty: true });
    firestoreMocks.runTransaction.mockRejectedValueOnce(new Error('recovery-unavailable'));

    const legacyLoader = vi.fn(async () => makePayload(9));
    const canonical = await loadCanonicalProjectState('project-1', 'client-a', legacyLoader);

    expect(legacyLoader).not.toHaveBeenCalled();
    expect(canonical.mode).toBe('v2');
    expect(canonical.resolved).toBeNull();
    expect(canonical.entities.meta?.readMode).toBe('v2');
  });

  it('writes datasetEpoch on every base-commit chunk document', async () => {
    firestoreMocks.getDocs.mockResolvedValue({ docs: [], empty: true });

    const base = makeBaseSnapshot(9);
    base.results = [{ tokens: 'alpha', keywordLower: 'alpha' } as any];
    base.clusterSummary = [{ tokens: 'alpha', keywords: [] } as any];
    base.autoGroupSuggestions = [{ id: 'sg_1', groupName: 'Alpha', confidence: 0.9, matchedPageNames: ['alpha'] } as any];

    await saveBaseCommitToFirestore('project-1', base, {
      commitId: 'commit_9',
      saveId: 9,
      clientId: 'client-a',
    });

    const chunkWrites = firestoreMocks.batchSetCalls.filter(({ ref }) => ref.path.startsWith('chunks/'));

    expect(chunkWrites).toHaveLength(3);
    expect(chunkWrites.map(({ ref }) => ref.path)).toEqual([
      'chunks/results_0',
      'chunks/clusters_0',
      'chunks/suggestions_0',
    ]);

    for (const { data } of chunkWrites) {
      expect((data as { datasetEpoch?: unknown }).datasetEpoch).toBe(9);
    }
  });

  it('normalizes legacy V2 group docs with embedded clusters into clusterTokens on read', async () => {
    firestoreMocks.getDoc.mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    });
    firestoreMocks.getDocs.mockImplementation(async (source: { path?: string; collectionRef?: { path?: string } }) => {
      const path = source?.path ?? source?.collectionRef?.path ?? '';
      if (path.endsWith('/groups')) {
        return {
          empty: false,
          docs: [
            {
              id: '1::group-legacy',
              data: () => ({
                id: 'group-legacy',
                groupName: 'Legacy Group',
                status: 'grouped',
                datasetEpoch: 1,
                clusters: [
                  {
                    pageName: 'Alpha',
                    pageNameLower: 'alpha',
                    pageNameLen: 5,
                    tokens: 'alpha',
                    tokenArr: ['alpha'],
                    keywordCount: 1,
                    totalVolume: 100,
                    avgKd: 10,
                    avgKwRating: 1,
                    label: '',
                    labelArr: [],
                    locationCity: '',
                    locationState: '',
                    keywords: [
                      {
                        keyword: 'alpha keyword',
                        volume: 100,
                        kd: 10,
                        locationCity: '',
                        locationState: '',
                        kwRating: 1 as const,
                      },
                    ],
                  },
                ],
                revision: 1,
                updatedAt: '2026-03-30T00:00:00.000Z',
                updatedByClientId: 'client-a',
                lastMutationId: null,
              }),
            },
          ],
        };
      }
      return { empty: true, docs: [] };
    });

    const entities = await loadCollabEntitiesFromFirestore('project-1', 1);
    expect(entities.groups).toHaveLength(1);
    expect(entities.groups[0].clusterTokens).toEqual(['alpha']);
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
