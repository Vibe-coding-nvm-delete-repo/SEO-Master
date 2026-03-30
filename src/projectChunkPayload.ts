/**
 * Pure Firestore chunk → payload merge (no Firebase client).
 * Split from projectStorage so integration tests can import real merge logic without loading db.
 */
import type {
  AutoGroupSuggestion,
  AutoMergeRecommendation,
  BlockedKeyword,
  ClusterSummary,
  GroupMergeRecommendation,
  GroupedCluster,
  ProcessedRow,
} from './types';
import type { ProjectDataPayload } from './projectStorage';

interface GroupCollections {
  groupedClusters: GroupedCluster[] | null | undefined;
  approvedGroups: GroupedCluster[] | null | undefined;
}

/** Count pages sitting in grouped + approved collections. */
export function countGroupedPages(input: GroupCollections): number {
  let n = 0;
  for (const g of input.groupedClusters || []) n += g.clusters?.length ?? 0;
  for (const g of input.approvedGroups || []) n += g.clusters?.length ?? 0;
  return n;
}

/** Pages sitting in grouped + approved (the number users care about on refresh). */
export function groupedPageMass(p: ProjectDataPayload): number {
  return countGroupedPages(p);
}

export const buildProjectDataPayloadFromChunkDocs = (
  docs: Array<{ data: () => any }>
): ProjectDataPayload | null => {
  let meta: any = null;
  const resultChunks: { index: number; data: ProcessedRow[] }[] = [];
  const clusterChunks: { index: number; data: ClusterSummary[] }[] = [];
  const blockedChunks: { index: number; data: BlockedKeyword[] }[] = [];
  const suggestionChunks: { index: number; data: AutoGroupSuggestion[] }[] = [];
  const autoMergeChunks: { index: number; data: AutoMergeRecommendation[] }[] = [];
  const groupMergeChunks: { index: number; data: GroupMergeRecommendation[] }[] = [];
  const groupedChunks: { index: number; data: GroupedCluster[]; saveId: unknown }[] = [];
  const approvedChunks: { index: number; data: GroupedCluster[]; saveId: unknown }[] = [];

  docs.forEach((docSnap) => {
    const chunk = docSnap.data();
    if (chunk.type === 'meta') meta = chunk;
    else if (chunk.type === 'results') resultChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'clusters') clusterChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'blocked') blockedChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'suggestions') suggestionChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'auto_merge') autoMergeChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'group_merge') groupMergeChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'grouped')
      groupedChunks.push({ index: chunk.index, data: chunk.data, saveId: chunk.saveId ?? null });
    else if (chunk.type === 'approved')
      approvedChunks.push({ index: chunk.index, data: chunk.data, saveId: chunk.saveId ?? null });
  });

  if (!meta) return null;

  const metaSaveId = meta.saveId ?? null;
  if (metaSaveId != null) {
    if (groupedChunks.length > 0 && groupedChunks.some((c) => c.saveId !== metaSaveId)) return null;
    if (approvedChunks.length > 0 && approvedChunks.some((c) => c.saveId !== metaSaveId)) return null;
  }

  const impliedChunkSpan = (chunks: { index: number }[]) =>
    chunks.length === 0 ? 0 : Math.max(...chunks.map((c) => c.index)) + 1;

  const resultSpan = impliedChunkSpan(resultChunks);
  const clusterSpan = impliedChunkSpan(clusterChunks);
  const blockedSpan = impliedChunkSpan(blockedChunks);
  const suggestionSpan = impliedChunkSpan(suggestionChunks);
  const autoMergeSpan = impliedChunkSpan(autoMergeChunks);
  const groupMergeSpan = impliedChunkSpan(groupMergeChunks);
  const groupedSpan = impliedChunkSpan(groupedChunks);
  const approvedSpan = impliedChunkSpan(approvedChunks);

  const resultCountMeta = meta.resultChunkCount ?? resultSpan;
  const clusterCountMeta = meta.clusterChunkCount ?? clusterSpan;
  const blockedCountMeta = meta.blockedChunkCount ?? blockedSpan;
  const suggestionCountMeta = meta.suggestionChunkCount ?? suggestionSpan;
  const autoMergeCountMeta = meta.autoMergeChunkCount ?? autoMergeSpan;
  const groupMergeCountMeta = meta.groupMergeChunkCount ?? groupMergeSpan;
  const groupedCountMeta = meta.groupedClusterCount ?? groupedSpan;
  const approvedCountMeta = meta.approvedGroupCount ?? approvedSpan;

  if (resultChunks.length > 0 && resultSpan < resultCountMeta) return null;
  if (clusterChunks.length > 0 && clusterSpan < clusterCountMeta) return null;
  if (blockedChunks.length > 0 && blockedSpan < blockedCountMeta) return null;
  if (suggestionChunks.length > 0 && suggestionSpan < suggestionCountMeta) return null;
  if (autoMergeChunks.length > 0 && autoMergeSpan < autoMergeCountMeta) return null;
  if (groupMergeChunks.length > 0 && groupMergeSpan < groupMergeCountMeta) return null;
  if (groupedChunks.length > 0 && groupedSpan < groupedCountMeta) return null;
  if (approvedChunks.length > 0 && approvedSpan < approvedCountMeta) return null;

  if (autoMergeChunks.length === 0 && autoMergeCountMeta > 0) {
    return null;
  }
  if (groupMergeChunks.length === 0 && groupMergeCountMeta > 0) {
    return null;
  }

  if (
    groupedChunks.length === 0 &&
    groupedCountMeta > 0 &&
    !(Array.isArray(meta.groupedClusters) && meta.groupedClusters.length > 0)
  ) {
    return null;
  }
  if (
    approvedChunks.length === 0 &&
    approvedCountMeta > 0 &&
    !(Array.isArray(meta.approvedGroups) && meta.approvedGroups.length > 0)
  ) {
    return null;
  }

  const resultCount = Math.max(resultCountMeta, resultSpan);
  const clusterCount = Math.max(clusterCountMeta, clusterSpan);
  const blockedCount = Math.max(blockedCountMeta, blockedSpan);
  const suggestionCount = Math.max(suggestionCountMeta, suggestionSpan);
  const autoMergeCount = Math.max(autoMergeCountMeta, autoMergeSpan);
  const groupMergeCount = Math.max(groupMergeCountMeta, groupMergeSpan);
  const groupedCount = Math.max(groupedCountMeta, groupedSpan);
  const approvedCount = Math.max(approvedCountMeta, approvedSpan);

  const results = resultChunks
    .filter((chunk) => chunk.index < resultCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const clusterSummary = clusterChunks
    .filter((chunk) => chunk.index < clusterCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const blockedKeywords = blockedChunks
    .filter((chunk) => chunk.index < blockedCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const autoGroupSuggestions = suggestionChunks
    .filter((chunk) => chunk.index < suggestionCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const autoMergeRecommendations = autoMergeChunks
    .filter((chunk) => chunk.index < autoMergeCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const groupMergeRecommendations = groupMergeChunks
    .filter((chunk) => chunk.index < groupMergeCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);

  const groupedClusters = groupedChunks.length > 0
    ? groupedChunks
        .filter((chunk) => chunk.index < groupedCount)
        .sort((a, b) => a.index - b.index)
        .flatMap((chunk) => chunk.data)
    : meta.groupedClusters || [];

  const approvedGroups = approvedChunks.length > 0
    ? approvedChunks
        .filter((chunk) => chunk.index < approvedCount)
        .sort((a, b) => a.index - b.index)
        .flatMap((chunk) => chunk.data)
    : meta.approvedGroups || [];

  const lastSaveId =
    typeof metaSaveId === 'number' && Number.isFinite(metaSaveId)
      ? metaSaveId
      : metaSaveId != null && typeof metaSaveId === 'string' && /^\d+$/.test(metaSaveId)
        ? Number(metaSaveId)
        : undefined;

  return {
    results: resultCount > 0 ? results : [],
    clusterSummary: clusterCount > 0 ? clusterSummary : [],
    tokenSummary: meta.tokenSummary || null,
    groupedClusters,
    approvedGroups,
    stats: meta.stats || null,
    datasetStats: meta.datasetStats || null,
    blockedTokens: meta.blockedTokens || [],
    blockedKeywords,
    labelSections: meta.labelSections || [],
    activityLog: meta.activityLog || [],
    tokenMergeRules: meta.tokenMergeRules || [],
    autoGroupSuggestions,
    autoMergeRecommendations,
    groupMergeRecommendations,
    updatedAt: meta.updatedAt || new Date().toISOString(),
    lastSaveId,
  };
};
