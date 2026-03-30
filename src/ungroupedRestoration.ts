import type { ClusterSummary } from './types';

export interface UniqueClustersToRestoreResult {
  clustersToAppend: ClusterSummary[];
  duplicateTokens: string[];
}

/**
 * Restoring pages back into Ungrouped must preserve the invariant that each
 * token signature appears at most once in clusterSummary. This helper filters
 * out clusters that are already present and also deduplicates overlaps inside
 * the incoming restore batch itself.
 */
export function getUniqueClustersToRestore(
  existingClusters: ClusterSummary[] | null,
  incomingClusters: ClusterSummary[],
): UniqueClustersToRestoreResult {
  const seenTokens = new Set((existingClusters || []).map(cluster => cluster.tokens));
  const duplicateTokens = new Set<string>();
  const clustersToAppend: ClusterSummary[] = [];

  for (const cluster of incomingClusters) {
    if (!cluster?.tokens) continue;

    if (seenTokens.has(cluster.tokens)) {
      duplicateTokens.add(cluster.tokens);
      continue;
    }

    seenTokens.add(cluster.tokens);
    clustersToAppend.push(cluster);
  }

  return {
    clustersToAppend,
    duplicateTokens: [...duplicateTokens].sort((a, b) => a.localeCompare(b)),
  };
}
