import { describe, expect, it } from 'vitest';
import {
  buildProjectDataPayloadFromChunkDocs,
  countGroupedPages,
  pickNewerProjectPayload,
  projectFromFirestoreData,
  projectMetaForFirestore,
  sanitizeJsonForFirestore,
  type ProjectDataPayload,
} from './projectStorage';
import type { Project } from './types';

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
          autoMergeChunkCount: 0,
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
          autoMergeChunkCount: 0,
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
          autoMergeChunkCount: 0,
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
          autoMergeChunkCount: 0,
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
          autoMergeChunkCount: 0,
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
          autoMergeChunkCount: 0,
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
          autoMergeChunkCount: 0,
          saveId: 42,
          updatedAt: '2025-01-01T00:00:00.000Z',
        }),
      },
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.lastSaveId).toBe(42);
  });

  it('reconstructs auto-merge recommendations from auto_merge chunks', () => {
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
          autoMergeChunkCount: 1,
          groupMergeChunkCount: 0,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'auto_merge',
          index: 0,
          data: [{
            id: 'auto_merge_a',
            sourceToken: 'a',
            canonicalToken: 'a',
            mergeTokens: ['aa'],
            confidence: 0.95,
            reason: 'variant',
            affectedKeywordCount: 5,
            affectedPageCount: 2,
            affectedKeywords: ['a one'],
            status: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
          }],
        }),
      },
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.autoMergeRecommendations).toHaveLength(1);
    expect(payload?.autoMergeRecommendations?.[0].canonicalToken).toBe('a');
  });

  it('returns null when meta expects auto_merge chunks but none are visible yet', () => {
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
          autoMergeChunkCount: 2,
          updatedAt: new Date().toISOString(),
        }),
      },
    ]);
    expect(payload).toBeNull();
  });

  it('returns null when visible auto_merge chunk span is smaller than meta count', () => {
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
          autoMergeChunkCount: 3,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'auto_merge',
          index: 0,
          data: [],
        }),
      },
      {
        data: () => ({
          type: 'auto_merge',
          index: 1,
          data: [],
        }),
      },
    ]);
    expect(payload).toBeNull();
  });

  it('includes all visible auto_merge chunks when meta chunk count is stale lower', () => {
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
          autoMergeChunkCount: 1,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'auto_merge',
          index: 0,
          data: [{
            id: 'in',
            sourceToken: 'a',
            canonicalToken: 'a',
            mergeTokens: ['aa'],
            confidence: 1,
            reason: '',
            affectedKeywordCount: 1,
            affectedPageCount: 1,
            affectedKeywords: [],
            status: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
          }],
        }),
      },
      {
        data: () => ({
          type: 'auto_merge',
          index: 5,
          data: [{
            id: 'out',
            sourceToken: 'b',
            canonicalToken: 'b',
            mergeTokens: ['bb'],
            confidence: 1,
            reason: '',
            affectedKeywordCount: 1,
            affectedPageCount: 1,
            affectedKeywords: [],
            status: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
          }],
        }),
      },
    ]);
    expect(payload).not.toBeNull();
    expect(payload?.autoMergeRecommendations?.map(r => r.id)).toEqual(['in', 'out']);
  });

  it('reconstructs group auto-merge recommendations from group_merge chunks', () => {
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
          autoMergeChunkCount: 0,
          groupMergeChunkCount: 1,
          updatedAt: new Date().toISOString(),
        }),
      },
      {
        data: () => ({
          type: 'group_merge',
          index: 0,
          data: [{
            id: 'g1__g2',
            sourceFingerprint: 'fp_1',
            groupA: { id: 'g1', name: 'Car Loans', pageCount: 2, totalVolume: 1000, locationSummary: 'National / non-local' },
            groupB: { id: 'g2', name: 'Auto Loans', pageCount: 3, totalVolume: 1500, locationSummary: 'National / non-local' },
            similarity: 0.95,
            exactNameMatch: false,
            sharedPageNameCount: 1,
            locationCompatible: true,
            status: 'pending',
            createdAt: '2026-03-30T00:00:00.000Z',
          }],
        }),
      },
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.groupMergeRecommendations).toHaveLength(1);
    expect(payload?.groupMergeRecommendations?.[0].id).toBe('g1__g2');
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
    autoMergeRecommendations: [],
    groupMergeRecommendations: [],
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

  it('prefers IDB when it has a valid saveId and Firestore is legacy (saveId 0) even with fewer groups', () => {
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
    // IDB has data (1 group) and a valid saveId; Firestore is legacy — trust IDB.
    expect(pickNewerProjectPayload(idb, fs)).toBe(idb);
  });

  it('prefers IDB when lastSaveId is ahead even with fewer grouped pages (ungroup before cloud flush)', () => {
    const mkCluster = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ tokens: `t${i}`, pageName: `p${i}` }));
    const idb = {
      ...emptyPayload(),
      lastSaveId: 101,
      updatedAt: '2025-06-02T12:00:00.000Z',
      groupedClusters: [{ id: 'g1', clusters: mkCluster(10) } as any],
      approvedGroups: [],
    };
    const fs = {
      ...emptyPayload(),
      lastSaveId: 99,
      updatedAt: '2025-06-01T00:00:00.000Z',
      groupedClusters: [{ id: 'g1', clusters: mkCluster(350) } as any],
      approvedGroups: [],
    };
    expect(pickNewerProjectPayload(idb, fs)).toBe(idb);
  });

  it('REGRESSION: ungroup + unblock + refresh — IDB with higher saveId but fewer groups MUST win over Firestore', () => {
    const mkCluster = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ tokens: `t${i}`, pageName: `p${i}` }));
    const idb = {
      ...emptyPayload(),
      lastSaveId: 56,
      updatedAt: '2025-06-02T12:01:00.000Z',
      groupedClusters: [{ id: 'g1', clusters: mkCluster(5) } as any],
      approvedGroups: [],
      blockedTokens: [],
    };
    const fs = {
      ...emptyPayload(),
      lastSaveId: 50,
      updatedAt: '2025-06-02T12:00:00.000Z',
      groupedClusters: [
        { id: 'g1', clusters: mkCluster(50) } as any,
        { id: 'g2', clusters: mkCluster(30) } as any,
        { id: 'g3', clusters: mkCluster(20) } as any,
      ],
      approvedGroups: [],
      blockedTokens: ['tok1', 'tok2'],
    };
    // IDB has higher saveId (user did 6 mutations: ungroup + unblock + activity entries).
    // It intentionally has fewer groups and fewer blocked tokens. Must win.
    expect(pickNewerProjectPayload(idb, fs)).toBe(idb);
  });

  it('prefers Firestore when IDB is legacy (saveId 0) and empty but Firestore has data', () => {
    const idb = {
      ...emptyPayload(),
      lastSaveId: undefined,
      results: [],
      clusterSummary: [],
    };
    const fs = {
      ...emptyPayload(),
      lastSaveId: 10,
      results: [{ tokens: 'a' } as any],
      clusterSummary: [],
    };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('both sides saveId 0: uses timestamp tiebreaker (Firestore newer wins)', () => {
    const idb = { ...emptyPayload(), lastSaveId: undefined, updatedAt: '2025-01-01T00:00:00.000Z' };
    const fs = { ...emptyPayload(), lastSaveId: undefined, updatedAt: '2025-06-01T00:00:00.000Z' };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('both sides saveId 0: uses timestamp tiebreaker (IDB newer wins)', () => {
    const idb = { ...emptyPayload(), lastSaveId: undefined, updatedAt: '2025-09-01T00:00:00.000Z' };
    const fs = { ...emptyPayload(), lastSaveId: undefined, updatedAt: '2025-01-01T00:00:00.000Z' };
    expect(pickNewerProjectPayload(idb, fs)).toBe(idb);
  });

  it('both sides saveId 0 and identical timestamps: Firestore wins as shared source of truth', () => {
    const ts = '2025-05-15T12:00:00.000Z';
    const idb = { ...emptyPayload(), lastSaveId: undefined, updatedAt: ts };
    const fs = { ...emptyPayload(), lastSaveId: undefined, updatedAt: ts };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('equal saveId but Firestore has newer timestamp: Firestore wins', () => {
    const idb = { ...emptyPayload(), lastSaveId: 50, updatedAt: '2025-01-01T00:00:00.000Z' };
    const fs = { ...emptyPayload(), lastSaveId: 50, updatedAt: '2025-06-01T00:00:00.000Z' };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('equal saveId but IDB has newer timestamp: IDB wins', () => {
    const idb = { ...emptyPayload(), lastSaveId: 50, updatedAt: '2025-09-01T00:00:00.000Z' };
    const fs = { ...emptyPayload(), lastSaveId: 50, updatedAt: '2025-01-01T00:00:00.000Z' };
    expect(pickNewerProjectPayload(idb, fs)).toBe(idb);
  });

  it('equal saveId and identical timestamps: Firestore wins', () => {
    const ts = '2025-05-15T12:00:00.000Z';
    const idb = { ...emptyPayload(), lastSaveId: 50, updatedAt: ts };
    const fs = { ...emptyPayload(), lastSaveId: 50, updatedAt: ts };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('IDB has data but legacy saveId; Firestore is empty but has saveId: IDB wins', () => {
    const idb = {
      ...emptyPayload(),
      lastSaveId: undefined,
      results: [{ tokens: 'a' } as any],
      groupedClusters: [{ id: 'g1' } as any],
    };
    const fs = { ...emptyPayload(), lastSaveId: 5 };
    expect(pickNewerProjectPayload(idb, fs)).toBe(idb);
  });

  it('Firestore higher saveId wins when both sides have data', () => {
    const idb = {
      ...emptyPayload(),
      lastSaveId: 10,
      results: Array.from({ length: 1000 }, (_, i) => ({ tokens: `t${i}` } as any)),
    };
    const fs = {
      ...emptyPayload(),
      lastSaveId: 20,
      results: [{ tokens: 'fewer' } as any],
    };
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
  });

  it('REGRESSION: never prefer empty data over real data regardless of saveId (clearProject race)', () => {
    // IDB was corrupted by a clearProject race — empty with high saveId.
    // Firestore has the real data with a lower saveId.
    const idb = { ...emptyPayload(), lastSaveId: 438 };
    const fs = {
      ...emptyPayload(),
      lastSaveId: 200,
      results: Array.from({ length: 7175 }, (_, i) => ({ tokens: `t${i}` } as any)),
      clusterSummary: Array.from({ length: 4082 }, (_, i) => ({ token: `c${i}` } as any)),
    };
    // Must prefer Firestore because IDB is completely empty — corrupt artifact.
    expect(pickNewerProjectPayload(idb, fs)).toBe(fs);
    // And the reverse: empty Firestore should not beat IDB with data.
    expect(pickNewerProjectPayload(fs, idb)).toBe(fs);
  });
});

describe('sanitizeJsonForFirestore', () => {
  it('drops nested undefined so Firestore batch.set accepts the payload', () => {
    const dirty = {
      a: 1,
      nested: { keep: 'x', drop: undefined },
      arr: [{ ok: true, bad: undefined }],
    };
    const clean = sanitizeJsonForFirestore(dirty);
    expect(clean).toEqual({
      a: 1,
      nested: { keep: 'x' },
      arr: [{ ok: true }],
    });
  });

  it('normalizes non-finite numbers so Firestore-safe payloads do not contain NaN', () => {
    const dirty = {
      cost: Number.NaN,
      nested: {
        promptTokens: Number.POSITIVE_INFINITY,
        completionTokens: Number.NEGATIVE_INFINITY,
      },
    };
    const clean = sanitizeJsonForFirestore(dirty);
    expect(clean).toEqual({
      cost: null,
      nested: {
        promptTokens: null,
        completionTokens: null,
      },
    });
  });
});

describe('projectFromFirestoreData / projectMetaForFirestore', () => {
  it('round-trips folder and deleted metadata', () => {
    const p = projectFromFirestoreData('abc', {
      name: 'N',
      description: 'D',
      createdAt: '2020-01-01T00:00:00.000Z',
      uid: 'u',
      folderId: 'fld1',
      deletedAt: '2020-02-01T00:00:00.000Z',
    });
    expect(p.id).toBe('abc');
    expect(p.folderId).toBe('fld1');
    expect(p.deletedAt).toBe('2020-02-01T00:00:00.000Z');

    const meta = projectMetaForFirestore(p as Project);
    expect(meta.folderId).toBe('fld1');
    expect(meta.deletedAt).toBe('2020-02-01T00:00:00.000Z');
  });

  it('treats missing folder as null in Firestore payload', () => {
    const p = projectFromFirestoreData('x', { name: 'A', description: '', createdAt: '2020-01-01T00:00:00.000Z', uid: 'u' });
    const meta = projectMetaForFirestore(p as Project);
    expect(meta.folderId).toBeNull();
    expect(meta.deletedAt).toBeNull();
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
