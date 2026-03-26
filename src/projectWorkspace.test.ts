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
  });

  it('still returns an empty workspace when there is no payload at all', () => {
    expect(toProjectViewState(null)).toEqual(createEmptyProjectViewState());
  });
});
