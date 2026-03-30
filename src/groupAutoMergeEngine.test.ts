import { describe, expect, it } from 'vitest';
import {
  buildGroupAutoMergeFingerprint,
  buildGroupAutoMergeSource,
  compareGroupAutoMergeSources,
  getRecommendationSourceFingerprint,
  isGroupMergeRecommendationSetStale,
  resolveGroupAutoMergeSelection,
} from './groupAutoMergeEngine';
import type { ClusterSummary, GroupMergeRecommendation, GroupedCluster } from './types';

function makeCluster(
  pageName: string,
  tokens: string,
  totalVolume: number,
  opts?: { city?: string | null; state?: string | null },
): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: 1,
    totalVolume,
    avgKd: 20,
    avgKwRating: null,
    label: '',
    labelArr: [],
    locationCity: opts?.city ?? null,
    locationState: opts?.state ?? null,
    keywords: [
      {
        keyword: `${pageName} keyword`,
        volume: totalVolume,
        kd: 20,
        locationCity: opts?.city ?? null,
        locationState: opts?.state ?? null,
      },
    ],
  };
}

function makeGroup(
  id: string,
  groupName: string,
  clusters: ClusterSummary[],
): GroupedCluster {
  return {
    id,
    groupName,
    clusters,
    totalVolume: clusters.reduce((sum, cluster) => sum + cluster.totalVolume, 0),
    keywordCount: clusters.reduce((sum, cluster) => sum + cluster.keywordCount, 0),
    avgKd: 20,
    avgKwRating: null,
  };
}

describe('compareGroupAutoMergeSources', () => {
  it('scores all group pairs even when they share no tokens', async () => {
    const carLoan = makeGroup('a', 'car loan', [makeCluster('car loan page', 'car loan tokens', 1000)]);
    const autoLoan = makeGroup('b', 'auto loan', [makeCluster('auto loan page', 'auto finance tokens', 900)]);
    const mortgage = makeGroup('c', 'mortgage', [makeCluster('mortgage page', 'home mortgage tokens', 800)]);
    const sources = [carLoan, autoLoan, mortgage].map((g) => buildGroupAutoMergeSource(g));
    const fingerprint = buildGroupAutoMergeFingerprint([carLoan, autoLoan, mortgage]);

    const recommendations = await compareGroupAutoMergeSources({
      sources,
      vectors: [
        [1, 0],
        [0.99, 0.01],
        [0, 1],
      ],
      sourceFingerprint: fingerprint,
      minSimilarity: 0.95,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].id).toBe('a__b');
    expect(recommendations[0].groupA.name).toBe('car loan');
    expect(recommendations[0].groupB.name).toBe('auto loan');
  });

  it('suppresses obvious location mismatches before they become recommendations', async () => {
    const miami = makeGroup('a', 'personal loan', [makeCluster('personal loan miami', 'loan miami', 1000, { city: 'Miami', state: 'FL' })]);
    const chicago = makeGroup('b', 'personal loan', [makeCluster('personal loan chicago', 'loan chicago', 900, { city: 'Chicago', state: 'IL' })]);
    const sources = [miami, chicago].map((g) => buildGroupAutoMergeSource(g));

    const recommendations = await compareGroupAutoMergeSources({
      sources,
      vectors: [
        [1, 0],
        [1, 0],
      ],
      sourceFingerprint: buildGroupAutoMergeFingerprint([miami, chicago]),
      minSimilarity: 0.8,
    });

    expect(recommendations).toEqual([]);
  });
});

describe('group auto-merge fingerprinting', () => {
  it('marks recommendation sets stale when grouped membership changes', () => {
    const original = makeGroup('a', 'car loan', [makeCluster('car loan page', 'car loan tokens', 1000)]);
    const updated = makeGroup('a', 'car loan', [makeCluster('car loan page', 'car loan tokens updated', 1000)]);
    const originalFingerprint = buildGroupAutoMergeFingerprint([original]);
    const updatedFingerprint = buildGroupAutoMergeFingerprint([updated]);
    const recommendations: GroupMergeRecommendation[] = [{
      id: 'a__b',
      sourceFingerprint: originalFingerprint,
      groupA: { id: 'a', name: 'car loan', pageCount: 1, totalVolume: 1000, locationSummary: 'National / non-local' },
      groupB: { id: 'b', name: 'auto loan', pageCount: 1, totalVolume: 900, locationSummary: 'National / non-local' },
      similarity: 0.95,
      exactNameMatch: false,
      sharedPageNameCount: 0,
      locationCompatible: true,
      status: 'pending',
      createdAt: '2026-03-30T00:00:00.000Z',
    }];

    expect(isGroupMergeRecommendationSetStale(recommendations, updatedFingerprint)).toBe(true);
  });

  it('treats missing recommendation state as not stale during hydration', () => {
    expect(getRecommendationSourceFingerprint(undefined)).toBeNull();
    expect(isGroupMergeRecommendationSetStale(undefined, 'current')).toBe(false);
  });
});

describe('resolveGroupAutoMergeSelection', () => {
  it('resolves selected pairs into connected components and keeps the highest-volume group name', () => {
    const groupA = makeGroup('a', 'Car Loans', [makeCluster('car loan one', 'a', 100)]);
    const groupB = makeGroup('b', 'Auto Loans', [makeCluster('auto loan one', 'b', 250)]);
    const groupC = makeGroup('c', 'Vehicle Loans', [makeCluster('vehicle loan one', 'c', 150)]);
    const recommendations: GroupMergeRecommendation[] = [
      {
        id: 'a__b',
        sourceFingerprint: buildGroupAutoMergeFingerprint([groupA, groupB, groupC]),
        groupA: { id: 'a', name: 'Car Loans', pageCount: 1, totalVolume: 100, locationSummary: 'National / non-local' },
        groupB: { id: 'b', name: 'Auto Loans', pageCount: 1, totalVolume: 250, locationSummary: 'National / non-local' },
        similarity: 0.96,
        exactNameMatch: false,
        sharedPageNameCount: 0,
        locationCompatible: true,
        status: 'pending',
        createdAt: '2026-03-30T00:00:00.000Z',
      },
      {
        id: 'b__c',
        sourceFingerprint: buildGroupAutoMergeFingerprint([groupA, groupB, groupC]),
        groupA: { id: 'b', name: 'Auto Loans', pageCount: 1, totalVolume: 250, locationSummary: 'National / non-local' },
        groupB: { id: 'c', name: 'Vehicle Loans', pageCount: 1, totalVolume: 150, locationSummary: 'National / non-local' },
        similarity: 0.95,
        exactNameMatch: false,
        sharedPageNameCount: 0,
        locationCompatible: true,
        status: 'pending',
        createdAt: '2026-03-30T00:00:00.000Z',
      },
    ];

    const resolution = resolveGroupAutoMergeSelection({
      groupedClusters: [groupA, groupB, groupC],
      recommendations,
      selectedRecommendationIds: ['a__b', 'b__c'],
      hasReviewApi: false,
    });

    expect(resolution.mergedGroups).toHaveLength(1);
    expect(resolution.removedGroupIds).toEqual(new Set(['a', 'b', 'c']));
    expect(resolution.mergedGroups[0].groupName).toBe('Auto Loans');
    expect(resolution.mergedGroups[0].clusters.map((cluster) => cluster.tokens).sort()).toEqual(['a', 'b', 'c']);
  });
});
