import type { AutoMergeRecommendation } from './types';

export function mergeRecommendationsAfterRerun(
  existing: AutoMergeRecommendation[],
  fresh: AutoMergeRecommendation[],
): AutoMergeRecommendation[] {
  const approvedById = new Map<string, AutoMergeRecommendation>(
    existing.filter(r => r.status === 'approved').map(r => [r.id, r] as const),
  );
  return [
    ...fresh.map(r =>
      approvedById.has(r.id)
        ? { ...r, status: 'approved' as const, reviewedAt: approvedById.get(r.id)?.reviewedAt }
        : r,
    ),
    ...existing.filter(r => r.status === 'approved' && !fresh.some(nr => nr.id === r.id)),
  ];
}

export function markRecommendationApproved(
  recommendations: AutoMergeRecommendation[],
  recommendationId: string,
  reviewedAt: string,
): AutoMergeRecommendation[] {
  return recommendations.map(r =>
    r.id === recommendationId ? { ...r, status: 'approved' as const, reviewedAt } : r,
  );
}

export function markRecommendationPendingAfterUndo(
  recommendations: AutoMergeRecommendation[],
  recommendationId: string,
): AutoMergeRecommendation[] {
  return recommendations.map(r =>
    r.id === recommendationId ? { ...r, status: 'pending' as const, reviewedAt: undefined } : r,
  );
}
