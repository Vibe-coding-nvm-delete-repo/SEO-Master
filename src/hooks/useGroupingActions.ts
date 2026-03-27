import { useCallback } from 'react';
import type { ClusterSummary, GroupedCluster } from '../types';

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
  addGroupsAndRemovePages: (groups: GroupedCluster[], removedTokens: Set<string>) => void;
  approveGroup: (groupName: string) => GroupedCluster | null;
  unapproveGroup: (groupName: string) => GroupedCluster | null;
  removeFromApproved: (
    selectedGroupIds: Set<string>,
    selectedSubClusterKeys: Set<string>,
    recalc: (group: GroupedCluster, remainingClusters: ClusterSummary[]) => GroupedCluster,
  ) => { clustersReturned: ClusterSummary[] };
  ungroupPages: (
    selectedGroupIds: Set<string>,
    selectedSubClusterKeys: Set<string>,
    recalc: (group: GroupedCluster, remainingClusters: ClusterSummary[]) => GroupedCluster,
  ) => { clustersReturned: ClusterSummary[]; groupsWithPartialRemoval: string[] };
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
    const group = approveGroup(groupName);
    if (group) {
      logAndToast('approve', `Approved '${groupName}'`, group.clusters.length, `Approved '${groupName}' (${group.clusters.length} pages)`, 'success');
    }
  }, [approveGroup, logAndToast]);

  const handleUnapproveGroup = useCallback((groupName: string) => {
    const group = unapproveGroup(groupName);
    if (group) {
      logAndToast('unapprove', `Unapproved '${groupName}'`, group.clusters.length, `Unapproved '${groupName}'`, 'warning');
    }
  }, [logAndToast, unapproveGroup]);

  const handleRemoveFromApproved = useCallback(() => {
    if (selectedGroups.size === 0 && selectedSubClusters.size === 0) return;
    if (!clusterSummary) return;

    const wholeGroupCount = selectedGroups.size;
    const { clustersReturned } = removeFromApproved(selectedGroups, selectedSubClusters, recalcGroupStats);
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());

    const totalRemoved = wholeGroupCount + clustersReturned.length;
    logAndToast('remove-approved', `Removed ${totalRemoved} items from approved`, totalRemoved, `Removed ${totalRemoved} items from approved`, 'warning');
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
    addGroupsAndRemovePages([newGroup], removedTokens);
    setSelectedClusters(new Set());
    setGroupNameInput('');
    setCurrentPage(1);

    recordGroupingEvent(clustersToGroup.length);
    logAndToast('group', `Grouped into '${groupLabel}'`, clustersToGroup.length, `Grouped ${clustersToGroup.length} pages into '${groupLabel}'`, 'info');
  }, [addGroupsAndRemovePages, clusterSummary, groupNameInput, hasReviewApi, logAndToast, recordGroupingEvent, selectedClusters, setCurrentPage, setGroupNameInput, setSelectedClusters]);

  const handleAutoGroupApprove = useCallback((newGroups: GroupedCluster[]) => {
    const removedTokens = new Set<string>();
    for (const g of newGroups) {
      for (const c of g.clusters) removedTokens.add(c.tokens);
    }
    addGroupsAndRemovePages(newGroups, removedTokens);
  }, [addGroupsAndRemovePages]);

  const handleUngroupClusters = useCallback(() => {
    if (selectedGroups.size === 0 && selectedSubClusters.size === 0) return;
    if (!clusterSummary) return;

    const { clustersReturned, groupsWithPartialRemoval } = ungroupPages(selectedGroups, selectedSubClusters, recalcGroupStats);
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());

    logAndToast('ungroup', `Ungrouped ${clustersReturned.length} pages`, clustersReturned.length, `Ungrouped ${clustersReturned.length} pages back to ungrouped`, 'warning');

    if (groupsWithPartialRemoval.length > 0) {
      scheduleReReview(groupsWithPartialRemoval);
    }
  }, [clusterSummary, logAndToast, recalcGroupStats, scheduleReReview, selectedGroups, selectedSubClusters, setSelectedGroups, setSelectedSubClusters, ungroupPages]);

  const clearApprovedSelections = useCallback(() => {
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());
  }, [setSelectedGroups, setSelectedSubClusters]);

  const approveSelectedGrouped = useCallback(() => {
    const groupsToApprove = groupedClusters.filter(g => selectedGroups.has(g.id));
    groupsToApprove.forEach(g => handleApproveGroup(g.groupName));
    clearApprovedSelections();
  }, [clearApprovedSelections, groupedClusters, handleApproveGroup, selectedGroups]);

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
