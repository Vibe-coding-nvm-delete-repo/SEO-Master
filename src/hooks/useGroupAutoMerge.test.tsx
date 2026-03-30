import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GroupReviewSettingsData, GroupReviewSettingsRef } from '../GroupReviewSettings';
import {
  buildGroupAutoMergeFingerprint,
  isGroupMergeRecommendationSetStale,
} from '../groupAutoMergeEngine';
import { useGroupAutoMerge } from './useGroupAutoMerge';
import type { ClusterSummary, GroupMergeRecommendation, GroupedCluster } from '../types';

function makeCluster(tokens: string, pageName: string, totalVolume: number): ClusterSummary {
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
    locationCity: null,
    locationState: null,
    keywords: [
      {
        keyword: `${pageName} keyword`,
        volume: totalVolume,
        kd: 20,
        locationCity: null,
        locationState: null,
      },
    ],
  };
}

function makeGroup(
  id: string,
  groupName: string,
  clusters: ClusterSummary[],
  reviewStatus: GroupedCluster['reviewStatus'] = 'approve',
): GroupedCluster {
  return {
    id,
    groupName,
    clusters,
    totalVolume: clusters.reduce((sum, cluster) => sum + cluster.totalVolume, 0),
    keywordCount: clusters.reduce((sum, cluster) => sum + cluster.keywordCount, 0),
    avgKd: 20,
    avgKwRating: null,
    reviewStatus,
    reviewedAt: '2026-03-29T00:00:00.000Z',
  };
}

function makeSettings(): GroupReviewSettingsData {
  return {
    apiKey: 'openrouter-test-key-12345',
    selectedModel: 'openai/gpt-5.4-mini',
    concurrency: 3,
    temperature: 0.2,
    maxTokens: 1200,
    systemPrompt: 'review',
    autoGroupPrompt: 'group',
    reasoningEffort: 'low',
    keywordRatingModel: 'openai/gpt-5.4-mini',
    keywordRatingTemperature: 0,
    keywordRatingMaxTokens: 500,
    keywordRatingConcurrency: 3,
    keywordRatingReasoningEffort: 'low',
    keywordRatingPrompt: 'rate',
    keywordCoreIntentSummary: '',
    keywordCoreIntentSummaryUpdatedAt: '',
    autoMergeModel: 'openai/gpt-5.4-mini',
    autoMergeTemperature: 0,
    autoMergeMaxTokens: 500,
    autoMergeConcurrency: 3,
    autoMergeReasoningEffort: 'low',
    autoMergePrompt: 'merge',
    groupAutoMergeEmbeddingModel: 'text-embedding-3-small',
    groupAutoMergeMinSimilarity: 0.9,
  };
}

describe('useGroupAutoMerge', () => {
  it('applies recommendations, rebuilds grouped state, and leaves accepted recommendations stale for re-embed', async () => {
    const groupA = makeGroup('a', 'Car Loans', [makeCluster('car-loans', 'car loans page', 100)], 'approve');
    const groupB = makeGroup('b', 'Auto Loans', [makeCluster('auto-loans', 'auto loans page', 250)], 'approve');
    const groupedClusters = [groupA, groupB];
    const sourceFingerprint = buildGroupAutoMergeFingerprint(groupedClusters);
    const recommendations: GroupMergeRecommendation[] = [
      {
        id: 'a__b',
        sourceFingerprint,
        groupA: {
          id: 'a',
          name: 'Car Loans',
          pageCount: 1,
          totalVolume: 100,
          locationSummary: 'National / non-local',
        },
        groupB: {
          id: 'b',
          name: 'Auto Loans',
          pageCount: 1,
          totalVolume: 250,
          locationSummary: 'National / non-local',
        },
        similarity: 0.96,
        exactNameMatch: false,
        sharedPageNameCount: 0,
        locationCompatible: true,
        status: 'pending',
        createdAt: '2026-03-30T00:00:00.000Z',
      },
    ];
    const groupedClustersRef = { current: groupedClusters };
    const groupMergeRecommendationsRef = { current: recommendations };
    const settings = makeSettings();
    const groupReviewSettingsRef = {
      current: {
        getSettings: () => settings,
        getSelectedModelObj: () => undefined,
        hasApiKey: () => true,
        updateSettings: vi.fn(),
      } satisfies GroupReviewSettingsRef,
    };
    const updateGroupMergeRecommendations = vi.fn();
    const bulkSet = vi.fn();
    const addToast = vi.fn();
    const logAndToast = vi.fn();
    const flushNow = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useGroupAutoMerge({
        groupedClusters,
        groupedClustersRef,
        groupMergeRecommendations: recommendations,
        groupMergeRecommendationsRef,
        groupReviewSettingsRef,
        groupReviewSettingsSnapshot: settings,
        updateGroupMergeRecommendations,
        bulkSet,
        addToast,
        logAndToast,
        flushNow,
      }),
    );

    let applied = false;
    await act(async () => {
      applied = await result.current.applyRecommendations(['a__b']);
    });

    expect(applied).toBe(true);
    expect(flushNow).toHaveBeenCalledTimes(1);
    expect(logAndToast).toHaveBeenCalledTimes(1);
    expect(bulkSet).toHaveBeenCalledTimes(1);

    const bulkSetArg = bulkSet.mock.calls[0][0] as {
      groupedClusters: GroupedCluster[];
      groupMergeRecommendations: GroupMergeRecommendation[];
    };

    expect(bulkSetArg.groupedClusters).toHaveLength(1);
    expect(bulkSetArg.groupedClusters[0].groupName).toBe('Auto Loans');
    expect(bulkSetArg.groupedClusters[0].reviewStatus).toBe('approve');
    expect(bulkSetArg.groupedClusters[0].mergeAffected).toBe(true);
    expect(bulkSetArg.groupMergeRecommendations[0].status).toBe('accepted');
    expect(
      isGroupMergeRecommendationSetStale(
        bulkSetArg.groupMergeRecommendations,
        buildGroupAutoMergeFingerprint(bulkSetArg.groupedClusters),
      ),
    ).toBe(true);
  });
});
