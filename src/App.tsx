/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react-hooks/refs */
import React, { useState, useCallback, useMemo, useEffect, useTransition, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { UploadCloud, Download, FileText, Loader2, AlertCircle, RefreshCw, Database, CheckCircle2, Layers, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Hash, TrendingUp, MapPin, Map as MapIcon, HelpCircle, ShoppingCart, Navigation, Calendar, Filter, BookOpen, Compass, LogIn, LogOut, Save, Bookmark, Sparkles, X, Plus, Folder, Trash2, Lock, Settings, Star, ExternalLink, Copy, Zap, Globe, ClipboardList, Cloud, CloudOff, Lightbulb, List, Check, DollarSign, Inbox, Bell } from 'lucide-react';
import { numberMap, stateMap, stateAbbrToFull, stateFullNames, stopWords, ignoredTokens, synonymMap, countries } from './dictionaries';
import { citySet, cityFirstWords, stateSet, capitalizeWords, normalizeState, detectForeignEntity, normalizeKeywordToTokenArr, getLabelColor } from './processing';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, deleteDoc, onSnapshot, query, where, getDoc, getDocFromServer, addDoc, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import GenerateTab from './GenerateTab';
import ContentTab from './ContentTab';
import FeedbackTab from './FeedbackTab';
import FeatureIdeasTab from './FeatureIdeasTab';
import NotificationsTab from './NotificationsTab';
import UpdatesTab from './UpdatesTab';
import FeedbackModalHost from './FeedbackModalHost';
import AppStatusBar from './AppStatusBar';
import {
  clearListenerError,
  clearProjectPersistErrorFlag,
  CLOUD_SYNC_CHANNELS,
  getCloudSyncSnapshot,
  markListenerError,
  markListenerSnapshot,
} from './cloudSyncStatus';
import GroupReviewSettings, { type GroupReviewSettingsRef, type GroupReviewSettingsData } from './GroupReviewSettings';
import type { ProcessedRow, Cluster, ClusterSummary, TokenSummary, GroupedCluster, GroupMergeRecommendation, BlockedKeyword, LabelSection, Project, Stats, ActivityLogEntry, ActivityAction, TokenMergeRule, AutoGroupSuggestion, AutoMergeRecommendation } from './types';
import { computeMergeImpact, applyMergeRulesToTokenArr, computeSignature, mergeTokenArr } from './tokenMerge';
import MergeConfirmModal from './MergeConfirmModal';
import { useToast } from './ToastContext';
import ActivityLog from './ActivityLog';
import AutoGroupPanel from './AutoGroupPanel';
import GroupAutoMergePanel from './GroupAutoMergePanel';
import ClusterRowView from './ClusterRow';
import GroupedClusterRowView from './GroupedClusterRow';
import TopicsSubTab from './TopicsSubTab';
import ProjectsTab from './ProjectsTab';
import InlineHelpHint from './InlineHelpHint';
import TableHeader, { type FilterBag } from './TableHeader';
import { PAGES_COLUMNS, GROUPED_COLUMNS, APPROVED_COLUMNS, BLOCKED_COLUMNS, KEYWORDS_COLUMNS, CELL } from './tableConstants';
import {
  formatKeywordRatingDuration,
} from './KeywordRatingEngine';
import {
  buildProjectDataPayloadFromChunkDocs,
  loadProjectDataFromFirestore,
  saveAppPrefsToFirestore,
  saveAppPrefsToIDB,
  saveToIDB,
  type ProjectDataPayload,
} from './projectStorage';
import {
  createEmptyProjectViewState,
  loadProjectDataForView,
  loadSavedWorkspacePrefs,
  toProjectViewState,
  type ProjectViewState,
} from './projectWorkspace';
import { useProjectPersistence } from './useProjectPersistence';
import {
  appSettingsIdbKey,
  cacheStateLocallyBestEffort,
  loadCachedState,
  persistAppSettingsDoc,
  subscribeAppSettingsDoc,
} from './appSettingsPersistence';
import { parseTokenMgmtSearchTerms, tokenIncludesAnyTerm } from './tokenMgmtSearch';
import { parseSubClusterKey } from './subClusterKeys';
import { reportPersistFailure } from './persistenceErrors';
import {
  buildMainPath,
  type MainTab,
  type GroupSubTab,
  type SettingsSubTab,
} from './appRouting';
import { useProjectLifecycle } from './hooks/useProjectLifecycle';
import { useNavigationState } from './hooks/useNavigationState';
import { useKeywordWorkspace } from './hooks/useKeywordWorkspace';
import { useGroupingActions } from './hooks/useGroupingActions';
import { useTokenActions } from './hooks/useTokenActions';
import { useKeywordRating } from './hooks/useKeywordRating';
import { useTokenMerge } from './hooks/useTokenMerge';
import { useAutoMerge } from './hooks/useAutoMerge';
import { useGroupAutoMerge } from './hooks/useGroupAutoMerge';
import { useFilteredTableData } from './hooks/useFilteredTableData';
import { useTokenMgmtFiltering } from './hooks/useTokenMgmtFiltering';
import ErrorBoundary from './ErrorBoundary';
import KwRatingCell from './KwRatingCell';
import TokenRow from './TokenRow';
import { ensureFirebaseProjectCacheGuard } from './firebaseProjectCacheGuard';
import { useStarredModels } from './hooks/useStarredModels';
import { useUniversalBlockedTokens } from './hooks/useUniversalBlockedTokens';
import { useWorkspacePrefsSync } from './hooks/useWorkspacePrefsSync';
import { useCsvImport } from './hooks/useCsvImport';
import { useCsvExport } from './hooks/useCsvExport';
import { useGroupReviewAutoProcessor } from './hooks/useGroupReviewAutoProcessor';
import { useFilteredAutoGroupFlow } from './hooks/useFilteredAutoGroupFlow';
import { useGlobalGroupingShortcuts } from './hooks/useGlobalGroupingShortcuts';
import GroupWorkspaceShell from './GroupWorkspaceShell';

ensureFirebaseProjectCacheGuard('new-final-8edfc');

export default function App() {
  const projectsNavRef = useRef<Project[]>([]);
  const activeProjectIdNavRef = useRef<string | null>(null);
  const {
    mainTab,
    setMainTab,
    groupSubTab,
    setGroupSubTab,
    settingsSubTab,
    setSettingsSubTab,
    navigateMainTab,
    navigateGroupSub,
    navigateSettingsSub,
  } = useNavigationState({ activeProjectIdRef: activeProjectIdNavRef, projectsRef: projectsNavRef });
  const { addToast } = useToast();
  const { starredModels, toggleStarModel } = useStarredModels(addToast);
  const [projects, setProjects] = useState<Project[]>([]);

  // -- Project persistence hook -- single source of truth for all 14 persisted state variables --
  const persistence = useProjectPersistence({ projects, setProjects, addToast });
  const {
    results, clusterSummary, tokenSummary, groupedClusters,
    approvedGroups, blockedKeywords, activityLog, stats,
    datasetStats, autoGroupSuggestions, autoMergeRecommendations, groupMergeRecommendations, tokenMergeRules,
    blockedTokens, labelSections, fileName,
    activeProjectId, setActiveProjectId,
    loadProject, clearProject, syncFileNameLocal, flushNow,
    storageMode, activeOperation, isProjectBusy, isCanonicalReloading, isWriteUnsafe, writeBlockReason, isSharedProjectReadOnly, isRoutineSharedEditBlocked, isBulkSharedEditBlocked, runWithExclusiveOperation,
    removeFromApproved, ungroupPages,
    addActivityEntry,
    updateGroupMergeRecommendations,
    bulkSet,
    // Transitional setters (will be removed as mutations replace them)
    setResults, setClusterSummary, setTokenSummary, setGroupedClusters,
    setApprovedGroups, setBlockedKeywords, setActivityLog, setStats,
    setDatasetStats, setAutoGroupSuggestions, setAutoMergeRecommendations, setGroupMergeRecommendations, setTokenMergeRules,
    setBlockedTokens, setLabelSections, setFileName,
    refs: persistenceRefs,
  } = persistence;

  useEffect(() => {
    clearProjectPersistErrorFlag();
  }, [activeProjectId]);

  // Convenience aliases for transitional refs (used by legacy code during migration)
  const activeProjectIdRef = persistenceRefs.activeProjectId;
  const resultsRef = persistenceRefs.results;
  const clusterSummaryRef = persistenceRefs.clusterSummary;
  const tokenSummaryRef = persistenceRefs.tokenSummary;
  const groupedClustersRef = persistenceRefs.groupedClusters;
  const approvedGroupsRef = persistenceRefs.approvedGroups;
  const blockedKeywordsRef = persistenceRefs.blockedKeywords;
  const statsRef = persistenceRefs.stats;
  const datasetStatsRef = persistenceRefs.datasetStats;
  const autoGroupSuggestionsRef = persistenceRefs.autoGroupSuggestions;
  const autoMergeRecommendationsRef = persistenceRefs.autoMergeRecommendations;
  const groupMergeRecommendationsRef = persistenceRefs.groupMergeRecommendations;
  const tokenMergeRulesRef = persistenceRefs.tokenMergeRules;
  const blockedTokensRef = persistenceRefs.blockedTokens;
  const labelSectionsRef = persistenceRefs.labelSections;
  const fileNameRef = persistenceRefs.fileName;

  projectsNavRef.current = projects;
  activeProjectIdNavRef.current = activeProjectId;

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [isProjectCardCollapsed, setIsProjectCardCollapsed] = useState(true);
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());
  const [groupNameInput, setGroupNameInput] = useState<string>('');
  const [expandedGroupedClusters, setExpandedGroupedClusters] = useState<Set<string>>(new Set());
  const [expandedGroupedSubClusters, setExpandedGroupedSubClusters] = useState<Set<string>>(new Set());
  // AI Group Review
  const [showGroupReviewSettings, setShowGroupReviewSettings] = useState(false);
  const groupReviewSettingsRef = useRef<GroupReviewSettingsRef>(null);
  const [groupReviewSettingsSnapshot, setGroupReviewSettingsSnapshot] = useState<GroupReviewSettingsData | null>(null);
  const [groupReviewSettingsHydrated, setGroupReviewSettingsHydrated] = useState(false);
  const [autoMergeSortConfig, setAutoMergeSortConfig] = useState<{
    key: 'canonical' | 'mergeTokens' | 'impact' | 'confidence' | 'status';
    direction: 'asc' | 'desc';
  }>({ key: 'confidence', direction: 'desc' });
  const [pendingFilteredAutoGroupTokens, setPendingFilteredAutoGroupTokens] = useState<Set<string>>(new Set());
  // Ungrouping: track selected groups and sub-clusters within groups (see useKeywordWorkspace)
  const [, startTransition] = useTransition();
  const {
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
  } = useKeywordWorkspace({ setSelectedClusters });

  const { universalBlockedTokens, setUniversalBlockedTokens } = useUniversalBlockedTokens(addToast);

  const [isLabelSidebarOpen, setIsLabelSidebarOpen] = useState(true);
  const [labelSortConfigs, setLabelSortConfigs] = useState<Record<string, { key: 'token' | 'kws' | 'vol' | 'kd'; direction: 'asc' | 'desc' }>>({});

  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const { savedClusters, setSavedClusters } = useWorkspacePrefsSync(activeProjectId, addToast);
  const [isGenerateBusy, setIsGenerateBusy] = useState(false);
  const [isContentBusy, setIsContentBusy] = useState(false);
  const isProjectWorkspaceBusy = isGenerateBusy || isContentBusy;
  const handleProjectChangeBlocked = useCallback(() => {
    addToast('Stop or wait for Generate/Content to finish before switching projects.', 'warning');
  }, [addToast]);
  const { createProject, deleteProject, reviveProject, permanentlyDeleteProject, selectProject } = useProjectLifecycle({
    projects,
    setProjects,
    activeProjectId,
    activeProjectIdRef,
    setActiveProjectId,
    loadProject,
    clearProject,
    syncFileNameLocal,
    mainTab,
    groupSubTab,
    setMainTab,
    setGroupSubTab,
    setSettingsSubTab,
    setIsProjectLoading,
    setIsAuthReady,
    setSavedClusters,
    newProjectName,
    newProjectDescription,
    setNewProjectName,
    setNewProjectDescription,
    setProjectError,
    setIsCreatingProject,
    canChangeProject: () => !isProjectWorkspaceBusy,
    onProjectChangeBlocked: handleProjectChangeBlocked,
  });

  const {
    isDragging,
    isProcessing,
    progress,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInput,
  } = useCsvImport({
    activeProjectIdRef,
    storageMode,
    runWithExclusiveOperation,
    tokenMergeRules,
    syncFileNameLocal,
    bulkSet,
    setActiveTab,
    setResults,
    setClusterSummary,
    setTokenSummary,
    setAutoMergeRecommendations,
    setGroupMergeRecommendations,
    setStats,
    setDatasetStats,
    addToast,
    setError,
  });

  const handleLogin = async () => {};
  const handleLogout = async () => {};

  const reset = () => {
    if (activeProjectId) {
      clearProject();
    } else {
      setResults(null);
      setClusterSummary(null);
      setTokenSummary(null);
      setAutoMergeRecommendations([]);
      setGroupMergeRecommendations([]);
      setStats(null);
      setFileName(null);
      setGroupedClusters([]);
      setApprovedGroups([]);
      setActivityLog([]);
      setAutoGroupSuggestions([]);
      setTokenMergeRules([]);
      setBlockedTokens(new Set());
    }
    setError(null);
    setActiveTab('pages');
    setSearchImmediate('');
    setMinClusterCount('');
    setMaxClusterCount('');
    setMinTokenLen('');
    setMaxTokenLen('');
    setSortConfig({ key: 'keywordCount', direction: 'desc' });
    setTokenSortConfig({ key: 'frequency', direction: 'desc' });
    setCurrentPage(1);
    setExpandedClusters(new Set());
    setExcludedLabels(new Set());
    setSelectedTokens(new Set());
    setIsLabelDropdownOpen(false);
    setSelectedMgmtTokens(new Set());
    setTokenMgmtSubTab('all');
    setGroupedSortConfig({ key: 'keywordCount', direction: 'desc' });
  };

  // Check if a row's tokens contain any blocked token
  // Check both project-specific AND universal blocked token sets
  const hasBlockedToken = useCallback((tokenArr: string[]) => {
    if (blockedTokens.size === 0 && universalBlockedTokens.size === 0) return false;
    for (const t of tokenArr) {
      if (blockedTokens.has(t) || universalBlockedTokens.has(t)) return true;
    }
    return false;
  }, [blockedTokens, universalBlockedTokens]);

  const {
    kwRatingJob, setKwRatingJob, runKeywordRating, handleCancelKeywordRating,
  } = useKeywordRating({
    resultsRef, groupedClustersRef, approvedGroupsRef, clusterSummaryRef,
    groupReviewSettingsRef, groupReviewSettingsSnapshot,
    results, hasBlockedToken, addToast, bulkSet: persistence.bulkSet, activeProjectId, flushNow,
  });

  // Effective results: filter out keywords whose tokens contain a blocked token
  // Multi-sort handler: regular click = replace sort, Shift+click = add/toggle secondary sort
  const handleSort = useCallback((key: keyof ClusterSummary, additive?: boolean) => {
    setSortConfig(current => {
      const existingIdx = current.findIndex(s => s.key === key);
      if (additive) {
        // Shift+click: add as secondary sort or toggle direction if already in list
        if (existingIdx >= 0) {
          const updated = [...current];
          updated[existingIdx] = { key, direction: updated[existingIdx].direction === 'desc' ? 'asc' : 'desc' };
          return updated;
        }
        return [...current, { key, direction: 'desc' }];
      }
      // Regular click: if already primary, toggle direction. Otherwise replace all with this one.
      if (existingIdx === 0 && current.length === 1) {
        return [{ key, direction: current[0].direction === 'desc' ? 'asc' : 'desc' }];
      }
      return [{ key, direction: 'desc' }];
    });
    setCurrentPage(1);
  }, []);

  const handleTokenSort = useCallback((key: keyof TokenSummary) => {
    setTokenSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
    setCurrentPage(1);
  }, []);

  const toggleCluster = useCallback((pageName: string) => {
    setExpandedClusters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pageName)) {
        newSet.delete(pageName);
      } else {
        newSet.add(pageName);
      }
      return newSet;
    });
  }, []);

  const SortIcon = ({ columnKey }: { columnKey: keyof ClusterSummary }) => {
    if (sortConfig.length > 1) {
      const idx = sortConfig.findIndex(s => s.key === columnKey);
      if (idx >= 0) {
        const dir = sortConfig[idx].direction;
        return <span className="inline-flex items-center gap-0.5">{dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />}<span className="text-[8px] font-bold text-indigo-500">{idx + 1}</span></span>;
      }
      return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    }
    const primary = sortConfig[0];
    if (!primary || primary.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    return primary.direction === 'asc' ? <ArrowUp className="w-4 h-4 text-indigo-600" /> : <ArrowDown className="w-4 h-4 text-indigo-600" />;
  };

  // Unified sort handler for grouped/approved tabs
  const handleGroupedSort = useCallback((key: string, additive?: boolean) => {
    setGroupedSortConfig(current => {
      const existingIdx = current.findIndex(s => s.key === key);
      if (additive) {
        if (existingIdx >= 0) {
          const updated = [...current];
          updated[existingIdx] = { key, direction: updated[existingIdx].direction === 'desc' ? 'asc' : 'desc' };
          return updated;
        }
        return [...current, { key, direction: 'desc' }];
      }
      if (existingIdx === 0 && current.length === 1) {
        return [{ key, direction: current[0].direction === 'desc' ? 'asc' : 'desc' }];
      }
      return [{ key, direction: 'desc' }];
    });
    setCurrentPage(1);
  }, []);

  // Blocked tab sort
  const [blockedSortConfig, setBlockedSortConfig] = useState<{key: string, direction: 'asc' | 'desc'}>({ key: 'volume', direction: 'desc' });
  const handleBlockedSort = useCallback((key: string) => {
    setBlockedSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
    setCurrentPage(1);
  }, []);

  const handleKeywordsSort = useCallback((key: string, additive?: boolean) => {
    setKeywordsSortConfig(current => {
      const existingIdx = current.findIndex(s => s.key === key);
      if (additive) {
        if (existingIdx >= 0) {
          const updated = [...current];
          updated[existingIdx] = { key, direction: updated[existingIdx].direction === 'desc' ? 'asc' : 'desc' };
          return updated;
        }
        return [...current, { key, direction: 'desc' }];
      }
      if (existingIdx === 0 && current.length === 1) {
        return [{ key, direction: current[0].direction === 'desc' ? 'asc' : 'desc' }];
      }
      return [{ key, direction: 'desc' }];
    });
    setCurrentPage(1);
  }, []);


  const filteredData = useFilteredTableData({
    results, clusterSummary, tokenSummary, groupedClusters, approvedGroups,
    blockedKeywords, blockedTokens, labelSections,
    hasBlockedToken, pendingFilteredAutoGroupTokens, selectedTokens,
    debouncedSearchQuery, activeTab, isLabelDropdownOpen,
    minClusterCount: debouncedMinClusterCount, maxClusterCount: debouncedMaxClusterCount,
    minLen: debouncedMinLen, maxLen: debouncedMaxLen,
    minKwInCluster: debouncedMinKwInCluster, maxKwInCluster: debouncedMaxKwInCluster,
    minVolume: debouncedMinVolume, maxVolume: debouncedMaxVolume,
    minKd: debouncedMinKd, maxKd: debouncedMaxKd,
    minKwRating: debouncedMinKwRating, maxKwRating: debouncedMaxKwRating,
    filterCity: debouncedFilterCity, filterState: debouncedFilterState, excludedLabels,
    minTokenLen: debouncedMinTokenLen, maxTokenLen: debouncedMaxTokenLen,
    sortConfig, tokenSortConfig, keywordsSortConfig, blockedSortConfig,
    currentPage, itemsPerPage,
  });

  const {
    effectiveResults, effectiveClusters, effectiveGrouped,
    tokenBlockedKeywords, allBlockedKeywords,
    min, max, hasMin, hasMax, validClusterCounts, clusterByTokens,
    labelCounts, filteredClusters, filteredResultsData, filteredResults,
    sortedKeywordRows, sortedClusters, filteredTokens, sortedTokens,
    displayedValid, displayedClusters, displayedTokens, displayedVolume,
    labelColorMap, labelSectionStats, filteredTokenCounts,
    paginatedResults, paginatedClusters, paginatedTokens,
    filteredSortedGrouped, paginatedGroupedClusters,
    filteredApprovedGroups, filteredBlocked, sortedBlocked,
    groupedStats, approvedPageCount, keywordGroupingProgress,
  } = filteredData;

  // --- Performance: stable callbacks for row components ---
  // Extract groupNameInput auto-population to a useEffect so onSelect callbacks don't close over clusterByTokens
  useEffect(() => {
    if (selectedClusters.size > 0) {
      let highest: ClusterSummary | null = null;
      for (const tokens of selectedClusters) {
        const c = clusterByTokens.get(tokens);
        if (c && (!highest || c.totalVolume > highest.totalVolume)) highest = c;
      }
      if (highest) setGroupNameInput(highest.pageName);
    } else {
      setGroupNameInput('');
    }
  }, [selectedClusters, clusterByTokens]);

  // Stable callback: select/deselect a cluster on the Pages tab
  const handleClusterSelect = useCallback((tokens: string, checked: boolean) => {
    setSelectedClusters(prev => {
      const next = new Set(prev);
      if (checked) next.add(tokens);
      else next.delete(tokens);
      return next;
    });
  }, []);

  // Stable callback: toggle group expansion
  const handleToggleGroup = useCallback((id: string) => {
    setExpandedGroupedClusters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Stable callback: toggle sub-cluster expansion
  const handleToggleSubCluster = useCallback((subId: string) => {
    setExpandedGroupedSubClusters(prev => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId);
      else next.add(subId);
      return next;
    });
  }, []);

  // Stable callback: select/deselect a group (grouped + approved tabs)
  const handleGroupSelect = useCallback((groupId: string, clusters: { tokens: string }[], checked: boolean) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (checked) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
    setSelectedSubClusters(prev => {
      const next = new Set(prev);
      clusters.forEach(c => {
        const key = `${groupId}::${c.tokens}`;
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }, []);

  // Stable callback: select/deselect a sub-cluster (grouped + approved tabs)
  const handleSubClusterSelect = useCallback((subKey: string, checked: boolean) => {
    setSelectedSubClusters(prev => {
      const next = new Set(prev);
      if (checked) next.add(subKey);
      else next.delete(subKey);
      // Auto-select/deselect parent group
      const parsed = parseSubClusterKey(subKey);
      if (parsed) {
        // Look up group in both grouped and approved lists via refs
        const allGroups = [...(groupedClustersRef.current || []), ...(approvedGroupsRef.current || [])];
        const group = allGroups.find(g => g.id === parsed.groupId);
        if (group) {
          const allSelected = group.clusters.every(c => next.has(`${parsed.groupId}::${c.tokens}`));
          setSelectedGroups(gPrev => {
            const gNext = new Set(gPrev);
            if (allSelected) gNext.add(parsed.groupId);
            else gNext.delete(parsed.groupId);
            return gNext;
          });
        }
      }
      return next;
    });
  }, []);

  // Memoize approved tab sort+pagination (was an inline IIFE re-computed every render)
  const sortedPaginatedApproved = useMemo(() => {
    const sorted = [...filteredApprovedGroups].sort((a, b) => {
      for (const { key, direction } of groupedSortConfig) {
        let aVal: any, bVal: any;
        if (key === 'groupName') { aVal = a.groupName.toLowerCase(); bVal = b.groupName.toLowerCase(); }
        else if (key === 'keywordCount') { aVal = a.keywordCount; bVal = b.keywordCount; }
        else if (key === 'totalVolume') { aVal = a.totalVolume; bVal = b.totalVolume; }
        else if (key === 'avgKd') { aVal = a.avgKd ?? -1; bVal = b.avgKd ?? -1; }
        else if (key === 'avgKwRating') { aVal = a.avgKwRating ?? -1; bVal = b.avgKwRating ?? -1; }
        else { aVal = 0; bVal = 0; }
        if (typeof aVal === 'string') {
          const cmp = aVal.localeCompare(bVal);
          if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
          continue;
        }
        if (aVal !== bVal) return direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
    return sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  }, [filteredApprovedGroups, groupedSortConfig, currentPage, itemsPerPage]);

  // Shared filter bag for TableHeader — single object passed to all tabs
  const filterBag = useMemo((): FilterBag => ({
    minLen, setMinLen, maxLen, setMaxLen,
    minKwInCluster, setMinKwInCluster, maxKwInCluster, setMaxKwInCluster,
    minVolume, setMinVolume, maxVolume, setMaxVolume,
    minKd, setMinKd, maxKd, setMaxKd,
    minKwRating, setMinKwRating, maxKwRating, setMaxKwRating,
    filterCity, setFilterCity, filterState, setFilterState,
    excludedLabels, setExcludedLabels,
    isLabelDropdownOpen, setIsLabelDropdownOpen,
    labelCounts,
  }), [minLen, maxLen, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, minKwRating, maxKwRating, filterCity, filterState, excludedLabels, isLabelDropdownOpen, labelCounts]);

  const TokenSortIcon = ({ columnKey }: { columnKey: keyof TokenSummary }) => {
    if (tokenSortConfig.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    return tokenSortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4 text-indigo-600" /> : <ArrowDown className="w-4 h-4 text-indigo-600" />;
  };


  type MergeTokenStats = { frequency: number; totalVolume: number; avgKd: number | null };
  type MergeRuleRow = {
    ruleId: string;
    parentToken: string;
    childTokens: string[];
    parentStats: MergeTokenStats;
    childStats: Record<string, MergeTokenStats>;
  };

  const tokenMgmtMergeSearchTerms = useMemo(() => parseTokenMgmtSearchTerms(debouncedTokenMgmtSearch), [debouncedTokenMgmtSearch]);

  // Merge subtab rows: 1 row per parent token + collapsible children underneath.
  // We compute token stats by simulating merges in rule order on a per-row tokenArr basis,
  // and measuring child token stats from the "stage before" the rule is applied.
  const mergeMgmtRuleRows = useMemo<MergeRuleRow[]>(() => {
    if (tokenMgmtSubTab !== 'merge') return [];
    if (!results || tokenMergeRules.length === 0) return [];

    const tokensByRow: string[][] = results.map(r => [...(r.originalTokenArr ?? r.tokenArr)]);
    const mergeRows: MergeRuleRow[] = [];

    for (const rule of tokenMergeRules) {
      const childSet = new Set(rule.childTokens);

      // Group rows into "clusters" based on the token signature at this stage.
      const signatureToCluster = new Map<string, { tokensArr: string[]; volume: number; kd: number | null }>();
      for (let i = 0; i < results.length; i++) {
        const signature = computeSignature(tokensByRow[i]);
        const existing = signatureToCluster.get(signature);
        if (!existing) {
          signatureToCluster.set(signature, {
            tokensArr: signature ? signature.split(' ') : [],
            volume: results[i].searchVolume,
            kd: results[i].kd,
          });
        } else {
          existing.volume += results[i].searchVolume;
          if (results[i].kd !== null && existing.kd === null) existing.kd = results[i].kd;
        }
      }

      // Token stats for each child token are computed from clusters where that child exists.
      const rawChildStats = new Map<string, { frequency: number; totalVolume: number; totalKd: number; kdCount: number }>();
      for (const cluster of signatureToCluster.values()) {
        // Match rebuildTokenSummary: frequency = number of clusters containing the token.
        for (const token of cluster.tokensArr) {
          if (!childSet.has(token)) continue;
          const existing = rawChildStats.get(token);
          if (!existing) rawChildStats.set(token, { frequency: 1, totalVolume: cluster.volume, totalKd: cluster.kd !== null ? cluster.kd : 0, kdCount: cluster.kd !== null ? 1 : 0 });
          else {
            existing.frequency++;
            existing.totalVolume += cluster.volume;
            if (cluster.kd !== null) { existing.totalKd += cluster.kd; existing.kdCount++; }
          }
        }
      }

      const childStats: Record<string, MergeTokenStats> = {};
      let parentFrequency = 0;
      let parentTotalVolume = 0;
      let parentTotalKd = 0;
      let parentKdCount = 0;

      for (const child of rule.childTokens) {
        const st = rawChildStats.get(child);
        if (!st) {
          childStats[child] = { frequency: 0, totalVolume: 0, avgKd: null };
          continue;
        }
        childStats[child] = {
          frequency: st.frequency,
          totalVolume: st.totalVolume,
          avgKd: st.kdCount > 0 ? Math.round(st.totalKd / st.kdCount) : null,
        };
        parentFrequency += st.frequency;
        parentTotalVolume += st.totalVolume;
        parentTotalKd += st.totalKd;
        parentKdCount += st.kdCount;
      }

      const parentStats: MergeTokenStats = {
        frequency: parentFrequency,
        totalVolume: parentTotalVolume,
        avgKd: parentKdCount > 0 ? Math.round(parentTotalKd / parentKdCount) : null,
      };

      mergeRows.push({
        ruleId: rule.id,
        parentToken: rule.parentToken,
        childTokens: [...rule.childTokens],
        parentStats,
        childStats,
      });

      // Apply this rule so the next iteration measures the stage after.
      for (let i = 0; i < results.length; i++) {
        if (tokensByRow[i].some(t => childSet.has(t))) {
          tokensByRow[i] = mergeTokenArr(tokensByRow[i], rule.parentToken, rule.childTokens);
        }
      }
    }

    return mergeRows;
  }, [tokenMgmtSubTab, results, tokenMergeRules]);

  const filteredMergeRuleRows = useMemo(() => {
    if (tokenMgmtSubTab !== 'merge') return [];
    if (mergeMgmtRuleRows.length === 0) return [];
    if (tokenMgmtMergeSearchTerms.length === 0) return mergeMgmtRuleRows;

    return mergeMgmtRuleRows.filter(r => {
      if (tokenIncludesAnyTerm(r.parentToken, tokenMgmtMergeSearchTerms)) return true;
      return r.childTokens.some(c => tokenIncludesAnyTerm(c, tokenMgmtMergeSearchTerms));
    });
  }, [tokenMgmtSubTab, mergeMgmtRuleRows, tokenMgmtMergeSearchTerms]);

  const sortedMergeRuleRows = useMemo(() => {
    if (tokenMgmtSubTab !== 'merge') return [];
    const { key, direction } = tokenMgmtSort;

    const dir = direction === 'asc' ? 1 : -1;
    const cmp = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * dir;
    };

    return [...filteredMergeRuleRows].sort((a, b) => {
      if (key === 'token') return dir * a.parentToken.localeCompare(b.parentToken);
      if (key === 'frequency') return cmp(a.parentStats.frequency, b.parentStats.frequency);
      if (key === 'totalVolume') return cmp(a.parentStats.totalVolume, b.parentStats.totalVolume);
      if (key === 'avgKd') return cmp(a.parentStats.avgKd, b.parentStats.avgKd);
      return 0;
    });
  }, [tokenMgmtSubTab, filteredMergeRuleRows, tokenMgmtSort]);

  const mergeMgmtTotalPages = Math.max(1, Math.ceil(sortedMergeRuleRows.length / tokenMgmtPerPage));
  const safeMergeMgmtPage = Math.min(tokenMgmtPage, mergeMgmtTotalPages);
  const paginatedMergeRuleRows = useMemo(
    () =>
      sortedMergeRuleRows.slice((safeMergeMgmtPage - 1) * tokenMgmtPerPage, safeMergeMgmtPage * tokenMgmtPerPage),
    [sortedMergeRuleRows, safeMergeMgmtPage]
  );

  const autoMergeRows = useMemo(() => {
    if (tokenMgmtSubTab !== 'auto-merge') return [];
    const statusRank = (status: AutoMergeRecommendation['status']) =>
      status === 'pending' ? 0 : status === 'approved' ? 1 : 2;
    const dir = autoMergeSortConfig.direction === 'asc' ? 1 : -1;
    return (autoMergeRecommendations || [])
      .filter(r => r.status !== 'declined')
      .sort((a, b) => {
        let base: number;
        if (autoMergeSortConfig.key === 'canonical') {
          base = a.canonicalToken.localeCompare(b.canonicalToken);
        } else if (autoMergeSortConfig.key === 'mergeTokens') {
          if (a.mergeTokens.length !== b.mergeTokens.length) base = a.mergeTokens.length - b.mergeTokens.length;
          else base = a.mergeTokens.join(',').localeCompare(b.mergeTokens.join(','));
        } else if (autoMergeSortConfig.key === 'impact') {
          if (a.affectedKeywordCount !== b.affectedKeywordCount) base = a.affectedKeywordCount - b.affectedKeywordCount;
          else base = a.affectedPageCount - b.affectedPageCount;
        } else if (autoMergeSortConfig.key === 'status') {
          base = statusRank(a.status) - statusRank(b.status);
        } else {
          base = a.confidence - b.confidence;
        }
        if (base !== 0) return base * dir;
        // Stable fallback keeps highest confidence near top unless explicitly inverted by chosen sort.
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        if (a.affectedKeywordCount !== b.affectedKeywordCount) return b.affectedKeywordCount - a.affectedKeywordCount;
        return a.canonicalToken.localeCompare(b.canonicalToken);
      });
  }, [tokenMgmtSubTab, autoMergeRecommendations, autoMergeSortConfig]);
  const autoMergeTotalPages = Math.max(1, Math.ceil(autoMergeRows.length / tokenMgmtPerPage));
  const safeAutoMergePage = Math.min(tokenMgmtPage, autoMergeTotalPages);
  const paginatedAutoMergeRows = useMemo(
    () => autoMergeRows.slice((safeAutoMergePage - 1) * tokenMgmtPerPage, safeAutoMergePage * tokenMgmtPerPage),
    [autoMergeRows, safeAutoMergePage],
  );
  const autoMergeSortIcon = (key: 'canonical' | 'mergeTokens' | 'impact' | 'confidence' | 'status') => {
    if (autoMergeSortConfig.key !== key) return <ArrowUpDown className="w-3 h-3" />;
    return autoMergeSortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  // Token Management panel: filtered, sorted, paginated with subtab support
  // Token management filtering — split into 3 stages for performance:
  // Stage 1 (expensive): build token stats from filtered data — does NOT depend on search/sort
  // Stage 2 (cheap): apply debounced search filter
  // Stage 3 (cheap): sort
  const filteredMgmtTokens = useTokenMgmtFiltering({
    tokenSummary, tokenMgmtSubTab, blockedTokens, universalBlockedTokens,
    activeTab, filteredClusters, filteredSortedGrouped, filteredApprovedGroups, filteredResults,
    debouncedTokenMgmtSearch, tokenMgmtSort,
  });

  const tokenMgmtTotalPages = Math.max(1, Math.ceil(filteredMgmtTokens.length / tokenMgmtPerPage));
  const safeMgmtPage = Math.min(tokenMgmtPage, tokenMgmtTotalPages);
  const paginatedMgmtTokens = useMemo(() => filteredMgmtTokens.slice((safeMgmtPage - 1) * tokenMgmtPerPage, safeMgmtPage * tokenMgmtPerPage), [filteredMgmtTokens, safeMgmtPage]);

  // Activity log + toast — persists via addActivityEntry (IDB + Firestore for active project)
  const logAndToast = useCallback((action: ActivityAction, details: string, count: number, toastMsg: string, toastType: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    const entry: ActivityLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action,
      details,
      count,
    };
    addActivityEntry(entry);
    addToast(toastMsg, toastType);
  }, [addActivityEntry, addToast]);

  const {
    isMergeModalOpen, setIsMergeModalOpen,
    mergeModalTokens, setMergeModalTokens,
    handleOpenMergeModal,
    handleMergeTokens,
    handleUndoMergeChild,
    handleUndoMergeParent,
  } = useTokenMerge({
    results, clusterSummary, groupedClusters, approvedGroups,
    tokenMergeRules, selectedMgmtTokens, selectedTokens,
    resultsRef, groupedClustersRef, approvedGroupsRef, clusterSummaryRef, tokenSummaryRef,
    logAndToast,
    applyMergeCascade: persistence.applyMergeCascade,
    undoMerge: persistence.undoMerge,
    setSelectedTokens, setSelectedMgmtTokens,
  });

  const {
    autoMergeJob, setAutoMergeJob, handleCancelAutoMerge,
    runAutoMergeRecommendations, buildAutoMergeRecommendations,
    applyAutoMergeRecommendation,
    declineAutoMergeRecommendation,
    applyAllAutoMergeRecommendations,
    undoAutoMergeRecommendation,
    tokenTopPagesMap, tokenPagesTooltip,
  } = useAutoMerge({
    results, tokenMergeRules,
    resultsRef, tokenSummaryRef, groupedClustersRef, approvedGroupsRef, clusterSummaryRef,
    autoMergeRecommendationsRef, blockedTokensRef, universalBlockedTokens,
    groupReviewSettingsRef, groupReviewSettingsSnapshot,
    addToast, logAndToast,
    updateAutoMergeRecommendations: persistence.updateAutoMergeRecommendations,
    applyMergeCascade: persistence.applyMergeCascade,
    activeProjectId, flushNow,
    setTokenMgmtSubTab, setTokenMgmtPage,
    handleUndoMergeParent,
  });

  const {
    job: groupAutoMergeJob,
    recommendationsAreStale: groupAutoMergeRecommendationsAreStale,
    runRecommendations: runGroupAutoMergeRecommendations,
    cancelRun: cancelGroupAutoMerge,
    dismissRecommendations: dismissGroupAutoMergeRecommendations,
    applyRecommendations: applyGroupAutoMergeRecommendations,
  } = useGroupAutoMerge({
    groupedClusters,
    groupedClustersRef,
    approvedGroups,
    approvedGroupsRef,
    groupMergeRecommendations,
    groupMergeRecommendationsRef,
    groupReviewSettingsRef,
    groupReviewSettingsSnapshot,
    updateGroupMergeRecommendations,
    bulkSet,
    addToast,
    logAndToast: (action, details, count, toastMsg, toastType) => {
      logAndToast(action, details, count, toastMsg, toastType);
    },
    flushNow,
    runWithExclusiveOperation,
  });

  const { exportCSV, exportTokensCSV } = useCsvExport({
    results,
    clusterSummary,
    tokenSummary,
    groupedClusters,
    approvedGroups,
    activeTab,
    activeProjectId,
    projects,
    blockedTokens,
    universalBlockedTokens,
    logAndToast,
  });

  const { scheduleReReview } = useGroupReviewAutoProcessor({
    groupedClusters,
    isRoutineSharedEditBlocked,
    groupReviewSettingsRef,
    persistenceUpdateGroups: persistence.updateGroups,
    logAndToast,
  });

  const {
    handleBlockSingleToken,
    handleBlockTokens,
    handleUnblockTokens,
  } = useTokenActions({
    logAndToast,
    setSelectedMgmtTokens,
    setTokenMgmtSubTab,
    setTokenMgmtPage,
    switchTab,
    blockTokens: persistence.blockTokens,
    unblockTokens: persistence.unblockTokens,
  });

  // Grouping rate tracker — estimates remaining time to group all ungrouped pages
  const groupingTimestamps = useRef<{ time: number; pagesGrouped: number }[]>([]);
  const [groupingEta, setGroupingEta] = useState<string | null>(null);

  // Record a grouping event and recalculate ETA
  const recordGroupingEvent = useCallback((pagesInBatch: number) => {
    const now = Date.now();
    groupingTimestamps.current.push({ time: now, pagesGrouped: pagesInBatch });
    // Keep only last 15 seconds of data
    const cutoff = now - 15000;
    groupingTimestamps.current = groupingTimestamps.current.filter(t => t.time >= cutoff);
  }, []);

  const {
    handleApproveGroup,
    handleUnapproveGroup,
    handleRemoveFromApproved,
    handleGroupClusters,
    handleAutoGroupApprove,
    handleUngroupClusters,
    approveSelectedGrouped,
  } = useGroupingActions({
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
    hasReviewApi: () => groupReviewSettingsRef.current?.hasApiKey() ?? false,
    addGroupsAndRemovePages: persistence.addGroupsAndRemovePages,
    approveGroup: persistence.approveGroup,
    unapproveGroup: persistence.unapproveGroup,
    removeFromApproved,
    ungroupPages,
  });
  const canRunManualGroup = !isRoutineSharedEditBlocked && selectedClusters.size > 0 && groupNameInput.trim().length > 0;
  const canApproveGrouped = !isRoutineSharedEditBlocked && selectedGroups.size > 0;
  const canUngroupGrouped = !isRoutineSharedEditBlocked && (selectedGroups.size > 0 || selectedSubClusters.size > 0);
  const canUnapproveApproved = !isRoutineSharedEditBlocked && (selectedGroups.size > 0 || selectedSubClusters.size > 0);

  // Stable callback: middle-click on a ClusterRow to quick-group
  const handleClusterMiddleClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 && canRunManualGroup) {
      e.preventDefault();
      handleGroupClusters();
    }
  }, [canRunManualGroup, handleGroupClusters]);

  // Update ETA every 10 seconds based on rolling average
  useEffect(() => {
    const interval = setInterval(() => {
      const timestamps = groupingTimestamps.current;
      if (timestamps.length < 2) { setGroupingEta(null); return; }
      const now = Date.now();
      const cutoff = now - 15000;
      const recent = timestamps.filter(t => t.time >= cutoff);
      if (recent.length < 2) { setGroupingEta(null); return; }
      const totalPagesGrouped = recent.reduce((sum, t) => sum + t.pagesGrouped, 0);
      const timeSpan = (recent[recent.length - 1].time - recent[0].time) / 1000; // seconds
      if (timeSpan <= 0) { setGroupingEta(null); return; }
      const pagesPerSec = totalPagesGrouped / timeSpan;
      const remainingPages = effectiveClusters?.length || 0;
      if (remainingPages === 0 || pagesPerSec <= 0) { setGroupingEta(null); return; }
      const etaSec = Math.round(remainingPages / pagesPerSec);
      const rateStr = `${pagesPerSec.toFixed(pagesPerSec >= 10 ? 0 : 1)}/s`;
      if (etaSec < 60) setGroupingEta(`~${etaSec}s left (${rateStr})`);
      else if (etaSec < 3600) setGroupingEta(`~${Math.round(etaSec / 60)}m left (${rateStr})`);
      else setGroupingEta(`~${(etaSec / 3600).toFixed(1)}h left (${rateStr})`);
    }, 10000);
    return () => clearInterval(interval);
  }, [effectiveClusters?.length]);

  const {
    canRunFilteredAutoGroup,
    filteredAutoGroupFilterSummary,
    filteredAutoGroupQueue,
    filteredAutoGroupSettingsStatus,
    filteredAutoGroupStats,
    handleRunFilteredAutoGroup,
    handleStopFilteredAutoGroup,
    isFilteredAutoGroupFilterActive,
    isRunningFilteredAutoGroup,
  } = useFilteredAutoGroupFlow({
    filteredClusters,
    groupReviewSettingsHydrated,
    groupReviewSettingsSnapshot,
    groupReviewSettingsRef,
    isBulkSharedEditBlocked,
    selectedTokens,
    excludedLabels,
    debouncedSearchQuery,
    filterCity,
    filterState,
    minKwInCluster,
    maxKwInCluster,
    minVolume,
    maxVolume,
    minKd,
    maxKd,
    minKwRating,
    maxKwRating,
    minLen,
    maxLen,
    mergeGroupsByName: persistence.mergeGroupsByName,
    pendingFilteredAutoGroupTokens,
    setPendingFilteredAutoGroupTokens,
    setSelectedClusters,
    setCurrentPage,
    startTransition,
    logAndToast,
    recordGroupingEvent,
    runWithExclusiveOperation,
  });

  useGlobalGroupingShortcuts({
    activeTab,
    canRunManualGroup,
    canApproveGrouped,
    canRunFilteredAutoGroup,
    handleGroupClusters,
    approveSelectedGrouped,
    handleRunFilteredAutoGroup,
  });

  const pendingGroupMergeRecommendationsCount = groupMergeRecommendations.filter(
    (recommendation) => recommendation.status === 'pending',
  ).length;
  const totalGroupMergeRecommendationsCount = groupMergeRecommendations.length;

  const totalPages = Math.max(1, Math.ceil(
    (activeTab === 'pages' ? sortedClusters.length :
     activeTab === 'keywords' ? sortedKeywordRows.length :
     activeTab === 'grouped' ? filteredSortedGrouped.length :
     activeTab === 'group-auto-merge' ? 1 :
     activeTab === 'approved' ? approvedGroups.length :
     sortedBlocked.length) / itemsPerPage
  ));

  // Auto-correct page if it exceeds total (e.g. after filtering reduces results)
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages]);

  const filteredCount = activeTab === 'pages' ? sortedClusters.length :
                       activeTab === 'keywords' ? sortedKeywordRows.length :
                       activeTab === 'grouped' ? filteredSortedGrouped.length :
                       activeTab === 'group-auto-merge' ? pendingGroupMergeRecommendationsCount :
                       activeTab === 'approved' ? filteredApprovedGroups.length :
                       sortedBlocked.length;

  const totalCount = activeTab === 'pages' ? (effectiveClusters?.length || 0) :
                    activeTab === 'keywords' ? (effectiveResults?.length || 0) :
                    activeTab === 'grouped' ? effectiveGrouped.length :
                    activeTab === 'group-auto-merge' ? totalGroupMergeRecommendationsCount :
                    activeTab === 'approved' ? approvedGroups.length :
                    allBlockedKeywords.length;

  const tabRailClass = 'flex items-center gap-0.5 bg-zinc-100/80 p-0.5 rounded-lg border border-zinc-200/70';
  const mainTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5';
  const mainTabBtnActive = 'bg-white text-zinc-900 border border-zinc-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#6366f1]';
  const mainTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/60';
  const subTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all';
  const subTabBtnActive = 'bg-white text-zinc-900 border border-zinc-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#6366f1]';
  const subTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100/70';
  const stateTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1';

  const groupWorkspaceProps = {
    activityLog,
    addToast,
    createProject,
    deleteProject,
    groupSubTab,
    navigateGroupSub,
    navigateMainTab,
    navigateSettingsSub,
    settingsSubTab,
    universalBlockedTokens,
    setUniversalBlockedTokens,
    persistence,
    projects,
    setProjects,
    isCreatingProject,
    setIsCreatingProject,
    newProjectName,
    setNewProjectName,
    newProjectDescription,
    setNewProjectDescription,
    projectError,
    setProjectError,
    isProjectLoading,
    isProjectCardCollapsed,
    setIsProjectCardCollapsed,
    selectProject,
    reviveProject,
    permanentlyDeleteProject,
    user,
    isAuthReady,
    handleLogin,
    handleLogout,
    mainTab,
    setGroupSubTab,
    activeProjectId,
    activeOperation,
    activeTab,
    allBlockedKeywords,
    applyAllAutoMergeRecommendations,
    applyAutoMergeRecommendation,
    applyGroupAutoMergeRecommendations,
    approvedGroups,
    approvedPageCount,
    autoMergeJob,
    autoMergeRows,
    autoMergeSortConfig,
    autoMergeSortIcon,
    blockedSortConfig,
    blockedTokens,
    canApproveGrouped,
    canRunFilteredAutoGroup,
    canRunManualGroup,
    canUnapproveApproved,
    canUngroupGrouped,
    cancelGroupAutoMerge,
    clusterSummary,
    currentPage,
    datasetStats,
    declineAutoMergeRecommendation,
    dismissGroupAutoMergeRecommendations,
    error,
    excludedLabels,
    expandedClusters,
    expandedGroupedClusters,
    expandedGroupedSubClusters,
    expandedMergeParents,
    exportCSV,
    exportTokensCSV,
    fileName,
    filteredApprovedGroups,
    filteredAutoGroupFilterSummary,
    filteredAutoGroupQueue,
    filteredAutoGroupSettingsStatus,
    filteredAutoGroupStats,
    filteredCount,
    filteredMgmtTokens,
    filteredSortedGrouped,
    filterBag,
    filteredClusters,
    groupAutoMergeJob,
    groupAutoMergeRecommendationsAreStale,
    groupNameInput,
    groupReviewSettingsHydrated,
    groupReviewSettingsRef,
    groupedClusters,
    groupedSortConfig,
    groupedStats,
    groupingEta,
    handleApproveGroup,
    handleAutoGroupApprove,
    handleBlockSingleToken,
    handleBlockTokens,
    handleCancelAutoMerge,
    handleCancelKeywordRating,
    handleClusterMiddleClick,
    handleClusterSelect,
    handleDrop,
    handleDragLeave,
    handleDragOver,
    handleFileInput,
    handleGroupClusters,
    handleGroupedSort,
    handleKeywordsSort,
    handleOpenMergeModal,
    handleRemoveFromApproved,
    handleRunFilteredAutoGroup,
    handleSort,
    handleStopFilteredAutoGroup,
    handleSubClusterSelect,
    handleTokenSort,
    handleToggleGroup,
    handleToggleSubCluster,
    handleUnapproveGroup,
    handleUngroupClusters,
    handleUndoMergeChild,
    handleUndoMergeParent,
    handleUnblockTokens,
    isDragging,
    isFilteredAutoGroupFilterActive,
    isLabelDropdownOpen,
    isLabelSidebarOpen,
    isMergeModalOpen,
    isProcessing,
    isCanonicalReloading,
    isWriteUnsafe,
    isProjectBusy,
    isRunningFilteredAutoGroup,
    isRoutineSharedEditBlocked,
    isBulkSharedEditBlocked,
    isSharedProjectReadOnly,
    writeBlockReason,
    itemsPerPage,
    kwRatingJob,
    labelColorMap,
    labelSectionStats,
    logAndToast,
    mergeModalTokens,
    mergeMgmtTotalPages,
    paginatedAutoMergeRows,
    paginatedClusters,
    paginatedGroupedClusters,
    paginatedMergeRuleRows,
    paginatedMgmtTokens,
    paginatedResults,
    paginatedTokens,
    pendingGroupMergeRecommendationsCount,
    progress,
    reset,
    results,
    runAutoMergeRecommendations,
    runGroupAutoMergeRecommendations,
    runKeywordRating,
    safeAutoMergePage,
    safeMergeMgmtPage,
    safeMgmtPage,
    searchQuery,
    selectedClusters,
    selectedGroups,
    selectedMgmtTokens,
    selectedTokens,
    selectedSubClusters,
    setActiveTab,
    setAutoMergeSortConfig,
    setCurrentPage,
    setExpandedClusters,
    setExpandedMergeParents,
    setGroupNameInput,
    setGroupReviewSettingsHydrated,
    setGroupReviewSettingsSnapshot,
    setIsLabelSidebarOpen,
    setLabelSortConfigs,
    setMergeModalTokens,
    setSearchQuery,
    setSearchImmediate,
    setSelectedClusters,
    setSelectedGroups,
    setSelectedMgmtTokens,
    setSelectedTokens,
    setSelectedSubClusters,
    setShowGroupReviewSettings,
    setTokenMgmtPage,
    setTokenMgmtSearch,
    setTokenMgmtSort,
    setTokenMgmtSubTab,
    setItemsPerPage,
    setStatsExpanded,
    showGroupReviewSettings,
    sortedBlocked,
    sortedClusters,
    sortedKeywordRows,
    sortedPaginatedApproved,
    sortedTokens,
    starredModels,
    stats,
    statsExpanded,
    switchTab,
    tokenMgmtPage,
    tokenMgmtPerPage,
    tokenMgmtSearch,
    tokenMgmtSort,
    tokenMgmtSubTab,
    tokenPagesTooltip,
    tokenSortConfig,
    tokenSummary,
    tokenTopPagesMap,
    toggleCluster,
    toggleStarModel,
    totalCount,
    totalGroupMergeRecommendationsCount,
    totalPages,
    undoAutoMergeRecommendation,
    approveSelectedGrouped,
    autoGroupSuggestions,
    autoMergeRecommendations,
    autoMergeTotalPages,
    displayedClusters,
    displayedTokens,
    displayedValid,
    displayedVolume,
    effectiveClusters,
    effectiveGrouped,
    effectiveResults,
    filteredMergeRuleRows,
    filteredTokenCounts,
    groupMergeRecommendations,
    handleBlockedSort,
    handleGroupSelect,
    keywordsSortConfig,
    keywordGroupingProgress,
    labelSections,
    labelSortConfigs,
    mainTabBtnActive,
    mainTabBtnInactive,
    runWithExclusiveOperation,
    sortConfig,
    stateTabBtnBase,
    tabRailClass,
    tokenMergeRules,
    tokenMgmtMergeSearchTerms,
    tokenMgmtTotalPages,
  };

  // Approved stats
  return (
    <div className="min-h-screen bg-[#f8f9fa] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-[1600px] mx-auto px-3 py-2.5">
        <AppStatusBar activeProjectId={activeProjectId} />

        <header className="mb-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex shrink-0 items-center gap-1.5">
                <h1 className="text-lg font-semibold tracking-tight text-zinc-900 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden />
                  SEO Magic
                </h1>
              </div>
              <nav
                className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-zinc-400 leading-tight"
                aria-label="Breadcrumb"
              >
                <button
                  type="button"
                  onClick={() => navigateMainTab(mainTab)}
                  className="text-zinc-600 font-medium hover:text-zinc-800 hover:underline transition-colors"
                >
                  {mainTab === 'group'
                    ? 'Group'
                    : mainTab === 'generate'
                      ? 'Generate'
                      : mainTab === 'content'
                        ? 'Content'
                        : mainTab === 'feedback'
                          ? 'Feedback'
                          : mainTab === 'notifications'
                            ? 'Notifications'
                          : mainTab === 'updates'
                            ? 'Updates'
                            : 'Feature ideas'}
                </button>
                {mainTab === 'group' && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                    <button type="button" onClick={() => navigateMainTab('group')} className="text-zinc-600 font-medium hover:text-zinc-800 hover:underline transition-colors">
                      {groupSubTab === 'data'
                        ? 'Keyword Management'
                        : groupSubTab === 'topics'
                          ? 'Topics'
                          : groupSubTab === 'settings'
                            ? 'Settings'
                            : groupSubTab === 'log'
                              ? 'Log'
                              : 'Projects'}
                    </button>
                    {groupSubTab === 'settings' && (
                      <>
                        <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                        <button type="button" onClick={() => navigateGroupSub('settings')} className="text-zinc-600 font-medium hover:text-zinc-800 hover:underline transition-colors">
                          {settingsSubTab === 'general'
                            ? 'General'
                            : settingsSubTab === 'how-it-works'
                              ? 'How It Works'
                              : settingsSubTab === 'dictionaries'
                                ? 'Dictionaries'
                                : 'Universal Blocked'}
                        </button>
                      </>
                    )}
                    {groupSubTab === 'data' && activeProjectId && (
                      <>
                        <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                        <button type="button" onClick={() => navigateGroupSub('data')} className="text-zinc-600 font-medium hover:text-zinc-800 hover:underline transition-colors">
                          {activeTab === 'pages'
                            ? 'Pages (Ungrouped)'
                            : activeTab === 'keywords'
                              ? 'All Keywords'
                              : activeTab === 'grouped'
                                ? 'Pages (Grouped)'
                                : activeTab === 'approved'
                                  ? 'Pages (Approved)'
                                  : activeTab === 'group-auto-merge'
                                    ? 'Group Auto Merge'
                                    : 'Blocked'}
                        </button>
                      </>
                    )}
                  </>
                )}
        {mainTab === 'feedback' && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                    <button type="button" onClick={() => navigateMainTab('feedback')} className="text-zinc-600 font-medium hover:text-zinc-800 hover:underline transition-colors">Queue</button>
                  </>
                )}
                {mainTab === 'feature-ideas' && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                    <button type="button" onClick={() => navigateMainTab('feature-ideas')} className="text-zinc-600 font-medium hover:text-zinc-800 hover:underline transition-colors">Backlog</button>
                  </>
                )}
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <FeedbackModalHost authorEmail={user?.email ?? null} />
              <div className={tabRailClass}>
                <button
                  type="button"
                  onClick={() => navigateMainTab('group')}
                  className={`${mainTabBtnBase} ${mainTab === 'group' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Layers className="w-3 h-3 shrink-0" aria-hidden />
                  Group
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('generate')}
                  className={`${mainTabBtnBase} ${mainTab === 'generate' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Sparkles className="w-3 h-3 shrink-0" aria-hidden />
                  Generate
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('content')}
                  className={`${mainTabBtnBase} ${mainTab === 'content' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <FileText className="w-3 h-3 shrink-0" aria-hidden />
                  Content
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('feedback')}
                  className={`${mainTabBtnBase} ${mainTab === 'feedback' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <ClipboardList className="w-3 h-3 shrink-0" aria-hidden />
                  Feedback
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('feature-ideas')}
                  className={`${mainTabBtnBase} ${mainTab === 'feature-ideas' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Lightbulb className="w-3 h-3 shrink-0" aria-hidden />
                  Feature ideas
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('notifications')}
                  className={`${mainTabBtnBase} ${mainTab === 'notifications' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Bell className="w-3 h-3 shrink-0" aria-hidden />
                  Notifications
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('updates')}
                  className={`${mainTabBtnBase} ${mainTab === 'updates' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <RefreshCw className="w-3 h-3 shrink-0" aria-hidden />
                  Updates
                </button>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-zinc-400 mt-1 leading-snug max-w-3xl">
            Keyword clustering, page grouping, approval workflows & AI content generation
          </p>
        </header>

        {mainTab === 'group' && (
          <GroupWorkspaceShell {...groupWorkspaceProps} />
        )}
        {mainTab === 'feedback' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <FeedbackTab />
          </div>
        )}

        {mainTab === 'feature-ideas' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <FeatureIdeasTab />
          </div>
        )}

        {mainTab === 'notifications' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <NotificationsTab />
          </div>
        )}

        {mainTab === 'updates' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <UpdatesTab />
          </div>
        )}

        {/* GenerateTab stays mounted always — prevents generation from stopping when switching tabs */}
        <div style={mainTab === 'generate' ? undefined : { display: 'none' }}>
          <ErrorBoundary fallbackLabel="The Generate tab encountered an error. Your data has been saved.">
            <GenerateTab
              activeProjectId={activeProjectId}
              isVisible={mainTab === 'generate'}
              runtimeEffectsActive={mainTab === 'generate' || isGenerateBusy}
              starredModels={starredModels}
              onToggleStar={toggleStarModel}
              onBusyStateChange={setIsGenerateBusy}
            />
          </ErrorBoundary>
        </div>

        {/* ContentTab stays mounted always — prevents generation from stopping when switching tabs */}
        <div style={mainTab === 'content' ? undefined : { display: 'none' }}>
          <ErrorBoundary fallbackLabel="The Content tab encountered an error. Your data has been saved.">
            <ContentTab
              activeProjectId={activeProjectId}
              isVisible={mainTab === 'content'}
              runtimeEffectsActive={mainTab === 'content' || isContentBusy}
              starredModels={starredModels}
              onToggleStar={toggleStarModel}
              onBusyStateChange={setIsContentBusy}
            />
          </ErrorBoundary>
        </div>

        {/* How it Works — now inside Settings, kept here for backward compat rendering */}

        {/* Dictionaries content moved to Settings > Dictionaries sub-tab */}
        {mainTab === '__legacy_rules__' ? (
          <div className="space-y-8">
            <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-zinc-900 mb-6">Label Detection Rules (OLD - REMOVED)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                    <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                      <InlineHelpHint
                        text="Question intent / FAQ keyword matches (examples: who, what, where, when, why, how, can, vs., compare, which, etc.)."
                        className="inline-flex items-center cursor-help"
                      >
                        <HelpCircle className="w-4 h-4 text-purple-500" />
                      </InlineHelpHint>
                      FAQ / Question
                    </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(who|what|where|when|why|how|can|vs\.?|compare|is|are|do|does|will|would|should|could|which)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-emerald-500" />
                    Commercial / Transactional
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(buy|price|cost|cheap|best|review|discount|coupon|sale|order|hire|service|services)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-amber-500" />
                    Local / Proximity
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(near me|nearby|close to)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-rose-500" />
                    Year / Time
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(202\d|201\d)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-blue-500" />
                    Informational / Learning
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(guide|tutorial|tips|examples|meaning|definition|learn|course|training)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-indigo-500" />
                    Navigational / Brand
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(login|sign in|contact|support|phone number|address|customer service|account)\b/i
                  </code>
                </div>
              </div>
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-xl font-semibold text-zinc-900 mb-6">Dictionaries & Logic Rules</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  Stop Words (Removed)
                </h3>
                <p className="text-sm text-zinc-500 mb-3">These common words are completely removed from the keyword before clustering.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 max-h-64 overflow-y-auto flex flex-wrap gap-2">
                  {Array.from(stopWords).sort().map(word => (
                    <span key={word} className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-xs text-zinc-600">{word}</span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                  Ignored Tokens (Removed)
                </h3>
                <p className="text-sm text-zinc-500 mb-3">These words are treated like stop words because they don't impact core semantic meaning.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 max-h-64 overflow-y-auto flex flex-wrap gap-2">
                  {Array.from(ignoredTokens).sort().map(word => (
                    <span key={word} className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-xs text-zinc-600">{word}</span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                  Synonym Mapping
                </h3>
                <p className="text-sm text-zinc-500 mb-3">Words with identical intent are mapped to a single base word.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-0 max-h-64 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium text-zinc-600">Word</th>
                        <th className="px-4 py-2 font-medium text-zinc-600">Maps To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {Object.entries(synonymMap).map(([word, replacement]) => (
                        <tr key={word}>
                          <td className="px-4 py-2 text-zinc-600">{word}</td>
                          <td className="px-4 py-2 text-zinc-900 font-medium">{replacement}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  State Normalization
                </h3>
                <p className="text-sm text-zinc-500 mb-3">Full state names are converted to their 2-letter abbreviations.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-0 max-h-64 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium text-zinc-600">Full Name</th>
                        <th className="px-4 py-2 font-medium text-zinc-600">Maps To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {Object.entries(stateMap).map(([state, abbr]) => (
                        <tr key={state}>
                          <td className="px-4 py-2 text-zinc-600 capitalize">{state}</td>
                          <td className="px-4 py-2 text-zinc-900 font-medium uppercase">{abbr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Number Normalization
                </h3>
                <p className="text-sm text-zinc-500 mb-3">Spelled-out numbers are converted to digits.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-0 max-h-64 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium text-zinc-600">Word</th>
                        <th className="px-4 py-2 font-medium text-zinc-600">Maps To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {Object.entries(numberMap).map(([word, digit]) => (
                        <tr key={word}>
                          <td className="px-4 py-2 text-zinc-600">{word}</td>
                          <td className="px-4 py-2 text-zinc-900 font-medium">{digit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  Countries
                </h3>
                <p className="text-sm text-zinc-500 mb-3">These countries are removed from the core keyword signature.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 max-h-64 overflow-y-auto flex flex-wrap gap-2">
                  {Array.from(countries).sort().map(word => (
                    <span key={word} className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-xs text-zinc-600 capitalize">{word}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        ) : null}

        {/* Saved Clusters removed */}

        {/* Merge Confirm Modal */}
        {isMergeModalOpen && tokenSummary && (
          <MergeConfirmModal
            isOpen={isMergeModalOpen}
            tokens={mergeModalTokens}
            tokenSummary={tokenSummary}
            impact={results && clusterSummary ? computeMergeImpact(results, groupedClusters, approvedGroups, mergeModalTokens[0], mergeModalTokens.slice(1)) : { pagesAffected: 0, groupsAffected: 0, approvedGroupsAffected: 0, pageCollisions: 0 }}
            universalBlockedTokens={universalBlockedTokens}
            onConfirm={(parentToken) => {
              void runWithExclusiveOperation('token-merge', async () => {
                handleMergeTokens(parentToken);
              });
            }}
            onCancel={() => { setIsMergeModalOpen(false); setMergeModalTokens([]); }}
          />
        )}
      </div>
    </div>
  );
}






