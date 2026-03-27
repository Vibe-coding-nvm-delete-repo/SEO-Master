import { describe, expect, it } from 'vitest';
import { createEmptyProjectViewState, toProjectViewState } from './projectWorkspace';

describe('toProjectViewState', () => {
  it('keeps grouped and approved state even when results are empty', () => {
    const view = toProjectViewState({
      results: [],
      clusterSummary: [],
      tokenSummary: [],
      groupedClusters: [{ id: 'g1', groupName: 'Grouped Only', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
      approvedGroups: [{ id: 'a1', groupName: 'Approved Only', clusters: [], totalVolume: 0, keywordCount: 0, avgKd: null }],
      stats: null,
      datasetStats: null,
      blockedTokens: [],
      blockedKeywords: [],
      labelSections: [],
      activityLog: [],
      tokenMergeRules: [],
      autoGroupSuggestions: [],
      autoMergeRecommendations: [],
      updatedAt: '2026-03-25T00:00:00.000Z',
    }, {
      id: 'proj-1',
      name: 'Shared Project',
      description: 'collab',
      createdAt: '2026-03-25T00:00:00.000Z',
      uid: 'local',
      fileName: 'shared.csv',
    });

    expect(view.results).toEqual([]);
    expect(view.clusterSummary).toEqual([]);
    expect(view.groupedClusters).toHaveLength(1);
    expect(view.approvedGroups).toHaveLength(1);
    expect(view.fileName).toBe('shared.csv');
    expect(view.autoMergeRecommendations).toEqual([]);
  });

  it('still returns an empty workspace when there is no payload at all', () => {
    expect(toProjectViewState(null)).toEqual(createEmptyProjectViewState());
  });

  it('rebuilds clusterSummary from results so avgKwRating matches kwRating on rows (survives stale chunk data)', () => {
    const row = (kw: string, vol: number, rating: 1 | 2 | 3) => ({
      pageName: 'page',
      pageNameLower: 'page',
      pageNameLen: 4,
      tokens: 'a b',
      tokenArr: ['a', 'b'],
      keyword: kw,
      keywordLower: kw.toLowerCase(),
      searchVolume: vol,
      kd: 10 as number | null,
      label: '',
      labelArr: [] as string[],
      locationCity: null,
      locationState: null,
      kwRating: rating,
    });
    const view = toProjectViewState({
      results: [row('k1', 100, 1), row('k2', 50, 3)],
      clusterSummary: [
        {
          pageName: 'k1',
          pageNameLower: 'k1',
          pageNameLen: 2,
          tokens: 'a b',
          tokenArr: ['a', 'b'],
          keywordCount: 2,
          totalVolume: 150,
          avgKd: 10,
          avgKwRating: null,
          label: '',
          labelArr: [],
          locationCity: null,
          locationState: null,
          keywords: [],
        },
      ],
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
      autoMergeRecommendations: [{
        id: 'auto_merge_1',
        sourceToken: 'hvac',
        canonicalToken: 'hvac',
        mergeTokens: ['h-v-a-c'],
        confidence: 0.91,
        reason: 'punctuation variant',
        affectedKeywordCount: 3,
        affectedPageCount: 2,
        affectedKeywords: ['hvac repair'],
        status: 'pending',
        createdAt: '2026-03-26T00:00:00.000Z',
      }],
      updatedAt: '2026-03-26T00:00:00.000Z',
    }, null);

    expect(view.clusterSummary).toHaveLength(1);
    expect(view.clusterSummary![0].avgKwRating).toBe(2);
    expect(view.autoMergeRecommendations).toHaveLength(1);
  });
});
