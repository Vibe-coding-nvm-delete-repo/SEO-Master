import { buildGroupedClusterFromPages } from './groupedClusterUtils';
import {
  computeVectorMagnitudes,
  cosineSimilarity,
  yieldToBrowser,
} from './embeddingSimilarity';
import type {
  GroupMergeRecommendation,
  GroupMergeRecommendationGroup,
  GroupedCluster,
} from './types';

export interface GroupAutoMergeSource {
  group: GroupedCluster;
  summary: GroupMergeRecommendationGroup;
  embeddingText: string;
  normalizedName: string;
  pageNameSet: Set<string>;
  localityKey: string;
  isLocal: boolean;
}

export interface GroupAutoMergeCompareProgress {
  comparedPairs: number;
  totalPairs: number;
  keptPairs: number;
}

export interface GroupAutoMergeResolution {
  mergedGroups: GroupedCluster[];
  removedGroupIds: Set<string>;
  appliedRecommendationIds: string[];
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeLocationValue(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toDisplayLocation(value: string): string {
  return value
    .split(' ')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function buildLocationSummary(group: GroupedCluster): { summary: string; localityKey: string; isLocal: boolean } {
  const cityStatePairs = new Set<string>();
  const states = new Set<string>();
  for (const cluster of group.clusters) {
    const city = normalizeLocationValue(cluster.locationCity);
    const state = normalizeLocationValue(cluster.locationState);
    if (city && state) {
      cityStatePairs.add(`${city}::${state}`);
      continue;
    }
    if (city) {
      cityStatePairs.add(`${city}::`);
      continue;
    }
    if (state) states.add(state);
  }

  if (cityStatePairs.size > 0) {
    const sorted = [...cityStatePairs].sort();
    return {
      summary: sorted
        .map((pair) => {
          const [city, state] = pair.split('::');
          return state ? `${toDisplayLocation(city)}, ${state.toUpperCase()}` : toDisplayLocation(city);
        })
        .join(' | '),
      localityKey: `city:${sorted.join('|')}`,
      isLocal: true,
    };
  }

  if (states.size > 0) {
    const sortedStates = [...states].sort();
    return {
      summary: sortedStates.map((state) => state.toUpperCase()).join(' | '),
      localityKey: `state:${sortedStates.join('|')}`,
      isLocal: true,
    };
  }

  return { summary: 'National / non-local', localityKey: '', isLocal: false };
}

function uniqueTopPageNames(group: GroupedCluster): string[] {
  const seen = new Set<string>();
  const topPages: string[] = [];
  for (const cluster of [...group.clusters].sort((a, b) => b.totalVolume - a.totalVolume)) {
    const normalized = normalizeName(cluster.pageName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    topPages.push(cluster.pageName);
    if (topPages.length >= 10) break;
  }
  return topPages;
}

export function buildGroupAutoMergeSource(group: GroupedCluster): GroupAutoMergeSource {
  const { summary: locationSummary, localityKey, isLocal } = buildLocationSummary(group);
  const topPageNames = uniqueTopPageNames(group);
  const normalizedName = normalizeName(group.groupName);
  return {
    group,
    summary: {
      id: group.id,
      name: group.groupName,
      pageCount: group.clusters.length,
      totalVolume: group.totalVolume,
      locationSummary,
    },
    embeddingText: [
      `GROUP NAME: ${group.groupName}`,
      `LOCATION: ${locationSummary}`,
      'TOP PAGES:',
      ...topPageNames.map((pageName, index) => `${index + 1}. ${pageName}`),
    ].join('\n'),
    normalizedName,
    pageNameSet: new Set(topPageNames.map((pageName) => normalizeName(pageName))),
    localityKey,
    isLocal,
  };
}

export function buildGroupAutoMergeFingerprint(groups: GroupedCluster[]): string {
  const signature = groups
    .map((group) => {
      const tokenSignature = group.clusters
        .map((cluster) => cluster.tokens)
        .slice()
        .sort()
        .join('|');
      return `${group.id}::${normalizeName(group.groupName)}::${tokenSignature}`;
    })
    .sort()
    .join('||');
  return `group_merge_${groups.length}_${simpleHash(signature)}`;
}

export function getRecommendationSourceFingerprint(
  recommendations: GroupMergeRecommendation[] | null | undefined,
): string | null {
  return Array.isArray(recommendations) && recommendations.length > 0
    ? recommendations[0].sourceFingerprint
    : null;
}

export function isGroupMergeRecommendationSetStale(
  recommendations: GroupMergeRecommendation[] | null | undefined,
  currentFingerprint: string,
): boolean {
  const sourceFingerprint = getRecommendationSourceFingerprint(recommendations);
  return sourceFingerprint != null && sourceFingerprint !== currentFingerprint;
}

function buildRecommendationId(groupAId: string, groupBId: string): string {
  return [groupAId, groupBId].sort().join('__');
}

function sharedPageNameCount(a: GroupAutoMergeSource, b: GroupAutoMergeSource): number {
  let count = 0;
  for (const pageName of a.pageNameSet) {
    if (b.pageNameSet.has(pageName)) count += 1;
  }
  return count;
}

function areLocationsCompatible(a: GroupAutoMergeSource, b: GroupAutoMergeSource): boolean {
  if (!a.isLocal && !b.isLocal) return true;
  if (a.isLocal !== b.isLocal) return false;
  return a.localityKey === b.localityKey;
}

export async function compareGroupAutoMergeSources(params: {
  sources: GroupAutoMergeSource[];
  vectors: number[][];
  sourceFingerprint: string;
  minSimilarity: number;
  maxRecommendationsPerGroup?: number;
  signal?: AbortSignal;
  onProgress?: (progress: GroupAutoMergeCompareProgress) => void;
}): Promise<GroupMergeRecommendation[]> {
  const {
    sources,
    vectors,
    sourceFingerprint,
    minSimilarity,
    maxRecommendationsPerGroup = 8,
    signal,
    onProgress,
  } = params;

  if (sources.length !== vectors.length) {
    throw new Error('Group auto-merge embedding count mismatch.');
  }

  const magnitudes = computeVectorMagnitudes(vectors);
  const totalPairs = (sources.length * (sources.length - 1)) / 2;
  const chunkSize = 10000;
  const now = new Date().toISOString();
  const allMatches: GroupMergeRecommendation[] = [];
  let comparedPairs = 0;
  let lastYieldAt = 0;

  for (let i = 0; i < sources.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    for (let j = i + 1; j < sources.length; j += 1) {
      const sourceA = sources[i];
      const sourceB = sources[j];
      const locationCompatible = areLocationsCompatible(sourceA, sourceB);
      const exactNameMatch = sourceA.normalizedName === sourceB.normalizedName;
      const sharedPages = sharedPageNameCount(sourceA, sourceB);

      if (locationCompatible) {
        const similarity = cosineSimilarity(vectors[i], vectors[j], magnitudes[i], magnitudes[j]);
        if (similarity >= minSimilarity) {
          allMatches.push({
            id: buildRecommendationId(sourceA.group.id, sourceB.group.id),
            sourceFingerprint,
            groupA: sourceA.summary,
            groupB: sourceB.summary,
            similarity: Math.round(similarity * 10000) / 10000,
            exactNameMatch,
            sharedPageNameCount: sharedPages,
            locationCompatible,
            status: 'pending',
            createdAt: now,
          });
        }
      }

      comparedPairs += 1;
      if (comparedPairs - lastYieldAt >= chunkSize) {
        lastYieldAt = comparedPairs;
        onProgress?.({ comparedPairs, totalPairs, keptPairs: allMatches.length });
        await yieldToBrowser();
      }
    }
  }

  onProgress?.({ comparedPairs: totalPairs, totalPairs, keptPairs: allMatches.length });

  allMatches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    const volumeDelta = (b.groupA.totalVolume + b.groupB.totalVolume) - (a.groupA.totalVolume + a.groupB.totalVolume);
    if (volumeDelta !== 0) return volumeDelta;
    return a.id.localeCompare(b.id);
  });

  const keptCounts = new Map<string, number>();
  const keptMatches: GroupMergeRecommendation[] = [];
  for (const recommendation of allMatches) {
    const countA = keptCounts.get(recommendation.groupA.id) || 0;
    const countB = keptCounts.get(recommendation.groupB.id) || 0;
    if (countA >= maxRecommendationsPerGroup || countB >= maxRecommendationsPerGroup) continue;
    keptMatches.push(recommendation);
    keptCounts.set(recommendation.groupA.id, countA + 1);
    keptCounts.set(recommendation.groupB.id, countB + 1);
  }

  return keptMatches;
}

function chooseMergeTemplate(groups: GroupedCluster[]): GroupedCluster {
  return [...groups].sort((a, b) => {
    if (b.totalVolume !== a.totalVolume) return b.totalVolume - a.totalVolume;
    if (b.clusters.length !== a.clusters.length) return b.clusters.length - a.clusters.length;
    return a.groupName.localeCompare(b.groupName);
  })[0];
}

export function resolveGroupAutoMergeSelection(params: {
  groupedClusters: GroupedCluster[];
  recommendations: GroupMergeRecommendation[];
  selectedRecommendationIds: Iterable<string>;
  hasReviewApi: boolean;
}): GroupAutoMergeResolution {
  const { groupedClusters, recommendations, selectedRecommendationIds, hasReviewApi } = params;
  const selectedIds = new Set(selectedRecommendationIds);
  const selectedRecommendations = recommendations.filter(
    (recommendation) =>
      selectedIds.has(recommendation.id) &&
      recommendation.status === 'pending',
  );

  const groupById = new Map(groupedClusters.map((group) => [group.id, group]));
  const involvedGroupIds = new Set<string>();
  for (const recommendation of selectedRecommendations) {
    involvedGroupIds.add(recommendation.groupA.id);
    involvedGroupIds.add(recommendation.groupB.id);
  }

  const parent = new Map<string, string>();
  for (const groupId of involvedGroupIds) parent.set(groupId, groupId);

  function find(groupId: string): string {
    let root = groupId;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(groupId) !== root) {
      const next = parent.get(groupId)!;
      parent.set(groupId, root);
      groupId = next;
    }
    return root;
  }

  function union(a: string, b: string) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    parent.set(rootB, rootA);
  }

  for (const recommendation of selectedRecommendations) {
    union(recommendation.groupA.id, recommendation.groupB.id);
  }

  const components = new Map<string, string[]>();
  for (const groupId of involvedGroupIds) {
    const root = find(groupId);
    const existing = components.get(root) || [];
    existing.push(groupId);
    components.set(root, existing);
  }

  const removedGroupIds = new Set<string>();
  const mergedGroups: GroupedCluster[] = [];
  for (const componentIds of components.values()) {
    const componentGroups = componentIds
      .map((groupId) => groupById.get(groupId))
      .filter((group): group is GroupedCluster => Boolean(group));
    if (componentGroups.length < 2) continue;

    const template = chooseMergeTemplate(componentGroups);
    const uniquePages = new Map<string, GroupedCluster['clusters'][number]>();
    for (const group of componentGroups) {
      removedGroupIds.add(group.id);
      for (const page of group.clusters) {
        if (!uniquePages.has(page.tokens)) uniquePages.set(page.tokens, page);
      }
    }

    mergedGroups.push(
      buildGroupedClusterFromPages(
        [...uniquePages.values()],
        hasReviewApi,
        { ...template, groupName: template.groupName },
      ),
    );
  }

  return {
    mergedGroups,
    removedGroupIds,
    appliedRecommendationIds: selectedRecommendations.map((recommendation) => recommendation.id),
  };
}

export function mergeGroupAutoMergeRecommendationsAfterRun(
  existing: GroupMergeRecommendation[] | null | undefined,
  fresh: GroupMergeRecommendation[],
  sourceFingerprint: string,
): GroupMergeRecommendation[] {
  const safeExisting = Array.isArray(existing) ? existing : [];
  const existingById = new Map(
    safeExisting
      .filter((recommendation) => recommendation.sourceFingerprint === sourceFingerprint)
      .map((recommendation) => [recommendation.id, recommendation] as const),
  );

  return fresh.map((recommendation) => {
    const prior = existingById.get(recommendation.id);
    if (!prior) return recommendation;
    return {
      ...recommendation,
      status: prior.status,
      reviewedAt: prior.reviewedAt,
    };
  });
}

export function markGroupAutoMergeRecommendationsStatus(
  recommendations: GroupMergeRecommendation[] | null | undefined,
  recommendationIds: Iterable<string>,
  status: GroupMergeRecommendation['status'],
  reviewedAt: string,
): GroupMergeRecommendation[] {
  const safeRecommendations = Array.isArray(recommendations) ? recommendations : [];
  const ids = new Set(recommendationIds);
  return safeRecommendations.map((recommendation) =>
    ids.has(recommendation.id)
      ? { ...recommendation, status, reviewedAt }
      : recommendation,
  );
}
