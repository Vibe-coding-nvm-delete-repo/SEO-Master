/**
 * tokenMerge.ts — Pure functions for the token merge cascade.
 * Zero React imports. All functions take data in, return data out.
 */
import type { ProcessedRow, ClusterSummary, GroupedCluster, TokenSummary, TokenMergeRule } from './types';

// ─── Phase 1: Token Replacement ───────────────────────────────────────────────

/** Replace child tokens with parent in a single tokenArr, deduplicate, sort */
export function mergeTokenArr(tokenArr: string[], parentToken: string, childTokens: string[]): string[] {
  const childSet = new Set(childTokens);
  let hasParent = false;
  const result: string[] = [];
  for (const t of tokenArr) {
    if (childSet.has(t)) {
      if (!hasParent) { result.push(parentToken); hasParent = true; }
    } else if (t === parentToken) {
      if (!hasParent) { result.push(parentToken); hasParent = true; }
    } else {
      result.push(t);
    }
  }
  return result.sort();
}

/** Compute signature from tokenArr */
export function computeSignature(tokenArr: string[]): string {
  return [...new Set(tokenArr)].sort().join(' ');
}

/** Apply a single merge to all rows. Stores originalTokenArr on first merge. */
export function applyMergeToRows(
  results: ProcessedRow[],
  parentToken: string,
  childTokens: string[]
): { updatedResults: ProcessedRow[]; signatureMap: Map<string, string> } {
  const childSet = new Set(childTokens);
  const signatureMap = new Map<string, string>(); // oldSignature → newSignature

  const updatedResults = results.map(row => {
    // Check if this row is affected
    const hasChild = row.tokenArr.some(t => childSet.has(t));
    if (!hasChild) return row;

    // Store original tokens on first merge (for undo)
    const originalTokenArr = row.originalTokenArr || [...row.tokenArr];
    const newTokenArr = mergeTokenArr(row.tokenArr, parentToken, childTokens);
    const newSignature = computeSignature(newTokenArr);

    if (row.tokens !== newSignature) {
      signatureMap.set(row.tokens, newSignature);
    }

    return {
      ...row,
      tokenArr: newTokenArr,
      tokens: newSignature,
      originalTokenArr,
    };
  });

  return { updatedResults, signatureMap };
}

// ─── Phase 2: Re-clustering ──────────────────────────────────────────────────

/** Rebuild ClusterSummary[] from ProcessedRow[] grouped by signature */
export function rebuildClusters(results: ProcessedRow[]): ClusterSummary[] {
  const clusterMap = new Map<string, {
    rows: ProcessedRow[];
    maxVolume: number;
    pageName: string;
    pageNameLower: string;
  }>();

  for (const row of results) {
    const existing = clusterMap.get(row.tokens);
    if (existing) {
      existing.rows.push(row);
      if (row.searchVolume > existing.maxVolume) {
        existing.maxVolume = row.searchVolume;
        existing.pageName = row.keyword;
        existing.pageNameLower = row.keywordLower;
      }
    } else {
      clusterMap.set(row.tokens, {
        rows: [row],
        maxVolume: row.searchVolume,
        pageName: row.keyword,
        pageNameLower: row.keywordLower,
      });
    }
  }

  const clusters: ClusterSummary[] = [];
  for (const [signature, data] of clusterMap) {
    const tokenArr = signature.split(' ').filter(t => t.length > 0);
    let totalVolume = 0;
    let totalKd = 0;
    let kdCount = 0;
    let totalKwRating = 0;
    let kwRatingCount = 0;
    const labels = new Set<string>();
    let locationCity: string | null = null;
    let locationState: string | null = null;

    const keywords: ClusterSummary['keywords'] = [];
    for (const row of data.rows) {
      totalVolume += row.searchVolume;
      if (row.kd !== null) { totalKd += row.kd; kdCount++; }
      if (row.kwRating !== undefined && row.kwRating !== null) {
        totalKwRating += row.kwRating;
        kwRatingCount++;
      }
      if (row.labelArr) row.labelArr.forEach(l => labels.add(l));
      if (row.locationCity) locationCity = row.locationCity;
      if (row.locationState) locationState = row.locationState;
      keywords.push({
        keyword: row.keyword,
        volume: row.searchVolume,
        kd: row.kd,
        locationCity: row.locationCity,
        locationState: row.locationState,
        ...(row.kwRating != null ? { kwRating: row.kwRating } : {}),
      });
    }

    clusters.push({
      pageName: data.pageName,
      pageNameLower: data.pageNameLower,
      pageNameLen: data.pageName.length,
      tokens: signature,
      tokenArr,
      keywordCount: data.rows.length,
      totalVolume,
      avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
      avgKwRating: kwRatingCount > 0 ? Math.round(totalKwRating / kwRatingCount) : null,
      label: Array.from(labels).join(', '),
      labelArr: Array.from(labels),
      locationCity,
      locationState,
      keywords,
    });
  }

  return clusters.sort((a, b) => b.totalVolume - a.totalVolume);
}

// ─── Phase 3: Group Updates ──────────────────────────────────────────────────

/** Recalculate group aggregate stats from its clusters */
function recalcGroupStats(group: GroupedCluster, clusters: ClusterSummary[]): GroupedCluster {
  const totalVolume = clusters.reduce((s, c) => s + c.totalVolume, 0);
  const keywordCount = clusters.reduce((s, c) => s + c.keywordCount, 0);
  let totalKd = 0, kdCount = 0;
  let totalKw = 0, kwCount = 0;
  clusters.forEach(c => {
    if (c.avgKd !== null) { totalKd += c.avgKd * c.keywordCount; kdCount += c.keywordCount; }
    if (c.avgKwRating != null) { totalKw += c.avgKwRating * c.keywordCount; kwCount += c.keywordCount; }
  });
  return {
    ...group,
    clusters,
    totalVolume,
    keywordCount,
    avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
    avgKwRating: kwCount > 0 ? Math.round(totalKw / kwCount) : null,
  };
}

/**
 * When `ProcessedRow[]` changes without token signature changes (e.g. kwRating batches),
 * replace each group's nested `ClusterSummary` with rebuilt rows and recalc group aggregates.
 */
export function refreshGroupsFromClusterSummaries(
  groupedClusters: GroupedCluster[],
  approvedGroups: GroupedCluster[],
  newSummaries: ClusterSummary[],
): { groupedClusters: GroupedCluster[]; approvedGroups: GroupedCluster[] } {
  const byTokens = new Map(newSummaries.map(c => [c.tokens, c]));
  const refresh = (groups: GroupedCluster[]) =>
    groups.map(g => {
      const clusters = g.clusters.map(c => byTokens.get(c.tokens) ?? c);
      return recalcGroupStats({ ...g, clusters }, clusters);
    });
  return {
    groupedClusters: refresh(groupedClusters),
    approvedGroups: refresh(approvedGroups),
  };
}

/** Update groups after merge — replace old clusters with new ones, deduplicate, remove empties */
export function updateGroupsAfterMerge(
  groups: GroupedCluster[],
  signatureMap: Map<string, string>,
  newClusterMap: Map<string, ClusterSummary>
): { updatedGroups: GroupedCluster[]; emptyGroupNames: string[] } {
  const emptyGroupNames: string[] = [];

  const updatedGroups = groups.map(group => {
    const newClusters: ClusterSummary[] = [];
    const seenSignatures = new Set<string>();

    for (const cluster of group.clusters) {
      const newSig = signatureMap.get(cluster.tokens) || cluster.tokens;
      if (seenSignatures.has(newSig)) continue; // Deduplicate within group
      seenSignatures.add(newSig);
      const newCluster = newClusterMap.get(newSig);
      if (newCluster) {
        newClusters.push(newCluster);
      } else {
        newClusters.push(cluster); // Unchanged cluster
      }
    }

    if (newClusters.length === 0) {
      emptyGroupNames.push(group.groupName);
      return null;
    }

    return recalcGroupStats(group, newClusters);
  }).filter((g): g is GroupedCluster => g !== null);

  return { updatedGroups, emptyGroupNames };
}

/** Handle cross-group conflicts — if same signature in multiple groups, keep in larger one */
export function handleCrossGroupConflict(groups: GroupedCluster[]): GroupedCluster[] {
  const signatureToGroup = new Map<string, { groupIdx: number; groupSize: number }>();
  const signaturesToRemove = new Map<number, Set<string>>(); // groupIdx → signatures to remove

  // First pass: find conflicts
  for (let i = 0; i < groups.length; i++) {
    for (const cluster of groups[i].clusters) {
      const existing = signatureToGroup.get(cluster.tokens);
      if (existing) {
        // Conflict — keep in the group with more total volume
        const currentGroupVol = groups[i].totalVolume;
        if (currentGroupVol > existing.groupSize) {
          // Current group is larger, remove from the other
          if (!signaturesToRemove.has(existing.groupIdx)) signaturesToRemove.set(existing.groupIdx, new Set());
          signaturesToRemove.get(existing.groupIdx)!.add(cluster.tokens);
          signatureToGroup.set(cluster.tokens, { groupIdx: i, groupSize: currentGroupVol });
        } else {
          // Other group is larger, remove from current
          if (!signaturesToRemove.has(i)) signaturesToRemove.set(i, new Set());
          signaturesToRemove.get(i)!.add(cluster.tokens);
        }
      } else {
        signatureToGroup.set(cluster.tokens, { groupIdx: i, groupSize: groups[i].totalVolume });
      }
    }
  }

  if (signaturesToRemove.size === 0) return groups;

  // Second pass: remove conflicting signatures from losing groups
  return groups.map((group, idx) => {
    const toRemove = signaturesToRemove.get(idx);
    if (!toRemove || toRemove.size === 0) return group;
    const filtered = group.clusters.filter(c => !toRemove.has(c.tokens));
    if (filtered.length === 0) return null;
    return recalcGroupStats(group, filtered);
  }).filter((g): g is GroupedCluster => g !== null);
}

/** Update approved groups — same as groups but returns affected ones for unapproval */
export function updateApprovedAfterMerge(
  approved: GroupedCluster[],
  signatureMap: Map<string, string>,
  newClusterMap: Map<string, ClusterSummary>
): { unaffected: GroupedCluster[]; affected: GroupedCluster[] } {
  const unaffected: GroupedCluster[] = [];
  const affected: GroupedCluster[] = [];

  for (const group of approved) {
    const isAffected = group.clusters.some(c => signatureMap.has(c.tokens));
    if (!isAffected) {
      unaffected.push(group);
      continue;
    }

    // Rebuild this group's clusters
    const newClusters: ClusterSummary[] = [];
    const seenSignatures = new Set<string>();
    for (const cluster of group.clusters) {
      const newSig = signatureMap.get(cluster.tokens) || cluster.tokens;
      if (seenSignatures.has(newSig)) continue;
      seenSignatures.add(newSig);
      const newCluster = newClusterMap.get(newSig);
      newClusters.push(newCluster || cluster);
    }

    if (newClusters.length > 0) {
      const updated = recalcGroupStats(group, newClusters);
      affected.push({ ...updated, mergeAffected: true, reviewStatus: undefined });
    }
  }

  return { unaffected, affected };
}

// ─── Phase 4: Token Summary ──────────────────────────────────────────────────

/** Rebuild token summary from results */
export function rebuildTokenSummary(results: ProcessedRow[]): TokenSummary[] {
  const tokenMap = new Map<string, { frequency: number; totalVolume: number; totalKd: number; kdCount: number }>();
  const tokenClusters = new Map<string, Set<string>>(); // token → set of signatures (for frequency = # clusters)

  for (const row of results) {
    const sig = row.tokens;
    for (const token of row.tokenArr) {
      if (!tokenClusters.has(token)) tokenClusters.set(token, new Set());
      tokenClusters.get(token)!.add(sig);

      if (!tokenMap.has(token)) tokenMap.set(token, { frequency: 0, totalVolume: 0, totalKd: 0, kdCount: 0 });
    }
  }

  // Aggregate per-cluster (not per-row) to match original logic
  const clusterData = new Map<string, { tokens: string[]; volume: number; kd: number | null }>();
  for (const row of results) {
    const existing = clusterData.get(row.tokens);
    if (!existing) {
      clusterData.set(row.tokens, { tokens: row.tokenArr, volume: row.searchVolume, kd: row.kd });
    } else {
      existing.volume += row.searchVolume;
      if (row.kd !== null && existing.kd === null) existing.kd = row.kd;
    }
  }

  // Actually rebuild per original logic: frequency = # clusters containing token
  const tokenStats = new Map<string, { frequency: number; totalVolume: number; totalKd: number; kdCount: number }>();
  for (const [, cluster] of clusterData) {
    const uniqueTokens = new Set(cluster.tokens);
    for (const token of uniqueTokens) {
      if (!tokenStats.has(token)) tokenStats.set(token, { frequency: 0, totalVolume: 0, totalKd: 0, kdCount: 0 });
      const s = tokenStats.get(token)!;
      s.frequency++;
      s.totalVolume += cluster.volume;
      if (cluster.kd !== null) { s.totalKd += cluster.kd; s.kdCount++; }
    }
  }

  return Array.from(tokenStats.entries())
    .map(([token, stats]) => ({
      token,
      length: token.length,
      frequency: stats.frequency,
      totalVolume: stats.totalVolume,
      avgKd: stats.kdCount > 0 ? Math.round(stats.totalKd / stats.kdCount) : null,
      label: '',
      labelArr: [],
      locationCity: 'No',
      locationState: 'No',
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

// ─── Impact Preview ──────────────────────────────────────────────────────────

/** Dry-run merge to compute impact stats (does not modify data) */
export function computeMergeImpact(
  results: ProcessedRow[],
  groupedClusters: GroupedCluster[],
  approvedGroups: GroupedCluster[],
  parentToken: string,
  childTokens: string[]
): { pagesAffected: number; groupsAffected: number; approvedGroupsAffected: number; pageCollisions: number } {
  const childSet = new Set(childTokens);
  const affectedSignatures = new Set<string>();

  // Count affected rows and track signature changes
  const sigChanges = new Map<string, string>(); // old → new
  for (const row of results) {
    if (row.tokenArr.some(t => childSet.has(t))) {
      const newTokenArr = mergeTokenArr(row.tokenArr, parentToken, childTokens);
      const newSig = computeSignature(newTokenArr);
      if (row.tokens !== newSig) {
        affectedSignatures.add(row.tokens);
        sigChanges.set(row.tokens, newSig);
      }
    }
  }

  // Count page collisions (different old signatures mapping to same new signature)
  const newSigCounts = new Map<string, number>();
  for (const newSig of sigChanges.values()) {
    newSigCounts.set(newSig, (newSigCounts.get(newSig) || 0) + 1);
  }
  // Also count existing signatures that match a new signature
  const existingSigs = new Set(results.map(r => r.tokens));
  let pageCollisions = 0;
  for (const [newSig, count] of newSigCounts) {
    const existingMatch = existingSigs.has(newSig) && !sigChanges.has(newSig) ? 1 : 0;
    if (count + existingMatch > 1) pageCollisions += count + existingMatch - 1;
  }

  // Count affected groups
  let groupsAffected = 0;
  for (const group of groupedClusters) {
    if (group.clusters.some(c => affectedSignatures.has(c.tokens))) groupsAffected++;
  }

  let approvedGroupsAffected = 0;
  for (const group of approvedGroups) {
    if (group.clusters.some(c => affectedSignatures.has(c.tokens))) approvedGroupsAffected++;
  }

  return {
    pagesAffected: affectedSignatures.size,
    groupsAffected,
    approvedGroupsAffected,
    pageCollisions,
  };
}

// ─── Apply All Merge Rules (for CSV processing) ─────────────────────────────

/** Apply all merge rules to a tokenArr — used during CSV processing */
export function applyMergeRulesToTokenArr(tokenArr: string[], rules: TokenMergeRule[]): string[] {
  let current = [...tokenArr];
  for (const rule of rules) {
    const childSet = new Set(rule.childTokens);
    if (current.some(t => childSet.has(t))) {
      current = mergeTokenArr(current, rule.parentToken, rule.childTokens);
    }
  }
  return current;
}

// ─── Full Merge Cascade ──────────────────────────────────────────────────────

export interface MergeCascadeResult {
  results: ProcessedRow[];
  clusterSummary: ClusterSummary[];
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];  // Only unaffected ones stay
  unapprovedGroups: GroupedCluster[]; // Affected approved → moved to grouped
  tokenSummary: TokenSummary[];
  emptyGroupNames: string[];
  pagesAffected: number;
}

/** Run the full merge cascade — all pure, no side effects */
export function executeMergeCascade(
  results: ProcessedRow[],
  groupedClusters: GroupedCluster[],
  approvedGroups: GroupedCluster[],
  parentToken: string,
  childTokens: string[]
): MergeCascadeResult {
  // Phase 1: Token replacement
  const { updatedResults, signatureMap } = applyMergeToRows(results, parentToken, childTokens);

  // Phase 2: Rebuild clusters
  const newClusters = rebuildClusters(updatedResults);
  const newClusterMap = new Map(newClusters.map(c => [c.tokens, c]));

  // Phase 3: Update groups
  const { updatedGroups: initialUpdatedGroups, emptyGroupNames } = updateGroupsAfterMerge(groupedClusters, signatureMap, newClusterMap);
  let updatedGroups = initialUpdatedGroups;

  // Phase 4: Handle cross-group conflicts
  updatedGroups = handleCrossGroupConflict(updatedGroups);

  // Phase 5: Update approved groups
  const { unaffected, affected } = updateApprovedAfterMerge(approvedGroups, signatureMap, newClusterMap);

  // Move affected approved back to grouped
  const unapprovedGroups = affected;
  const mergedGrouped = [...updatedGroups, ...unapprovedGroups];

  // Handle cross-group conflicts again (approved may conflict with grouped)
  const finalGrouped = handleCrossGroupConflict(mergedGrouped);

  // Phase 6: Rebuild token summary
  const tokenSummary = rebuildTokenSummary(updatedResults);

  return {
    results: updatedResults,
    clusterSummary: newClusters,
    groupedClusters: finalGrouped,
    approvedGroups: unaffected,
    unapprovedGroups,
    tokenSummary,
    emptyGroupNames,
    pagesAffected: signatureMap.size,
  };
}
