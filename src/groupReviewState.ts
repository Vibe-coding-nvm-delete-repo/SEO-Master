import type { GroupedCluster } from './types';

export function healReviewingGroups(groups: GroupedCluster[]): GroupedCluster[] {
  if (!groups.some((group) => group.reviewStatus === 'reviewing')) {
    return groups;
  }
  return groups.map((group) => (
    group.reviewStatus === 'reviewing'
      ? { ...group, reviewStatus: 'pending' as const }
      : group
  ));
}
