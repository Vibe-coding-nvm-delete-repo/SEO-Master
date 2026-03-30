/**
 * Group Data tab: sub-tab, filters, sort, pagination, search, label/token selection, token management panel.
 * P1.1 — extracted from App.tsx; behavior must match the previous inline implementation.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ClusterSummary, TokenSummary } from '../types';
import { useDebouncedValue } from './useDebouncedValue';

export type GroupDataTab = 'pages' | 'keywords' | 'grouped' | 'group-auto-merge' | 'approved' | 'blocked' | 'auto-group';

export interface UseKeywordWorkspaceInput {
  setSelectedClusters: Dispatch<SetStateAction<Set<string>>>;
}

export function useKeywordWorkspace({ setSelectedClusters }: UseKeywordWorkspaceInput) {
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedSubClusters, setSelectedSubClusters] = useState<Set<string>>(new Set()); // key: "groupId::clusterTokens"
  const [activeTab, setActiveTab] = useState<GroupDataTab>('pages');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(500);
  /** Urgent updates — do not wrap in startTransition or tab switches feel delayed (seconds) under load. */
  const switchTab = useCallback((tab: GroupDataTab) => {
    setActiveTab(tab);
    setCurrentPage(1);
    setSelectedClusters(new Set());
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());
  }, [setSelectedClusters]);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSearchImmediate = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearchQuery(value), 200);
  }, []);
  useEffect(() => () => { if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current); }, []);
  const [minClusterCount, setMinClusterCount] = useState<string>('');
  const [maxClusterCount, setMaxClusterCount] = useState<string>('');
  const [minTokenLen, setMinTokenLen] = useState<string>('');
  const [maxTokenLen, setMaxTokenLen] = useState<string>('');
  const [excludedLabels, setExcludedLabels] = useState<Set<string>>(new Set());
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [isLabelDropdownOpen, setIsLabelDropdownOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<Array<{ key: keyof ClusterSummary; direction: 'asc' | 'desc' }>>([
    { key: 'totalVolume', direction: 'desc' },
  ]);
  const [tokenSortConfig, setTokenSortConfig] = useState<{ key: keyof TokenSummary; direction: 'asc' | 'desc' }>({
    key: 'frequency',
    direction: 'desc',
  });
  const [groupedSortConfig, setGroupedSortConfig] = useState<Array<{ key: string; direction: 'asc' | 'desc' }>>([
    { key: 'keywordCount', direction: 'desc' },
  ]);
  /** All Keywords tab — multi-sort on ProcessedRow fields */
  const [keywordsSortConfig, setKeywordsSortConfig] = useState<Array<{ key: string; direction: 'asc' | 'desc' }>>([
    { key: 'searchVolume', direction: 'desc' },
  ]);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  const [filterCity, setFilterCity] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');
  const [minLen, setMinLen] = useState<string>('');
  const [maxLen, setMaxLen] = useState<string>('');
  const [minKwInCluster, setMinKwInCluster] = useState<string>('');
  const [maxKwInCluster, setMaxKwInCluster] = useState<string>('');
  const [minVolume, setMinVolume] = useState<string>('');
  const [maxVolume, setMaxVolume] = useState<string>('');
  const [minKd, setMinKd] = useState<string>('');
  const [maxKd, setMaxKd] = useState<string>('');
  const [minKwRating, setMinKwRating] = useState<string>('');
  const [maxKwRating, setMaxKwRating] = useState<string>('');

  // Debounced range/location filters — raw values stay bound to inputs for instant UI feedback,
  // debounced values drive the expensive filtering computations.
  const debouncedMinClusterCount = useDebouncedValue(minClusterCount, 250);
  const debouncedMaxClusterCount = useDebouncedValue(maxClusterCount, 250);
  const debouncedMinTokenLen = useDebouncedValue(minTokenLen, 250);
  const debouncedMaxTokenLen = useDebouncedValue(maxTokenLen, 250);
  const debouncedFilterCity = useDebouncedValue(filterCity, 250);
  const debouncedFilterState = useDebouncedValue(filterState, 250);
  const debouncedMinLen = useDebouncedValue(minLen, 250);
  const debouncedMaxLen = useDebouncedValue(maxLen, 250);
  const debouncedMinKwInCluster = useDebouncedValue(minKwInCluster, 250);
  const debouncedMaxKwInCluster = useDebouncedValue(maxKwInCluster, 250);
  const debouncedMinVolume = useDebouncedValue(minVolume, 250);
  const debouncedMaxVolume = useDebouncedValue(maxVolume, 250);
  const debouncedMinKd = useDebouncedValue(minKd, 250);
  const debouncedMaxKd = useDebouncedValue(maxKd, 250);
  const debouncedMinKwRating = useDebouncedValue(minKwRating, 250);
  const debouncedMaxKwRating = useDebouncedValue(maxKwRating, 250);

  const [tokenMgmtSearch, setTokenMgmtSearch] = useState('');
  const debouncedTokenMgmtSearch = useDebouncedValue(tokenMgmtSearch, 200);
  const [tokenMgmtSort, setTokenMgmtSort] = useState<{
    key: 'token' | 'totalVolume' | 'frequency' | 'avgKd';
    direction: 'asc' | 'desc';
  }>({ key: 'totalVolume', direction: 'desc' });
  const [selectedMgmtTokens, setSelectedMgmtTokens] = useState<Set<string>>(new Set());
  const [tokenMgmtPage, setTokenMgmtPage] = useState(1);
  const tokenMgmtPerPage = 100;
  const [tokenMgmtSubTab, setTokenMgmtSubTab] = useState<'current' | 'all' | 'merge' | 'auto-merge' | 'blocked'>('current');
  const [expandedMergeParents, setExpandedMergeParents] = useState<Set<string>>(new Set());

  return {
    selectedGroups,
    setSelectedGroups,
    selectedSubClusters,
    setSelectedSubClusters,
    activeTab,
    setActiveTab,
    switchTab,
    statsExpanded,
    setStatsExpanded,
    error,
    setError,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    setDebouncedSearchQuery,
    setSearchImmediate,
    minClusterCount,
    setMinClusterCount,
    maxClusterCount,
    setMaxClusterCount,
    minTokenLen,
    setMinTokenLen,
    maxTokenLen,
    setMaxTokenLen,
    excludedLabels,
    setExcludedLabels,
    selectedTokens,
    setSelectedTokens,
    isLabelDropdownOpen,
    setIsLabelDropdownOpen,
    sortConfig,
    setSortConfig,
    tokenSortConfig,
    setTokenSortConfig,
    groupedSortConfig,
    setGroupedSortConfig,
    keywordsSortConfig,
    setKeywordsSortConfig,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    expandedClusters,
    setExpandedClusters,
    filterCity,
    setFilterCity,
    filterState,
    setFilterState,
    minLen,
    setMinLen,
    maxLen,
    setMaxLen,
    minKwInCluster,
    setMinKwInCluster,
    maxKwInCluster,
    setMaxKwInCluster,
    minVolume,
    setMinVolume,
    maxVolume,
    setMaxVolume,
    minKd,
    setMinKd,
    maxKd,
    setMaxKd,
    minKwRating,
    setMinKwRating,
    maxKwRating,
    setMaxKwRating,
    debouncedMinClusterCount,
    debouncedMaxClusterCount,
    debouncedMinTokenLen,
    debouncedMaxTokenLen,
    debouncedFilterCity,
    debouncedFilterState,
    debouncedMinLen,
    debouncedMaxLen,
    debouncedMinKwInCluster,
    debouncedMaxKwInCluster,
    debouncedMinVolume,
    debouncedMaxVolume,
    debouncedMinKd,
    debouncedMaxKd,
    debouncedMinKwRating,
    debouncedMaxKwRating,
    tokenMgmtSearch,
    setTokenMgmtSearch,
    debouncedTokenMgmtSearch,
    tokenMgmtSort,
    setTokenMgmtSort,
    selectedMgmtTokens,
    setSelectedMgmtTokens,
    tokenMgmtPage,
    setTokenMgmtPage,
    tokenMgmtPerPage,
    tokenMgmtSubTab,
    setTokenMgmtSubTab,
    expandedMergeParents,
    setExpandedMergeParents,
  };
}
