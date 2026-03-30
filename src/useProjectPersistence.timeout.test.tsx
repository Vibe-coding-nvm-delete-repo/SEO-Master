import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveCloudStatusLine,
  getCloudSyncSnapshot,
  resetCloudSyncStateForTests,
} from './cloudSyncStatus';

const storageMocks = vi.hoisted(() => ({
  saveToIDB: vi.fn(),
  saveProjectDataToFirestore: vi.fn(),
  saveProjectToFirestore: vi.fn(),
  buildProjectDataPayloadFromChunkDocs: vi.fn(() => null),
  countGroupedPages: vi.fn(() => 0),
  groupedPageMass: vi.fn(() => 0),
}));

vi.mock('./firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ path: 'projects/mock/chunks' })),
  onSnapshot: vi.fn(() => () => {}),
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
  loadProjectDataForView: vi.fn(async () => null),
  toProjectViewState: vi.fn(() => ({
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

import {
  PROJECT_CLOUD_WRITE_TIMEOUT_MS,
  PROJECT_LOCAL_WRITE_TIMEOUT_MS,
  useProjectPersistence,
} from './useProjectPersistence';

describe('useProjectPersistence stalled local writes', () => {
  beforeEach(() => {
    resetCloudSyncStateForTests();
    storageMocks.saveToIDB.mockReset();
    storageMocks.saveProjectDataToFirestore.mockReset();
    storageMocks.saveProjectToFirestore.mockReset();
    storageMocks.saveToIDB.mockResolvedValue(undefined);
    storageMocks.saveProjectDataToFirestore.mockResolvedValue(undefined);
    storageMocks.saveProjectToFirestore.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out IDB writes, clears saving banner, and still flushes cloud writes', async () => {
    storageMocks.saveToIDB.mockReturnValue(new Promise<void>(() => {
      /* never resolves */
    }));

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: [{ id: 'proj_1', name: 'P1', description: '', uid: 'u', createdAt: new Date().toISOString() }],
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    const row = {
      keyword: 'loan',
      keywordLower: 'loan',
      searchVolume: 100,
      kd: 12,
      pageName: 'loan page',
      pageNameLower: 'loan page',
      pageNameLen: 9,
      tokens: 'loan page',
      tokenArr: ['loan', 'page'],
      label: '',
      labelArr: [],
      locationCity: '',
      locationState: '',
    };

    act(() => {
      result.current.setActiveProjectId('proj_1');
    });

    act(() => {
      result.current.bulkSet({
        results: [row],
        clusterSummary: [],
      });
    });

    await vi.advanceTimersByTimeAsync(PROJECT_LOCAL_WRITE_TIMEOUT_MS + 5);
    const flushPromise = act(async () => {
      await result.current.flushNow();
    });
    await vi.advanceTimersByTimeAsync(PROJECT_LOCAL_WRITE_TIMEOUT_MS + 5);
    await flushPromise;

    expect(storageMocks.saveProjectDataToFirestore).toHaveBeenCalled();
    const snap = getCloudSyncSnapshot();
    expect(snap.local.pendingCount).toBe(0);
    expect(snap.project.flushDepth).toBe(0);
    expect(deriveCloudStatusLine(true, snap, true).label).not.toContain('Saving');
  }, 20_000);

  it('times out hung Firestore writes, clears pending state, and retries on the next save', async () => {
    storageMocks.saveProjectDataToFirestore.mockImplementationOnce(
      () => new Promise<void>(() => {
        /* never resolves */
      }),
    );

    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: [{ id: 'proj_1', name: 'P1', description: '', uid: 'u', createdAt: new Date().toISOString() }],
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    const row = {
      keyword: 'loan',
      keywordLower: 'loan',
      searchVolume: 100,
      kd: 12,
      pageName: 'loan page',
      pageNameLower: 'loan page',
      pageNameLen: 9,
      tokens: 'loan page',
      tokenArr: ['loan', 'page'],
      label: '',
      labelArr: [],
      locationCity: '',
      locationState: '',
    };

    act(() => {
      result.current.setActiveProjectId('proj_1');
    });

    act(() => {
      result.current.bulkSet({
        results: [row],
        clusterSummary: [],
      });
    });

    const firstFlushPromise = act(async () => {
      await result.current.flushNow();
    });
    await vi.advanceTimersByTimeAsync(PROJECT_CLOUD_WRITE_TIMEOUT_MS + 5);
    await firstFlushPromise;

    let snap = getCloudSyncSnapshot();
    expect(snap.local.pendingCount).toBe(0);
    expect(snap.project.flushDepth).toBe(0);
    expect(snap.project.cloudWritePendingCount).toBe(0);
    expect(snap.project.writeFailed).toBe(true);
    expect(deriveCloudStatusLine(true, snap, true).label).toContain('failed');

    act(() => {
      result.current.bulkSet({
        results: [row, { ...row, keyword: 'loan rates', keywordLower: 'loan rates' }],
        clusterSummary: [],
      });
    });

    const secondFlushPromise = act(async () => {
      await result.current.flushNow();
    });
    await secondFlushPromise;

    snap = getCloudSyncSnapshot();
    expect(storageMocks.saveProjectDataToFirestore).toHaveBeenCalledTimes(2);
    expect(snap.project.flushDepth).toBe(0);
    expect(snap.project.cloudWritePendingCount).toBe(0);
    expect(snap.project.writeFailed).toBe(false);
    expect(deriveCloudStatusLine(true, snap, true).label).not.toContain('Saving');
    expect(deriveCloudStatusLine(true, snap, true).label).not.toContain('failed');
  }, 40_000);
});
