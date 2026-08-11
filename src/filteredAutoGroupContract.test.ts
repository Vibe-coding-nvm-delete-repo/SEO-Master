import { describe, expect, it } from 'vitest';
import {
  findAcceptedTokenCoverageMismatch,
  normalizeFilteredAutoGroupIncomingGroups,
  prepareFilteredAutoGroupFinalGroups,
} from './filteredAutoGroupContract';
import type { ClusterSummary, GroupedCluster } from './types';

function makeCluster(tokens: string, pageName = tokens): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: 1,
    totalVolume: 100,
    avgKd: 20,
    avgKwRating: 1,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
    keywords: [],
  };
}

function makeGroup(id: string, pageName: string, clusters: ClusterSummary[]): GroupedCluster {
  return {
    id,
    groupName: pageName,
    clusters,
    totalVolume: clusters.reduce((sum, cluster) => sum + cluster.totalVolume, 0),
    keywordCount: clusters.reduce((sum, cluster) => sum + cluster.keywordCount, 0),
    avgKd: 20,
    avgKwRating: 1,
  };
}

describe('filteredAutoGroupContract', () => {
  it('adds singleton repair groups for accepted pages omitted by model output', () => {
    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');

    const normalized = normalizeFilteredAutoGroupIncomingGroups(
      [makeGroup('group-alpha', 'Alpha', [alpha])],
      [alpha, beta],
      true,
    );

    expect(normalized.flatMap((group) => group.clusters.map((cluster) => cluster.tokens)).sort()).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('deduplicates accepted pages that the model assigns more than once', () => {
    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');

    const normalized = normalizeFilteredAutoGroupIncomingGroups(
      [
        makeGroup('group-a', 'Alpha', [alpha]),
        makeGroup('group-b', 'Beta', [alpha, beta]),
      ],
      [alpha, beta],
      true,
    );

    expect(findAcceptedTokenCoverageMismatch(normalized, ['alpha', 'beta'])).toEqual({
      duplicateTokens: [],
      missingTokens: [],
    });
    expect(normalized.flatMap((group) => group.clusters.map((cluster) => cluster.tokens)).sort()).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('strips accepted tokens from stale existing groups before the final merge', () => {
    const alpha = makeCluster('alpha', 'Shared Intent');
    const beta = makeCluster('beta', 'Shared Intent');
    const gamma = makeCluster('gamma', 'Existing Neighbor');

    const prepared = prepareFilteredAutoGroupFinalGroups(
      [makeGroup('existing', 'Shared Intent', [alpha, gamma])],
      [makeGroup('incoming', 'Shared Intent', [alpha, beta])],
      [alpha, beta],
      true,
    );

    expect(prepared.mismatch).toEqual({ duplicateTokens: [], missingTokens: [] });
    expect(prepared.groups).toHaveLength(1);
    expect(prepared.groups[0]?.clusters.map((cluster) => cluster.tokens).sort()).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('reports duplicate accepted tokens when grouped state is still invalid', () => {
    const alpha = makeCluster('alpha', 'Alpha');

    expect(
      findAcceptedTokenCoverageMismatch(
        [
          makeGroup('group-a', 'Alpha', [alpha]),
          makeGroup('group-b', 'Beta', [alpha]),
        ],
        ['alpha'],
      ),
    ).toEqual({
      duplicateTokens: ['alpha'],
      missingTokens: [],
    });
  });
});
