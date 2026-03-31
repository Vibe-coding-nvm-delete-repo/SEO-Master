import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClusterSummary, GroupedCluster } from '../types';
import { useGroupingActions } from './useGroupingActions';

function makeCluster(tokens: string, pageName = 'Alpha'): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: 2,
    totalVolume: 100,
    avgKd: 20,
    avgKwRating: 1,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
    keywords: [],
  };
}

describe('useGroupingActions', () => {
  it('does not clear state or toast success when grouping is rejected', () => {
    const cluster = makeCluster('alpha');
    const setSelectedClusters = vi.fn();
    const setGroupNameInput = vi.fn();
    const setCurrentPage = vi.fn();
    const logAndToast = vi.fn();
    const recordGroupingEvent = vi.fn();

    const { result } = renderHook(() =>
      useGroupingActions({
        selectedClusters: new Set(['alpha']),
        setSelectedClusters,
        groupNameInput: 'Alpha Group',
        setGroupNameInput,
        clusterSummary: [cluster],
        selectedGroups: new Set(),
        setSelectedGroups: vi.fn(),
        selectedSubClusters: new Set(),
        setSelectedSubClusters: vi.fn(),
        groupedClusters: [],
        setCurrentPage,
        logAndToast,
        recordGroupingEvent,
        scheduleReReview: vi.fn(),
        hasReviewApi: () => false,
        addGroupsAndRemovePages: vi.fn(() => false),
        approveGroup: vi.fn(() => ({ applied: false, group: null })),
        unapproveGroup: vi.fn(() => ({ applied: false, group: null })),
        removeFromApproved: vi.fn(() => ({ applied: false, clustersReturned: [] })),
        ungroupPages: vi.fn(() => ({ applied: false, clustersReturned: [], groupsWithPartialRemoval: [] })),
      }),
    );

    let applied = true;
    act(() => {
      applied = result.current.handleGroupClusters();
    });

    expect(applied).toBe(false);
    expect(setSelectedClusters).not.toHaveBeenCalled();
    expect(setGroupNameInput).not.toHaveBeenCalled();
    expect(setCurrentPage).not.toHaveBeenCalled();
    expect(recordGroupingEvent).not.toHaveBeenCalled();
    expect(logAndToast).not.toHaveBeenCalled();
  });

  it('keeps grouped selections when approve is rejected', () => {
    const group: GroupedCluster = {
      id: 'group-1',
      groupName: 'Alpha Group',
      clusters: [makeCluster('alpha')],
      totalVolume: 100,
      keywordCount: 2,
      avgKd: 20,
      avgKwRating: 1,
    };
    const clearSelections = vi.fn();

    const { result } = renderHook(() =>
      useGroupingActions({
        selectedClusters: new Set(),
        setSelectedClusters: vi.fn(),
        groupNameInput: '',
        setGroupNameInput: vi.fn(),
        clusterSummary: [makeCluster('alpha')],
        selectedGroups: new Set(['group-1']),
        setSelectedGroups: clearSelections,
        selectedSubClusters: new Set(),
        setSelectedSubClusters: vi.fn(),
        groupedClusters: [group],
        setCurrentPage: vi.fn(),
        logAndToast: vi.fn(),
        recordGroupingEvent: vi.fn(),
        scheduleReReview: vi.fn(),
        hasReviewApi: () => false,
        addGroupsAndRemovePages: vi.fn(() => true),
        approveGroup: vi.fn(() => ({ applied: false, group })),
        unapproveGroup: vi.fn(() => ({ applied: false, group: null })),
        removeFromApproved: vi.fn(() => ({ applied: false, clustersReturned: [] })),
        ungroupPages: vi.fn(() => ({ applied: false, clustersReturned: [], groupsWithPartialRemoval: [] })),
      }),
    );

    let applied = true;
    act(() => {
      applied = result.current.approveSelectedGrouped();
    });

    expect(applied).toBe(false);
    expect(clearSelections).not.toHaveBeenCalled();
  });

  it('approves all selected groups and clears only the successful selections', () => {
    const groupA: GroupedCluster = {
      id: 'group-a',
      groupName: 'Group A',
      clusters: [makeCluster('alpha')],
      totalVolume: 100,
      keywordCount: 2,
      avgKd: 20,
      avgKwRating: 1,
    };
    const groupB: GroupedCluster = {
      id: 'group-b',
      groupName: 'Group B',
      clusters: [makeCluster('beta', 'Beta')],
      totalVolume: 120,
      keywordCount: 2,
      avgKd: 25,
      avgKwRating: 1,
    };
    const setSelectedGroups = vi.fn();
    const setSelectedSubClusters = vi.fn();
    const approveGroup = vi.fn((groupName: string) => ({
      applied: true,
      group: groupName === 'Group A' ? groupA : groupB,
    }));

    const { result } = renderHook(() =>
      useGroupingActions({
        selectedClusters: new Set(),
        setSelectedClusters: vi.fn(),
        groupNameInput: '',
        setGroupNameInput: vi.fn(),
        clusterSummary: [makeCluster('alpha'), makeCluster('beta', 'Beta')],
        selectedGroups: new Set(['group-a', 'group-b']),
        setSelectedGroups,
        selectedSubClusters: new Set(['group-a::alpha', 'group-b::beta']),
        setSelectedSubClusters,
        groupedClusters: [groupA, groupB],
        setCurrentPage: vi.fn(),
        logAndToast: vi.fn(),
        recordGroupingEvent: vi.fn(),
        scheduleReReview: vi.fn(),
        hasReviewApi: () => false,
        addGroupsAndRemovePages: vi.fn(() => true),
        approveGroup,
        unapproveGroup: vi.fn(() => ({ applied: false, group: null })),
        removeFromApproved: vi.fn(() => ({ applied: false, clustersReturned: [] })),
        ungroupPages: vi.fn(() => ({ applied: false, clustersReturned: [], groupsWithPartialRemoval: [] })),
      }),
    );

    let applied = false;
    act(() => {
      applied = result.current.approveSelectedGrouped();
    });

    expect(applied).toBe(true);
    expect(approveGroup).toHaveBeenCalledTimes(2);
    expect(setSelectedGroups).toHaveBeenCalledWith(new Set());
    expect(setSelectedSubClusters).toHaveBeenCalledWith(new Set());
  });

  it('preserves failed approvals in the grouped selection', () => {
    const groupA: GroupedCluster = {
      id: 'group-a',
      groupName: 'Group A',
      clusters: [makeCluster('alpha')],
      totalVolume: 100,
      keywordCount: 2,
      avgKd: 20,
      avgKwRating: 1,
    };
    const groupB: GroupedCluster = {
      id: 'group-b',
      groupName: 'Group B',
      clusters: [makeCluster('beta', 'Beta')],
      totalVolume: 120,
      keywordCount: 2,
      avgKd: 25,
      avgKwRating: 1,
    };
    const setSelectedGroups = vi.fn();
    const setSelectedSubClusters = vi.fn();

    const { result } = renderHook(() =>
      useGroupingActions({
        selectedClusters: new Set(),
        setSelectedClusters: vi.fn(),
        groupNameInput: '',
        setGroupNameInput: vi.fn(),
        clusterSummary: [makeCluster('alpha'), makeCluster('beta', 'Beta')],
        selectedGroups: new Set(['group-a', 'group-b']),
        setSelectedGroups,
        selectedSubClusters: new Set(['group-a::alpha', 'group-b::beta']),
        setSelectedSubClusters,
        groupedClusters: [groupA, groupB],
        setCurrentPage: vi.fn(),
        logAndToast: vi.fn(),
        recordGroupingEvent: vi.fn(),
        scheduleReReview: vi.fn(),
        hasReviewApi: () => false,
        addGroupsAndRemovePages: vi.fn(() => true),
        approveGroup: vi.fn((groupName: string) => ({
          applied: groupName === 'Group A',
          group: groupName === 'Group A' ? groupA : groupB,
        })),
        unapproveGroup: vi.fn(() => ({ applied: false, group: null })),
        removeFromApproved: vi.fn(() => ({ applied: false, clustersReturned: [] })),
        ungroupPages: vi.fn(() => ({ applied: false, clustersReturned: [], groupsWithPartialRemoval: [] })),
      }),
    );

    let applied = false;
    act(() => {
      applied = result.current.approveSelectedGrouped();
    });

    expect(applied).toBe(true);
    expect(setSelectedGroups).toHaveBeenCalledWith(new Set(['group-b']));
    expect(setSelectedSubClusters).toHaveBeenCalledWith(new Set(['group-b::beta']));
  });
});
