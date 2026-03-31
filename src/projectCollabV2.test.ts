import { describe, expect, it } from 'vitest';
import {
  assembleCanonicalPayload,
  buildBaseSnapshotFromResolvedPayload,
  buildEntityStateFromResolvedPayload,
  buildGroupDocChanges,
  buildManualBlockedKeywordDocChanges,
  type ProjectCollabEntityState,
} from './projectCollabV2';
import type { ProjectDataPayload } from './projectStorage';
import type { BlockedKeyword, ClusterSummary, GroupedCluster, ProjectGroupDoc } from './types';

function makeCluster(tokens: string, pageName = tokens): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: 1,
    totalVolume: 100,
    avgKd: 10,
    avgKwRating: 1,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
    keywords: [
      {
        keyword: `${pageName} keyword`,
        volume: 100,
        kd: 10,
        locationCity: null,
        locationState: null,
        kwRating: 1,
      },
    ],
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

function makePayload(): ProjectDataPayload {
  const alpha = makeCluster('alpha', 'Alpha');
  const beta = makeCluster('beta', 'Beta');
  return {
    results: [
      {
        pageName: alpha.pageName,
        pageNameLower: alpha.pageNameLower,
        pageNameLen: alpha.pageNameLen,
        tokens: alpha.tokens,
        tokenArr: alpha.tokenArr,
        keyword: alpha.keywords[0].keyword,
        keywordLower: alpha.keywords[0].keyword.toLowerCase(),
        searchVolume: alpha.keywords[0].volume,
        kd: alpha.keywords[0].kd,
        label: alpha.label,
        labelArr: alpha.labelArr,
        locationCity: null,
        locationState: null,
        kwRating: 1,
      },
      {
        pageName: beta.pageName,
        pageNameLower: beta.pageNameLower,
        pageNameLen: beta.pageNameLen,
        tokens: beta.tokens,
        tokenArr: beta.tokenArr,
        keyword: beta.keywords[0].keyword,
        keywordLower: beta.keywords[0].keyword.toLowerCase(),
        searchVolume: beta.keywords[0].volume,
        kd: beta.keywords[0].kd,
        label: beta.label,
        labelArr: beta.labelArr,
        locationCity: null,
        locationState: null,
        kwRating: 1,
      },
    ],
    clusterSummary: [alpha, beta],
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
    lastSaveId: 7,
  };
}

describe('projectCollabV2', () => {
  it('assembles canonical payload from base plus entity overlays', () => {
    const payload = makePayload();
    const base = buildBaseSnapshotFromResolvedPayload(payload);
    const entities = buildEntityStateFromResolvedPayload(payload, 'client-a', base.datasetEpoch);
    const alphaGroup = makeGroup('group-alpha', 'Alpha Group', makeCluster('alpha', 'Alpha'));

    const overlay: ProjectCollabEntityState = {
      ...entities,
      groups: [
        {
          id: alphaGroup.id,
          groupName: alphaGroup.groupName,
          status: 'grouped',
          datasetEpoch: base.datasetEpoch,
          clusterTokens: alphaGroup.clusters.map((cluster) => cluster.tokens),
          clusters: alphaGroup.clusters,
          pageCount: 1,
          totalVolume: alphaGroup.totalVolume,
          keywordCount: alphaGroup.keywordCount,
          avgKd: alphaGroup.avgKd,
          avgKwRating: alphaGroup.avgKwRating,
          revision: 1,
          updatedAt: '2026-03-30T00:00:00.000Z',
          updatedByClientId: 'client-a',
          lastMutationId: 'm1',
        },
      ],
      blockedTokens: [
        {
          id: 'blocked-beta',
          token: 'beta',
          datasetEpoch: base.datasetEpoch,
          revision: 1,
          updatedAt: '2026-03-30T00:00:00.000Z',
          updatedByClientId: 'client-a',
          lastMutationId: 'm2',
        },
      ],
      manualBlockedKeywords: [
        {
          id: 'blocked-keyword',
          datasetEpoch: base.datasetEpoch,
          keyword: 'manual keyword',
          volume: 50,
          kd: 5,
          kwRating: 2,
          reason: 'manual',
          tokenArr: ['beta'],
          revision: 1,
          updatedAt: '2026-03-30T00:00:00.000Z',
          updatedByClientId: 'client-a',
          lastMutationId: 'm3',
        },
      ],
    };

    const resolved = assembleCanonicalPayload(base, overlay);

    expect(resolved?.groupedClusters.map((group) => group.id)).toEqual(['group-alpha']);
    expect(resolved?.clusterSummary?.map((cluster) => cluster.tokens)).toEqual(['beta']);
    expect(resolved?.results?.map((row) => row.tokens)).toEqual(['beta']);
    expect(resolved?.blockedTokens).toEqual(['beta']);
    expect(resolved?.blockedKeywords).toEqual([
      {
        keyword: 'manual keyword',
        volume: 50,
        kd: 5,
        kwRating: 2,
        reason: 'manual',
        tokenArr: ['beta'],
      },
    ]);
  });

  it('buildGroupDocChanges emits upsert and delete diffs by stable group id', () => {
    const cluster = makeCluster('alpha', 'Alpha');
    const previous: ProjectGroupDoc[] = [
      {
        id: 'group-1',
        groupName: 'Old Name',
        status: 'grouped',
        datasetEpoch: 3,
        clusterTokens: ['alpha'],
        clusters: [cluster],
        pageCount: 1,
        totalVolume: 100,
        keywordCount: 1,
        avgKd: 10,
        avgKwRating: 1,
        revision: 4,
        updatedAt: '2026-03-30T00:00:00.000Z',
        updatedByClientId: 'client-a',
        lastMutationId: 'm1',
      },
    ];

    const nextGrouped = [makeGroup('group-1', 'New Name', cluster)];
    const changes = buildGroupDocChanges(previous, nextGrouped, [], 'client-b', 3);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'upsert',
      id: 'group-1',
      expectedRevision: 4,
    });

    const deletes = buildGroupDocChanges(previous, [], [], 'client-b', 3);
    expect(deletes).toEqual([{ kind: 'delete', id: 'group-1', expectedRevision: 4 }]);
  });

  it('buildManualBlockedKeywordDocChanges normalizes identical manual exclusions into stable ids', () => {
    const keyword: BlockedKeyword = {
      keyword: '  Same Keyword  ',
      volume: 12,
      kd: 3,
      kwRating: 1,
      reason: 'Manual',
      tokenArr: ['alpha'],
    };

    const first = buildManualBlockedKeywordDocChanges([], [keyword], 'client-a', 9);
    const second = buildManualBlockedKeywordDocChanges([], [{ ...keyword, keyword: 'same keyword' }], 'client-a', 9);

    expect(first[0].kind).toBe('upsert');
    expect(second[0].kind).toBe('upsert');
    expect(first[0].id).toBe(second[0].id);
  });
});
