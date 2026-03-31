/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction, type TransitionStartFunction } from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { OPENROUTER_REQUEST_TIMEOUT_MS, runWithOpenRouterTimeout } from '../openRouterTimeout';
import { getFilteredAutoGroupSettingsStatus } from '../filteredAutoGroupSettingsStatus';
import { buildGroupedClusterFromPages, mergeGroupedClustersByName } from '../groupedClusterUtils';
import { parseFilteredAutoGroupResponse } from '../autoGroupResponseParser';
import { enqueueLatestFilteredAutoGroupJob } from '../filteredAutoGroupQueue';
import type { GroupReviewSettingsData, GroupReviewSettingsRef } from '../GroupReviewSettings';
import type { ClusterSummary, GroupedCluster } from '../types';

export interface FilteredAutoGroupRunStats {
  status: 'idle' | 'running' | 'complete' | 'error';
  totalPages: number;
  groupsCreated: number;
  pagesGrouped: number;
  pagesRemaining: number;
  totalVolumeGrouped: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
  error?: string;
}

interface FilteredAutoGroupJob {
  id: string;
  signature: string;
  pages: ClusterSummary[];
  filterSummary: string;
  settings: GroupReviewSettingsData;
  modelPricing?: { prompt: string; completion: string };
}

interface UseFilteredAutoGroupFlowParams {
  filteredClusters: ClusterSummary[];
  groupReviewSettingsHydrated: boolean;
  groupReviewSettingsSnapshot: GroupReviewSettingsData | null;
  groupReviewSettingsRef: MutableRefObject<GroupReviewSettingsRef | null>;
  isBulkSharedEditBlocked: boolean;
  selectedTokens: Set<string>;
  excludedLabels: Set<string>;
  debouncedSearchQuery: string;
  filterCity: string;
  filterState: string;
  minKwInCluster: string;
  maxKwInCluster: string;
  minVolume: string;
  maxVolume: string;
  minKd: string;
  maxKd: string;
  minKwRating: string;
  maxKwRating: string;
  minLen: string;
  maxLen: string;
  mergeGroupsByName: (params: {
    incoming: GroupedCluster[];
    removedTokens: Set<string>;
    hasReviewApi: boolean;
    mergeFn: typeof mergeGroupedClustersByName;
  }) => boolean;
  pendingFilteredAutoGroupTokens: Set<string>;
  setPendingFilteredAutoGroupTokens: Dispatch<SetStateAction<Set<string>>>;
  setSelectedClusters: Dispatch<SetStateAction<Set<string>>>;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  startTransition: TransitionStartFunction;
  logAndToast: (action: any, details: string, count: number, toastMsg: string, toastType: any) => void;
  recordGroupingEvent: (pagesInBatch: number) => void;
  runWithExclusiveOperation?: <T>(type: 'auto-group', task: () => Promise<T>) => Promise<T | null>;
}

export function useFilteredAutoGroupFlow({
  filteredClusters,
  groupReviewSettingsHydrated,
  groupReviewSettingsSnapshot,
  groupReviewSettingsRef,
  isBulkSharedEditBlocked,
  selectedTokens,
  excludedLabels,
  debouncedSearchQuery,
  filterCity,
  filterState,
  minKwInCluster,
  maxKwInCluster,
  minVolume,
  maxVolume,
  minKd,
  maxKd,
  minKwRating,
  maxKwRating,
  minLen,
  maxLen,
  mergeGroupsByName,
  pendingFilteredAutoGroupTokens,
  setPendingFilteredAutoGroupTokens,
  setSelectedClusters,
  setCurrentPage,
  startTransition,
  logAndToast,
  recordGroupingEvent,
  runWithExclusiveOperation,
}: UseFilteredAutoGroupFlowParams) {
  const filteredAutoGroupAbortRef = useRef<AbortController | null>(null);
  const activeFilteredAutoGroupJobRef = useRef<FilteredAutoGroupJob | null>(null);
  const [isRunningFilteredAutoGroup, setIsRunningFilteredAutoGroup] = useState(false);
  const [filteredAutoGroupQueue, setFilteredAutoGroupQueue] = useState<FilteredAutoGroupJob[]>([]);
  const [filteredAutoGroupStats, setFilteredAutoGroupStats] = useState<FilteredAutoGroupRunStats>({
    status: 'idle',
    totalPages: 0,
    groupsCreated: 0,
    pagesGrouped: 0,
    pagesRemaining: 0,
    totalVolumeGrouped: 0,
    cost: 0,
    promptTokens: 0,
    completionTokens: 0,
    elapsedMs: 0,
  });

  const filteredAutoGroupFilterSummary = useMemo(() => {
    const active: string[] = [];
    if (debouncedSearchQuery.trim()) active.push(`search="${debouncedSearchQuery.trim()}"`);
    if (selectedTokens.size > 0) active.push(`tokens=${Array.from(selectedTokens).join(', ')}`);
    if (excludedLabels.size > 0) active.push(`excluded_labels=${Array.from(excludedLabels).join(', ')}`);
    if (filterCity.trim()) active.push(`city=${filterCity.trim()}`);
    if (filterState.trim()) active.push(`state=${filterState.trim()}`);
    if (minKwInCluster.trim()) active.push(`min_kws=${minKwInCluster.trim()}`);
    if (maxKwInCluster.trim()) active.push(`max_kws=${maxKwInCluster.trim()}`);
    if (minVolume.trim()) active.push(`min_volume=${minVolume.trim()}`);
    if (maxVolume.trim()) active.push(`max_volume=${maxVolume.trim()}`);
    if (minKd.trim()) active.push(`min_kd=${minKd.trim()}`);
    if (maxKd.trim()) active.push(`max_kd=${maxKd.trim()}`);
    if (minKwRating.trim()) active.push(`min_kw_rating=${minKwRating.trim()}`);
    if (maxKwRating.trim()) active.push(`max_kw_rating=${maxKwRating.trim()}`);
    if (minLen.trim()) active.push(`min_len=${minLen.trim()}`);
    if (maxLen.trim()) active.push(`max_len=${maxLen.trim()}`);
    return active.length > 0 ? active.join(' | ') : 'No additional filters active';
  }, [
    debouncedSearchQuery,
    excludedLabels,
    filterCity,
    filterState,
    maxKd,
    maxKwInCluster,
    maxKwRating,
    maxLen,
    maxVolume,
    minKd,
    minKwInCluster,
    minKwRating,
    minLen,
    minVolume,
    selectedTokens,
  ]);

  const isFilteredAutoGroupFilterActive = filteredAutoGroupFilterSummary !== 'No additional filters active';
  const canRunFilteredAutoGroup = !isBulkSharedEditBlocked && isFilteredAutoGroupFilterActive && filteredClusters.length >= 1;
  const filteredAutoGroupSettingsStatus = useMemo(
    () => getFilteredAutoGroupSettingsStatus(groupReviewSettingsHydrated, groupReviewSettingsSnapshot),
    [groupReviewSettingsHydrated, groupReviewSettingsSnapshot],
  );

  const buildFilteredAutoGroupPrompt = useCallback((pages: ClusterSummary[], filterSummary: string, basePrompt: string) => {
    const pageLines = pages
      .map(
        (page, idx) =>
          `P${idx + 1} | ${page.pageName} | volume=${page.totalVolume} | kd=${page.avgKd ?? 'n/a'} | kws=${page.keywordCount}`,
      )
      .join('\n');

    const system = `${basePrompt}

You are reviewing the currently filtered ungrouped pages from the keyword management tab.

STRICT REQUIREMENTS:
1. Review all provided pages together and group them by COMPLETE core semantic intent only.
2. Use strict matching. Do not merge pages unless their underlying search intent is effectively identical.
3. Minor lexical variation is fine only if it does not change meaning at all.
4. Volume and KD are context signals. They can help determine the strongest representative page, but semantic intent is the deciding factor.
5. You must partition the full filtered page set into as MANY distinct semantic groups as needed. There is no group limit.
6. Never force unrelated pages into one catch-all group. Returning one massive group is WRONG unless every single page has the exact same intent.
7. For each distinct semantic intent, create a separate group. Distinct intents must become separate groups.
8. Single-page groups are allowed and must still be returned as valid groups when no exact semantic match exists.
9. The highest-volume page inside each group will become the final group name in the app, so group pages strictly and intelligently.
10. Every page must appear exactly once in exactly one group.
11. Return valid JSON only.

JSON SCHEMA:
{
  "groups": [
    { "pageIds": ["P1", "P4"] },
    { "pageIds": ["P2", "P3", "P8"] },
    { "pageIds": ["P5"] }
  ]
}

LEGACY-COMPATIBLE SCHEMA ALSO ACCEPTED:
{
  "groups": [
    { "pages": ["exact page name 1", "exact page name 2"] },
    { "pages": ["exact page name 3", "exact page name 4", "exact page name 5"] },
    { "pages": ["exact page name 6"] }
  ]
}

FAILURE CONDITIONS TO AVOID:
- Do not return one giant group just because the pages share a broad topic.
- Do not merge informational, comparison, review, pricing, legal, tool, local, and transactional intents together.
- Do not merge broad head terms with narrower sub-intents unless they are truly the exact same search intent.
- If two pages would deserve different landing pages, they must be different groups.`;

    const user = `Current filters:\n${filterSummary}\n\nFiltered ungrouped pages (${pages.length}):\n${pageLines}\n\nGroup ALL of these pages in one pass. Create multiple groups whenever the semantic intent differs. Prefer pageIds. If you do not use pageIds, use exact page names. Return every page exactly once inside groups[].`;

    return { system, user };
  }, []);

  const runFilteredAutoGroupJob = useCallback(async (job: FilteredAutoGroupJob) => {
    const pagesToReview = job.pages;
    const controller = new AbortController();
    activeFilteredAutoGroupJobRef.current = job;
    filteredAutoGroupAbortRef.current = controller;
    setIsRunningFilteredAutoGroup(true);
    setFilteredAutoGroupStats({
      status: 'running',
      totalPages: pagesToReview.length,
      groupsCreated: 0,
      pagesGrouped: 0,
      pagesRemaining: 0,
      totalVolumeGrouped: 0,
      cost: 0,
      promptTokens: 0,
      completionTokens: 0,
      elapsedMs: 0,
    });
    logAndToast(
      'auto-group',
      `Filtered Auto Group started on ${pagesToReview.length} pages`,
      pagesToReview.length,
      `Auto Group started for ${pagesToReview.length} filtered pages`,
      'info',
    );

    const startedAt = performance.now();

    try {
      const { system, user } = buildFilteredAutoGroupPrompt(
        pagesToReview,
        job.filterSummary,
        job.settings.autoGroupPrompt,
      );

      const timedResponse = await runWithOpenRouterTimeout({
        signal: controller.signal,
        timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
        run: async (requestSignal) =>
          fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${job.settings.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': window.location.origin,
            },
            body: JSON.stringify({
              model: job.settings.selectedModel,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              temperature: job.settings.temperature,
              ...(job.settings.maxTokens > 0 ? { max_tokens: job.settings.maxTokens } : {}),
              ...(job.settings.reasoningEffort && job.settings.reasoningEffort !== 'none'
                ? { reasoning: { effort: job.settings.reasoningEffort } }
                : {}),
              response_format: { type: 'json_object' },
            }),
            signal: requestSignal,
          }),
      });
      const response = timedResponse.result;

      if (!response.ok) {
        const errText = (
          await runWithOpenRouterTimeout({
            signal: controller.signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async () => response.text().catch(() => ''),
          }).catch(() => ({ result: '' }))
        ).result;
        throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = (
        await runWithOpenRouterTimeout({
          signal: controller.signal,
          timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          run: async () => response.json(),
        })
      ).result;
      const content = data.choices?.[0]?.message?.content || '';
      const parsedGroups = parseFilteredAutoGroupResponse(content, pagesToReview);
      if (parsedGroups.length === 0) throw new Error('Model returned no usable groups');

      const hasReviewApi = groupReviewSettingsRef.current?.hasApiKey() ?? false;
      const generatedGroups: GroupedCluster[] = parsedGroups
        .filter((groupPages) => groupPages.length >= 1)
        .map((groupPages) =>
          buildGroupedClusterFromPages(groupPages, hasReviewApi, {
            id: `filtered_auto_group_${Date.now()}_${groupPages[0].tokens}`,
          }),
        );

      const groupedTokens = new Set(generatedGroups.flatMap((group) => group.clusters.map((page) => page.tokens)));
      const groupedVolume = generatedGroups.reduce((sum, group) => sum + group.totalVolume, 0);
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const cost = job.modelPricing
        ? promptTokens * parseFloat(job.modelPricing.prompt || '0') +
          completionTokens * parseFloat(job.modelPricing.completion || '0')
        : 0;

      const groupsApplied =
        !isBulkSharedEditBlocked && generatedGroups.length > 0
          ? mergeGroupsByName({
              incoming: generatedGroups,
              removedTokens: groupedTokens,
              hasReviewApi,
              mergeFn: mergeGroupedClustersByName,
            })
          : false;

      if (groupsApplied) {
        startTransition(() => {
          setSelectedClusters(new Set());
          setCurrentPage(1);
        });
      }

      setPendingFilteredAutoGroupTokens((prev) => {
        const next = new Set(prev);
        for (const page of pagesToReview) next.delete(page.tokens);
        return next;
      });

      const elapsedMs = Math.round(performance.now() - startedAt);
      setFilteredAutoGroupStats({
        status: 'complete',
        totalPages: pagesToReview.length,
        groupsCreated: groupsApplied ? generatedGroups.length : 0,
        pagesGrouped: groupsApplied ? groupedTokens.size : 0,
        pagesRemaining: pagesToReview.length - (groupsApplied ? groupedTokens.size : 0),
        totalVolumeGrouped: groupsApplied ? groupedVolume : 0,
        cost,
        promptTokens,
        completionTokens,
        elapsedMs,
      });

      if (groupsApplied && groupedTokens.size > 0) recordGroupingEvent(groupedTokens.size);
      if (groupsApplied && groupedTokens.size > 0) {
        logAndToast(
          'auto-group',
          `Filtered Auto Group created ${generatedGroups.length} groups from ${pagesToReview.length} filtered pages`,
          groupedTokens.size,
          `Auto Group grouped ${groupedTokens.size}/${pagesToReview.length} filtered pages into ${generatedGroups.length} groups`,
          'success',
        );
      } else if (generatedGroups.length > 0) {
        logAndToast(
          'auto-group',
          'Filtered Auto Group could not apply groups while shared edits are read-only',
          0,
          'Auto Group finished generating candidate groups, but shared edits are currently read-only so nothing was applied.',
          'warning',
        );
      } else {
        logAndToast(
          'auto-group',
          'Filtered Auto Group returned only singleton/no-op results',
          0,
          `Auto Group reviewed ${pagesToReview.length} pages but did not return any usable groups. Adjust the Auto-Group Prompt or filters.`,
          'info',
        );
      }
    } catch (error: any) {
      setPendingFilteredAutoGroupTokens((prev) => {
        const next = new Set(prev);
        for (const page of pagesToReview) next.delete(page.tokens);
        return next;
      });
      if (error.name === 'AbortError') {
        setFilteredAutoGroupStats((prev) => ({
          ...prev,
          status: 'idle',
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
      } else {
        setFilteredAutoGroupStats((prev) => ({
          ...prev,
          status: 'error',
          error: error.message || 'Unknown error',
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
        logAndToast('auto-group', `Filtered Auto Group error: ${error.message}`, 0, `Auto Group error: ${error.message}`, 'error');
      }
    } finally {
      setIsRunningFilteredAutoGroup(false);
      filteredAutoGroupAbortRef.current = null;
      activeFilteredAutoGroupJobRef.current = null;
    }
  }, [buildFilteredAutoGroupPrompt, groupReviewSettingsRef, isBulkSharedEditBlocked, logAndToast, mergeGroupsByName, recordGroupingEvent, setCurrentPage, setSelectedClusters, startTransition]);

  const runLockedFilteredAutoGroupJob = useCallback(async (job: FilteredAutoGroupJob) => {
    if (runWithExclusiveOperation) {
      await runWithExclusiveOperation('auto-group', () => runFilteredAutoGroupJob(job));
      return;
    }
    await runFilteredAutoGroupJob(job);
  }, [runFilteredAutoGroupJob, runWithExclusiveOperation]);

  const handleRunFilteredAutoGroup = useCallback(() => {
    if (isBulkSharedEditBlocked) {
      logAndToast(
        'auto-group',
        'Filtered Auto Group blocked while shared edits are read-only',
        0,
        'Shared state is currently read-only, so Auto Group cannot apply new groups right now.',
        'warning',
      );
      return;
    }
    if (!isFilteredAutoGroupFilterActive) {
      logAndToast(
        'auto-group',
        'Filtered Auto Group blocked: activate filters first',
        0,
        'Activate at least one filter (search/tokens/city/state/keyword/volume/KD/len) before using Auto Group.',
        'info',
      );
      return;
    }
    if (filteredClusters.length < 1) {
      logAndToast(
        'auto-group',
        'Filtered Auto Group blocked: no matching pages',
        0,
        'No ungrouped pages match your current filters. Adjust filters and try again.',
        'info',
      );
      return;
    }
    if (!groupReviewSettingsHydrated) {
      logAndToast(
        'auto-group',
        'Filtered Auto Group waiting for shared AI settings',
        0,
        'Shared Group Review settings are still loading. Try again in a moment.',
        'info',
      );
      return;
    }
    const settingsData = groupReviewSettingsRef.current?.getSettings();
    const modelObj = groupReviewSettingsRef.current?.getSelectedModelObj();
    if (!settingsData || !settingsData.apiKey.trim() || !settingsData.selectedModel) {
      logAndToast(
        'auto-group',
        'Filtered Auto Group blocked: missing shared AI settings',
        0,
        'Set an API key and model in Group Review settings before using Auto Group.',
        'error',
      );
      return;
    }

    const pagesToReview = [...filteredClusters];
    const job: FilteredAutoGroupJob = {
      id: `filtered-auto-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      signature: JSON.stringify({
        tokens: pagesToReview.map((page) => page.tokens).sort(),
        filterSummary: filteredAutoGroupFilterSummary,
        model: settingsData.selectedModel,
        temperature: settingsData.temperature,
        prompt: settingsData.autoGroupPrompt,
      }),
      pages: pagesToReview,
      filterSummary: filteredAutoGroupFilterSummary,
      settings: { ...settingsData },
      modelPricing: modelObj?.pricing,
    };

    setPendingFilteredAutoGroupTokens((prev) => {
      const next = new Set(prev);
      for (const page of pagesToReview) next.add(page.tokens);
      return next;
    });

    if (isRunningFilteredAutoGroup || filteredAutoGroupQueue.length > 0) {
      setFilteredAutoGroupQueue((prev) => enqueueLatestFilteredAutoGroupJob(prev, job));
      logAndToast(
        'auto-group',
        `Queued Auto Group job for ${pagesToReview.length} pages`,
        pagesToReview.length,
        'Auto Group will run the latest pending filtered job after the current run finishes.',
        'info',
      );
      return;
    }

    void runLockedFilteredAutoGroupJob(job);
  }, [
    filteredAutoGroupFilterSummary,
    filteredAutoGroupQueue.length,
    filteredClusters,
    groupReviewSettingsHydrated,
    groupReviewSettingsRef,
    isFilteredAutoGroupFilterActive,
    isRunningFilteredAutoGroup,
    isBulkSharedEditBlocked,
    logAndToast,
    runLockedFilteredAutoGroupJob,
  ]);

  const handleStopFilteredAutoGroup = useCallback(() => {
    filteredAutoGroupAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (isRunningFilteredAutoGroup) return;
    if (activeFilteredAutoGroupJobRef.current) return;
    if (isBulkSharedEditBlocked) {
      if (filteredAutoGroupQueue.length > 0) {
        setPendingFilteredAutoGroupTokens((prev) => {
          const next = new Set(prev);
          for (const queuedJob of filteredAutoGroupQueue) {
            for (const page of queuedJob.pages) next.delete(page.tokens);
          }
          return next;
        });
        setFilteredAutoGroupQueue([]);
      }
      return;
    }
    if (filteredAutoGroupQueue.length === 0) return;
    const [nextJob, ...rest] = filteredAutoGroupQueue;
    setFilteredAutoGroupQueue(rest);
    void runLockedFilteredAutoGroupJob(nextJob);
  }, [filteredAutoGroupQueue, isBulkSharedEditBlocked, isRunningFilteredAutoGroup, runLockedFilteredAutoGroupJob, setPendingFilteredAutoGroupTokens]);

  useEffect(() => {
    if (!isBulkSharedEditBlocked) return;
    filteredAutoGroupAbortRef.current?.abort();
  }, [isBulkSharedEditBlocked]);

  useEffect(() => () => {
    filteredAutoGroupAbortRef.current?.abort();
  }, []);

  return {
    canRunFilteredAutoGroup,
    filteredAutoGroupFilterSummary,
    filteredAutoGroupQueue,
    filteredAutoGroupSettingsStatus,
    filteredAutoGroupStats,
    handleRunFilteredAutoGroup,
    handleStopFilteredAutoGroup,
    isFilteredAutoGroupFilterActive,
    isRunningFilteredAutoGroup,
    pendingFilteredAutoGroupTokens,
    setPendingFilteredAutoGroupTokens,
  };
}
