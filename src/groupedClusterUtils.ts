import type { ClusterSummary, GroupedCluster } from './types';

export function buildGroupedClusterFromPages(
  pages: ClusterSummary[],
  hasReviewApi: boolean,
  existing?: Partial<GroupedCluster>
): GroupedCluster {
  const sortedPages = [...pages].sort((a, b) => b.totalVolume - a.totalVolume);
  const totalVolume = sortedPages.reduce((sum, page) => sum + page.totalVolume, 0);
  const keywordCount = sortedPages.reduce((sum, page) => sum + page.keywordCount, 0);
  let totalKd = 0;
  let kdCount = 0;
  let totalKw = 0;
  let kwCount = 0;
  for (const page of sortedPages) {
    if (page.avgKd !== null) {
      totalKd += page.avgKd * page.keywordCount;
      kdCount += page.keywordCount;
    }
    if (page.avgKwRating != null) {
      totalKw += page.avgKwRating * page.keywordCount;
      kwCount += page.keywordCount;
    }
  }

  const tokenSig = sortedPages.map(p => p.tokens).slice().sort().join(' ');
  const existingTokenSig = existing?.clusters
    ? existing.clusters.map(c => c.tokens).slice().sort().join(' ')
    : null;

  const existingReviewed =
    existing?.reviewStatus === 'approve' || existing?.reviewStatus === 'mismatch';

  const tokensSame =
    existingReviewed && existingTokenSig != null && existingTokenSig === tokenSig;

  // When a merge changes group membership, we keep the last known review result
  // to avoid badge flicker, but mark it for re-review.
  const mergeAffected =
    hasReviewApi && existingReviewed && existingTokenSig != null && !tokensSame;

  const reviewStatus: GroupedCluster['reviewStatus'] | undefined =
    sortedPages.length === 1
      ? 'approve'
      : hasReviewApi
        ? (existingReviewed ? existing.reviewStatus : 'pending')
        : existing?.reviewStatus;

  const next: GroupedCluster = {
    id: existing?.id || `llm_group_${sortedPages[0]?.tokens || Date.now()}`,
    groupName: existing?.groupName || sortedPages[0]?.pageName || 'Untitled group',
    clusters: sortedPages,
    totalVolume,
    keywordCount,
    avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
    avgKwRating: kwCount > 0 ? Math.round(totalKw / kwCount) : null,
    reviewStatus,
    ...(mergeAffected ? { mergeAffected: true } : {}),
    ...(existingReviewed ? {
      reviewMismatchedPages: existing.reviewMismatchedPages,
      reviewReason: existing.reviewReason,
      reviewCost: existing.reviewCost,
      reviewedAt: existing.reviewedAt,
    } : {}),
  };

  if (existingReviewed && tokensSame) {
    delete next.mergeAffected;
  }

  // If we don't have a previous approved/mismatch result to preserve, clear
  // stale review fields for consistency.
  if (next.reviewStatus === 'pending') {
    delete next.reviewMismatchedPages;
    delete next.reviewReason;
    delete next.reviewCost;
    delete next.reviewedAt;
    delete next.mergeAffected;
  }

  return next;
}

export function mergeGroupedClustersByName(
  existingGroups: GroupedCluster[],
  incomingGroups: GroupedCluster[],
  hasReviewApi: boolean
): GroupedCluster[] {
  const byName = new Map<
    string,
    { template: GroupedCluster; pages: ClusterSummary[]; candidates: GroupedCluster[] }
  >();
  const seedGroups = [...existingGroups, ...incomingGroups];

  for (const group of seedGroups) {
    const key = group.groupName.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { template: group, pages: [...group.clusters], candidates: [group] });
      continue;
    }
    const mergedPages = [...existing.pages];
    existing.candidates.push(group);
    for (const page of group.clusters) {
      if (!mergedPages.some(item => item.tokens === page.tokens)) mergedPages.push(page);
    }
    const preferredTemplate =
      existing.template.totalVolume >= group.totalVolume ? existing.template : group;
    byName.set(key, { ...existing, template: preferredTemplate, pages: mergedPages });
  }

  const clusterTokensSig = (clusters: ClusterSummary[]) =>
    clusters.map(c => c.tokens).slice().sort().join(' ');

  return [...byName.values()]
    .map(({ template, pages, candidates }) => {
      const mergedSig = clusterTokensSig(pages);
      const reviewedCandidates = candidates.filter(
        c => c.reviewStatus === 'approve' || c.reviewStatus === 'mismatch'
      );

      const matchingReviewed = reviewedCandidates.find(
        c => clusterTokensSig(c.clusters) === mergedSig
      );

      const preferredTemplate = matchingReviewed
        ? matchingReviewed
        : (reviewedCandidates.length > 0
          ? reviewedCandidates.reduce((best, c) => c.totalVolume > best.totalVolume ? c : best, reviewedCandidates[0])
          : template);

      return buildGroupedClusterFromPages(pages, hasReviewApi, preferredTemplate);
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);
}
