import { useCallback } from 'react';
import type { ClusterSummary, GroupedCluster } from '../types';
import { parseSubClusterKey } from '../subClusterKeys';

export interface UseGroupingActionsInput {
  selectedClusters: Set<string>;
  setSelectedClusters: (next: Set<string>) => void;
  groupNameInput: string;
  setGroupNameInput: (value: string) => void;
  clusterSummary: ClusterSummary[] | null;
  selectedGroups: Set<string>;
  setSelectedGroups: (next: Set<string>) => void;
  selectedSubClusters: Set<string>;
  setSelectedSubClusters: (next: Set<string>) => void;
  groupedClusters: GroupedCluster[];
  setCurrentPage: (page: number) => void;
  logAndToast: (action: any, details: string, affectedRows: number, toastMsg: string, toastType: 'info' | 'warning' | 'success' | 'error') => void;
  recordGroupingEvent: (pagesInBatch: number) => void;
  scheduleReReview: (groupIds: string[]) => void;
  hasReviewApi: () => boolean;
  addGroupsAndRemovePages: (groups: GroupedCluster[], removedTokens: Set<string>) => boolean;
  approveGroup: (groupName: string) => { applied: boolean; group: GroupedCluster | null };
  unapproveGroup: (groupName: string) => { applied: boolean; group: GroupedCluster | null };
  removeFromApproved: (
    selectedGroupIds: Set<string>,
    selectedSubClusterKeys: Set<string>,
    recalc: (group: GroupedCluster, remainingClusters: ClusterSummary[]) => GroupedCluster,
  ) => { applied: boolean; clustersReturned: ClusterSummary[] };
  ungroupPages: (
    selectedGroupIds: Set<string>,
    selectedSubClusterKeys: Set<string>,
    recalc: (group: GroupedCluster, remainingClusters: ClusterSummary[]) => GroupedCluster,
  ) => { applied: boolean; clustersReturned: ClusterSummary[]; groupsWithPartialRemoval: string[] };
}

export function useGroupingActions(input: UseGroupingActionsInput) {
  const {
    selectedClusters,
    setSelectedClusters,
    groupNameInput,
    setGroupNameInput,
    clusterSummary,
    selectedGroups,
    setSelectedGroups,
    selectedSubClusters,
    setSelectedSubClusters,
    groupedClusters,
    setCurrentPage,
    logAndToast,
    recordGroupingEvent,
    scheduleReReview,
    hasReviewApi,
    addGroupsAndRemovePages,
    approveGroup,
    unapproveGroup,
    removeFromApproved,
    ungroupPages,
  } = input;

  const recalcGroupStats = useCallback((group: GroupedCluster, remainingClusters: ClusterSummary[]): GroupedCluster => {
    const totalVolume = remainingClusters.reduce((sum, c) => sum + c.totalVolume, 0);
    const keywordCount = remainingClusters.reduce((sum, c) => sum + c.keywordCount, 0);
    let totalKd = 0;
    let kdCount = 0;
    let totalKw = 0;
    let kwCount = 0;
    remainingClusters.forEach(c => {
      if (c.avgKd !== null) {
        totalKd += c.avgKd * c.keywordCount;
        kdCount += c.keywordCount;
      }
      if (c.avgKwRating != null) {
        totalKw += c.avgKwRating * c.keywordCount;
        kwCount += c.keywordCount;
      }
    });
    return {
      ...group,
      clusters: remainingClusters,
      totalVolume,
      keywordCount,
      avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
      avgKwRating: kwCount > 0 ? Math.round(totalKw / kwCount) : null,
    };
  }, []);

  const handleApproveGroup = useCallback((groupName: string) => {
    const result = approveGroup(groupName);
    if (result.applied && result.group) {
      logAndToast('approve', `Approved '${groupName}'`, result.group.clusters.length, `Approved '${groupName}' (${result.group.clusters.length} pages)`, 'success');
      return true;
    }
    return false;
  }, [approveGroup, logAndToast]);

  const handleUnapproveGroup = useCallback((groupName: string) => {
    const result = unapproveGroup(groupName);
    if (result.applied && result.group) {
      logAndToast('unapprove', `Unapproved '${groupName}'`, result.group.clusters.length, `Unapproved '${groupName}'`, 'warning');
      return true;
    }
    return false;
  }, [logAndToast, unapproveGroup]);

  const handleRemoveFromApproved = useCallback(() => {
    if (selectedGroups.size === 0 && selectedSubClusters.size === 0) return;
    if (!clusterSummary) return;

    const wholeGroupCount = selectedGroups.size;
    const { applied, clustersReturned } = removeFromApproved(selectedGroups, selectedSubClusters, recalcGroupStats);
    if (!applied) return false;
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());

    const totalRemoved = wholeGroupCount + clustersReturned.length;
    logAndToast('remove-approved', `Removed ${totalRemoved} items from approved`, totalRemoved, `Removed ${totalRemoved} items from approved`, 'warning');
    return true;
  }, [clusterSummary, logAndToast, recalcGroupStats, removeFromApproved, selectedGroups, selectedSubClusters, setSelectedGroups, setSelectedSubClusters]);

  const handleGroupClusters = useCallback(() => {
    if (selectedClusters.size === 0 || !groupNameInput.trim() || !clusterSummary) return;

    const clustersToGroup = clusterSummary.filter(c => selectedClusters.has(c.tokens));
    const totalVolume = clustersToGroup.reduce((sum, c) => sum + c.totalVolume, 0);
    const keywordCount = clustersToGroup.reduce((sum, c) => sum + c.keywordCount, 0);

    let totalKd = 0;
    let kdCount = 0;
    let totalKw = 0;
    let kwCount = 0;
    clustersToGroup.forEach(c => {
      if (c.avgKd !== null) {
        totalKd += c.avgKd * c.keywordCount;
        kdCount += c.keywordCount;
      }
      if (c.avgKwRating != null) {
        totalKw += c.avgKwRating * c.keywordCount;
        kwCount += c.keywordCount;
      }
    });

    const groupLabel = groupNameInput.trim();
    const newGroup: GroupedCluster = {
      id: `${groupLabel}-${Date.now()}`,
      groupName: groupLabel,
      clusters: clustersToGroup,
      totalVolume,
      keywordCount,
      avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
      avgKwRating: kwCount > 0 ? Math.round(totalKw / kwCount) : null,
      reviewStatus: hasReviewApi() ? 'pending' : undefined,
    };

    const removedTokens = new Set(clustersToGroup.map(c => c.tokens));
    const applied = addGroupsAndRemovePages([newGroup], removedTokens);
    if (!applied) return false;
    setSelectedClusters(new Set());
    setGroupNameInput('');
    setCurrentPage(1);

    recordGroupingEvent(clustersToGroup.length);
    logAndToast('group', `Grouped into '${groupLabel}'`, clustersToGroup.length, `Grouped ${clustersToGroup.length} pages into '${groupLabel}'`, 'info');
    return true;
  }, [addGroupsAndRemovePages, clusterSummary, groupNameInput, hasReviewApi, logAndToast, recordGroupingEvent, selectedClusters, setCurrentPage, setGroupNameInput, setSelectedClusters]);

  const handleAutoGroupApprove = useCallback((newGroups: GroupedCluster[]) => {
    const removedTokens = new Set<string>();
    for (const g of newGroups) {
      for (const c of g.clusters) removedTokens.add(c.tokens);
    }
    return addGroupsAndRemovePages(newGroups, removedTokens);
  }, [addGroupsAndRemovePages]);

  const handleUngroupClusters = useCallback(() => {
    if (selectedGroups.size === 0 && selectedSubClusters.size === 0) return;
    if (!clusterSummary) return;

    const { applied, clustersReturned, groupsWithPartialRemoval } = ungroupPages(selectedGroups, selectedSubClusters, recalcGroupStats);
    if (!applied) return false;
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());

    logAndToast('ungroup', `Ungrouped ${clustersReturned.length} pages`, clustersReturned.length, `Ungrouped ${clustersReturned.length} pages back to ungrouped`, 'warning');

    if (groupsWithPartialRemoval.length > 0) {
      scheduleReReview(groupsWithPartialRemoval);
    }
    return true;
  }, [clusterSummary, logAndToast, recalcGroupStats, scheduleReReview, selectedGroups, selectedSubClusters, setSelectedGroups, setSelectedSubClusters, ungroupPages]);

  const clearApprovedSelections = useCallback(() => {
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());
  }, [setSelectedGroups, setSelectedSubClusters]);

  const approveSelectedGrouped = useCallback(() => {
    const groupsToApprove = groupedClusters.filter(g => selectedGroups.has(g.id));
    const approvedIds = new Set<string>();
    for (const group of groupsToApprove) {
      if (handleApproveGroup(group.groupName)) {
        approvedIds.add(group.id);
      }
    }
    if (approvedIds.size === 0) return false;
    setSelectedGroups(new Set(Array.from(selectedGroups).filter((id) => !approvedIds.has(id))));
    setSelectedSubClusters(new Set(
      Array.from(selectedSubClusters).filter((key) => {
        const parsed = parseSubClusterKey(key);
        return !parsed || !approvedIds.has(parsed.groupId);
      }),
    ));
    return true;
  }, [groupedClusters, handleApproveGroup, selectedGroups, selectedSubClusters, setSelectedGroups, setSelectedSubClusters]);

  return {
    recalcGroupStats,
    handleApproveGroup,
    handleUnapproveGroup,
    handleRemoveFromApproved,
    handleGroupClusters,
    handleAutoGroupApprove,
    handleUngroupClusters,
    approveSelectedGrouped,
    clearApprovedSelections,
  };
}
