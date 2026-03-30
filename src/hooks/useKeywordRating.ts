/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ProcessedRow, ClusterSummary, GroupedCluster } from '../types';
import type { GroupReviewSettingsRef, GroupReviewSettingsData } from '../GroupReviewSettings';
import type { ProjectViewState } from '../projectWorkspace';
import type { ToastOptions } from '../ToastContext';
import {
  addOpenRouterUsage,
  applyKeywordRatingsToResults,
  buildKeywordLinesForSummary,
  countKwRatingBucketsForRows,
  fetchCoreIntentSummary,
  fetchSingleKeywordRating,
  formatKeywordRatingDuration,
  keywordRatingRowKey,
  type KeywordRatingSettingsSlice,
  type OpenRouterUsage,
} from '../KeywordRatingEngine';
import { rebuildClusters as rebuildClustersFromRows, refreshGroupsFromClusterSummaries } from '../tokenMerge';
import { getCloudSyncSnapshot } from '../cloudSyncStatus';

interface UseKeywordRatingParams {
  resultsRef: React.MutableRefObject<ProcessedRow[] | null>;
  groupedClustersRef: React.MutableRefObject<GroupedCluster[]>;
  approvedGroupsRef: React.MutableRefObject<GroupedCluster[]>;
  clusterSummaryRef: React.MutableRefObject<ClusterSummary[] | null>;
  groupReviewSettingsRef: React.RefObject<GroupReviewSettingsRef | null>;
  groupReviewSettingsSnapshot: GroupReviewSettingsData | null;
  results: ProcessedRow[] | null;
  hasBlockedToken: (tokenArr: string[]) => boolean;
  addToast: (msg: string, type: 'success' | 'info' | 'warning' | 'error', options?: ToastOptions) => void;
  bulkSet: (data: Partial<ProjectViewState>) => void;
  activeProjectId: string | null;
  flushNow: () => Promise<void>;
}

export type KwRatingJobState = {
  phase: 'idle' | 'summary' | 'rating' | 'done' | 'error';
  progress: number;
  done: number;
  total: number;
  n1: number;
  n2: number;
  n3: number;
  error: string | null;
  apiErrors: number;
  costUsdTotal: number;
  costReported: boolean;
  promptTokens: number;
  completionTokens: number;
  apiCalls: number;
  elapsedMs: number;
};

const INITIAL_KW_RATING_JOB: KwRatingJobState = {
  phase: 'idle',
  progress: 0,
  done: 0,
  total: 0,
  n1: 0,
  n2: 0,
  n3: 0,
  error: null,
  apiErrors: 0,
  costUsdTotal: 0,
  costReported: false,
  promptTokens: 0,
  completionTokens: 0,
  apiCalls: 0,
  elapsedMs: 0,
};

export function useKeywordRating({
  resultsRef,
  groupedClustersRef,
  approvedGroupsRef,
  clusterSummaryRef,
  groupReviewSettingsRef,
  groupReviewSettingsSnapshot,
  results,
  hasBlockedToken,
  addToast,
  bulkSet,
  activeProjectId,
  flushNow,
}: UseKeywordRatingParams) {
  const kwRatingAbortRef = useRef<AbortController | null>(null);
  const kwRatingJobStartRef = useRef(0);

  const [kwRatingJob, setKwRatingJob] = useState<KwRatingJobState>(INITIAL_KW_RATING_JOB);

  // Restore rating job UI after refresh: kwRating lives on results; job state is not persisted.
  useEffect(() => {
    if (!results?.length) return;
    setKwRatingJob(prev => {
      if (prev.phase === 'summary' || prev.phase === 'rating' || prev.phase === 'error') return prev;
      const ratable = results.filter(r => !hasBlockedToken(r.tokenArr));
      if (ratable.length === 0) return prev;
      const done = ratable.filter(r => r.kwRating != null).length;
      const total = ratable.length;
      const { n1, n2, n3 } = countKwRatingBucketsForRows(results, ratable);
      if (done === total) {
        return {
          phase: 'done',
          progress: 100,
          done,
          total,
          n1,
          n2,
          n3,
          error: null,
          apiErrors: 0,
          costUsdTotal: 0,
          costReported: false,
          promptTokens: 0,
          completionTokens: 0,
          apiCalls: 0,
          elapsedMs: 0,
        };
      }
      if (done > 0) {
        return {
          ...prev,
          phase: 'idle',
          progress: Math.round((done / total) * 100),
          done,
          total,
          n1,
          n2,
          n3,
          error: null,
          apiErrors: 0,
          costUsdTotal: 0,
          costReported: false,
          promptTokens: 0,
          completionTokens: 0,
          apiCalls: 0,
          elapsedMs: 0,
        };
      }
      return prev;
    });
  }, [results, hasBlockedToken]);

  // Live elapsed timer while keyword rating runs (summary is one long request).
  useEffect(() => {
    const ph = kwRatingJob.phase;
    if (ph !== 'summary' && ph !== 'rating') return;
    const tick = () => {
      setKwRatingJob(prev => ({
        ...prev,
        elapsedMs: Math.round(performance.now() - kwRatingJobStartRef.current),
      }));
    };
    tick();
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [kwRatingJob.phase]);

  const handleCancelKeywordRating = useCallback(() => {
    kwRatingAbortRef.current?.abort();
  }, []);

  const runKeywordRating = useCallback(async () => {
    const gs = groupReviewSettingsRef.current?.getSettings() ?? groupReviewSettingsSnapshot;
    if (!gs?.apiKey || gs.apiKey.trim().length < 10) {
      addToast('Add an OpenRouter API key in Group Review settings first.', 'error');
      return;
    }
    const raw = resultsRef.current;
    if (!raw || raw.length === 0) {
      addToast('No keywords loaded.', 'error');
      return;
    }
    const rows = raw.filter(r => !hasBlockedToken(r.tokenArr));
    if (rows.length === 0) {
      addToast('No keywords to rate after token blocks.', 'error');
      return;
    }
    kwRatingAbortRef.current?.abort();
    const ac = new AbortController();
    kwRatingAbortRef.current = ac;
    kwRatingJobStartRef.current = performance.now();
    let usageAcc: OpenRouterUsage = { promptTokens: 0, completionTokens: 0, costUsd: null };
    let costReported = false;
    let apiCalls = 0;
    const mergeUsage = (u: OpenRouterUsage) => {
      usageAcc = addOpenRouterUsage(usageAcc, u);
      if (u.costUsd != null) costReported = true;
    };
    const slice: KeywordRatingSettingsSlice = {
      apiKey: gs.apiKey,
      keywordRatingModel: gs.keywordRatingModel,
      fallbackModel: gs.selectedModel,
      temperature: gs.keywordRatingTemperature,
      maxTokens: gs.keywordRatingMaxTokens,
      reasoningEffort: gs.keywordRatingReasoningEffort,
      ratingPrompt: gs.keywordRatingPrompt,
    };
    setKwRatingJob({
      phase: 'summary',
      progress: 0,
      done: 0,
      total: rows.length,
      n1: 0,
      n2: 0,
      n3: 0,
      error: null,
      apiErrors: 0,
      costUsdTotal: 0,
      costReported: false,
      promptTokens: 0,
      completionTokens: 0,
      apiCalls: 0,
      elapsedMs: 0,
    });
    try {
      const lines = buildKeywordLinesForSummary(rows);
      const { summary, usage: summaryUsage } = await fetchCoreIntentSummary(slice, lines, ac.signal);
      mergeUsage(summaryUsage);
      apiCalls += 1;
      const nowIso = new Date().toISOString();
      const gsFresh = groupReviewSettingsRef.current?.getSettings() ?? groupReviewSettingsSnapshot;
      if (gsFresh) {
        groupReviewSettingsRef.current?.updateSettings({
          ...gsFresh,
          keywordCoreIntentSummary: summary,
          keywordCoreIntentSummaryUpdatedAt: nowIso,
        });
      }
      const ratingMap = new Map<string, 1 | 2 | 3>();
      const concurrency = Math.max(1, Math.min(500, gs.keywordRatingConcurrency || 5));
      let done = 0;
      /** Ref updates one frame after bulkSet; keep last merged snapshot so we never clobber with stale ref. */
      let lastMerged: ProcessedRow[] | null = null;
      const elapsedNow = () => Math.round(performance.now() - kwRatingJobStartRef.current);
      setKwRatingJob({
        phase: 'rating',
        progress: 0,
        done: 0,
        total: rows.length,
        n1: 0,
        n2: 0,
        n3: 0,
        error: null,
        apiErrors: 0,
        costUsdTotal: usageAcc.costUsd ?? 0,
        costReported,
        promptTokens: usageAcc.promptTokens,
        completionTokens: usageAcc.completionTokens,
        apiCalls,
        elapsedMs: elapsedNow(),
      });
      for (let i = 0; i < rows.length; i += concurrency) {
        if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const batch = rows.slice(i, i + concurrency);
        const ratings = await Promise.all(
          batch.map(row => fetchSingleKeywordRating(slice, summary, row.keyword, ac.signal)),
        );
        apiCalls += batch.length;
        for (let j = 0; j < batch.length; j++) {
          ratingMap.set(keywordRatingRowKey(batch[j]), ratings[j].rating);
          mergeUsage(ratings[j].usage);
        }
        const base = resultsRef.current ?? lastMerged;
        if (!base || base.length === 0) {
          throw new Error('Keyword data was cleared while rating was in progress.');
        }
        const merged = applyKeywordRatingsToResults(base, ratingMap);
        const newClusterSummary = rebuildClustersFromRows(merged);
        const { groupedClusters: nextGrouped, approvedGroups: nextApproved } = refreshGroupsFromClusterSummaries(
          groupedClustersRef.current,
          approvedGroupsRef.current,
          newClusterSummary,
        );
        // Ref-before-save: next batch reads refs immediately
        resultsRef.current = merged;
        clusterSummaryRef.current = newClusterSummary;
        groupedClustersRef.current = nextGrouped;
        approvedGroupsRef.current = nextApproved;
        bulkSet({
          results: merged,
          clusterSummary: newClusterSummary,
          groupedClusters: nextGrouped,
          approvedGroups: nextApproved,
        });
        lastMerged = merged;
        done += batch.length;
        const batchBuckets = countKwRatingBucketsForRows(merged, rows);
        setKwRatingJob({
          phase: 'rating',
          progress: Math.round((done / rows.length) * 100),
          done,
          total: rows.length,
          n1: batchBuckets.n1,
          n2: batchBuckets.n2,
          n3: batchBuckets.n3,
          error: null,
          apiErrors: 0,
          costUsdTotal: usageAcc.costUsd ?? 0,
          costReported,
          promptTokens: usageAcc.promptTokens,
          completionTokens: usageAcc.completionTokens,
          apiCalls,
          elapsedMs: elapsedNow(),
        });
      }
      const finalMerged = lastMerged ?? resultsRef.current;
      const doneBuckets = finalMerged
        ? countKwRatingBucketsForRows(finalMerged, rows)
        : { n1: 0, n2: 0, n3: 0 };
      const finalElapsed = Math.round(performance.now() - kwRatingJobStartRef.current);
      setKwRatingJob({
        phase: 'done',
        progress: 100,
        done: rows.length,
        total: rows.length,
        n1: doneBuckets.n1,
        n2: doneBuckets.n2,
        n3: doneBuckets.n3,
        error: null,
        apiErrors: 0,
        costUsdTotal: usageAcc.costUsd ?? 0,
        costReported,
        promptTokens: usageAcc.promptTokens,
        completionTokens: usageAcc.completionTokens,
        apiCalls,
        elapsedMs: finalElapsed,
      });
      const costToast =
        costReported && usageAcc.costUsd != null ? ` · $${usageAcc.costUsd.toFixed(4)}` : '';
      await flushNow();
      const cloud = getCloudSyncSnapshot();
      if (activeProjectId && cloud.project.writeFailed) {
        addToast(
          `Keyword rating complete locally, but cloud sync failed. Check Cloud status. ${doneBuckets.n1} / ${doneBuckets.n2} / ${doneBuckets.n3}${costToast}`,
          'warning',
          {
            notification: {
              mode: 'shared',
              source: 'group',
            },
          },
        );
      } else {
        addToast(
          `Keyword rating synced: ${doneBuckets.n1} relevant (1), ${doneBuckets.n2} unsure (2), ${doneBuckets.n3} not relevant (3) · ${formatKeywordRatingDuration(finalElapsed)}${costToast}`,
          'success',
          {
            notification: {
              mode: 'shared',
              source: 'group',
            },
          },
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isAbort =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      if (isAbort) {
        setKwRatingJob({
          phase: 'idle',
          progress: 0,
          done: 0,
          total: 0,
          n1: 0,
          n2: 0,
          n3: 0,
          error: null,
          apiErrors: 0,
          costUsdTotal: 0,
          costReported: false,
          promptTokens: 0,
          completionTokens: 0,
          apiCalls: 0,
          elapsedMs: 0,
        });
        addToast('Keyword rating cancelled.', 'info', {
          notification: {
            mode: 'none',
            source: 'group',
          },
        });
        return;
      }
      setKwRatingJob({
        phase: 'error',
        progress: 0,
        done: 0,
        total: rows.length,
        n1: 0,
        n2: 0,
        n3: 0,
        error: msg,
        apiErrors: 0,
        costUsdTotal: usageAcc.costUsd ?? 0,
        costReported,
        promptTokens: usageAcc.promptTokens,
        completionTokens: usageAcc.completionTokens,
        apiCalls,
        elapsedMs: Math.round(performance.now() - kwRatingJobStartRef.current),
      });
      addToast(msg, 'error', {
        notification: {
          mode: 'shared',
          source: 'group',
        },
      });
    }
  }, [addToast, bulkSet, groupReviewSettingsSnapshot, hasBlockedToken]);

  return {
    kwRatingJob,
    setKwRatingJob,
    runKeywordRating,
    handleCancelKeywordRating,
  };
}
