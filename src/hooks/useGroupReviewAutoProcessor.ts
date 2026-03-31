import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { processReviewQueue, type ReviewError, type ReviewRequest, type ReviewResult } from '../GroupReviewEngine';
import { healReviewingGroups } from '../groupReviewState';
import type { GroupReviewSettingsRef } from '../GroupReviewSettings';
import type { GroupedCluster } from '../types';

interface UseGroupReviewAutoProcessorParams {
  groupedClusters: GroupedCluster[];
  isRoutineSharedEditBlocked: boolean;
  groupReviewSettingsRef: MutableRefObject<GroupReviewSettingsRef | null>;
  persistenceUpdateGroups: (updater: (groups: GroupedCluster[]) => GroupedCluster[]) => void;
  logAndToast: (action: any, details: string, count: number, toastMsg: string, toastType: any) => void;
}

export function useGroupReviewAutoProcessor({
  groupedClusters,
  isRoutineSharedEditBlocked,
  groupReviewSettingsRef,
  persistenceUpdateGroups,
  logAndToast,
}: UseGroupReviewAutoProcessorParams) {
  const reviewAbortRef = useRef<AbortController | null>(null);
  const reviewProcessingRef = useRef(false);
  const isRoutineSharedEditBlockedRef = useRef(false);
  const reReviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reReviewGroupIds = useRef<Set<string>>(new Set());

  const scheduleReReview = useCallback((groupIds: string[]) => {
    groupIds.forEach((id) => reReviewGroupIds.current.add(id));
    if (reReviewTimerRef.current) clearTimeout(reReviewTimerRef.current);
    reReviewTimerRef.current = setTimeout(() => {
      reReviewTimerRef.current = null;
      const ids = new Set(reReviewGroupIds.current);
      reReviewGroupIds.current.clear();
      if (ids.size === 0) return;
      const hasReviewApi = groupReviewSettingsRef.current?.hasApiKey() ?? false;
      if (!hasReviewApi) return;
      persistenceUpdateGroups((groups) =>
        groups.map((group) =>
          ids.has(group.id) && group.clusters.length > 0
            ? { ...group, reviewStatus: 'pending' as const, reviewMismatchedPages: undefined, reviewReason: undefined }
            : group,
        ),
      );
      logAndToast(
        'qa-review',
        `Re-reviewing ${ids.size} group${ids.size > 1 ? 's' : ''} after page removal`,
        ids.size,
        `QA re-review queued for ${ids.size} group${ids.size > 1 ? 's' : ''}`,
        'info',
      );
    }, 5000);
  }, [groupReviewSettingsRef, logAndToast, persistenceUpdateGroups]);

  useEffect(() => {
    if (reviewProcessingRef.current) return;
    if (isRoutineSharedEditBlocked) return;
    const groupsToReview = groupedClusters.filter(
      (group) => group.reviewStatus === 'pending' || (!!group.mergeAffected && group.clusters.length > 0),
    );
    if (groupsToReview.length === 0) return;

    const settingsData = groupReviewSettingsRef.current?.getSettings();
    const modelObj = groupReviewSettingsRef.current?.getSelectedModelObj();
    if (!settingsData || !settingsData.apiKey.trim() || !settingsData.selectedModel) return;

    reviewProcessingRef.current = true;
    persistenceUpdateGroups((groups) =>
      groups.map((group) => (group.reviewStatus === 'pending' ? { ...group, reviewStatus: 'reviewing' as const } : group)),
    );

    const runReviewBatch = (batchQueue: ReviewRequest[], batchGroups: GroupedCluster[]) => {
      const controller = new AbortController();
      reviewAbortRef.current = controller;

      processReviewQueue(
        batchQueue,
        {
          apiKey: settingsData.apiKey,
          model: settingsData.selectedModel,
          temperature: settingsData.temperature,
          maxTokens: settingsData.maxTokens,
          systemPrompt: settingsData.systemPrompt,
          concurrency: settingsData.concurrency,
          modelPricing: modelObj?.pricing,
          reasoningEffort: settingsData.reasoningEffort,
        },
        {
          onReviewing: () => {},
          onResult: (result: ReviewResult) => {
            if (isRoutineSharedEditBlockedRef.current) return;
            persistenceUpdateGroups((groups) =>
              groups.map((group) =>
                group.id === result.groupId
                  ? {
                      ...group,
                      reviewStatus: result.status,
                      reviewMismatchedPages: result.mismatchedPages,
                      reviewReason: result.reason,
                      reviewCost: result.cost,
                      reviewedAt: result.reviewedAt,
                      mergeAffected: false,
                    }
                  : group,
              ),
            );
            const groupName = batchGroups.find((group) => group.id === result.groupId)?.groupName || result.groupId;
            if (result.status === 'approve') {
              logAndToast('qa-review', `QA: '${groupName}' - Approved`, 1, `QA: '${groupName}' - Approved`, 'success');
            } else {
              logAndToast(
                'qa-review',
                `QA: '${groupName}' - Mismatch (${(result.mismatchedPages || []).join(', ')})`,
                result.mismatchedPages?.length || 1,
                `QA: '${groupName}' - Mismatch`,
                'error',
              );
            }
          },
          onError: (error: ReviewError) => {
            if (isRoutineSharedEditBlockedRef.current) return;
            persistenceUpdateGroups((groups) =>
              groups.map((group) =>
                group.id === error.groupId
                  ? {
                      ...group,
                      ...(group.mergeAffected
                        ? { mergeAffected: false }
                        : {
                            reviewStatus: 'error' as const,
                            reviewReason: error.error,
                            reviewedAt: new Date().toISOString(),
                            mergeAffected: false,
                          }),
                    }
                  : group,
              ),
            );
            const groupName = batchGroups.find((group) => group.id === error.groupId)?.groupName || error.groupId;
            logAndToast('qa-review', `QA error: '${groupName}' - ${error.error}`, 1, `QA error: '${groupName}'`, 'error');
          },
        },
        controller.signal,
      ).finally(() => {
        reviewAbortRef.current = null;
        if (isRoutineSharedEditBlockedRef.current) {
          reviewProcessingRef.current = false;
          return;
        }
        let remaining: GroupedCluster[] = [];
        persistenceUpdateGroups((groups) => {
          const healed = healReviewingGroups(groups);
          remaining = healed.filter((group) => group.reviewStatus === 'pending');
          if (remaining.length > 0) {
            return healed.map((group) =>
              group.reviewStatus === 'pending' ? { ...group, reviewStatus: 'reviewing' as const } : group,
            );
          }
          return healed;
        });
        if (remaining.length > 0) {
          const nextQueue: ReviewRequest[] = remaining.map((group) => ({
            groupId: group.id,
            groupName: group.groupName,
            pages: group.clusters.map((cluster) => ({ pageName: cluster.pageName, tokens: cluster.tokenArr || cluster.tokens.split(' ') })),
          }));
          runReviewBatch(nextQueue, remaining);
        } else {
          reviewProcessingRef.current = false;
        }
      });
    };

    const queue: ReviewRequest[] = groupsToReview.map((group) => ({
      groupId: group.id,
      groupName: group.groupName,
      pages: group.clusters.map((cluster) => ({ pageName: cluster.pageName, tokens: cluster.tokenArr || cluster.tokens.split(' ') })),
    }));

    runReviewBatch(queue, groupsToReview);
  }, [groupReviewSettingsRef, groupedClusters, isRoutineSharedEditBlocked, logAndToast, persistenceUpdateGroups]);

  useEffect(() => {
    if (reviewProcessingRef.current) return;
    if (isRoutineSharedEditBlocked) return;
    if (!groupedClusters.some((group) => group.reviewStatus === 'reviewing')) return;
    persistenceUpdateGroups(healReviewingGroups);
  }, [groupedClusters, isRoutineSharedEditBlocked, persistenceUpdateGroups]);

  useEffect(() => {
    isRoutineSharedEditBlockedRef.current = isRoutineSharedEditBlocked;
    if (!isRoutineSharedEditBlocked) return;
    reviewAbortRef.current?.abort();
    reviewAbortRef.current = null;
    reviewProcessingRef.current = false;
  }, [isRoutineSharedEditBlocked]);

  useEffect(() => () => {
    if (reReviewTimerRef.current) clearTimeout(reReviewTimerRef.current);
    reviewAbortRef.current?.abort();
  }, []);

  return { scheduleReReview };
}
