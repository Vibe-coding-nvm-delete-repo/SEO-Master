import { describe, expect, it } from 'vitest';
import {
  buildProjectDataPayloadFromChunkDocs,
  countGroupedPages,
  pickNewerProjectPayload,
  type ProjectDataPayload,
} from './projectStorage';

describe('buildProjectDataPayloadFromChunkDocs', () => {
  it('preserves explicit empty results and cluster arrays when meta says there are zero chunks', () => {
    const payload = buildProjectDataPayloadFromChunkDocs([
      {
        data: () => ({
          type: 'meta',
          stats: null,
          datasetStats: null,
          tokenSummary: [],
          groupedClusters: [{ id: 'g1', groupName: 'Grouped Only', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
          approvedGroups: [],
          blockedTokens: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          resultChunkCount: 0,
          clusterChunkCount: 0,
          blockedChunkCount: 0,
          suggestionChunkCount: 0,
        }),
      },
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.results).toEqual([]);
    expect(payload?.clusterSummary).toEqual([]);
    expect(payload?.groupedClusters).toHaveLength(1);
    expect(payload?.groupedClusters[0].groupName).toBe('Grouped Only');
  });

  it('reconstructs groupedClusters from grouped chunk docs when meta lacks groupedClusters', () => {
    const payload = buildProjectDataPayloadFromChunkDocs([
      {
        data: () => ({
          type: 'meta',
          stats: null,
          datasetStats: null,
          tokenSummary: [],
          // new scheme: groupedClusters removed from meta
          groupedClusterCount: 2,
          approvedGroupCount: 0,
          blockedTokens: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          resultChunkCount: 0,
          clusterChunkCount: 0,
          blockedChunkCount: 0,
          suggestionChunkCount: 0,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'grouped',
          index: 0,
          data: [
            { id: 'g1', groupName: 'G1', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null },
          ],
        }),
      },
      {
        data: () => ({
          type: 'grouped',
          index: 1,
          data: [
            { id: 'g2', groupName: 'G2', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null },
          ],
        }),
      },
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.groupedClusters.map(g => g.id)).toEqual(['g1', 'g2']);
    expect(payload?.approvedGroups).toEqual([]);
  });

  it('includes all grouped chunk docs when meta chunk count is stale (multi-batch write race)', () => {
    const payload = buildProjectDataPayloadFromChunkDocs([
      {
        data: () => ({
          type: 'meta',
          stats: null,
          datasetStats: null,
          tokenSummary: [],
          groupedClusterCount: 1,
          approvedGroupCount: 0,
          blockedTokens: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          resultChunkCount: 0,
          clusterChunkCount: 0,
          blockedChunkCount: 0,
          suggestionChunkCount: 0,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'grouped',
          index: 0,
          data: [{ id: 'a', groupName: 'A', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
        }),
      },
      {
        data: () => ({
          type: 'grouped',
          index: 1,
          data: [{ id: 'b', groupName: 'B', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
        }),
      },
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.groupedClusters.map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('returns null when meta expects more grouped chunks than are visible yet (partial snapshot)', () => {
    const payload = buildProjectDataPayloadFromChunkDocs([
      {
        data: () => ({
          type: 'meta',
          stats: null,
          datasetStats: null,
          tokenSummary: [],
          groupedClusterCount: 3,
          approvedGroupCount: 0,
          blockedTokens: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          resultChunkCount: 0,
          clusterChunkCount: 0,
          blockedChunkCount: 0,
          suggestionChunkCount: 0,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'grouped',
          index: 0,
          data: [{ id: 'only', groupName: 'Only', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
        }),
      },
    ]);

    expect(payload).toBeNull();
  });

  it('returns null when grouped chunk saveId mismatches meta.saveId', () => {
    const payload = buildProjectDataPayloadFromChunkDocs([
      {
        data: () => ({
          type: 'meta',
          stats: null,
          datasetStats: null,
          tokenSummary: [],
          groupedClusterCount: 1,
          approvedGroupCount: 0,
          blockedTokens: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          resultChunkCount: 0,
          clusterChunkCount: 0,
          blockedChunkCount: 0,
          suggestionChunkCount: 0,
          saveId: 123,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'grouped',
          index: 0,
          saveId: 122,
          data: [{ id: 'only', groupName: 'Only', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
        }),
      },
    ]);

    expect(payload).toBeNull();
  });

  it('returns null when grouped chunk saveId is missing but meta.saveId is set', () => {
    const payload = buildProjectDataPayloadFromChunkDocs([
      {
        data: () => ({
          type: 'meta',
          stats: null,
          datasetStats: null,
          tokenSummary: [],
          groupedClusterCount: 1,
          approvedGroupCount: 0,
          blockedTokens: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          resultChunkCount: 0,
          clusterChunkCount: 0,
          blockedChunkCount: 0,
          suggestionChunkCount: 0,
          saveId: 123,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'grouped',
          index: 0,
          // no saveId field -> treated as mismatched to meta.saveId
          data: [{ id: 'only', groupName: 'Only', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
        }),
      },
    ]);

    expect(payload).toBeNull();
  });

  it('sets lastSaveId from meta.saveId when reconstructing', () => {
    const payload = buildProjectDataPayloadFromChunkDocs([
      {
        data: () => ({
          type: 'meta',
          stats: null,
          datasetStats: null,
          tokenSummary: [],
          groupedClusterCount: 0,
          approvedGroupCount: 0,
          blockedTokens: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          resultChunkCount: 0,
          clusterChunkCount: 0,
          blockedChunkCount: 0,
          suggestionChunkCount: 0,
          saveId: 42,
          updatedAt: '2025-01-01T00:00:00.000Z',
        }),
      },
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.lastSaveId).toBe(42);
  });
});

describe('pickNewerProjectPayload', () => {
  const emptyPayload = (): ProjectDataPayload => ({
    results: [],
    clusterSummary: [],
    tokenSummary: null,
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
    updatedAt: '2025-01-01T00:00:00.000Z',
  });

  it('prefers higher lastSaveId', () => {
    const a = { ...emptyPayload(), lastSaveId: 1 };
    const b = { ...emptyPayload(), lastSaveId: 9 };
    expect(pickNewerProjectPayload(a, b)).toBe(b);
    expect(pickNewerProjectPayload(b, a)).toBe(b);
  });

  it('ties on lastSaveId then prefers newer updatedAt', () => {
    const a = { ...emptyPayload(), lastSaveId: 3, updatedAt: '2025-01-01T00:00:00.000Z' };
    const b = { ...emptyPayload(), lastSaveId: 3, updatedAt: '2025-06-01T00:00:00.000Z' };
    expect(pickNewerProjectPayload(a, b)).toBe(b);
  });

  it('ties on lastSaveId and updatedAt prefers Firestore (second arg)', () => {
    const base = { ...emptyPayload(), lastSaveId: 3, updatedAt: '2025-01-01T00:00:00.000Z' };
    const idb = { ...base };
    const fs = { ...base };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('prefers Firestore when IDB has higher saveId but no rows and Firestore has CSV (legacy saveId 0)', () => {
    const idb = { ...emptyPayload(), lastSaveId: 15, results: [], clusterSummary: [] };
    const fs = {
      ...emptyPayload(),
      lastSaveId: undefined,
      results: [{ tokens: 'a' } as any],
      clusterSummary: [],
    };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('prefers Firestore when IDB has higher saveId but fewer groups (legacy saveId 0)', () => {
    const idb = {
      ...emptyPayload(),
      lastSaveId: 20,
      groupedClusters: [{ id: 'g1' } as any],
      approvedGroups: [],
    };
    const fs = {
      ...emptyPayload(),
      lastSaveId: undefined,
      groupedClusters: [{ id: 'a' } as any, { id: 'b' } as any],
      approvedGroups: [],
    };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('adjacent saveIds: prefers more grouped pages over higher lastSaveId (refresh data-loss fix)', () => {
    const mkCluster = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ tokens: `t${i}`, pageName: `p${i}` }));
    const idb = {
      ...emptyPayload(),
      lastSaveId: 100,
      groupedClusters: [{ id: 'bad', clusters: mkCluster(30) } as any],
      approvedGroups: [],
    };
    const fs = {
      ...emptyPayload(),
      lastSaveId: 99,
      groupedClusters: [{ id: 'good', clusters: mkCluster(350) } as any],
      approvedGroups: [],
    };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });
});

describe('countGroupedPages', () => {
  it('counts all clusters across grouped and approved', () => {
    const groupedClusters = [{ id: 'g1', clusters: [{}, {}, {}] } as any];
    const approvedGroups = [{ id: 'a1', clusters: [{}, {}] } as any];
    expect(countGroupedPages({ groupedClusters, approvedGroups })).toBe(5);
  });

  it('handles null/undefined collections safely', () => {
    expect(countGroupedPages({ groupedClusters: null, approvedGroups: undefined })).toBe(0);
  });
});
