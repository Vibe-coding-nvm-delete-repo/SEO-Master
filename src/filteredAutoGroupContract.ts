import { buildGroupedClusterFromPages, mergeGroupedClustersByName } from './groupedClusterUtils';
import type { ClusterSummary, GroupedCluster } from './types';

export interface AcceptedTokenCoverageMismatch {
  duplicateTokens: string[];
  missingTokens: string[];
}

function buildRepairGroup(page: ClusterSummary, hasReviewApi: boolean): GroupedCluster {
  return buildGroupedClusterFromPages([page], hasReviewApi, {
    id: `filtered_auto_group_repair_${Date.now()}_${page.tokens}`,
  });
}

export function collectGroupedTokenCounts(groups: GroupedCluster[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const page of group.clusters) {
      counts.set(page.tokens, (counts.get(page.tokens) ?? 0) + 1);
    }
  }
  return counts;
}

export function findAcceptedTokenCoverageMismatch(
  groups: GroupedCluster[],
  acceptedTokens: Iterable<string>,
): AcceptedTokenCoverageMismatch {
  const tokenCounts = collectGroupedTokenCounts(groups);
  const duplicateTokens: string[] = [];
  const missingTokens: string[] = [];

  for (const token of acceptedTokens) {
    const count = tokenCounts.get(token) ?? 0;
    if (count < 1) missingTokens.push(token);
    if (count > 1) duplicateTokens.push(token);
  }

  return { duplicateTokens, missingTokens };
}

export function normalizeFilteredAutoGroupIncomingGroups(
  generatedGroups: GroupedCluster[],
  acceptedPages: ClusterSummary[],
  hasReviewApi: boolean,
): GroupedCluster[] {
  const acceptedByToken = new Map(acceptedPages.map((page) => [page.tokens, page]));
  const seenAcceptedTokens = new Set<string>();
  const normalizedGroups = generatedGroups.flatMap((group) => {
    const normalizedClusters = group.clusters.flatMap((page) => {
      const acceptedPage = acceptedByToken.get(page.tokens);
      if (!acceptedPage) return [page];
      if (seenAcceptedTokens.has(page.tokens)) return [];
      seenAcceptedTokens.add(page.tokens);
      return [acceptedPage];
    });

    if (normalizedClusters.length === 0) return [];
    return [buildGroupedClusterFromPages(normalizedClusters, hasReviewApi, group)];
  });

  const missingPages = acceptedPages.filter((page) => !seenAcceptedTokens.has(page.tokens));
  if (missingPages.length === 0) return normalizedGroups;
  return [...normalizedGroups, ...missingPages.map((page) => buildRepairGroup(page, hasReviewApi))];
}

export function stripAcceptedTokensFromGroups(
  groups: GroupedCluster[],
  acceptedTokens: Iterable<string>,
  hasReviewApi: boolean,
): GroupedCluster[] {
  const acceptedTokenSet = new Set(acceptedTokens);
  return groups.flatMap((group) => {
    const remainingClusters = group.clusters.filter((page) => !acceptedTokenSet.has(page.tokens));
    if (remainingClusters.length === 0) return [];
    return [buildGroupedClusterFromPages(remainingClusters, hasReviewApi, group)];
  });
}

export function prepareFilteredAutoGroupFinalGroups(
  existingGroups: GroupedCluster[],
  incomingGroups: GroupedCluster[],
  acceptedPages: ClusterSummary[],
  hasReviewApi: boolean,
): {
  groups: GroupedCluster[];
  normalizedIncomingGroups: GroupedCluster[];
  mismatch: AcceptedTokenCoverageMismatch;
} {
  const acceptedTokens = acceptedPages.map((page) => page.tokens);
  const normalizedIncomingGroups = normalizeFilteredAutoGroupIncomingGroups(
    incomingGroups,
    acceptedPages,
    hasReviewApi,
  );
  const strippedExistingGroups = stripAcceptedTokensFromGroups(
    existingGroups,
    acceptedTokens,
    hasReviewApi,
  );
  const groups = mergeGroupedClustersByName(
    strippedExistingGroups,
    normalizedIncomingGroups,
    hasReviewApi,
  );

  return {
    groups,
    normalizedIncomingGroups,
    mismatch: findAcceptedTokenCoverageMismatch(groups, acceptedTokens),
  };
}
