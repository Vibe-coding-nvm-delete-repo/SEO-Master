import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectPersistence } from './useProjectPersistence';
import type { ClusterSummary, GroupedCluster, ProcessedRow } from './types';

vi.mock('./firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ path: 'projects/mock/chunks' })),
  onSnapshot: vi.fn(() => () => {}),
}));

function makeCluster(tokens: string, pageName = `page ${tokens}`): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: 1,
    totalVolume: 100,
    avgKd: 20,
    avgKwRating: null,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
    keywords: [
      {
        keyword: `${pageName} keyword`,
        volume: 100,
        kd: 20,
        locationCity: null,
        locationState: null,
      },
    ],
  };
}

function makeRow(cluster: ClusterSummary): ProcessedRow {
  const keyword = cluster.keywords[0];
  return {
    pageName: cluster.pageName,
    pageNameLower: cluster.pageNameLower,
    pageNameLen: cluster.pageNameLen,
    tokens: cluster.tokens,
    tokenArr: cluster.tokenArr,
    keyword: keyword.keyword,
    keywordLower: keyword.keyword.toLowerCase(),
    searchVolume: keyword.volume,
    kd: keyword.kd,
    label: cluster.label,
    labelArr: cluster.labelArr,
    locationCity: keyword.locationCity,
    locationState: keyword.locationState,
  };
}

function makeGroup(id: string, cluster: ClusterSummary): GroupedCluster {
  return {
    id,
    groupName: `Group ${id}`,
    clusters: [cluster],
    totalVolume: cluster.totalVolume,
    keywordCount: cluster.keywordCount,
    avgKd: cluster.avgKd,
    avgKwRating: cluster.avgKwRating,
  };
}

function recalcGroup(group: GroupedCluster, remaining: ClusterSummary[]): GroupedCluster {
  return {
    ...group,
    clusters: remaining,
    totalVolume: remaining.reduce((sum, cluster) => sum + cluster.totalVolume, 0),
    keywordCount: remaining.reduce((sum, cluster) => sum + cluster.keywordCount, 0),
    avgKd: remaining.length > 0 ? remaining[0].avgKd : null,
  };
}

describe('useProjectPersistence duplicate restore guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('ungroupPages restores a page only once even if multiple selected groups contain the same signature', () => {
    const cluster = makeCluster('shared tokens', 'shared page');
    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: [],
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.bulkSet({
        results: [],
        clusterSummary: [],
        groupedClusters: [
          makeGroup('g1', cluster),
          makeGroup('g2', cluster),
        ],
      });
    });

    act(() => {
      result.current.ungroupPages(new Set(['g1', 'g2']), new Set(), recalcGroup);
    });

    expect(result.current.clusterSummary).toHaveLength(1);
    expect(result.current.clusterSummary?.[0].tokens).toBe('shared tokens');
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results?.[0].tokens).toBe('shared tokens');
  });

  it('removeFromApproved does not duplicate an already-restored page in ungrouped state', () => {
    const cluster = makeCluster('approved tokens', 'approved page');
    const { result } = renderHook(() =>
      useProjectPersistence({
        projects: [],
        setProjects: vi.fn(),
        addToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.bulkSet({
        results: [makeRow(cluster)],
        clusterSummary: [cluster],
        approvedGroups: [makeGroup('approved-1', cluster)],
      });
    });

    act(() => {
      result.current.removeFromApproved(
        new Set(),
        new Set(['approved-1::approved tokens']),
        recalcGroup,
      );
    });

    expect(result.current.clusterSummary).toHaveLength(1);
    expect(result.current.clusterSummary?.[0].tokens).toBe('approved tokens');
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results?.[0].tokens).toBe('approved tokens');
  });
});
