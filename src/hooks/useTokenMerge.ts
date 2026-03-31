/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useCallback } from 'react';
import type { ProcessedRow, ClusterSummary, TokenSummary, GroupedCluster, TokenMergeRule, ActivityAction } from '../types';
import { executeMergeCascade, rebuildClusters as rebuildClustersFromRows, rebuildTokenSummary as rebuildTokenSummaryFromRows } from '../tokenMerge';
import { isAcceptedSharedMutation, type SharedMutationResult } from '../sharedMutation';

interface UseTokenMergeParams {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];
  tokenMergeRules: TokenMergeRule[];
  selectedMgmtTokens: Set<string>;
  selectedTokens: Set<string>;
  resultsRef: React.MutableRefObject<ProcessedRow[] | null>;
  groupedClustersRef: React.MutableRefObject<GroupedCluster[]>;
  approvedGroupsRef: React.MutableRefObject<GroupedCluster[]>;
  clusterSummaryRef: React.MutableRefObject<ClusterSummary[] | null>;
  tokenSummaryRef: React.MutableRefObject<TokenSummary[] | null>;
  logAndToast: (action: ActivityAction, details: string, count: number, toastMsg: string, toastType?: 'success' | 'info' | 'warning' | 'error') => void;
  applyMergeCascade: (cascade: { results: ProcessedRow[] | null; clusterSummary: ClusterSummary[] | null; tokenSummary: TokenSummary[] | null; groupedClusters: GroupedCluster[]; approvedGroups: GroupedCluster[]; }, newRule: TokenMergeRule) => Promise<SharedMutationResult>;
  undoMerge: (data: { results: ProcessedRow[] | null; clusterSummary: ClusterSummary[] | null; tokenSummary: TokenSummary[] | null; groupedClusters: GroupedCluster[]; approvedGroups: GroupedCluster[]; tokenMergeRules: TokenMergeRule[]; }) => Promise<SharedMutationResult>;
  setSelectedTokens: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedMgmtTokens: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useTokenMerge({
  results,
  clusterSummary,
  groupedClusters,
  approvedGroups,
  tokenMergeRules,
  selectedMgmtTokens,
  selectedTokens,
  resultsRef,
  groupedClustersRef,
  approvedGroupsRef,
  clusterSummaryRef: _clusterSummaryRef,
  tokenSummaryRef: _tokenSummaryRef,
  logAndToast,
  applyMergeCascade,
  undoMerge,
  setSelectedTokens,
  setSelectedMgmtTokens,
}: UseTokenMergeParams) {
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [mergeModalTokens, setMergeModalTokens] = useState<string[]>([]);

  const handleOpenMergeModal = useCallback(() => {
    if (selectedMgmtTokens.size < 2) return;
    setMergeModalTokens(Array.from(selectedMgmtTokens));
    setIsMergeModalOpen(true);
  }, [selectedMgmtTokens]);

  const handleMergeTokens = useCallback(async (parentToken: string): Promise<boolean> => {
    if (!results || !clusterSummary) return false;
    const childTokens = mergeModalTokens.filter(t => t !== parentToken);
    if (childTokens.length === 0) return false;

    // Run the cascade — use refs to avoid stale closures
    const cascade = executeMergeCascade(resultsRef.current, groupedClustersRef.current, approvedGroupsRef.current, parentToken, childTokens);

    // Create merge rule
    const newRule: TokenMergeRule = {
      id: `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      parentToken,
      childTokens,
      createdAt: new Date().toISOString(),
    };

    // Update selected token filters — replace children with parent
    const newSelectedTokens = new Set(selectedTokens);
    let filterChanged = false;
    for (const child of childTokens) {
      if (newSelectedTokens.has(child)) {
        newSelectedTokens.delete(child);
        newSelectedTokens.add(parentToken);
        filterChanged = true;
      }
    }

    // persistence.applyMergeCascade atomically updates latest ref + state + saves.
    // No separate startTransition/setState calls needed (they would conflict).
    const result = await applyMergeCascade(cascade, newRule);
    if (!isAcceptedSharedMutation(result)) return false;
    if (filterChanged) setSelectedTokens(newSelectedTokens);
    setSelectedMgmtTokens(new Set());

    const details = `Merged ${childTokens.join(', ')} \u2192 ${parentToken}`;
    logAndToast('merge', details, childTokens.length,
      `Merged ${childTokens.length} token${childTokens.length > 1 ? 's' : ''} into '${parentToken}' \u2014 ${cascade.pagesAffected} pages affected`, 'info');

    if (cascade.unapprovedGroups.length > 0) {
      logAndToast('merge', `Auto-unapproved ${cascade.unapprovedGroups.length} group(s) due to merge`, cascade.unapprovedGroups.length,
        `${cascade.unapprovedGroups.length} approved group${cascade.unapprovedGroups.length > 1 ? 's' : ''} moved back for re-review`, 'warning');
    }

    setIsMergeModalOpen(false);
    setMergeModalTokens([]);
    return true;
  }, [results, clusterSummary, groupedClusters, approvedGroups, mergeModalTokens, selectedTokens, logAndToast]);

  const handleUndoMergeChild = useCallback(async (ruleId: string, childToken: string): Promise<boolean> => {
    if (!results) return false;

    // Update the rule
    const updatedRules = tokenMergeRules.map(r => {
      if (r.id !== ruleId) return r;
      return { ...r, childTokens: r.childTokens.filter(t => t !== childToken) };
    }).filter(r => r.childTokens.length > 0); // Remove rules with no children

    // Restore originalTokenArr on all rows, then re-apply all remaining rules
    const restoredResults = results.map(row => {
      if (!row.originalTokenArr) return row;
      // Start from original tokens
      let tokenArr = [...row.originalTokenArr];
      // Re-apply all remaining rules
      for (const rule of updatedRules) {
        const childSet = new Set(rule.childTokens);
        if (tokenArr.some(t => childSet.has(t))) {
          let hasParent = false;
          const merged: string[] = [];
          for (const t of tokenArr) {
            if (childSet.has(t)) { if (!hasParent) { merged.push(rule.parentToken); hasParent = true; } }
            else if (t === rule.parentToken) { if (!hasParent) { merged.push(rule.parentToken); hasParent = true; } }
            else merged.push(t);
          }
          tokenArr = merged.sort();
        }
      }
      const newSig = [...new Set(tokenArr)].sort().join(' ');
      // If no rules remain and tokens match original, clear originalTokenArr
      const stillMerged = updatedRules.length > 0 && newSig !== [...row.originalTokenArr].sort().join(' ');
      return {
        ...row,
        tokenArr,
        tokens: newSig,
        originalTokenArr: stillMerged ? row.originalTokenArr : undefined,
      };
    });

    // Rebuild everything from the restored results
    const newClusters = rebuildClustersFromRows(restoredResults);
    const newClusterMap = new Map(newClusters.map(c => [c.tokens, c]));

    // Update groups with new cluster data
    const updateGroupList = (groups: GroupedCluster[]) => groups.map(group => {
      const newGroupClusters = group.clusters.map(c => newClusterMap.get(c.tokens) || c).filter((c, i, arr) => arr.findIndex(x => x.tokens === c.tokens) === i);
      if (newGroupClusters.length === 0) return null;
      const totalVolume = newGroupClusters.reduce((s, c) => s + c.totalVolume, 0);
      const keywordCount = newGroupClusters.reduce((s, c) => s + c.keywordCount, 0);
      return { ...group, clusters: newGroupClusters, totalVolume, keywordCount };
    }).filter((g): g is GroupedCluster => g !== null);

    const updatedGroups = updateGroupList(groupedClusters);
    const updatedApproved = updateGroupList(approvedGroups);
    const newTokenSummary = rebuildTokenSummaryFromRows(restoredResults);

    const result = await undoMerge({ results: restoredResults, clusterSummary: newClusters, tokenSummary: newTokenSummary, groupedClusters: updatedGroups, approvedGroups: updatedApproved, tokenMergeRules: updatedRules });
    if (!isAcceptedSharedMutation(result)) return false;
    const rule = tokenMergeRules.find(r => r.id === ruleId);
    logAndToast('unmerge', `Unmerged '${childToken}' from '${rule?.parentToken || 'parent'}'`, 1,
      `Unmerged '${childToken}'`, 'success');
    return true;
  }, [results, tokenMergeRules, groupedClusters, approvedGroups, logAndToast]);

  const handleUndoMergeParent = useCallback(async (ruleId: string): Promise<boolean> => {
    if (!results) return false;

    const ruleToRemove = tokenMergeRules.find(r => r.id === ruleId);
    const updatedRules = tokenMergeRules.filter(r => r.id !== ruleId);

    // Restore originalTokenArr on all rows, then re-apply all remaining rules
    const restoredResults = results.map(row => {
      if (!row.originalTokenArr) return row;

      let tokenArr = [...row.originalTokenArr];
      for (const rule of updatedRules) {
        const childSet = new Set(rule.childTokens);
        if (tokenArr.some(t => childSet.has(t))) {
          let hasParent = false;
          const merged: string[] = [];
          for (const t of tokenArr) {
            if (childSet.has(t)) {
              if (!hasParent) { merged.push(rule.parentToken); hasParent = true; }
            } else if (t === rule.parentToken) {
              if (!hasParent) { merged.push(rule.parentToken); hasParent = true; }
            } else {
              merged.push(t);
            }
          }
          tokenArr = merged.sort();
        }
      }

      const newSig = [...new Set(tokenArr)].sort().join(' ');
      const stillMerged = updatedRules.length > 0 && newSig !== [...row.originalTokenArr].sort().join(' ');
      return {
        ...row,
        tokenArr,
        tokens: newSig,
        originalTokenArr: stillMerged ? row.originalTokenArr : undefined,
      };
    });

    // Rebuild clusters
    const newClusters = rebuildClustersFromRows(restoredResults);
    const newClusterMap = new Map(newClusters.map(c => [c.tokens, c]));

    // Update groups with new cluster data
    const updateGroupList = (groups: GroupedCluster[]) => groups.map(group => {
      const newGroupClusters = group.clusters.map(c => newClusterMap.get(c.tokens) || c).filter((c, i, arr) => arr.findIndex(x => x.tokens === c.tokens) === i);
      if (newGroupClusters.length === 0) return null;
      const totalVolume = newGroupClusters.reduce((s, c) => s + c.totalVolume, 0);
      const keywordCount = newGroupClusters.reduce((s, c) => s + c.keywordCount, 0);
      return { ...group, clusters: newGroupClusters, totalVolume, keywordCount };
    }).filter((g): g is GroupedCluster => g !== null);

    const updatedGroups = updateGroupList(groupedClusters);
    const updatedApproved = updateGroupList(approvedGroups);
    const newTokenSummary = rebuildTokenSummaryFromRows(restoredResults);

    const result = await undoMerge({
      results: restoredResults,
      clusterSummary: newClusters,
      tokenSummary: newTokenSummary,
      groupedClusters: updatedGroups,
      approvedGroups: updatedApproved,
      tokenMergeRules: updatedRules,
    });
    if (!isAcceptedSharedMutation(result)) return false;
    logAndToast(
      'unmerge',
      `Unmerged '${ruleToRemove?.parentToken || 'parent'}'`,
      ruleToRemove?.childTokens.length ?? 0,
      `Unmerged '${ruleToRemove?.parentToken || 'parent'}'`,
      'success'
    );
    return true;
  }, [results, tokenMergeRules, groupedClusters, approvedGroups, logAndToast]);

  return {
    isMergeModalOpen,
    setIsMergeModalOpen,
    mergeModalTokens,
    setMergeModalTokens,
    handleOpenMergeModal,
    handleMergeTokens,
    handleUndoMergeChild,
    handleUndoMergeParent,
  };
}
