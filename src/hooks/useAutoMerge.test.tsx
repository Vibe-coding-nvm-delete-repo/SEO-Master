import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupReviewSettingsData, GroupReviewSettingsRef } from '../GroupReviewSettings';
import { blockedSharedMutation, SHARED_MUTATION_ACCEPTED, type SharedMutationResult } from '../sharedMutation';
import type { AutoMergeRecommendation, ProcessedRow, TokenSummary } from '../types';

const fetchAutoMergeMatchesMock = vi.fn();
const selectAutoMergeTokenRowsMock = vi.fn();
const runPoolMock = vi.fn();

vi.mock('../AutoMergeEngine', () => ({
  addAutoMergeUsage: (
    acc: { promptTokens: number; completionTokens: number; costUsd: number | null },
    usage: { promptTokens: number; completionTokens: number; costUsd: number | null },
  ) => ({
    promptTokens: acc.promptTokens + usage.promptTokens,
    completionTokens: acc.completionTokens + usage.completionTokens,
    costUsd: (acc.costUsd ?? 0) + (usage.costUsd ?? 0),
  }),
  fetchAutoMergeMatches: (...args: unknown[]) => fetchAutoMergeMatchesMock(...args),
  selectAutoMergeTokenRows: (...args: unknown[]) => selectAutoMergeTokenRowsMock(...args),
}));

vi.mock('../KeywordRatingEngine', () => ({
  runPool: (...args: unknown[]) => runPoolMock(...args),
}));

vi.mock('../cloudSyncStatus', () => ({
  getCloudSyncSnapshot: () => ({
    project: { writeFailed: false },
  }),
}));

import { useAutoMerge } from './useAutoMerge';

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

function makeResults(): ProcessedRow[] {
  return [
    {
      pageName: 'Alpha Page',
      pageNameLower: 'alpha page',
      pageNameLen: 10,
      tokens: 'alpha',
      tokenArr: ['alpha'],
      keyword: 'alpha keyword',
      keywordLower: 'alpha keyword',
      searchVolume: 100,
      kd: 20,
      label: '',
      labelArr: [],
      locationCity: null,
      locationState: null,
    },
    {
      pageName: 'Beta Page',
      pageNameLower: 'beta page',
      pageNameLen: 9,
      tokens: 'beta',
      tokenArr: ['beta'],
      keyword: 'beta keyword',
      keywordLower: 'beta keyword',
      searchVolume: 80,
      kd: 18,
      label: '',
      labelArr: [],
      locationCity: null,
      locationState: null,
    },
  ];
}

function makeTokenSummary(): TokenSummary[] {
  return [
    {
      token: 'alpha',
      length: 5,
      frequency: 10,
      totalVolume: 100,
      avgKd: 20,
      label: '',
      labelArr: [],
      locationCity: '',
      locationState: '',
    },
    {
      token: 'beta',
      length: 4,
      frequency: 8,
      totalVolume: 80,
      avgKd: 18,
      label: '',
      labelArr: [],
      locationCity: '',
      locationState: '',
    },
  ];
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useAutoMerge', () => {
  beforeEach(() => {
    fetchAutoMergeMatchesMock.mockReset();
    selectAutoMergeTokenRowsMock.mockReset();
    runPoolMock.mockReset();

    selectAutoMergeTokenRowsMock.mockImplementation((rows: TokenSummary[]) => rows);
    fetchAutoMergeMatchesMock.mockImplementation(async (_slice, sourceToken: string) => ({
      result: {
        matches: sourceToken === 'alpha' ? ['beta'] : ['alpha'],
        confidence: 0.99,
        reason: 'same intent',
      },
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        costUsd: 0.01,
      },
    }));
    runPoolMock.mockImplementation(async (items: TokenSummary[], _concurrency: number, worker: (item: TokenSummary) => Promise<unknown>) => {
      for (const item of items) {
        await worker(item);
      }
    });
  });

  it('uses an exclusive token-merge operation for recommendation persistence and does not mutate refs on blocked writes', async () => {
    const settings = makeSettings();
    const results = makeResults();
    const tokenSummary = makeTokenSummary();
    const autoMergeRecommendationsRef = { current: [] as AutoMergeRecommendation[] };
    const updateAutoMergeRecommendations = vi.fn(async () => blockedSharedMutation('lock-conflict'));
    const runWithExclusiveOperation = vi.fn(
      async (_type: 'token-merge', task: () => Promise<unknown>) => task(),
    ) as unknown as <T>(type: 'token-merge', task: () => Promise<T>) => Promise<T | null>;

    const { result } = renderHook(() =>
      useAutoMerge({
        results,
        tokenMergeRules: [],
        resultsRef: { current: results },
        tokenSummaryRef: { current: tokenSummary },
        groupedClustersRef: { current: [] },
        approvedGroupsRef: { current: [] },
        clusterSummaryRef: { current: null },
        autoMergeRecommendationsRef,
        blockedTokensRef: { current: new Set<string>() },
        universalBlockedTokens: new Set<string>(),
        groupReviewSettingsRef: {
          current: {
            getSettings: () => settings,
            getSelectedModelObj: () => undefined,
            hasApiKey: () => true,
            updateSettings: vi.fn(),
          } satisfies GroupReviewSettingsRef,
        },
        groupReviewSettingsSnapshot: settings,
        addToast: vi.fn(),
        logAndToast: vi.fn(),
        updateAutoMergeRecommendations,
        applyMergeCascade: vi.fn(async () => SHARED_MUTATION_ACCEPTED),
        activeProjectId: 'proj-1',
        flushNow: vi.fn(async () => {}),
        setTokenMgmtSubTab: vi.fn(),
        setTokenMgmtPage: vi.fn(),
        handleUndoMergeParent: vi.fn(async () => true),
        runWithExclusiveOperation,
      }),
    );

    await act(async () => {
      await result.current.runAutoMergeRecommendations();
    });

    expect(runWithExclusiveOperation).toHaveBeenCalledTimes(1);
    expect(runWithExclusiveOperation).toHaveBeenCalledWith('token-merge', expect.any(Function));
    expect(updateAutoMergeRecommendations).toHaveBeenCalledTimes(1);
    expect(autoMergeRecommendationsRef.current).toEqual([]);
    expect(result.current.autoMergeJob.phase).toBe('error');
  });

  it('does not mark a recommendation applied locally when the shared recommendation write is blocked', async () => {
    const settings = makeSettings();
    const results = makeResults();
    const tokenSummary = makeTokenSummary();
    const autoMergeRecommendationsRef = {
      current: [
        {
          id: 'auto_merge_alpha__beta',
          sourceToken: 'alpha',
          canonicalToken: 'alpha',
          mergeTokens: ['alpha', 'beta'],
          confidence: 0.99,
          reason: 'same intent',
          affectedKeywordCount: 2,
          affectedPageCount: 2,
          affectedKeywords: ['alpha keyword', 'beta keyword'],
          status: 'pending' as const,
          createdAt: '2026-03-31T00:00:00.000Z',
        },
      ],
    };
    const applyMergeCascade = vi.fn(async () => SHARED_MUTATION_ACCEPTED);
    const updateAutoMergeRecommendations = vi.fn(async () => blockedSharedMutation('lock-conflict'));
    const setTokenMgmtSubTab = vi.fn();
    const setTokenMgmtPage = vi.fn();

    const { result } = renderHook(() =>
      useAutoMerge({
        results,
        tokenMergeRules: [],
        resultsRef: { current: results },
        tokenSummaryRef: { current: tokenSummary },
        groupedClustersRef: { current: [] },
        approvedGroupsRef: { current: [] },
        clusterSummaryRef: { current: null },
        autoMergeRecommendationsRef,
        blockedTokensRef: { current: new Set<string>() },
        universalBlockedTokens: new Set<string>(),
        groupReviewSettingsRef: {
          current: {
            getSettings: () => settings,
            getSelectedModelObj: () => undefined,
            hasApiKey: () => true,
            updateSettings: vi.fn(),
          } satisfies GroupReviewSettingsRef,
        },
        groupReviewSettingsSnapshot: settings,
        addToast: vi.fn(),
        logAndToast: vi.fn(),
        updateAutoMergeRecommendations,
        applyMergeCascade,
        activeProjectId: 'proj-1',
        flushNow: vi.fn(async () => {}),
        setTokenMgmtSubTab,
        setTokenMgmtPage,
        handleUndoMergeParent: vi.fn(async () => true),
      }),
    );

    let applied = false;
    await act(async () => {
      applied = await result.current.applyAutoMergeRecommendation('auto_merge_alpha__beta');
    });

    expect(applied).toBe(false);
    expect(applyMergeCascade).toHaveBeenCalledTimes(1);
    expect(updateAutoMergeRecommendations).toHaveBeenCalledTimes(1);
    expect(autoMergeRecommendationsRef.current[0].status).toBe('pending');
    expect(setTokenMgmtSubTab).not.toHaveBeenCalled();
    expect(setTokenMgmtPage).not.toHaveBeenCalled();
  });

  it('keeps Merge All inside one exclusive token-merge operation until the merge write finishes', async () => {
    const settings = makeSettings();
    const results = makeResults();
    const tokenSummary = makeTokenSummary();
    const autoMergeRecommendationsRef = {
      current: [
        {
          id: 'auto_merge_alpha__beta',
          sourceToken: 'alpha',
          canonicalToken: 'alpha',
          mergeTokens: ['beta'],
          confidence: 0.99,
          reason: 'same intent',
          affectedKeywordCount: 2,
          affectedPageCount: 2,
          affectedKeywords: ['alpha keyword', 'beta keyword'],
          status: 'pending' as const,
          createdAt: '2026-03-31T00:00:00.000Z',
        },
      ],
    };
    const deferredApply = createDeferred<SharedMutationResult>();
    const applyMergeCascade = vi.fn(() => deferredApply.promise);
    const updateAutoMergeRecommendations = vi.fn(async () => SHARED_MUTATION_ACCEPTED);
    const runWithExclusiveOperation = vi.fn(
      async (_type: 'token-merge', task: () => Promise<unknown>) => task(),
    ) as unknown as <T>(type: 'token-merge', task: () => Promise<T>) => Promise<T | null>;

    const { result } = renderHook(() =>
      useAutoMerge({
        results,
        tokenMergeRules: [],
        resultsRef: { current: results },
        tokenSummaryRef: { current: tokenSummary },
        groupedClustersRef: { current: [] },
        approvedGroupsRef: { current: [] },
        clusterSummaryRef: { current: null },
        autoMergeRecommendationsRef,
        blockedTokensRef: { current: new Set<string>() },
        universalBlockedTokens: new Set<string>(),
        groupReviewSettingsRef: {
          current: {
            getSettings: () => settings,
            getSelectedModelObj: () => undefined,
            hasApiKey: () => true,
            updateSettings: vi.fn(),
          } satisfies GroupReviewSettingsRef,
        },
        groupReviewSettingsSnapshot: settings,
        addToast: vi.fn(),
        logAndToast: vi.fn(),
        updateAutoMergeRecommendations,
        applyMergeCascade,
        activeProjectId: 'proj-1',
        flushNow: vi.fn(async () => {}),
        setTokenMgmtSubTab: vi.fn(),
        setTokenMgmtPage: vi.fn(),
        handleUndoMergeParent: vi.fn(async () => true),
        runWithExclusiveOperation,
      }),
    );

    let settled = false;
    let mergeAllPromise!: Promise<boolean>;

    await act(async () => {
      mergeAllPromise = result.current.applyAllAutoMergeRecommendations();
      mergeAllPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(runWithExclusiveOperation).toHaveBeenCalledTimes(1);
      expect(runWithExclusiveOperation).toHaveBeenCalledWith('token-merge', expect.any(Function));
      expect(settled).toBe(false);
      deferredApply.resolve(SHARED_MUTATION_ACCEPTED);
      await mergeAllPromise;
    });

    expect(applyMergeCascade).toHaveBeenCalledTimes(1);
    expect(updateAutoMergeRecommendations).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
  });
});
