import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeFilteredAutoGroupIncomingGroups } from '../filteredAutoGroupContract';
import type { ClusterSummary, GroupedCluster } from '../types';
import type { GroupReviewSettingsData, GroupReviewSettingsRef } from '../GroupReviewSettings';
import { failedSharedMutation, SHARED_MUTATION_ACCEPTED } from '../sharedMutation';
import { useFilteredAutoGroupFlow } from './useFilteredAutoGroupFlow';

type HookProps = Parameters<typeof useFilteredAutoGroupFlow>[0];
type ApplyFilteredAutoGroupBatch = HookProps['applyFilteredAutoGroupBatch'];

vi.mock('../openRouterTimeout', () => ({
  OPENROUTER_REQUEST_TIMEOUT_MS: 60_000,
  runWithOpenRouterTimeout: async ({ run, signal }: { run: (signal: AbortSignal) => Promise<unknown>; signal: AbortSignal }) => ({
    result: await run(signal),
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

function makeSettings(): GroupReviewSettingsData {
  return {
    apiKey: 'test-key',
    selectedModel: 'openai/test-model',
    concurrency: 1,
    temperature: 0,
    maxTokens: 0,
    systemPrompt: 'review',
    autoGroupPrompt: 'group',
    reasoningEffort: 'none',
    keywordRatingModel: 'openai/test-model',
    keywordRatingTemperature: 0,
    keywordRatingMaxTokens: 0,
    keywordRatingConcurrency: 1,
    keywordRatingReasoningEffort: 'none',
    keywordRatingPrompt: 'rate',
    keywordCoreIntentSummary: '',
    keywordCoreIntentSummaryUpdatedAt: '',
    autoMergeModel: 'openai/test-model',
    autoMergeTemperature: 0,
    autoMergeMaxTokens: 0,
    autoMergeConcurrency: 1,
    autoMergeReasoningEffort: 'none',
    autoMergePrompt: 'merge',
    groupAutoMergeEmbeddingModel: 'embedding/test',
    groupAutoMergeMinSimilarity: 0.9,
  };
}

function buildOpenRouterResponse(pageCount: number) {
  return buildOpenRouterResponseForPageIds(
    Array.from({ length: pageCount }, (_, index) => `P${index + 1}`),
  );
}

/** Build a response that only groups the given page IDs (each as a singleton group). */
function buildOpenRouterResponseForPageIds(pageIds: string[]) {
  return {
    ok: true,
    text: vi.fn(async () => ''),
    json: vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              groups: pageIds.map((id) => ({ pageIds: [id] })),
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
      },
    })),
  };
}

function createHarness(
  initialFilteredClusters: ClusterSummary[],
  _initialAvailableClusters: ClusterSummary[],
  applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch,
  options?: {
    initialBulkBlock?: boolean;
    logAndToast?: HookProps['logAndToast'];
    runWithExclusiveOperation?: HookProps['runWithExclusiveOperation'];
  },
) {
  const settings = makeSettings();
  const initialBulkBlock = options?.initialBulkBlock ?? false;
  const logAndToast = options?.logAndToast ?? vi.fn();
  const groupReviewSettingsRef = {
    current: {
      getSettings: () => settings,
      getSelectedModelObj: () => ({
        id: settings.selectedModel,
        name: 'Test Model',
        pricing: { prompt: '0', completion: '0' },
        context_length: 8_192,
      }),
      hasApiKey: () => true,
      updateSettings: () => undefined,
    } satisfies GroupReviewSettingsRef,
  };

  return renderHook(() => {
    const [filteredClusters, setFilteredClusters] = useState(initialFilteredClusters);
    const [isBulkSharedEditBlocked, setIsBulkSharedEditBlocked] = useState(initialBulkBlock);
    const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [pendingFilteredAutoGroupTokens, setPendingFilteredAutoGroupTokens] = useState<Set<string>>(new Set());

    const hook = useFilteredAutoGroupFlow({
      filteredClusters,
      groupReviewSettingsHydrated: true,
      groupReviewSettingsSnapshot: settings,
      groupReviewSettingsRef,
      isBulkSharedEditBlocked,
      selectedTokens: new Set(),
      excludedLabels: new Set(),
      debouncedSearchQuery: '',
      filterCity: '',
      filterState: '',
      minKwInCluster: '',
      maxKwInCluster: '',
      minVolume: '',
      maxVolume: '',
      minKd: '',
      maxKd: '',
      minKwRating: '',
      maxKwRating: '',
      minLen: '',
      maxLen: '',
      pendingFilteredAutoGroupTokens,
      setPendingFilteredAutoGroupTokens,
      applyFilteredAutoGroupBatch,
      setSelectedClusters,
      setCurrentPage,
      startTransition: (callback) => callback(),
      logAndToast,
      recordGroupingEvent: vi.fn(),
      runWithExclusiveOperation: options?.runWithExclusiveOperation,
    });

    return {
      ...hook,
      currentPage,
      isBulkSharedEditBlocked,
      pendingFilteredAutoGroupTokens,
      selectedClusters,
      filteredClusters,
      setFilteredClusters,
      setIsBulkSharedEditBlocked,
      logAndToast,
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFilteredAutoGroupFlow', () => {
  it('marks pages pending immediately and keeps the user on Ungrouped when a run starts', async () => {
    const fetches = [deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async () => SHARED_MUTATION_ACCEPTED;
    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const { result } = createHarness([alpha, beta], [alpha, beta], applyFilteredAutoGroupBatch);

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(Array.from(result.current.pendingFilteredAutoGroupTokens).sort()).toEqual(['alpha', 'beta']);

    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponse(2));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.pendingFilteredAutoGroupTokens.size).toBe(0));
  });

  it('cleans up pending pages when the exclusive-operation wrapper refuses to start the job', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const runWithExclusiveOperation: HookProps['runWithExclusiveOperation'] = async () => null;
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async () => SHARED_MUTATION_ACCEPTED;
    const alpha = makeCluster('alpha', 'Alpha');
    const { result } = createHarness([alpha], [alpha], applyFilteredAutoGroupBatch, {
      runWithExclusiveOperation,
    });

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    await waitFor(() => expect(result.current.pendingFilteredAutoGroupTokens.size).toBe(0));
    expect(result.current.isRunningFilteredAutoGroup).toBe(false);
    expect(result.current.filteredAutoGroupQueue).toHaveLength(0);
  });

  it('collapses repeated queued runs to the latest one', async () => {
    const fetches = [deferred<any>(), deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    const removedTokenBatches: string[][] = [];
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async ({ acceptedPages }) => {
      removedTokenBatches.push(acceptedPages.map((page) => page.tokens));
      return SHARED_MUTATION_ACCEPTED;
    };

    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const gamma = makeCluster('gamma', 'Gamma');
    const { result } = createHarness([alpha], [alpha, beta, gamma], applyFilteredAutoGroupBatch);

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });
    act(() => {
      result.current.setFilteredClusters([beta]);
    });
    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });
    act(() => {
      result.current.setFilteredClusters([gamma]);
    });
    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    // enqueueLatestFilteredAutoGroupJob collapses to the latest pending job
    expect(result.current.filteredAutoGroupQueue).toHaveLength(1);

    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(removedTokenBatches).toHaveLength(1));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      fetches[1].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(removedTokenBatches).toHaveLength(2));
    // First run processes alpha, second run processes the latest queued job (gamma)
    expect(removedTokenBatches).toEqual([
      ['alpha'],
      ['gamma'],
    ]);
  });

  it('queued duplicate job runs and completes without hanging the queue', async () => {
    const fetches = [deferred<any>(), deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    let mergeCallCount = 0;
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async () => {
      mergeCallCount += 1;
      return SHARED_MUTATION_ACCEPTED;
    };
    const alpha = makeCluster('alpha', 'Alpha');
    const { result } = createHarness([alpha], [alpha], applyFilteredAutoGroupBatch);

    // First call starts immediately
    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });
    // Second call queues because the first is already running
    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.filteredAutoGroupQueue).toHaveLength(1);

    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(mergeCallCount).toBe(1));
    // Queued job drains and triggers a second fetch
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      fetches[1].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(mergeCallCount).toBe(2));
    await waitFor(() => expect(result.current.filteredAutoGroupQueue).toHaveLength(0));
    await waitFor(() => expect(result.current.isRunningFilteredAutoGroup).toBe(false));
  });

  it('stop cancels the active job, clears the queue, and restores pending pages', async () => {
    const fetches = [deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    let mergeCallCount = 0;
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async () => {
      mergeCallCount += 1;
      return SHARED_MUTATION_ACCEPTED;
    };

    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const { result } = createHarness([alpha], [alpha, beta], applyFilteredAutoGroupBatch);

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });
    act(() => {
      result.current.setFilteredClusters([beta]);
    });
    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    expect(result.current.filteredAutoGroupQueue).toHaveLength(1);
    expect(Array.from(result.current.pendingFilteredAutoGroupTokens).sort()).toEqual(['alpha', 'beta']);

    act(() => {
      result.current.handleStopFilteredAutoGroup();
    });

    await waitFor(() => expect(result.current.filteredAutoGroupQueue).toHaveLength(0));
    await waitFor(() => expect(result.current.pendingFilteredAutoGroupTokens.size).toBe(0));

    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isRunningFilteredAutoGroup).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mergeCallCount).toBe(0);
  });

  it('lets the active job finish and pauses queued jobs while bulk shared edits are blocked', async () => {
    const fetches = [deferred<any>(), deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    const removedTokenBatches: string[][] = [];
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async ({ acceptedPages }) => {
      removedTokenBatches.push(acceptedPages.map((page) => page.tokens));
      return SHARED_MUTATION_ACCEPTED;
    };

    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const { result } = createHarness([alpha], [alpha, beta], applyFilteredAutoGroupBatch);

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setFilteredClusters([beta]);
    });
    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });
    expect(result.current.filteredAutoGroupQueue).toHaveLength(1);

    // Block shared edits while the first job is in-flight. The active job should finish,
    // but the queued job should remain paused until the block clears.
    act(() => {
      result.current.setIsBulkSharedEditBlocked(true);
    });

    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(removedTokenBatches).toEqual([['alpha']]));
    expect(result.current.isRunningFilteredAutoGroup).toBe(false);
    expect(result.current.filteredAutoGroupQueue).toHaveLength(1);
    expect(Array.from(result.current.pendingFilteredAutoGroupTokens)).toEqual(['beta']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setIsBulkSharedEditBlocked(false);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      fetches[1].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(removedTokenBatches).toEqual([['alpha'], ['beta']]));
    await waitFor(() => expect(result.current.filteredAutoGroupQueue).toHaveLength(0));
    expect(result.current.pendingFilteredAutoGroupTokens.size).toBe(0);
  });

  it('creates singleton groups for pages the model omits from its response', async () => {
    const fetches = [deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    const mergedGroups: { tokens: string[]; removedTokens: string[] }[] = [];
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async ({ incoming, acceptedPages }) => {
      mergedGroups.push({
        tokens: incoming.flatMap((g) => g.clusters.map((c) => c.tokens)),
        removedTokens: acceptedPages.map((page) => page.tokens),
      });
      return SHARED_MUTATION_ACCEPTED;
    };

    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const gamma = makeCluster('gamma', 'Gamma');
    const allPages = [alpha, beta, gamma];
    const { result } = createHarness(allPages, allPages, applyFilteredAutoGroupBatch);

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    // Model only returns P1 (alpha) -- omits beta and gamma
    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponseForPageIds(['P1']));
      await Promise.resolve();
    });

    await waitFor(() => expect(mergedGroups).toHaveLength(1));

    // All three pages should be in the generated groups (alpha from model, beta+gamma as singletons)
    const allTokens = mergedGroups[0].tokens.sort();
    expect(allTokens).toEqual(['alpha', 'beta', 'gamma']);
    // All three should be removed from ungrouped
    expect(mergedGroups[0].removedTokens.sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('does not create singletons when the model returns all pages', async () => {
    const fetches = [deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    const mergedGroups: { groupCount: number; tokens: string[] }[] = [];
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async ({ incoming }) => {
      mergedGroups.push({
        groupCount: incoming.length,
        tokens: incoming.flatMap((g) => g.clusters.map((c) => c.tokens)),
      });
      return SHARED_MUTATION_ACCEPTED;
    };

    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const allPages = [alpha, beta];
    const { result } = createHarness(allPages, allPages, applyFilteredAutoGroupBatch);

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    // Model returns both pages -- no singletons needed
    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponse(2));
      await Promise.resolve();
    });

    await waitFor(() => expect(mergedGroups).toHaveLength(1));

    // Exactly 2 groups (one per page), no extra singletons
    expect(mergedGroups[0].groupCount).toBe(2);
    expect(mergedGroups[0].tokens.sort()).toEqual(['alpha', 'beta']);
  });

  it('creates singletons for all unmatched pages when model only groups some', async () => {
    const fetches = [deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    const mergedGroups: { groupCount: number; tokens: string[] }[] = [];
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async ({ incoming }) => {
      mergedGroups.push({
        groupCount: incoming.length,
        tokens: incoming.flatMap((g) => g.clusters.map((c) => c.tokens)),
      });
      return SHARED_MUTATION_ACCEPTED;
    };

    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const gamma = makeCluster('gamma', 'Gamma');
    const delta = makeCluster('delta', 'Delta');
    const allPages = [alpha, beta, gamma, delta];
    const { result } = createHarness(allPages, allPages, applyFilteredAutoGroupBatch);

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    // Model groups alpha+beta together, omits gamma and delta entirely
    await act(async () => {
      fetches[0].resolve({
        ok: true,
        text: vi.fn(async () => ''),
        json: vi.fn(async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [{ pageIds: ['P1', 'P2'] }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        })),
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(mergedGroups).toHaveLength(1));

    // 1 model group (alpha+beta) + 2 singletons (gamma, delta) = 3 groups
    expect(mergedGroups[0].groupCount).toBe(3);
    expect(mergedGroups[0].tokens.sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('normalizes generated groups so accepted pages appear exactly once before persistence', () => {
    const alpha = makeCluster('alpha', 'Alpha');
    const beta = makeCluster('beta', 'Beta');
    const generatedGroups: GroupedCluster[] = [
      {
        id: 'group-alpha',
        groupName: 'Alpha',
        clusters: [alpha],
        totalVolume: alpha.totalVolume,
        keywordCount: alpha.keywordCount,
        avgKd: alpha.avgKd,
        avgKwRating: alpha.avgKwRating,
      },
      {
        id: 'group-duplicate',
        groupName: 'Beta',
        clusters: [alpha, beta],
        totalVolume: alpha.totalVolume + beta.totalVolume,
        keywordCount: alpha.keywordCount + beta.keywordCount,
        avgKd: alpha.avgKd,
        avgKwRating: alpha.avgKwRating,
      },
    ];

    const normalizedGroups = normalizeFilteredAutoGroupIncomingGroups(
      generatedGroups,
      [alpha, beta],
      true,
    );

    expect(normalizedGroups.flatMap((group) => group.clusters.map((page) => page.tokens)).sort()).toEqual([
      'alpha',
      'beta',
    ]);
    expect(normalizedGroups).toHaveLength(2);
    expect(normalizedGroups[0]?.clusters.map((page) => page.tokens)).toEqual(['alpha']);
    expect(normalizedGroups[1]?.clusters.map((page) => page.tokens)).toEqual(['beta']);
  });

  it('treats persistence invariant failures as errors instead of read-only warnings', async () => {
    const fetches = [deferred<any>()];
    let fetchIndex = 0;
    const fetchMock = vi.fn(() => fetches[fetchIndex++]!.promise);
    vi.stubGlobal('fetch', fetchMock);

    const logAndToast = vi.fn();
    const applyFilteredAutoGroupBatch: ApplyFilteredAutoGroupBatch = async () => failedSharedMutation('unknown');
    const alpha = makeCluster('alpha', 'Alpha');
    const { result } = createHarness([alpha], [alpha], applyFilteredAutoGroupBatch, { logAndToast });

    act(() => {
      result.current.handleRunFilteredAutoGroup();
    });

    await act(async () => {
      fetches[0].resolve(buildOpenRouterResponse(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.filteredAutoGroupStats.status).toBe('error'));
    expect(result.current.filteredAutoGroupStats.error).toContain('could not finalize');
    expect(logAndToast.mock.calls.some(([, details]) => String(details).includes('read-only'))).toBe(false);
  });

});
