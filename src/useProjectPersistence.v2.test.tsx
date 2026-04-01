import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityLogEntry,
  AutoGroupSuggestion,
  BlockedKeyword,
  ClusterSummary,
  GroupedCluster,
  LabelSection,
  ProcessedRow,
  Project,
  ProjectCollabMetaDoc,
  ProjectOperationLockDoc,
  Stats,
  TokenMergeRule,
  TokenSummary,
} from './types';

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
  buildProjectDataPayloadFromChunkDocs: vi.fn((_docs: Array<{ data: () => unknown }>) => null),
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
  commitCanonicalProjectState: vi.fn(),
  acquireProjectOperationLock: vi.fn(),
  releaseProjectOperationLock: vi.fn(() => Promise.resolve()),
  heartbeatProjectOperationLock: vi.fn(),
}));

const runtimeTraceMocks = vi.hoisted(() => ({
  beginRuntimeTrace: vi.fn(() => 'trace-test'),
  traceRuntimeEvent: vi.fn(),
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
    commitCanonicalProjectState: collabMocks.commitCanonicalProjectState,
    acquireProjectOperationLock: collabMocks.acquireProjectOperationLock,
    releaseProjectOperationLock: collabMocks.releaseProjectOperationLock,
    heartbeatProjectOperationLock: collabMocks.heartbeatProjectOperationLock,
  };
});
vi.mock('./runtimeTrace', () => ({
  beginRuntimeTrace: runtimeTraceMocks.beginRuntimeTrace,
  traceRuntimeEvent: runtimeTraceMocks.traceRuntimeEvent,
}));

import {
  buildGroupDocChanges,
  buildTokenMergeRuleDocChanges,
  blockedTokenDocId,
  CLIENT_SCHEMA_VERSION,
  groupDocId,
  PROJECT_BLOCKED_TOKENS_SUBCOLLECTION,
  PROJECT_GROUPS_SUBCOLLECTION,
  PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION,
  tokenMergeRuleDocId,
} from './projectCollabV2';
import { buildProjectDataPayloadFromChunkDocs } from './projectChunkPayload';
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
    entities: {
      ...makeCanonical(1, blockedTokens).entities,
      meta: null,
    },
  };
}

function makeCluster(tokens: string, pageName = tokens): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: 1,
    totalVolume: 10,
    avgKd: 20,
    avgKwRating: 1,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
    keywords: [{
      keyword: `${pageName} keyword`,
      volume: 10,
      kd: 20,
      kwRating: 1,
      locationCity: null,
      locationState: null,
    }],
  };
}

function makeRow(cluster: ClusterSummary): ProcessedRow {
  return {
    pageName: cluster.pageName,
    pageNameLower: cluster.pageNameLower,
    pageNameLen: cluster.pageNameLen,
    tokens: cluster.tokens,
    tokenArr: cluster.tokenArr,
    keyword: cluster.keywords[0]?.keyword ?? `${cluster.pageName} keyword`,
    keywordLower: (cluster.keywords[0]?.keyword ?? `${cluster.pageName} keyword`).toLowerCase(),
    searchVolume: cluster.keywords[0]?.volume ?? 10,
    kd: cluster.keywords[0]?.kd ?? 20,
    kwRating: cluster.keywords[0]?.kwRating ?? 1,
    label: cluster.label,
    labelArr: cluster.labelArr,
    locationCity: cluster.locationCity,
    locationState: cluster.locationState,
  };
}

function makeGroup(id: string, groupName: string, cluster: ClusterSummary): GroupedCluster {
  return {
    id,
    groupName,
    clusters: [cluster],
    totalVolume: cluster.totalVolume,
    keywordCount: cluster.keywordCount,
    avgKd: cluster.avgKd,
    avgKwRating: cluster.avgKwRating,
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

/** Drive the legacy `projects/{id}/chunks` onSnapshot used when storageMode is legacy. */
function emitLegacyChunksSnapshot(
  projectId: string,
  payload: {
    results?: ProcessedRow[];
    clusterSummary?: ClusterSummary[];
    groupedClusters?: GroupedCluster[];
    approvedGroups?: GroupedCluster[];
    tokenSummary?: TokenSummary[];
    stats?: Stats | null;
    datasetStats?: unknown | null;
    blockedTokens?: string[];
    blockedKeywords?: BlockedKeyword[];
    labelSections?: LabelSection[];
    activityLog?: ActivityLogEntry[];
    tokenMergeRules?: TokenMergeRule[];
    autoGroupSuggestions?: AutoGroupSuggestion[];
  },
) {
  const results = payload.results ?? [];
  const clusters = payload.clusterSummary ?? [];
  const groupedClusters = payload.groupedClusters ?? [];
  const approvedGroups = payload.approvedGroups ?? [];
  const blockedKeywords = payload.blockedKeywords ?? [];
  const suggestions = payload.autoGroupSuggestions ?? [];

  const docs: Array<{ data: () => Record<string, unknown> }> = [
    {
      data: () => ({
        type: 'meta',
        stats: payload.stats ?? null,
        datasetStats: payload.datasetStats ?? null,
        tokenSummary: payload.tokenSummary ?? [],
        groupedClusters,
        approvedGroups,
        blockedTokens: payload.blockedTokens ?? [],
        labelSections: payload.labelSections ?? [],
        activityLog: payload.activityLog ?? [],
        tokenMergeRules: payload.tokenMergeRules ?? [],
        resultChunkCount: results.length > 0 ? 1 : 0,
        clusterChunkCount: clusters.length > 0 ? 1 : 0,
        blockedChunkCount: blockedKeywords.length > 0 ? 1 : 0,
        suggestionChunkCount: suggestions.length > 0 ? 1 : 0,
        autoMergeChunkCount: 0,
        groupMergeChunkCount: 0,
        groupedClusterCount: groupedClusters.length > 0 ? 1 : 0,
        approvedGroupCount: approvedGroups.length > 0 ? 1 : 0,
        saveId: 99,
      }),
    },
  ];

  if (results.length > 0) {
    docs.push({ data: () => ({ type: 'results', index: 0, data: results }) });
  }
  if (clusters.length > 0) {
    docs.push({ data: () => ({ type: 'clusters', index: 0, data: clusters }) });
  }
  if (blockedKeywords.length > 0) {
    docs.push({ data: () => ({ type: 'blocked', index: 0, data: blockedKeywords }) });
  }
  if (suggestions.length > 0) {
    docs.push({ data: () => ({ type: 'suggestions', index: 0, data: suggestions }) });
  }

  const snap = {
    empty: false,
    docs,
    metadata: { hasPendingWrites: false, fromCache: false },
  };

  const path = `projects/${projectId}/chunks`;
  const listeners = firestoreMocks.listeners.get(path) ?? [];
  const cb = listeners[listeners.length - 1];
  if (!cb) {
    throw new Error(`[test] no chunks listener for ${path}`);
  }
  cb(snap);
}

const PROJECTS: Project[] = [
  { id: 'project-1', name: 'Project 1', description: '', uid: 'user-1', createdAt: '2026-03-30T00:00:00.000Z' },
  { id: 'project-2', name: 'Project 2', description: '', uid: 'user-1', createdAt: '2026-03-30T00:00:00.000Z' },
];

const SHARED_PROJECTS: Project[] = [
  { id: 'project-1', name: 'Shared Project', description: 'collab', uid: 'user-1', createdAt: '2026-03-30T00:00:00.000Z' },
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
    collabMocks.commitCanonicalProjectState.mockReset();
    collabMocks.acquireProjectOperationLock.mockReset();
    collabMocks.releaseProjectOperationLock.mockResolvedValue(undefined);
    collabMocks.heartbeatProjectOperationLock.mockReset();
    runtimeTraceMocks.beginRuntimeTrace.mockReset();
    runtimeTraceMocks.beginRuntimeTrace.mockReturnValue('trace-test');
    runtimeTraceMocks.traceRuntimeEvent.mockReset();
  });

  it('never attaches the legacy chunk listener for shared collab projects', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', SHARED_PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    expect(firestoreMocks.listeners.has('projects/project-1/chunks')).toBe(false);
    expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true);
  });

  it('[project-v2-listener-converges] propagates a shared V2 edit from client A to client B without any legacy listener', async () => {
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    let echoedTokenDoc: Record<string, unknown> | null = null;

    collabMocks.commitRevisionedDocChanges.mockImplementation(
      async (_projectId, subcollection, changes, actorId) => {
        if (subcollection !== PROJECT_BLOCKED_TOKENS_SUBCOLLECTION) {
          return [];
        }
        return changes
          .filter((change: { kind: 'upsert' | 'delete' }) => change.kind === 'upsert')
          .map((change: {
            id: string;
            mutationId?: string;
            value?: Record<string, unknown>;
          }) => {
            echoedTokenDoc = {
              ...(change.value ?? {}),
              id: change.id,
              revision: 1,
              updatedByClientId: actorId,
              lastMutationId: change.mutationId ?? null,
            };
            return {
              kind: 'upsert' as const,
              id: change.id,
              revision: 1,
              lastMutationId: change.mutationId ?? null,
              value: echoedTokenDoc,
            };
          });
      },
    );

    const clientA = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
        clientIdOverride: 'client-a',
      }),
    );
    const clientB = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
        clientIdOverride: 'client-b',
      }),
    );

    act(() => {
      clientA.result.current.setActiveProjectId('project-1');
      clientB.result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await clientA.result.current.loadProject('project-1', SHARED_PROJECTS);
      await clientB.result.current.loadProject('project-1', SHARED_PROJECTS);
    });

    await waitFor(() => expect(clientA.result.current.storageMode).toBe('v2'));
    await waitFor(() => expect(clientB.result.current.storageMode).toBe('v2'));

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(1, 2));
    });

    await waitFor(() =>
      expect(firestoreMocks.listeners.get('projects/project-1/blocked_tokens')?.length).toBe(2),
    );

    await act(async () => {
      await clientA.result.current.blockTokens(['Alpha']);
    });

    expect(Array.from(clientA.result.current.blockedTokens)).toEqual(['Alpha']);
    expect(Array.from(clientB.result.current.blockedTokens)).toEqual([]);
    expect(firestoreMocks.listeners.has('projects/project-1/chunks')).toBe(false);
    expect(echoedTokenDoc).toBeTruthy();

    act(() => {
      emitQuerySnapshot('projects/project-1/blocked_tokens', [{
        type: 'added',
        doc: {
          id: `1::${blockedTokenDocId('Alpha')}`,
          data: () => echoedTokenDoc,
        },
      }]);
    });

    await waitFor(() => expect(Array.from(clientB.result.current.blockedTokens)).toEqual(['Alpha']));
  });

  it('[project-v2-entity-converges] propagates a successful shared grouping edit from client A to client B through the groups listener', async () => {
    const alpha = makeCluster('alpha', 'Alpha');
    const canonical = makeCanonical(1);
    canonical.base.clusterSummary = [alpha];
    canonical.base.results = [makeRow(alpha)];
    canonical.resolved.clusterSummary = [alpha];
    canonical.resolved.results = [makeRow(alpha)];
    collabMocks.loadCanonicalProjectState.mockResolvedValue(canonical);

    let echoedGroupDoc: Record<string, unknown> | null = null;
    collabMocks.commitRevisionedDocChanges.mockImplementation(
      async (_projectId, subcollection, changes, actorId) => {
        if (subcollection !== PROJECT_GROUPS_SUBCOLLECTION) {
          return [];
        }
        return changes
          .filter((change: { kind: 'upsert' | 'delete' }) => change.kind === 'upsert')
          .map((change: {
            id: string;
            mutationId?: string;
            expectedRevision: number;
            value?: Record<string, unknown>;
          }) => {
            echoedGroupDoc = {
              ...(change.value ?? {}),
              id: change.id,
              revision: change.expectedRevision + 1,
              updatedByClientId: actorId,
              lastMutationId: change.mutationId ?? null,
            };
            return {
              kind: 'upsert' as const,
              id: change.id,
              revision: change.expectedRevision + 1,
              lastMutationId: change.mutationId ?? null,
              value: echoedGroupDoc,
            };
          });
      },
    );

    const clientA = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
        clientIdOverride: 'client-a',
      }),
    );
    const clientB = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
        clientIdOverride: 'client-b',
      }),
    );

    act(() => {
      clientA.result.current.setActiveProjectId('project-1');
      clientB.result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await clientA.result.current.loadProject('project-1', SHARED_PROJECTS);
      await clientB.result.current.loadProject('project-1', SHARED_PROJECTS);
    });

    await waitFor(() => expect(clientA.result.current.storageMode).toBe('v2'));
    await waitFor(() => expect(clientB.result.current.storageMode).toBe('v2'));

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(1, 2));
    });

    await waitFor(() =>
      expect(firestoreMocks.listeners.get('projects/project-1/groups')?.length).toBe(2),
    );

    const newGroup = makeGroup('group-1', 'Alpha Group', alpha);

    await act(async () => {
      await clientA.result.current.addGroupsAndRemovePages([newGroup], new Set(['alpha']));
    });

    expect(clientA.result.current.groupedClusters.map((group) => group.id)).toEqual(['group-1']);
    expect(clientA.result.current.clusterSummary).toEqual([]);
    expect(clientB.result.current.groupedClusters).toEqual([]);
    expect(clientB.result.current.clusterSummary?.map((cluster) => cluster.tokens)).toEqual(['alpha']);
    expect(echoedGroupDoc).toBeTruthy();

    act(() => {
      emitQuerySnapshot('projects/project-1/groups', [{
        type: 'added',
        doc: {
          id: `1::${groupDocId(newGroup.id)}`,
          data: () => echoedGroupDoc,
        },
      }]);
    });

    await waitFor(() =>
      expect(clientB.result.current.groupedClusters.map((group) => group.id)).toEqual(['group-1']),
    );
    expect(clientB.result.current.clusterSummary).toEqual([]);
    expect(clientB.result.current.results).toEqual([]);
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

    let mutationResult: Awaited<ReturnType<typeof result.current.addGroupsAndRemovePages>> | null = null;
    await act(async () => {
      mutationResult = await result.current.addGroupsAndRemovePages([newGroup], new Set(['alpha']));
    });

    expect(mutationResult?.status).toBe('blocked');
    expect(result.current.groupedClusters).toEqual([]);
    expect(result.current.clusterSummary?.map((item) => item.tokens)).toEqual(['alpha']);
    expect(collabMocks.commitRevisionedDocChanges).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('Group edits is temporarily read-only'),
      'warning',
    );
  });

  it('rejects overlapping bulk operations from the same browser before a second lock attempt starts', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    const heldTask = deferred<string>();
    const lock: ProjectOperationLockDoc = {
      type: 'auto-group',
      ownerId: 'client-a',
      ownerClientId: 'client-a',
      ownerUserId: null,
      startedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: '2026-03-30T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      status: 'running',
    };
    collabMocks.acquireProjectOperationLock.mockResolvedValue(lock);
    collabMocks.heartbeatProjectOperationLock.mockResolvedValue(lock);

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

    const first = result.current.runWithExclusiveOperation('auto-group', () => heldTask.promise);
    const second = result.current.runWithExclusiveOperation('auto-group', async () => 'second');

    await expect(second).resolves.toBeNull();
    expect(collabMocks.acquireProjectOperationLock).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('already running in this browser'),
      'warning',
    );

    await act(async () => {
      heldTask.resolve('first');
      await first;
    });
  });

  it('clears the local exclusive-operation gate when lock acquisition throws so the next operation can retry', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    const lock: ProjectOperationLockDoc = {
      type: 'token-merge',
      ownerId: 'client-a',
      ownerClientId: 'client-a',
      ownerUserId: null,
      startedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: '2026-03-30T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      status: 'running',
    };
    collabMocks.acquireProjectOperationLock
      .mockRejectedValueOnce(new Error('acquire boom'))
      .mockResolvedValueOnce(lock);
    collabMocks.heartbeatProjectOperationLock.mockResolvedValue(lock);

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

    await expect(
      result.current.runWithExclusiveOperation('token-merge', async () => 'first'),
    ).resolves.toBeNull();

    await expect(
      result.current.runWithExclusiveOperation('token-merge', async () => 'second'),
    ).resolves.toBe('second');

    expect(collabMocks.acquireProjectOperationLock).toHaveBeenCalledTimes(2);
    expect(result.current.activeOperation).toBeNull();
  });

  it('reports release failures without leaving the local operation state pinned', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical(1));
    const lock: ProjectOperationLockDoc = {
      type: 'token-merge',
      ownerId: 'client-a',
      ownerClientId: 'client-a',
      ownerUserId: null,
      startedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: '2026-03-30T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      status: 'running',
    };
    collabMocks.acquireProjectOperationLock.mockResolvedValue(lock);
    collabMocks.heartbeatProjectOperationLock.mockResolvedValue(lock);
    collabMocks.releaseProjectOperationLock
      .mockRejectedValueOnce(new Error('release boom'))
      .mockResolvedValueOnce(undefined);

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

    await expect(
      result.current.runWithExclusiveOperation('token-merge', async () => 'first'),
    ).resolves.toBe('first');

    await waitFor(() => expect(result.current.activeOperation).toBeNull());

    await expect(
      result.current.runWithExclusiveOperation('token-merge', async () => 'second'),
    ).resolves.toBe('second');

    expect(collabMocks.acquireProjectOperationLock).toHaveBeenCalledTimes(2);
    expect(collabMocks.releaseProjectOperationLock).toHaveBeenCalledTimes(2);
  });

  it('[project-v2-canonical-converges] propagates a successful token merge from client A to client B through the canonical epoch barrier', async () => {
    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const canonical = makeCanonical(1);
    canonical.base.clusterSummary = [alpha, beta];
    canonical.base.results = [makeRow(alpha), makeRow(beta)];
    canonical.base.tokenSummary = [
      {
        token: 'alpha',
        length: 5,
        frequency: 1,
        totalVolume: 10,
        avgKd: 20,
        label: '',
        labelArr: [],
        locationCity: 'No',
        locationState: 'No',
      },
      {
        token: 'beta',
        length: 4,
        frequency: 1,
        totalVolume: 10,
        avgKd: 20,
        label: '',
        labelArr: [],
        locationCity: 'No',
        locationState: 'No',
      },
    ];
    canonical.resolved.clusterSummary = [alpha, beta];
    canonical.resolved.results = [makeRow(alpha), makeRow(beta)];
    canonical.resolved.tokenSummary = canonical.base.tokenSummary;
    collabMocks.loadCanonicalProjectState.mockResolvedValue(canonical);

    const mergedCluster: ClusterSummary = {
      ...alpha,
      keywordCount: 2,
      totalVolume: 20,
      keywords: [
        ...alpha.keywords,
        {
          keyword: 'beta keyword',
          volume: 10,
          kd: 20,
          kwRating: 1,
          locationCity: null,
          locationState: null,
        },
      ],
    };
    const mergedResults: ProcessedRow[] = [
      makeRow(alpha),
      {
        ...makeRow(beta),
        pageName: 'Alpha',
        pageNameLower: 'alpha',
        pageNameLen: 5,
        tokens: 'alpha',
        tokenArr: ['alpha'],
      },
    ];
    const mergeRule: TokenMergeRule = {
      id: 'rule-1',
      parentToken: 'alpha',
      childTokens: ['beta'],
      createdAt: '2026-03-30T00:00:00.000Z',
      source: 'manual',
    };
    const canonicalAfterMerge = makeCanonical(2);
    canonicalAfterMerge.base.clusterSummary = [mergedCluster];
    canonicalAfterMerge.base.results = mergedResults;
    canonicalAfterMerge.base.tokenSummary = [
      {
        token: 'alpha',
        length: 5,
        frequency: 2,
        totalVolume: 20,
        avgKd: 20,
        label: '',
        labelArr: [],
        locationCity: 'No',
        locationState: 'No',
      },
    ];
    canonicalAfterMerge.entities.tokenMergeRules = buildTokenMergeRuleDocChanges([], [mergeRule], 'client-a', 2)
      .filter((change) => change.kind === 'upsert')
      .map((change) => ({
        ...(change.kind === 'upsert' ? change.value : {}),
        id: change.id,
        revision: 1,
        lastMutationId: 'm-rule-1',
      })) as any;
    canonicalAfterMerge.entities.meta = makeMeta(2, 3);
    canonicalAfterMerge.resolved.clusterSummary = [mergedCluster];
    canonicalAfterMerge.resolved.results = mergedResults;
    canonicalAfterMerge.resolved.tokenSummary = canonicalAfterMerge.base.tokenSummary;
    canonicalAfterMerge.resolved.tokenMergeRules = [mergeRule];
    canonicalAfterMerge.resolved.lastSaveId = 2;

    const lock: ProjectOperationLockDoc = {
      type: 'token-merge',
      ownerId: 'client-a',
      ownerClientId: 'client-a',
      ownerUserId: null,
      startedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: '2026-03-30T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      status: 'running',
    };
    collabMocks.acquireProjectOperationLock.mockResolvedValue(lock);
    collabMocks.heartbeatProjectOperationLock.mockResolvedValue(lock);
    collabMocks.commitCanonicalProjectState.mockResolvedValue(canonicalAfterMerge);
    collabMocks.loadCanonicalEpoch.mockResolvedValue(canonicalAfterMerge);

    const clientA = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
        clientIdOverride: 'client-a',
      }),
    );
    const clientB = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
        clientIdOverride: 'client-b',
      }),
    );

    act(() => {
      clientA.result.current.setActiveProjectId('project-1');
      clientB.result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await clientA.result.current.loadProject('project-1', SHARED_PROJECTS);
      await clientB.result.current.loadProject('project-1', SHARED_PROJECTS);
    });

    await waitFor(() => expect(clientA.result.current.storageMode).toBe('v2'));
    await waitFor(() => expect(clientB.result.current.storageMode).toBe('v2'));

    const mutationResult = await act(async () =>
      clientA.result.current.runWithExclusiveOperation('token-merge', async () =>
        clientA.result.current.applyMergeCascade(
          {
            results: mergedResults,
            clusterSummary: [mergedCluster],
            tokenSummary: canonicalAfterMerge.base.tokenSummary,
            groupedClusters: [],
            approvedGroups: [],
          },
          mergeRule,
        ),
      ),
    );

    expect(mutationResult).toEqual({ status: 'accepted' });
    expect(clientA.result.current.tokenMergeRules.map((rule) => rule.id)).toEqual(['rule-1']);
    expect(clientA.result.current.results?.map((row) => row.tokens)).toEqual(['alpha', 'alpha']);
    expect(clientB.result.current.tokenMergeRules).toEqual([]);

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', canonicalAfterMerge.entities.meta);
    });

    await waitFor(() =>
      expect(clientB.result.current.tokenMergeRules.map((rule) => rule.id)).toEqual(['rule-1']),
    );
    expect(clientB.result.current.results?.map((row) => row.tokens)).toEqual(['alpha', 'alpha']);
    expect(collabMocks.commitCanonicalProjectState).toHaveBeenCalledTimes(1);
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

    let mutationResult: Awaited<ReturnType<typeof result.current.mergeGroupsByName>> | null = null;
    await act(async () => {
      mutationResult = await result.current.mergeGroupsByName({
        incoming: [incomingGroup],
        removedTokens: new Set(['alpha']),
        hasReviewApi: false,
        mergeFn: (_existing, incoming) => incoming,
      });
    });

    expect(mutationResult?.status).toBe('blocked');
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
    expect(runtimeTraceMocks.traceRuntimeEvent.mock.calls.some(([event]) =>
      event?.event === 'v2:canonical-load-complete' &&
      event?.source === 'useProjectPersistence.v2MetaListener' &&
      event?.data?.incoming?.datasetEpoch === 11,
    )).toBe(true);
    expect(runtimeTraceMocks.traceRuntimeEvent.mock.calls.some(([event]) =>
      event?.event === 'v2:canonical-apply' &&
      event?.source === 'useProjectPersistence.applyCanonicalState' &&
      event?.data?.incoming?.datasetEpoch === 11 &&
      event?.data?.before?.blockedTokenDocCount === 1,
    )).toBe(true);

    await act(async () => {
      epoch10.resolve(makeCanonical(10, ['epoch-10']));
      await epoch10.promise;
      await Promise.resolve();
    });

    expect(Array.from(result.current.blockedTokens)).toEqual(['epoch-11']);
    expect(runtimeTraceMocks.traceRuntimeEvent.mock.calls.some(([event]) =>
      event?.event === 'v2:canonical-load-drop' &&
      event?.source === 'useProjectPersistence.v2MetaListener' &&
      event?.data?.reason === 'generation-mismatch',
    )).toBe(true);
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

  it('blocks routine group edits while a newer meta epoch is still reloading', async () => {
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
    collabMocks.commitRevisionedDocChanges.mockResolvedValue([]);
    const epochReload = deferred<ReturnType<typeof makeCanonical>>();
    collabMocks.loadCanonicalEpoch.mockImplementationOnce(() => epochReload.promise);

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
      emitDocSnapshot('projects/project-1/collab/meta', makeMeta(2, 2));
    });

    await waitFor(() => expect(result.current.isCanonicalReloading).toBe(true));
    expect(result.current.writeBlockReason).toBe('canonical-unresolved');
    expect(result.current.isSharedProjectReadOnly).toBe(true);
    expect(result.current.isRoutineSharedEditBlocked).toBe(true);

    const newGroup: GroupedCluster = {
      id: 'group-1',
      groupName: 'Group 1',
      clusters: [cluster],
      totalVolume: 10,
      keywordCount: 1,
      avgKd: 20,
      avgKwRating: 1,
    };

    let mutationResult: Awaited<ReturnType<typeof result.current.addGroupsAndRemovePages>> | null = null;
    await act(async () => {
      mutationResult = await result.current.addGroupsAndRemovePages([newGroup], new Set(['alpha']));
    });

    expect(mutationResult).toEqual({ status: 'blocked', reason: 'canonical-unresolved' });
    expect(result.current.groupedClusters).toHaveLength(0);
    expect(collabMocks.commitRevisionedDocChanges).not.toHaveBeenCalled();

    await act(async () => {
      epochReload.resolve(makeCanonical(2));
      await epochReload.promise;
    });

    expect(result.current.isSharedProjectReadOnly).toBe(false);
    expect(result.current.isRoutineSharedEditBlocked).toBe(false);
  });

  it('keeps routine group edits writable while canonical reload stays on the last known writable base commit', async () => {
    const cluster = makeCluster('alpha', 'Alpha');
    const canonical = makeCanonical(1);
    canonical.base.clusterSummary = [cluster];
    canonical.base.results = [makeRow(cluster)];
    canonical.resolved.clusterSummary = [cluster];
    canonical.resolved.results = [makeRow(cluster)];
    collabMocks.loadCanonicalProjectState.mockResolvedValue(canonical);

    const epochReload = deferred<ReturnType<typeof makeCanonical>>();
    collabMocks.loadCanonicalEpoch.mockImplementationOnce(() => epochReload.promise);
    collabMocks.commitRevisionedDocChanges.mockImplementation(async (_projectId: string, _subcollection: string, changes: Array<any>) =>
      changes
        .filter((change: any) => change.kind === 'upsert')
        .map((change: any) => ({
          kind: 'upsert' as const,
          id: change.id,
          revision: change.expectedRevision + 1,
          lastMutationId: change.mutationId ?? null,
          value: {
            id: change.id,
            ...(change.value ?? {}),
            revision: change.expectedRevision + 1,
            updatedAt: '2026-03-30T00:00:00.000Z',
            updatedByClientId: 'client-a',
            lastMutationId: change.mutationId ?? null,
          },
        })),
    );

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
        clientIdOverride: 'client-a',
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

    await waitFor(() => expect(result.current.isCanonicalReloading).toBe(true));
    expect(result.current.writeBlockReason).toBeNull();
    expect(result.current.isSharedProjectReadOnly).toBe(false);
    expect(result.current.isRoutineSharedEditBlocked).toBe(false);

    const newGroup = makeGroup('group-1', 'Group 1', cluster);

    let mutationResult: Awaited<ReturnType<typeof result.current.addGroupsAndRemovePages>> | null = null;
    await act(async () => {
      mutationResult = await result.current.addGroupsAndRemovePages([newGroup], new Set(['alpha']));
    });

    expect(mutationResult?.status).toBe('accepted');
    expect(result.current.groupedClusters.map((group) => group.id)).toEqual(['group-1']);
    expect(result.current.clusterSummary).toEqual([]);
    await waitFor(() => expect(collabMocks.commitRevisionedDocChanges).toHaveBeenCalledTimes(1));

    const reloadedCanonical = makeCanonical(1);
    reloadedCanonical.base.clusterSummary = [cluster];
    reloadedCanonical.base.results = [makeRow(cluster)];
    reloadedCanonical.entities.groups = [{
      id: groupDocId(newGroup.id),
      groupName: newGroup.groupName,
      status: 'grouped',
      datasetEpoch: 1,
      clusterTokens: [cluster.tokens],
      lastWriterClientId: 'client-a',
      revision: 1,
      updatedAt: '2026-03-30T00:00:00.000Z',
      updatedByClientId: 'client-a',
      lastMutationId: 'mutation-1',
      pageCount: 1,
      totalVolume: newGroup.totalVolume,
      keywordCount: newGroup.keywordCount,
      avgKd: newGroup.avgKd,
      avgKwRating: newGroup.avgKwRating,
    }];
    reloadedCanonical.resolved.groupedClusters = [newGroup];
    reloadedCanonical.resolved.clusterSummary = [];
    reloadedCanonical.resolved.results = [];

    await act(async () => {
      epochReload.resolve(reloadedCanonical);
      await epochReload.promise;
    });

    expect(result.current.isCanonicalReloading).toBe(false);
    expect(result.current.isSharedProjectReadOnly).toBe(false);
    expect(result.current.isRoutineSharedEditBlocked).toBe(false);
    expect(result.current.groupedClusters.map((group) => group.id)).toEqual(['group-1']);
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
    expect(runtimeTraceMocks.traceRuntimeEvent.mock.calls.some(([event]) =>
      event?.event === 'v2:listener-skip-pending-writes' &&
      event?.source === 'useProjectPersistence.v2MetaListener' &&
      event?.data?.listener === 'collab/meta',
    )).toBe(true);
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

    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('Firestore blocked the fix'),
      'warning',
    );
  });

  it('keeps V2 fallback payloads in read-only shared mode instead of writable legacy mode', async () => {
    const addToast = vi.fn();
    collabMocks.loadCanonicalProjectState.mockResolvedValue({
      mode: 'legacy',
      base: null,
      entities: {
        groups: [],
        blockedTokens: [],
        manualBlockedKeywords: [],
        tokenMergeRules: [],
        labelSections: [],
        activityLog: [],
        meta: {
          ...makeMeta(1, 2),
          commitState: 'writing',
          migrationState: 'running',
        },
      },
      resolved: {
        results: [],
        clusterSummary: [],
        tokenSummary: [],
        groupedClusters: [],
        approvedGroups: [],
        blockedTokens: ['cached'],
        blockedKeywords: [],
        labelSections: [],
        activityLog: [],
        tokenMergeRules: [],
        autoGroupSuggestions: [],
        autoMergeRecommendations: [],
        groupMergeRecommendations: [],
        stats: null,
        datasetStats: null,
        updatedAt: '2026-03-31T00:00:00.000Z',
        lastSaveId: 0,
      },
      diagnostics: {
        recovery: {
          attempted: true,
          outcome: 'failed',
          code: 'permission-denied',
          step: 'repair collab meta',
        },
      },
    } as any);

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
    expect(result.current.isSharedProjectReadOnly).toBe(true);
    expect(Array.from(result.current.blockedTokens)).toEqual(['cached']);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(
      expect.stringMatching(/Firestore blocked the fix|last local copy/i),
      'warning',
    );

    await act(async () => {
      await result.current.bulkSet({
        results: [{ tokens: 'alpha' } as any],
        fileName: 'Should stay read-only',
      });
    });

    expect(storageMocks.saveProjectDataToFirestore).not.toHaveBeenCalled();
    expect(collabMocks.commitRevisionedDocChanges).not.toHaveBeenCalled();
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
    await act(async () => {
      await result.current.blockTokens(['Alpha']);
    });
    expect(Array.from(result.current.blockedTokens)).toEqual(['remote']);

    await waitFor(() => expect(Array.from(result.current.blockedTokens)).toEqual(['remote']));
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('Another client changed this project item'),
      'warning',
    );
  });

  it('does not expose fake local blocked-token success before conflict reload completes', async () => {
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

    await act(async () => {
      await result.current.blockTokens(['Alpha']);
    });

    expect(Array.from(result.current.blockedTokens)).toEqual([]);
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
    expect(runtimeTraceMocks.traceRuntimeEvent.mock.calls.some(([event]) =>
      event?.event === 'v2:listener-skip-pending-writes' &&
      event?.source === 'useProjectPersistence.v2EntityListener' &&
      event?.data?.listener === PROJECT_BLOCKED_TOKENS_SUBCOLLECTION,
    )).toBe(true);
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

    await act(async () => {
      const mutationPromise = result.current.blockTokens(['Alpha']);
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
      await mutationPromise;
    });

    let flushed = false;
    const flushPromise = result.current.flushNow().then(() => {
      flushed = true;
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
    expect(runtimeTraceMocks.traceRuntimeEvent.mock.calls.some(([event]) =>
      event?.event === 'v2:listener-drop' &&
      event?.source === 'useProjectPersistence.v2EntityListener' &&
      event?.data?.listener === PROJECT_BLOCKED_TOKENS_SUBCOLLECTION &&
      event?.data?.reason === 'project-switch',
    )).toBe(true);
  });

  it('clears projectLoadingRef after loadProject failure so legacy chunk snapshots are not stuck on guard 1a', async () => {
    collabMocks.loadCanonicalProjectState.mockRejectedValueOnce(new Error('canonical boom'));
    storageMocks.buildProjectDataPayloadFromChunkDocs.mockImplementation(buildProjectDataPayloadFromChunkDocs);
    try {
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
        await expect(result.current.loadProject('project-1', PROJECTS)).rejects.toThrow('canonical boom');
      });

      await waitFor(() =>
        expect(firestoreMocks.listeners.has('projects/project-1/chunks')).toBe(true),
      );

      const cluster: ClusterSummary = {
        pageName: 'Snap Page',
        pageNameLower: 'snap page',
        pageNameLen: 9,
        tokens: 'snap',
        tokenArr: ['snap'],
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

      act(() => {
        emitLegacyChunksSnapshot('project-1', {
          clusterSummary: [cluster],
        });
      });

      await waitFor(() => expect(result.current.clusterSummary?.map((c) => c.tokens)).toEqual(['snap']));
    } finally {
      storageMocks.buildProjectDataPayloadFromChunkDocs.mockReset();
      storageMocks.buildProjectDataPayloadFromChunkDocs.mockImplementation((_docs: Array<{ data: () => unknown }>) => null);
    }
  });

  it('live collab meta loss keeps shared projects on the V2 path and re-runs canonical load', async () => {
    workspaceMocks.loadProjectDataForView.mockResolvedValue({
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
      lastSaveId: 42,
    });

    collabMocks.loadCanonicalProjectState
      .mockResolvedValueOnce(makeCanonical(1))
      .mockResolvedValueOnce({
        ...makeCanonical(1),
        mode: 'v2' as const,
        entities: {
          ...makeCanonical(1).entities,
          meta: null,
        },
      });

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: SHARED_PROJECTS,
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveProjectId('project-1');
    });

    await act(async () => {
      await result.current.loadProject('project-1', SHARED_PROJECTS);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await flush();
    await waitFor(() =>
      expect(firestoreMocks.listeners.has('projects/project-1/collab/meta')).toBe(true),
    );

    const canonicalCallsBeforeMetaLoss = collabMocks.loadCanonicalProjectState.mock.calls.length;

    act(() => {
      emitDocSnapshot('projects/project-1/collab/meta', null);
    });

    await waitFor(() => expect(result.current.storageMode).toBe('v2'));
    await waitFor(() =>
      expect(collabMocks.loadCanonicalProjectState.mock.calls.length).toBeGreaterThan(canonicalCallsBeforeMetaLoss),
    );
    expect(firestoreMocks.listeners.has('projects/project-1/chunks')).toBe(false);
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
