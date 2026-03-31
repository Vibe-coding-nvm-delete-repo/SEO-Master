import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterSummary, GroupedCluster, Project, ProjectCollabMetaDoc, ProjectOperationLockDoc } from './types';

const firestoreMocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(snap: any) => void>>();
  const pathFor = (target: any) => target?.path ?? target?.collectionRef?.path ?? 'unknown';
  return {
    listeners,
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    onSnapshot: vi.fn((target: any, onNext: (snap: any) => void) => {
      const path = pathFor(target);
      const existing = listeners.get(path) ?? [];
      existing.push(onNext);
      listeners.set(path, existing);
      return () => {
        const current = listeners.get(path) ?? [];
        listeners.set(path, current.filter((callback) => callback !== onNext));
      };
    }),
    query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({ collectionRef, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    emit(path: string, snap: any) {
      for (const listener of listeners.get(path) ?? []) {
        listener(snap);
      }
    },
  };
});

const storageMocks = vi.hoisted(() => ({
  saveProjectDataToFirestore: vi.fn(() => Promise.resolve()),
  saveToIDB: vi.fn(() => Promise.resolve()),
  saveProjectToFirestore: vi.fn(() => Promise.resolve()),
  buildProjectDataPayloadFromChunkDocs: vi.fn(() => null),
  countGroupedPages: vi.fn(() => 0),
  groupedPageMass: vi.fn(() => 0),
}));

const workspaceMocks = vi.hoisted(() => ({
  loadProjectDataForView: vi.fn(async () => null),
  loadProjectDataFromIDBOnly: vi.fn(async () => null),
  reconcileWithFirestore: vi.fn(async () => ({ action: 'noop' })),
  toProjectViewState: vi.fn((payload: any) => ({
    results: payload?.results ?? null,
    clusterSummary: payload?.clusterSummary ?? null,
    tokenSummary: payload?.tokenSummary ?? null,
    groupedClusters: payload?.groupedClusters ?? [],
    approvedGroups: payload?.approvedGroups ?? [],
    activityLog: payload?.activityLog ?? [],
    tokenMergeRules: payload?.tokenMergeRules ?? [],
    autoGroupSuggestions: payload?.autoGroupSuggestions ?? [],
    autoMergeRecommendations: payload?.autoMergeRecommendations ?? [],
    groupMergeRecommendations: payload?.groupMergeRecommendations ?? [],
    stats: payload?.stats ?? null,
    datasetStats: payload?.datasetStats ?? null,
    blockedTokens: payload?.blockedTokens ?? [],
    blockedKeywords: payload?.blockedKeywords ?? [],
    labelSections: payload?.labelSections ?? [],
    fileName: payload?.fileName ?? null,
  })),
  createEmptyProjectViewState: vi.fn(() => ({
    results: null,
    clusterSummary: null,
    tokenSummary: null,
    groupedClusters: [],
    approvedGroups: [],
    activityLog: [],
    tokenMergeRules: [],
    autoGroupSuggestions: [],
    autoMergeRecommendations: [],
    groupMergeRecommendations: [],
    stats: null,
    datasetStats: null,
    blockedTokens: [],
    blockedKeywords: [],
    labelSections: [],
    fileName: null,
  })),
}));

const collabMocks = vi.hoisted(() => ({
  loadCanonicalProjectState: vi.fn(),
  loadCanonicalEpoch: vi.fn(),
  loadCanonicalCacheFromIDB: vi.fn(async () => null),
  saveCanonicalCacheToIDB: vi.fn(() => Promise.resolve()),
  commitRevisionedDocChanges: vi.fn(),
  acquireProjectOperationLock: vi.fn(),
  releaseProjectOperationLock: vi.fn(() => Promise.resolve()),
  heartbeatProjectOperationLock: vi.fn(),
}));

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: firestoreMocks.collection,
  doc: firestoreMocks.doc,
  onSnapshot: firestoreMocks.onSnapshot,
  query: firestoreMocks.query,
  where: firestoreMocks.where,
}));
vi.mock('./projectStorage', () => ({
  saveProjectDataToFirestore: storageMocks.saveProjectDataToFirestore,
  saveToIDB: storageMocks.saveToIDB,
  saveProjectToFirestore: storageMocks.saveProjectToFirestore,
  buildProjectDataPayloadFromChunkDocs: storageMocks.buildProjectDataPayloadFromChunkDocs,
  countGroupedPages: storageMocks.countGroupedPages,
  groupedPageMass: storageMocks.groupedPageMass,
}));
vi.mock('./projectWorkspace', () => ({
  loadProjectDataForView: workspaceMocks.loadProjectDataForView,
  loadProjectDataFromIDBOnly: workspaceMocks.loadProjectDataFromIDBOnly,
  reconcileWithFirestore: workspaceMocks.reconcileWithFirestore,
  toProjectViewState: workspaceMocks.toProjectViewState,
  createEmptyProjectViewState: workspaceMocks.createEmptyProjectViewState,
}));
vi.mock('./projectCollabV2', async () => {
  const actual = await vi.importActual<typeof import('./projectCollabV2')>('./projectCollabV2');
  return {
    ...actual,
    loadCanonicalProjectState: collabMocks.loadCanonicalProjectState,
    loadCanonicalEpoch: collabMocks.loadCanonicalEpoch,
    loadCanonicalCacheFromIDB: collabMocks.loadCanonicalCacheFromIDB,
    saveCanonicalCacheToIDB: collabMocks.saveCanonicalCacheToIDB,
    commitRevisionedDocChanges: collabMocks.commitRevisionedDocChanges,
    acquireProjectOperationLock: collabMocks.acquireProjectOperationLock,
    releaseProjectOperationLock: collabMocks.releaseProjectOperationLock,
    heartbeatProjectOperationLock: collabMocks.heartbeatProjectOperationLock,
  };
});

import { blockedTokenDocId, CLIENT_SCHEMA_VERSION } from './projectCollabV2';
import { useProjectPersistence } from './useProjectPersistence';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeMeta(epoch: number, revision = epoch): ProjectCollabMetaDoc {
  return {
    schemaVersion: 2,
    migrationState: 'complete',
    datasetEpoch: epoch,
    baseCommitId: `commit_${epoch}`,
    commitState: 'ready',
    lastMigratedAt: '2026-03-30T00:00:00.000Z',
    migrationOwnerClientId: null,
    migrationStartedAt: null,
    migrationHeartbeatAt: null,
    migrationExpiresAt: null,
    readMode: 'v2',
    requiredClientSchema: CLIENT_SCHEMA_VERSION,
    revision,
    updatedAt: '2026-03-30T00:00:00.000Z',
    updatedByClientId: 'client-a',
    lastMutationId: null,
  };
}

function makeCanonical(epoch: number, blockedTokens: string[] = []) {
  const meta = makeMeta(epoch);
  return {
    mode: 'v2' as const,
    base: {
      results: [],
      clusterSummary: [],
      tokenSummary: [],
      stats: null,
      datasetStats: null,
      autoGroupSuggestions: [],
      autoMergeRecommendations: [],
      groupMergeRecommendations: [],
      updatedAt: '2026-03-30T00:00:00.000Z',
      datasetEpoch: epoch,
    },
    entities: {
      meta,
      groups: [],
      blockedTokens: blockedTokens.map((token) => ({
        id: blockedTokenDocId(token),
        token,
        datasetEpoch: epoch,
        revision: 1,
        updatedAt: '2026-03-30T00:00:00.000Z',
        updatedByClientId: 'client-a',
        lastMutationId: null,
      })),
      manualBlockedKeywords: [],
      tokenMergeRules: [],
      labelSections: [],
      activityLog: [],
      activeOperation: null,
    },
    resolved: {
      results: [],
      clusterSummary: [],
      tokenSummary: [],
      groupedClusters: [],
      approvedGroups: [],
      stats: null,
      datasetStats: null,
      blockedTokens,
      blockedKeywords: [],
      labelSections: [],
      activityLog: [],
      tokenMergeRules: [],
      autoGroupSuggestions: [],
      autoMergeRecommendations: [],
      groupMergeRecommendations: [],
      updatedAt: '2026-03-30T00:00:00.000Z',
      lastSaveId: epoch,
    },
  };
}

function makeLegacyState(blockedTokens: string[] = []) {
  return {
    ...makeCanonical(1, blockedTokens),
    mode: 'legacy' as const,
  };
}

function emitDocSnapshot(path: string, data: any, hasPendingWrites = false) {
  firestoreMocks.emit(path, {
    exists: () => data != null,
    data: () => data,
    metadata: { hasPendingWrites },
  });
}

function emitQuerySnapshot(path: string, changes: any[], hasPendingWrites = false) {
  firestoreMocks.emit(path, {
    metadata: { hasPendingWrites },
    docChanges: () => changes,
  });
}

const PROJECTS: Project[] = [
  { id: 'project-1', name: 'Project 1', description: '', uid: 'user-1', createdAt: '2026-03-30T00:00:00.000Z' },
  { id: 'project-2', name: 'Project 2', description: '', uid: 'user-1', createdAt: '2026-03-30T00:00:00.000Z' },
];

describe('useProjectPersistence V2 hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.listeners.clear();
    collabMocks.loadCanonicalProjectState.mockReset();
    collabMocks.loadCanonicalEpoch.mockReset();
    collabMocks.loadCanonicalCacheFromIDB.mockResolvedValue(null);
    collabMocks.saveCanonicalCacheToIDB.mockResolvedValue(undefined);
    collabMocks.commitRevisionedDocChanges.mockReset();
    collabMocks.acquireProjectOperationLock.mockReset();
    collabMocks.releaseProjectOperationLock.mockResolvedValue(undefined);
    collabMocks.heartbeatProjectOperationLock.mockReset();
  });

  it('rejects blocked-token edits before optimistic local apply when a foreign operation lock is active', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/project_operations/current')).toBe(true),
    );

    const foreignLock: ProjectOperationLockDoc = {
      type: 'bulk-update',
      ownerId: 'other-client',
      ownerClientId: 'other-client',
      ownerUserId: null,
      startedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: '2026-03-30T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      status: 'running',
    };

    act(() => {
      emitDocSnapshot('projects/project-1/project_operations/current', foreignLock);
    });

    act(() => {
      result.current.blockTokens(['Alpha']);
    });

    expect(Array.from(result.current.blockedTokens)).toEqual([]);
    expect(collabMocks.commitRevisionedDocChanges).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('project-wide operation'),
      'warning',
    );
  });

  it('rejects group edits before optimistic local apply when a foreign operation lock is active', async () => {
    const addToast = vi.fn();
    const cluster: ClusterSummary = {
      pageName: 'Alpha',
      pageNameLower: 'alpha',
      pageNameLen: 5,
      tokens: 'alpha',
      tokenArr: ['alpha'],
      keywordCount: 1,
      totalVolume: 10,
      avgKd: 20,
      avgKwRating: 1,
      label: '',
      labelArr: [],
      locationCity: null,
      locationState: null,
      keywords: [],
    };
    const canonical = makeCanonical(1);
    canonical.base.clusterSummary = [cluster];
    canonical.resolved.clusterSummary = [cluster];
    canonical.base.results = [{
      pageName: 'Alpha',
      pageNameLower: 'alpha',
      pageNameLen: 5,
      tokens: 'alpha',
      tokenArr: ['alpha'],
      keyword: 'alpha keyword',
      keywordLower: 'alpha keyword',
      searchVolume: 10,
      kd: 20,
      kwRating: 1,
      label: '',
      labelArr: [],
      locationCity: '',
      locationState: '',
    }] as any;
    canonical.resolved.results = canonical.base.results;
    collabMocks.loadCanonicalProjectState.mockResolvedValue(canonical);

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/project_operations/current')).toBe(true),
    );

    const foreignLock: ProjectOperationLockDoc = {
      type: 'bulk-update',
      ownerId: 'other-client',
      ownerClientId: 'other-client',
      ownerUserId: null,
      startedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: '2026-03-30T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      status: 'running',
    };

    act(() => {
      emitDocSnapshot('projects/project-1/project_operations/current', foreignLock);
    });

    const newGroup: GroupedCluster = {
      id: 'group-1',
      groupName: 'Group 1',
      clusters: [cluster],
      totalVolume: 10,
      keywordCount: 1,
      avgKd: 20,
      avgKwRating: 1,
    };

    let applied = true;
    act(() => {
      applied = result.current.addGroupsAndRemovePages([newGroup], new Set(['alpha']));
    });

    expect(applied).toBe(false);
    expect(result.current.groupedClusters).toEqual([]);
    expect(result.current.clusterSummary?.map((item) => item.tokens)).toEqual(['alpha']);
    expect(collabMocks.commitRevisionedDocChanges).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('Group edits is temporarily read-only'),
      'warning',
    );
  });

  it('rejects merge-by-name edits before optimistic local apply when a foreign operation lock is active', async () => {
    const addToast = vi.fn();
    const cluster: ClusterSummary = {
      pageName: 'Alpha',
      pageNameLower: 'alpha',
      pageNameLen: 5,
      tokens: 'alpha',
      tokenArr: ['alpha'],
      keywordCount: 1,
      totalVolume: 10,
      avgKd: 20,
      avgKwRating: 1,
      label: '',
      labelArr: [],
      locationCity: null,
      locationState: null,
      keywords: [],
    };
    const canonical = makeCanonical(1);
    canonical.base.clusterSummary = [cluster];
    canonical.resolved.clusterSummary = [cluster];
    canonical.base.results = [{
      pageName: 'Alpha',
      pageNameLower: 'alpha',
      pageNameLen: 5,
      tokens: 'alpha',
      tokenArr: ['alpha'],
      keyword: 'alpha keyword',
      keywordLower: 'alpha keyword',
      searchVolume: 10,
      kd: 20,
      kwRating: 1,
      label: '',
      labelArr: [],
      locationCity: '',
      locationState: '',
    }] as any;
    canonical.resolved.results = canonical.base.results;
    collabMocks.loadCanonicalProjectState.mockResolvedValue(canonical);

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/project_operations/current')).toBe(true),
    );

    const foreignLock: ProjectOperationLockDoc = {
      type: 'bulk-update',
      ownerId: 'other-client',
      ownerClientId: 'other-client',
      ownerUserId: null,
      startedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: '2026-03-30T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      status: 'running',
    };

    act(() => {
      emitDocSnapshot('projects/project-1/project_operations/current', foreignLock);
    });

    const incomingGroup: GroupedCluster = {
      id: 'group-1',
      groupName: 'Group 1',
      clusters: [cluster],
      totalVolume: 10,
      keywordCount: 1,
      avgKd: 20,
      avgKwRating: 1,
    };

    let applied = true;
    act(() => {
      applied = result.current.mergeGroupsByName({
        incoming: [incomingGroup],
        removedTokens: new Set(['alpha']),
        hasReviewApi: false,
        mergeFn: (_existing, incoming) => incoming,
      });
    });

    expect(applied).toBe(false);
    expect(result.current.groupedClusters).toEqual([]);
    expect(result.current.clusterSummary?.map((item) => item.tokens)).toEqual(['alpha']);
    expect(collabMocks.commitRevisionedDocChanges).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('Group edits is temporarily read-only'),
      'warning',
    );
  });

  it('does not resubscribe the legacy chunks listener when addToast changes identity', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeLegacyState());
    const setProjects = vi.fn();

    const { result, rerender } = renderHook(
      ({ addToast }: { addToast: (msg: string, type: 'error' | 'info' | 'success' | 'warning') => void }) =>
        useProjectPersistence({
          projects: PROJECTS,
          setProjects,
          addToast,
        }),
      {
        initialProps: {
          addToast: vi.fn() as (msg: string, type: 'error' | 'info' | 'success' | 'warning') => void,
        },
      },
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('legacy'));
    await waitFor(() =>
      expect(firestoreMocks.onSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'projects/project-1/chunks' }),
        expect.any(Function),
        expect.any(Function),
      ),
    );

    const subscribeCount = firestoreMocks.onSnapshot.mock.calls.length;

    rerender({ addToast: vi.fn() });
    await flush();

    expect(firestoreMocks.onSnapshot.mock.calls.length).toBe(subscribeCount);
  });

  it('ignores stale epoch loads that resolve after a newer meta commit barrier', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1, ['initial']));
    const epoch10 = deferred<ReturnType<typeof makeCanonical>>();
    const epoch11 = deferred<ReturnType<typeof makeCanonical>>();
    collabMocks.loadCanonicalEpoch
      .mockImplementationOnce(() => epoch10.promise)
      .mockImplementationOnce(() => epoch11.promise);

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(10, 10));
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(11, 11));
    });

    expect(Array.from(result.current.blockedTokens)).toEqual(['initial']);

    await act(async () => {
      epoch11.resolve(makeCanonical(11, ['epoch-11']));
      await epoch11.promise;
    });

    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual(['epoch-11']));

    await act(async () => {
      epoch10.resolve(makeCanonical(10, ['epoch-10']));
      await epoch10.promise;
      await Promise.resolve();
    });

    expect(Array.from(result.current.blockedTokens)).toEqual(['epoch-11']);
  });

  it('falls back to full canonical recovery when a meta listener epoch load is unresolved', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1, ['stable']));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );

    collabMocks.loadCanonicalEpoch.mockResolvedValueOnce(null);
    collabMocks.loadCanonicalProjectState.mockClear();
    collabMocks.loadCanonicalProjectState.mockResolvedValueOnce(makeCanonical(2, ['recovered']));

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(2, 2));
    });

    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual(['recovered']));
    expect(collabMocks.loadCanonicalProjectState).toHaveBeenCalledTimes(1);
  });

  it('retries full canonical recovery when a meta listener epoch load throws', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1, ['stable']));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );

    collabMocks.loadCanonicalEpoch
      .mockRejectedValueOnce(new Error('epoch load failed'))
      .mockResolvedValueOnce(null);
    collabMocks.loadCanonicalProjectState.mockClear();
    collabMocks.loadCanonicalProjectState.mockResolvedValueOnce(makeCanonical(2, ['recovered-after-error']));

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(2, 2));
    });

    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual(['recovered-after-error']));
    expect(collabMocks.loadCanonicalProjectState).toHaveBeenCalledTimes(1);
  });

  it('ignores pending-write meta snapshots for epoch activation', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1, ['stable']));
    collabMocks.loadCanonicalEpoch.mockResolvedValue(makeCanonical(2, ['epoch-2']));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );

    collabMocks.loadCanonicalEpoch.mockClear();
    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(2, 2), true);
    });
    await flush();

    expect(collabMocks.loadCanonicalEpoch).not.toHaveBeenCalled();
    expect(Array.from(result.current.blockedTokens)).toEqual(['stable']);
  });

  it('serializes canonical V2 cache writes so stale completions cannot overtake newer ones', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1, ['Alpha']));
    collabMocks.loadCanonicalEpoch.mockResolvedValue(makeCanonical(1, ['Alpha']));
    const firstCacheWrite = deferred<void>();
    const secondCacheWrite = deferred<void>();

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(1, 2));
    });
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/blocked_tokens')).toBe(true),
    );

    collabMocks.saveCanonicalCacheToIDB.mockReset();
    collabMocks.saveCanonicalCacheToIDB
      .mockImplementationOnce(() => firstCacheWrite.promise)
      .mockImplementationOnce(() => secondCacheWrite.promise);

    act(() => {
      emitQuerySnapshot('projects/project-1/blocked_tokens', [{
        type: 'modified',
        doc: {
          id: `1::${blockedTokenDocId('Alpha')}`,
          data: () => ({
            id: blockedTokenDocId('Alpha'),
            token: 'Alpha',
            datasetEpoch: 1,
            revision: 2,
            updatedAt: '2026-03-30T00:00:00.000Z',
            updatedByClientId: 'client-a',
            lastMutationId: 'm-1',
          }),
        },
      }]);
      emitQuerySnapshot('projects/project-1/blocked_tokens', [{
        type: 'added',
        doc: {
          id: `1::${blockedTokenDocId('Beta')}`,
          data: () => ({
            id: blockedTokenDocId('Beta'),
            token: 'Beta',
            datasetEpoch: 1,
            revision: 1,
            updatedAt: '2026-03-30T00:00:00.000Z',
            updatedByClientId: 'client-a',
            lastMutationId: 'm-2',
          }),
        },
      }]);
    });

    await waitFor(() => expect(collabMocks.saveCanonicalCacheToIDB).toHaveBeenCalledTimes(1));
    expect(Array.from(result.current.blockedTokens)).toEqual(['Alpha', 'Beta']);

    await act(async () => {
      firstCacheWrite.resolve();
      await firstCacheWrite.promise;
      await Promise.resolve();
    });

    await waitFor(() => expect(collabMocks.saveCanonicalCacheToIDB).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondCacheWrite.resolve();
      await secondCacheWrite.promise;
    });
  });

  it('suppresses idempotent listener echoes with unchanged revision and mutation id', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1, ['Alpha']));
    collabMocks.loadCanonicalEpoch.mockResolvedValue(makeCanonical(1, ['Alpha']));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(1, 2));
    });
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/blocked_tokens')).toBe(true),
    );

    collabMocks.saveCanonicalCacheToIDB.mockClear();

    act(() => {
      emitQuerySnapshot('projects/project-1/blocked_tokens', [{
        type: 'modified',
        doc: {
          id: `1::${blockedTokenDocId('Alpha')}`,
          data: () => ({
            id: blockedTokenDocId('Alpha'),
            token: 'Alpha',
            datasetEpoch: 1,
            revision: 1,
            updatedAt: '2026-03-30T00:00:00.000Z',
            updatedByClientId: 'client-a',
            lastMutationId: null,
          }),
        },
      }]);
    });

    await flush();
    expect(Array.from(result.current.blockedTokens)).toEqual(['Alpha']);
    expect(collabMocks.saveCanonicalCacheToIDB).not.toHaveBeenCalled();
  });

  it('keeps prior view visible when V2 canonical load is unresolved (commit writing)', async () => {
    collabMocks.loadCanonicalCacheFromIDB.mockResolvedValue({
      schemaVersion: CLIENT_SCHEMA_VERSION,
      datasetEpoch: 1,
      baseCommitId: 'commit_1',
      cachedAt: '2026-03-30T00:00:00.000Z',
      payload: {
        ...makeCanonical(1, ['cached']).resolved,
      },
    });
    collabMocks.loadCanonicalProjectState.mockResolvedValue({
      ...makeCanonical(1),
      entities: {
        ...makeCanonical(1).entities,
        meta: {
          ...makeMeta(1, 2),
          commitState: 'writing',
          migrationState: 'running',
        },
      },
      resolved: null,
    });

    const addToast = vi.fn();
    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    expect(result.current.storageMode).toBe('v2');
    expect(Array.from(result.current.blockedTokens)).toEqual(['cached']);
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('recovering from an incomplete cloud commit'),
      'warning',
    );
  });

  it('surfaces a rules-focused warning when shared-project recovery is blocked by permissions', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue({
      ...makeCanonical(1),
      entities: {
        ...makeCanonical(1).entities,
        meta: {
          ...makeMeta(1, 2),
          commitState: 'writing',
          migrationState: 'running',
        },
      },
      resolved: null,
      diagnostics: {
        recovery: {
          attempted: true,
          outcome: 'failed',
          code: 'permission-denied',
          step: 'repair collab meta',
        },
      },
    });

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('recovery is blocked by Firestore permissions'),
      'warning',
    );
  });

  it('suppresses legacy chunk writes while project storage mode is unresolved', async () => {
    const canonicalLoad = deferred<ReturnType<typeof makeCanonical>>();
    collabMocks.loadCanonicalProjectState.mockImplementation(() => canonicalLoad.promise);

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
      void result.current.loadProject('project-1', PROJECTS);
    });

    await flush();

    act(() => {
      result.current.bulkSet({
        results: [{ tokens: 'alpha' } as any],
        fileName: 'Suppressed during bootstrap',
      });
    });

    await flush();

    expect(storageMocks.saveProjectDataToFirestore).not.toHaveBeenCalled();
    expect(storageMocks.saveProjectToFirestore).not.toHaveBeenCalled();
    expect(storageMocks.saveToIDB).not.toHaveBeenCalled();

    await act(async () => {
      canonicalLoad.resolve(makeCanonical(1));
      await canonicalLoad.promise;
    });
  });

  it('drops conflicted optimistic state and reloads canonical docs from cloud', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    collabMocks.loadCanonicalEpoch.mockResolvedValue(makeCanonical(1, ['remote']));
    collabMocks.commitRevisionedDocChanges.mockRejectedValueOnce(new Error(`conflict:blocked_tokens:${blockedTokenDocId('Alpha')}`));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );
    act(() => {
      result.current.blockTokens(['Alpha']);
    });
    expect(Array.from(result.current.blockedTokens)).toEqual(['Alpha']);

    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual(['remote']));
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('Another client changed this project item'),
      'warning',
    );
  });

  it('rolls back the touched optimistic overlay before conflict reload completes', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    const canonicalReload = deferred<ReturnType<typeof makeCanonical>>();
    collabMocks.loadCanonicalEpoch.mockImplementation(() => canonicalReload.promise);
    collabMocks.commitRevisionedDocChanges.mockRejectedValueOnce(new Error(`conflict:blocked_tokens:${blockedTokenDocId('Alpha')}`));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));

    act(() => {
      result.current.blockTokens(['Alpha']);
    });

    expect(Array.from(result.current.blockedTokens)).toEqual(['Alpha']);
    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual([]));

    await act(async () => {
      canonicalReload.resolve(makeCanonical(1, ['remote']));
      await canonicalReload.promise;
    });

    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual(['remote']));
  });

  it('ignores pending-write entity snapshots so unacked echoes do not recompose canonical view', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1, ['Alpha']));
    collabMocks.loadCanonicalEpoch.mockResolvedValue(makeCanonical(1, ['Alpha']));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );
    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(1, 2));
    });
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/blocked_tokens')).toBe(true),
    );

    collabMocks.saveCanonicalCacheToIDB.mockClear();
    act(() => {
      emitQuerySnapshot('projects/project-1/blocked_tokens', [{
        type: 'modified',
        doc: {
          id: `1::${blockedTokenDocId('Beta')}`,
          data: () => ({
            id: blockedTokenDocId('Beta'),
            token: 'Beta',
            datasetEpoch: 1,
            revision: 2,
            updatedAt: '2026-03-30T00:00:00.000Z',
            updatedByClientId: 'client-a',
            lastMutationId: 'pending',
          }),
        },
      }], true);
    });

    await flush();
    expect(Array.from(result.current.blockedTokens)).toEqual(['Alpha']);
    expect(collabMocks.saveCanonicalCacheToIDB).not.toHaveBeenCalled();
  });

  it('rejects V2 writes before optimistic local apply when the project requires a newer client schema', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    collabMocks.loadCanonicalEpoch.mockResolvedValue(makeCanonical(1));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', {
        ...makeMeta(1, 2),
        requiredClientSchema: 99,
      });
    });

    await flush();

    act(() => {
      result.current.blockTokens(['Alpha']);
    });

    expect(Array.from(result.current.blockedTokens)).toEqual([]);
    expect(collabMocks.commitRevisionedDocChanges).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('newer client version'),
      'warning',
    );
  });

  it('treats flushNow as a full V2 cloud-plus-cache durability barrier', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    const ack = deferred<Array<{
      kind: 'upsert' | 'delete';
      id: string;
      revision: number;
      lastMutationId: string | null;
      value?: Record<string, unknown>;
    }>>();
    const cacheWrite = deferred<void>();
    collabMocks.commitRevisionedDocChanges.mockImplementationOnce(() => ack.promise);
    collabMocks.saveCanonicalCacheToIDB.mockImplementationOnce(() => cacheWrite.promise);

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));

    act(() => {
      result.current.blockTokens(['Alpha']);
    });

    let flushed = false;
    const flushPromise = result.current.flushNow().then(() => {
      flushed = true;
    });

    await flush();
    expect(flushed).toBe(false);

    await act(async () => {
      ack.resolve([{
        kind: 'upsert',
        id: blockedTokenDocId('Alpha'),
        revision: 1,
        lastMutationId: 'mutation-1',
        value: {
          id: blockedTokenDocId('Alpha'),
          token: 'Alpha',
          datasetEpoch: 1,
          revision: 1,
          updatedAt: '2026-03-30T00:00:00.000Z',
          updatedByClientId: 'client-a',
          lastMutationId: 'mutation-1',
        },
      }]);
      await ack.promise;
      await Promise.resolve();
    });

    expect(flushed).toBe(false);

    await act(async () => {
      cacheWrite.resolve();
      await cacheWrite.promise;
      await flushPromise;
    });

    expect(flushed).toBe(true);
  });

  it('ignores stale entity listener callbacks after switching projects', async () => {
    collabMocks.loadCanonicalProjectState
      .mockResolvedValueOnce(makeCanonical(1, ['Alpha']))
      .mockResolvedValueOnce(makeCanonical(1, ['Project Two']));
    collabMocks.loadCanonicalEpoch
      .mockResolvedValueOnce(makeCanonical(1, ['Alpha']))
      .mockResolvedValueOnce(makeCanonical(1, ['Project Two']));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });
    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(1, 2));
    });
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/blocked_tokens')).toBe(true),
    );

    const staleBlockedTokensListener = firestoreMocks.listeners.get('projects/project-1/blocked_tokens')?.[0];
    expect(staleBlockedTokensListener).toBeTypeOf('function');

    act(() => {
      result.current.setActiveProjectId('project-2');
    });
    await act(async () => {
      await result.current.loadProject('project-2', PROJECTS);
    });

    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual(['Project Two']));

    act(() => {
      staleBlockedTokensListener?.({
        metadata: { hasPendingWrites: false },
        docChanges: () => [{
          type: 'added',
          doc: {
            id: `1::${blockedTokenDocId('Ghost')}`,
            data: () => ({
              id: blockedTokenDocId('Ghost'),
              token: 'Ghost',
              datasetEpoch: 1,
              revision: 1,
              updatedAt: '2026-03-30T00:00:00.000Z',
              updatedByClientId: 'client-a',
              lastMutationId: 'ghost',
            }),
          },
        }],
      });
    });

    expect(Array.from(result.current.blockedTokens)).toEqual(['Project Two']);
  });

  it('blocks transitional setter writes for active V2 projects', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast,
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));

    act(() => {
      result.current.setBlockedTokens(new Set(['Bypass']));
    });

    expect(Array.from(result.current.blockedTokens)).toEqual([]);
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('blocked for shared V2 projects'),
      'warning',
    );
  });

});
