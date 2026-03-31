import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectCollabMetaDoc, ProjectOperationLockDoc } from './types';

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

function emitDocSnapshot(path: string, data: any) {
  firestoreMocks.emit(path, {
    exists: () => data != null,
    data: () => data,
    metadata: { hasPendingWrites: false },
  });
}

const PROJECTS: Project[] = [
  { id: 'project-1', name: 'Project 1', description: '', uid: 'user-1', createdAt: '2026-03-30T00:00:00.000Z' },
];

describe('useProjectPersistence V2 hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.listeners.clear();
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
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(10, 10));
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(11, 11));
    });

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

  it('does not write V2 canonical cache before a revisioned mutation is acknowledged', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    const ack = deferred<Array<{
      kind: 'upsert' | 'delete';
      id: string;
      revision: number;
      lastMutationId: string | null;
      value?: Record<string, unknown>;
    }>>();
    collabMocks.commitRevisionedDocChanges.mockImplementationOnce(() => ack.promise);

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
    collabMocks.saveCanonicalCacheToIDB.mockClear();

    act(() => {
      result.current.blockTokens(['Alpha']);
    });

    expect(Array.from(result.current.blockedTokens)).toEqual(['Alpha']);
    expect(collabMocks.saveCanonicalCacheToIDB).not.toHaveBeenCalled();

    await act(async () => {
      ack.resolve([
        {
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
        },
      ]);
      await ack.promise;
    });

    await waitFor(() => expect(collabMocks.saveCanonicalCacheToIDB).toHaveBeenCalled());
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
});
