/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { fetchOpenRouterEmbeddings } from '../embeddingSimilarity';
import type { GroupReviewSettingsData, GroupReviewSettingsRef } from '../GroupReviewSettings';
import {
  buildGroupAutoMergeFingerprint,
  buildGroupAutoMergeSource,
  compareGroupAutoMergeSources,
  isGroupMergeRecommendationSetStale,
  markGroupAutoMergeRecommendationsStatus,
  mergeGroupAutoMergeRecommendationsAfterRun,
  resolveGroupAutoMergeSelection,
} from '../groupAutoMergeEngine';
import type { GroupMergeRecommendation, GroupedCluster } from '../types';
import { isAcceptedSharedMutation, type SharedMutationResult } from '../sharedMutation';

interface UseGroupAutoMergeParams {
  groupedClusters: GroupedCluster[];
  groupedClustersRef: MutableRefObject<GroupedCluster[]>;
  approvedGroups: GroupedCluster[];
  approvedGroupsRef: MutableRefObject<GroupedCluster[]>;
  groupMergeRecommendations: GroupMergeRecommendation[];
  groupMergeRecommendationsRef: MutableRefObject<GroupMergeRecommendation[]>;
  groupReviewSettingsRef: RefObject<GroupReviewSettingsRef | null>;
  groupReviewSettingsSnapshot: GroupReviewSettingsData | null;
  updateGroupMergeRecommendations: (recommendations: GroupMergeRecommendation[]) => Promise<SharedMutationResult>;
  bulkSet: (data: {
    groupedClusters?: GroupedCluster[];
    approvedGroups?: GroupedCluster[];
    groupMergeRecommendations?: GroupMergeRecommendation[];
  }) => Promise<SharedMutationResult>;
  addToast: (msg: string, type: 'success' | 'info' | 'warning' | 'error') => void;
  logAndToast: (
    action: 'merge',
    details: string,
    count: number,
    toastMsg: string,
    toastType?: 'success' | 'info' | 'warning' | 'error',
  ) => void;
  flushNow: () => Promise<void>;
  runWithExclusiveOperation?: <T>(type: 'auto-group', task: () => Promise<T>) => Promise<T | null>;
}

export interface GroupAutoMergeJobState {
  phase: 'idle' | 'embedding' | 'comparing' | 'ranking' | 'complete' | 'error';
  progress: number;
  groupsScanned: number;
  pairsCompared: number;
  matchesKept: number;
  tokensUsed: number;
  apiCalls: number;
  costUsdTotal: number;
  elapsedMs: number;
  error: string | null;
}

const INITIAL_JOB: GroupAutoMergeJobState = {
  phase: 'idle',
  progress: 0,
  groupsScanned: 0,
  pairsCompared: 0,
  matchesKept: 0,
  tokensUsed: 0,
  apiCalls: 0,
  costUsdTotal: 0,
  elapsedMs: 0,
  error: null,
};

export function useGroupAutoMerge({
  groupedClusters,
  groupedClustersRef,
  approvedGroups,
  approvedGroupsRef,
  groupMergeRecommendations,
  groupMergeRecommendationsRef,
  groupReviewSettingsRef,
  groupReviewSettingsSnapshot,
  updateGroupMergeRecommendations,
  bulkSet,
  addToast,
  logAndToast,
  flushNow,
  runWithExclusiveOperation,
}: UseGroupAutoMergeParams) {
  const [job, setJob] = useState<GroupAutoMergeJobState>(INITIAL_JOB);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const recommendations = useMemo(
    () => (Array.isArray(groupMergeRecommendations) ? groupMergeRecommendations : []),
    [groupMergeRecommendations],
  );

  const allGroups = useMemo(
    () => [...groupedClusters, ...approvedGroups],
    [groupedClusters, approvedGroups],
  );

  const currentFingerprint = useMemo(
    () => buildGroupAutoMergeFingerprint(allGroups),
    [allGroups],
  );

  const recommendationsAreStale = useMemo(
    () => isGroupMergeRecommendationSetStale(recommendations, currentFingerprint),
    [currentFingerprint, recommendations],
  );

  const recommendationsByGroupId = useMemo(() => {
    const byGroupId = new Map<string, number>();
    for (const recommendation of recommendations) {
      if (recommendation.status !== 'pending') continue;
      byGroupId.set(recommendation.groupA.id, (byGroupId.get(recommendation.groupA.id) || 0) + 1);
      byGroupId.set(recommendation.groupB.id, (byGroupId.get(recommendation.groupB.id) || 0) + 1);
    }
    return byGroupId;
  }, [recommendations]);

  useEffect(() => {
    if (job.phase !== 'embedding' && job.phase !== 'comparing' && job.phase !== 'ranking') return;
    const timer = setInterval(() => {
      setJob((prev) => ({
        ...prev,
        elapsedMs: Math.round(performance.now() - startedAtRef.current),
      }));
    }, 250);
    return () => clearInterval(timer);
  }, [job.phase]);

  const resetJob = useCallback(() => {
    setJob(INITIAL_JOB);
  }, []);

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const flushWithErrorToast = useCallback(async (messagePrefix: string): Promise<boolean> => {
    try {
      await flushNow();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addToast(`${messagePrefix}: ${message}`, 'error');
      return false;
    }
  }, [addToast, flushNow]);

  const runRecommendations = useCallback(async () => {
    const settings = groupReviewSettingsRef.current?.getSettings() ?? groupReviewSettingsSnapshot;
    const grouped = groupedClustersRef.current;
    const approved = approvedGroupsRef.current;
    if (!settings?.apiKey || settings.apiKey.trim().length < 10) {
      addToast('Add an OpenRouter API key in Group Review settings first.', 'error');
      return;
    }
    if (!settings.groupAutoMergeEmbeddingModel.trim()) {
      addToast('Choose a group auto-merge embedding model in Group Review settings.', 'error');
      return;
    }
    if (grouped.length + approved.length < 2) {
      addToast('Need at least 2 groups across Grouped and Approved before Auto Merge can compare them.', 'info');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = performance.now();

    const groupedIdSet = new Set(grouped.map((group) => group.id));
    const groupsSnapshot = [...grouped, ...approved];
    const sourceFingerprint = buildGroupAutoMergeFingerprint(groupsSnapshot);
    const sources = groupsSnapshot.map((group) =>
      buildGroupAutoMergeSource(group, groupedIdSet.has(group.id) ? 'grouped' : 'approved'),
    );
    const totalPairs = (sources.length * (sources.length - 1)) / 2;

    setJob({
      phase: 'embedding',
      progress: 0,
      groupsScanned: sources.length,
      pairsCompared: 0,
      matchesKept: 0,
      tokensUsed: 0,
      apiCalls: 0,
      costUsdTotal: 0,
      elapsedMs: 0,
      error: null,
    });

    try {
      await Promise.resolve();
      const embeddingResult = await fetchOpenRouterEmbeddings(
        sources.map((source) => source.embeddingText),
        settings.apiKey,
        settings.groupAutoMergeEmbeddingModel,
        controller.signal,
        (completedBatches, totalBatches) => {
          const fraction = totalBatches > 0 ? completedBatches / totalBatches : 1;
          setJob((prev) => ({
            ...prev,
            phase: 'embedding',
            progress: Math.round(fraction * 50),
            apiCalls: completedBatches,
            elapsedMs: Math.round(performance.now() - startedAtRef.current),
          }));
        },
      );

      setJob((prev) => ({
        ...prev,
        phase: 'comparing',
        progress: 50,
        tokensUsed: embeddingResult.tokensUsed,
        apiCalls: Math.max(prev.apiCalls, 1),
        costUsdTotal: embeddingResult.cost,
      }));

      const freshRecommendations = await compareGroupAutoMergeSources({
        sources,
        vectors: embeddingResult.vectors,
        sourceFingerprint,
        minSimilarity: settings.groupAutoMergeMinSimilarity,
        signal: controller.signal,
        onProgress: ({ comparedPairs, keptPairs }) => {
          const fraction = totalPairs > 0 ? comparedPairs / totalPairs : 1;
          setJob((prev) => ({
            ...prev,
            phase: 'comparing',
            progress: 50 + Math.round(fraction * 45),
            pairsCompared: comparedPairs,
            matchesKept: keptPairs,
            tokensUsed: embeddingResult.tokensUsed,
            costUsdTotal: embeddingResult.cost,
            elapsedMs: Math.round(performance.now() - startedAtRef.current),
          }));
        },
      });

      const nextRecommendations = mergeGroupAutoMergeRecommendationsAfterRun(
        Array.isArray(groupMergeRecommendationsRef.current) ? groupMergeRecommendationsRef.current : [],
        freshRecommendations,
        sourceFingerprint,
      );

      const persistRecommendations = async () => {
        const result = await updateGroupMergeRecommendations(nextRecommendations);
        if (!isAcceptedSharedMutation(result)) return false;
        groupMergeRecommendationsRef.current = nextRecommendations;
        return flushWithErrorToast('Auto Merge generated recommendations locally, but shared sync failed');
      };
      const persisted = runWithExclusiveOperation
        ? await runWithExclusiveOperation('auto-group', persistRecommendations)
        : await persistRecommendations();
      if (!persisted) {
        setJob((prev) => ({
          ...prev,
          phase: 'error',
          error: 'Failed to persist shared auto-merge recommendations.',
          elapsedMs: Math.round(performance.now() - startedAtRef.current),
        }));
        return;
      }

      const runFinishedStale =
        buildGroupAutoMergeFingerprint([...groupedClustersRef.current, ...approvedGroupsRef.current]) !== sourceFingerprint;

      setJob({
        phase: 'complete',
        progress: 100,
        groupsScanned: sources.length,
        pairsCompared: totalPairs,
        matchesKept: nextRecommendations.filter((recommendation) => recommendation.status === 'pending').length,
        tokensUsed: embeddingResult.tokensUsed,
        apiCalls: Math.max(1, Math.ceil(sources.length / 100)),
        costUsdTotal: embeddingResult.cost,
        elapsedMs: Math.round(performance.now() - startedAtRef.current),
        error: null,
      });

      if (runFinishedStale) {
        addToast('Auto Merge finished, but grouped data changed during the run. Recommendations are stale; click Embed again.', 'warning');
      } else if (nextRecommendations.length === 0) {
        addToast('Auto Merge finished. No semantic duplicate recommendations met the current threshold.', 'info');
      } else {
        addToast(`Auto Merge finished with ${nextRecommendations.length} recommendation${nextRecommendations.length === 1 ? '' : 's'}.`, 'success');
      }
    } catch (error) {
      const isAbort =
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError');
      if (isAbort) {
        resetJob();
        addToast('Auto Merge cancelled.', 'info');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setJob((prev) => ({
        ...prev,
        phase: 'error',
        error: message,
        elapsedMs: Math.round(performance.now() - startedAtRef.current),
      }));
      addToast(message, 'error');
    }
  }, [addToast, flushWithErrorToast, groupReviewSettingsSnapshot, resetJob, runWithExclusiveOperation, updateGroupMergeRecommendations]);

  const dismissRecommendations = useCallback(async (recommendationIds: Iterable<string>) => {
    const reviewedAt = new Date().toISOString();
    const nextRecommendations = markGroupAutoMergeRecommendationsStatus(
      Array.isArray(groupMergeRecommendationsRef.current) ? groupMergeRecommendationsRef.current : [],
      recommendationIds,
      'dismissed',
      reviewedAt,
    );
    const persistDismissal = async () => {
      const result = await updateGroupMergeRecommendations(nextRecommendations);
      if (!isAcceptedSharedMutation(result)) return false;
      groupMergeRecommendationsRef.current = nextRecommendations;
      return flushWithErrorToast('Auto Merge dismissal updated locally, but shared sync failed');
    };
    const persisted = runWithExclusiveOperation
      ? await runWithExclusiveOperation('auto-group', persistDismissal)
      : await persistDismissal();
    return Boolean(persisted);
  }, [flushWithErrorToast, runWithExclusiveOperation, updateGroupMergeRecommendations]);

  const applyRecommendations = useCallback(async (recommendationIds: Iterable<string>) => {
    const currentRecommendations = Array.isArray(groupMergeRecommendationsRef.current)
      ? groupMergeRecommendationsRef.current
      : [];
    const combinedFingerprint = buildGroupAutoMergeFingerprint([...groupedClustersRef.current, ...approvedGroupsRef.current]);
    if (isGroupMergeRecommendationSetStale(currentRecommendations, combinedFingerprint)) {
      addToast('These recommendations are stale because group data changed. Click Embed again before merging.', 'warning');
      return false;
    }

    const hasReviewApi = Boolean(groupReviewSettingsRef.current?.hasApiKey() ?? groupReviewSettingsSnapshot?.apiKey?.trim());
    const resolution = resolveGroupAutoMergeSelection({
      groupedClusters: groupedClustersRef.current,
      approvedGroups: approvedGroupsRef.current,
      recommendations: currentRecommendations,
      selectedRecommendationIds: recommendationIds,
      hasReviewApi,
    });

    if (resolution.mergedGroups.length === 0) {
      addToast('No selected recommendations could be merged. They may already be stale or resolved.', 'info');
      return false;
    }

    const reviewedAt = new Date().toISOString();
    const nextRecommendations = markGroupAutoMergeRecommendationsStatus(
      currentRecommendations,
      resolution.appliedRecommendationIds,
      'accepted',
      reviewedAt,
    );
    const nextGrouped = [
      ...groupedClustersRef.current.filter((group) => !resolution.removedGroupIds.has(group.id)),
      ...resolution.mergedGroups,
    ].sort((a, b) => b.totalVolume - a.totalVolume);
    const nextApproved = approvedGroupsRef.current.filter(
      (group) => !resolution.removedApprovedGroupIds.has(group.id),
    );

    const persistApply = async () => {
      const result = await bulkSet({
        groupedClusters: nextGrouped,
        approvedGroups: nextApproved,
        groupMergeRecommendations: nextRecommendations,
      });
      if (!isAcceptedSharedMutation(result)) return false;
      groupedClustersRef.current = nextGrouped;
      approvedGroupsRef.current = nextApproved;
      groupMergeRecommendationsRef.current = nextRecommendations;
      return flushWithErrorToast('Auto Merge applied locally, but shared sync failed');
    };
    const persisted = runWithExclusiveOperation
      ? await runWithExclusiveOperation('auto-group', persistApply)
      : await persistApply();
    if (!persisted) return false;

    const mergedNames = resolution.mergedGroups.map((group) => `'${group.groupName}'`).join(', ');
    const revertedCount = resolution.removedApprovedGroupIds.size;
    const revertNote = revertedCount > 0
      ? ` ${revertedCount} approved group${revertedCount === 1 ? '' : 's'} reverted to Grouped.`
      : '';
    logAndToast(
      'merge',
      `Auto-merged semantic duplicate groups into ${mergedNames}`,
      resolution.removedGroupIds.size,
      `Auto-merged ${resolution.removedGroupIds.size} group${resolution.removedGroupIds.size === 1 ? '' : 's'}.${revertNote}`,
      'success',
    );
    return true;
  }, [addToast, bulkSet, flushWithErrorToast, groupReviewSettingsSnapshot, logAndToast, runWithExclusiveOperation]);

  return {
    job,
    recommendationsAreStale,
    currentFingerprint,
    recommendationsByGroupId,
    runRecommendations,
    cancelRun,
    dismissRecommendations,
    applyRecommendations,
  };
}
