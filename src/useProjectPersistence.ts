/**
 * useProjectPersistence — single source of truth for all persisted project state.
 *
 * Every mutation atomically updates:
 *   1. The `latest` ref (synchronous, never stale)
 *   2. React state (for rendering)
 *   3. Firestore + IDB (via enqueueSave — queued immediately, no debounce)
 *
 * No external code should ever call saveProjectData or touch refs directly.
 * The stale-closure bug class is structurally impossible because:
 *   - All mutation functions have EMPTY dependency arrays
 *   - They read from `latest.current` (always fresh), never from closures
 *   - `enqueueSave` chains `flushPersistQueue` on a serialized promise; the flush
 *     loop reads `latest.current` at write time and re-runs while new mutations
 *     arrived mid-await so bursts still collapse to few round-trips when possible
 *   - `saveCounterRef` increments on every `mutateAndSave` (and suggestion checkpoints)
 *     so IDB `lastSaveId` is always strictly newer than the last cloud write until the
 *     next flush — refresh merge picks local state over stale Firestore (ungroup/unblock).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import {
  saveProjectDataToFirestore,
  saveToIDB,
  saveProjectToFirestore,
  buildProjectDataPayloadFromChunkDocs,
  countGroupedPages,
  groupedPageMass,
  type ProjectDataPayload,
} from './projectStorage';
import {
  loadProjectDataForView,
  loadProjectDataFromIDBOnly,
  toProjectViewState,
  createEmptyProjectViewState,
  type ProjectViewState,
} from './projectWorkspace';
import { getUniqueClustersToRestore } from './ungroupedRestoration';
import type {
  ProcessedRow,
  ClusterSummary,
  TokenSummary,
  GroupedCluster,
  GroupMergeRecommendation,
  BlockedKeyword,
  LabelSection,
  Project,
  Stats,
  ActivityLogEntry,
  AutoMergeRecommendation,
  TokenMergeRule,
  AutoGroupSuggestion,
  ProjectCollabMetaDoc,
} from './types';
import { parseSubClusterKey } from './subClusterKeys';
import { getPersistErrorInfo, logPersistError, reportLocalPersistFailure, reportPersistFailure } from './persistenceErrors';
import { withPersistTimeout } from './persistTimeout';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
  recordLocalPersistError,
  recordLocalPersistOk,
  recordLocalPersistStart,
  recordProjectCloudWriteStart,
  recordProjectFirestoreSaveError,
  recordProjectFirestoreSaveOk,
  recordProjectFlushEnter,
  recordProjectFlushExit,
  isLocalWriteFailed,
} from './cloudSyncStatus';
import { beginRuntimeTrace, traceRuntimeEvent } from './runtimeTrace';
import {
  acquireProjectOperationLock,
  activityLogDocId,
  appendActivityLogEntry,
  CLIENT_SCHEMA_VERSION,
  assembleCanonicalPayload,
  blockedTokenDocId,
  buildBaseSnapshotFromResolvedPayload,
  buildBlockedTokenDocChanges,
  buildEntityStateFromResolvedPayload,
  buildGroupDocChanges,
  buildLabelSectionDocChanges,
  buildManualBlockedKeywordDocChanges,
  buildTokenMergeRuleDocChanges,
  commitCanonicalProjectState,
  commitRevisionedDocChanges,
  createMutationId,
  groupDocId,
  heartbeatProjectOperationLock,
  labelSectionDocId,
  loadCanonicalCacheFromIDB,
  loadCanonicalEpoch,
  loadCanonicalProjectState,
  manualBlockedKeywordDocId,
  PROJECT_ACTIVITY_LOG_SUBCOLLECTION,
  PROJECT_BLOCKED_TOKENS_SUBCOLLECTION,
  PROJECT_COLLAB_META_COLLECTION,
  PROJECT_COLLAB_META_DOC,
  PROJECT_GROUPS_SUBCOLLECTION,
  PROJECT_LABEL_SECTIONS_SUBCOLLECTION,
  PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION,
  PROJECT_OPERATIONS_SUBCOLLECTION,
  PROJECT_OPERATION_CURRENT_DOC,
  PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION,
  releaseProjectOperationLock,
  replaceActivityLog,
  saveCanonicalCacheToIDB,
  tokenMergeRuleDocId,
  type CanonicalProjectState,
  type ProjectBaseSnapshot,
} from './projectCollabV2';
import type {
  ProjectActivityLogDoc,
  ProjectBlockedKeywordDoc,
  ProjectBlockedTokenDoc,
  ProjectGroupDoc,
  ProjectLabelSectionDoc,
  ProjectOperationLockDoc,
  ProjectTokenMergeRuleDoc,
} from './types';

export const PROJECT_LOCAL_WRITE_TIMEOUT_MS = 15_000;
export const PROJECT_CLOUD_WRITE_TIMEOUT_MS = 30_000;

/** Matches App.tsx remove-from-approved row shape (cluster-level location). */
function appendResultRowsRemoveFromApproved(
  currentResults: ProcessedRow[],
  clusters: ClusterSummary[],
): ProcessedRow[] {
  const newRows: ProcessedRow[] = [];
  for (const cluster of clusters) {
    for (const kw of cluster.keywords) {
      newRows.push({
        keyword: kw.keyword,
        keywordLower: kw.keyword.toLowerCase(),
        searchVolume: kw.volume,
        kd: kw.kd,
        pageName: cluster.pageName,
        tokens: cluster.tokens,
        tokenArr: cluster.tokenArr,
        labelArr: cluster.labelArr || [],
        label: cluster.label,
        locationCity: cluster.locationCity || '',
        locationState: cluster.locationState || '',
        pageNameLen: cluster.pageNameLen,
        pageNameLower: cluster.pageNameLower || cluster.pageName.toLowerCase(),
      });
    }
  }
  return [...currentResults, ...newRows];
}

/** Matches App.tsx ungroup row shape (keyword-level location). */
function appendResultRowsUngroup(
  currentResults: ProcessedRow[],
  clusters: ClusterSummary[],
): ProcessedRow[] {
  const newRows: ProcessedRow[] = [];
  for (const cluster of clusters) {
    for (const kw of cluster.keywords) {
      newRows.push({
        pageName: cluster.pageName,
        pageNameLower: cluster.pageNameLower,
        pageNameLen: cluster.pageNameLen,
        tokens: cluster.tokens,
        tokenArr: cluster.tokenArr,
        keyword: kw.keyword,
        keywordLower: kw.keyword.toLowerCase(),
        searchVolume: kw.volume,
        kd: kw.kd,
        label: cluster.label,
        labelArr: cluster.labelArr,
        locationCity: kw.locationCity,
        locationState: kw.locationState,
      });
    }
  }
  return [...currentResults, ...newRows];
}

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function ensureNullableArray<T>(value: T[] | null | undefined): T[] | null {
  return Array.isArray(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedState {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  tokenSummary: TokenSummary[] | null;
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];
  blockedKeywords: BlockedKeyword[];
  activityLog: ActivityLogEntry[];
  stats: Stats | null;
  datasetStats: any | null;
  autoGroupSuggestions: AutoGroupSuggestion[];
  autoMergeRecommendations: AutoMergeRecommendation[];
  groupMergeRecommendations: GroupMergeRecommendation[];
  tokenMergeRules: TokenMergeRule[];
  blockedTokens: Set<string>;
  labelSections: LabelSection[];
  fileName: string | null;
}

type RecalcFn = (g: GroupedCluster, remaining: ClusterSummary[]) => GroupedCluster;

interface MergeGroupsByNameOpts {
  incoming: GroupedCluster[];
  removedTokens: Set<string>;
  hasReviewApi: boolean;
  mergeFn: (existing: GroupedCluster[], incoming: GroupedCluster[], hasReviewApi: boolean) => GroupedCluster[];
}

export interface ProjectPersistence extends PersistedState {
  // Project lifecycle
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  loadProject: (projectId: string, projects: Project[]) => Promise<void>;
  clearProject: () => void;
  /** Sync `latest` + fileName state without persisting (metadata / CSV processing UI). */
  syncFileNameLocal: (name: string | null) => void;
  /** Force immediate Firestore flush and wait until queued writes complete. */
  flushNow: () => Promise<void>;
  storageMode: 'legacy' | 'v2';
  activeOperation: ProjectOperationLockDoc | null;
  isProjectBusy: boolean;
  runWithExclusiveOperation: <T>(
    type: ProjectOperationLockDoc['type'],
    task: () => Promise<T>,
  ) => Promise<T | null>;

  // Atomic mutations
  addGroupsAndRemovePages: (newGroups: GroupedCluster[], removedTokens: Set<string>) => void;
  mergeGroupsByName: (opts: MergeGroupsByNameOpts) => void;
  updateGroups: (updaterOrValue: ((groups: GroupedCluster[]) => GroupedCluster[]) | GroupedCluster[], approvedOverride?: GroupedCluster[]) => void;
  approveGroup: (groupName: string) => GroupedCluster | null;
  unapproveGroup: (groupName: string) => GroupedCluster | null;
  removeFromApproved: (
    groupIds: Set<string>,
    subKeys: Set<string>,
    recalc: RecalcFn,
  ) => { clustersReturned: ClusterSummary[]; groupsReturned: GroupedCluster[] };
  ungroupPages: (
    groupIds: Set<string>,
    subKeys: Set<string>,
    recalc: RecalcFn,
  ) => { clustersReturned: ClusterSummary[]; groupsWithPartialRemoval: string[] };
  blockTokens: (tokens: string[]) => void;
  unblockTokens: (tokens: string[]) => void;
  applyMergeCascade: (cascade: {
    results: ProcessedRow[] | null;
    clusterSummary: ClusterSummary[] | null;
    tokenSummary: TokenSummary[] | null;
    groupedClusters: GroupedCluster[];
    approvedGroups: GroupedCluster[];
  }, newRule: TokenMergeRule) => void;
  undoMerge: (data: {
    results: ProcessedRow[] | null;
    clusterSummary: ClusterSummary[] | null;
    tokenSummary: TokenSummary[] | null;
    groupedClusters: GroupedCluster[];
    approvedGroups: GroupedCluster[];
    tokenMergeRules: TokenMergeRule[];
  }) => void;
  updateLabelSections: (sections: LabelSection[]) => void;
  updateSuggestions: (suggestions: AutoGroupSuggestion[]) => void;
  updateAutoMergeRecommendations: (recommendations: AutoMergeRecommendation[]) => void;
  updateGroupMergeRecommendations: (recommendations: GroupMergeRecommendation[]) => void;
  addActivityEntry: (entry: ActivityLogEntry) => void;
  clearActivityLog: () => void;
  bulkSet: (data: Partial<ProjectViewState>) => void;

  // Transitional setters (for code not yet migrated to atomic mutations)
  setResults: React.Dispatch<React.SetStateAction<ProcessedRow[] | null>>;
  setClusterSummary: React.Dispatch<React.SetStateAction<ClusterSummary[] | null>>;
  setTokenSummary: React.Dispatch<React.SetStateAction<TokenSummary[] | null>>;
  setGroupedClusters: React.Dispatch<React.SetStateAction<GroupedCluster[]>>;
  setApprovedGroups: React.Dispatch<React.SetStateAction<GroupedCluster[]>>;
  setBlockedKeywords: React.Dispatch<React.SetStateAction<BlockedKeyword[]>>;
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityLogEntry[]>>;
  setStats: React.Dispatch<React.SetStateAction<Stats | null>>;
  setDatasetStats: React.Dispatch<React.SetStateAction<any | null>>;
  setAutoGroupSuggestions: React.Dispatch<React.SetStateAction<AutoGroupSuggestion[]>>;
  setAutoMergeRecommendations: React.Dispatch<React.SetStateAction<AutoMergeRecommendation[]>>;
  setGroupMergeRecommendations: React.Dispatch<React.SetStateAction<GroupMergeRecommendation[]>>;
  setTokenMergeRules: React.Dispatch<React.SetStateAction<TokenMergeRule[]>>;
  setBlockedTokens: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLabelSections: React.Dispatch<React.SetStateAction<LabelSection[]>>;
  setFileName: React.Dispatch<React.SetStateAction<string | null>>;

  // Transitional ref access (for code not yet migrated to mutations)
  refs: {
    results: React.MutableRefObject<ProcessedRow[] | null>;
    clusterSummary: React.MutableRefObject<ClusterSummary[] | null>;
    tokenSummary: React.MutableRefObject<TokenSummary[] | null>;
    groupedClusters: React.MutableRefObject<GroupedCluster[]>;
    approvedGroups: React.MutableRefObject<GroupedCluster[]>;
    blockedKeywords: React.MutableRefObject<BlockedKeyword[]>;
    activityLog: React.MutableRefObject<ActivityLogEntry[]>;
    stats: React.MutableRefObject<Stats | null>;
    datasetStats: React.MutableRefObject<any | null>;
    autoGroupSuggestions: React.MutableRefObject<AutoGroupSuggestion[]>;
    autoMergeRecommendations: React.MutableRefObject<AutoMergeRecommendation[]>;
    groupMergeRecommendations: React.MutableRefObject<GroupMergeRecommendation[]>;
    tokenMergeRules: React.MutableRefObject<TokenMergeRule[]>;
    blockedTokens: React.MutableRefObject<Set<string>>;
    labelSections: React.MutableRefObject<LabelSection[]>;
    fileName: React.MutableRefObject<string | null>;
    activeProjectId: React.MutableRefObject<string | null>;
  };
}

// ---------------------------------------------------------------------------
// Helper: build initial persisted state
// ---------------------------------------------------------------------------

const EMPTY: PersistedState = {
  results: null,
  clusterSummary: null,
  tokenSummary: null,
  groupedClusters: [],
  approvedGroups: [],
  blockedKeywords: [],
  activityLog: [],
  stats: null,
  datasetStats: null,
  autoGroupSuggestions: [],
  autoMergeRecommendations: [],
  groupMergeRecommendations: [],
  tokenMergeRules: [],
  blockedTokens: new Set<string>(),
  labelSections: [],
  fileName: null,
};

const SESSION_CLIENT_ID = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Snapshot guard evaluation — pure function, unit-testable
// ---------------------------------------------------------------------------

export type SnapshotGuardInput = {
  hasPendingWrites: boolean;
  isProjectLoading: boolean;
  isFlushing: boolean;
  metaClientId: string | null;
  ourClientId: string;
  dataExists: boolean;
  localResults: number;
  localGroupedCount: number;
  localApprovedCount: number;
  localClusterCount: number;
  incomingGroupedChunkCount: number | null;
  incomingApprovedChunkCount: number | null;
  incomingDataGroupedCount: number;
  incomingDataApprovedCount: number;
  incomingResultsCount: number;
  incomingClusterCount: number;
  loadFence: number;
  incomingGroupedPageMass: number;
  incomingSaveId: number;
  localSaveId: number;
  incomingFromCache: boolean;
};

export type SnapshotGuardResult =
  | { action: 'skip'; guard: string }
  | { action: 'apply' };

export function evaluateSnapshotGuards(input: SnapshotGuardInput): SnapshotGuardResult {
  if (input.hasPendingWrites) return { action: 'skip', guard: '0:hasPendingWrites' };
  if (input.isProjectLoading) return { action: 'skip', guard: '1a:projectLoading' };
  if (input.isFlushing) return { action: 'skip', guard: '1b:isFlushing' };
  if (input.metaClientId === input.ourClientId) return { action: 'skip', guard: '2:ownEcho' };

  if (!input.dataExists) {
    if (input.localResults > 0) return { action: 'skip', guard: '3:emptySnap_hasResults' };
    if (input.localGroupedCount > 0) return { action: 'skip', guard: '3:emptySnap_hasGrouped' };
    if (input.localApprovedCount > 0) return { action: 'skip', guard: '3:emptySnap_hasApproved' };
    if (input.localClusterCount > 0) return { action: 'skip', guard: '3:emptySnap_hasClusters' };
  }

  if (input.dataExists) {
    const localHasData =
      input.localResults > 0 ||
      input.localGroupedCount > 0 ||
      input.localApprovedCount > 0 ||
      input.localClusterCount > 0;
    const incomingHasData =
      input.incomingResultsCount > 0 ||
      input.incomingDataGroupedCount > 0 ||
      input.incomingDataApprovedCount > 0 ||
      input.incomingClusterCount > 0;
    if (localHasData && !incomingHasData) {
      const authoritativeDestructiveApply =
        !input.incomingFromCache &&
        input.incomingSaveId > 0 &&
        input.localSaveId > 0 &&
        input.incomingSaveId >= input.localSaveId;
      if (!authoritativeDestructiveApply) {
        return { action: 'skip', guard: '3b:effectiveEmpty_hasLocal' };
      }
    }
  }

  if (input.dataExists) {
    if (
      input.incomingGroupedChunkCount != null && input.incomingGroupedChunkCount > 0 &&
      input.localGroupedCount > 0 && input.incomingDataGroupedCount === 0
    ) return { action: 'skip', guard: '4:partialGrouped' };
    if (
      input.incomingApprovedChunkCount != null && input.incomingApprovedChunkCount > 0 &&
      input.localApprovedCount > 0 && input.incomingDataApprovedCount === 0
    ) return { action: 'skip', guard: '4:partialApproved' };
  }

  if (input.dataExists && input.loadFence > 0) {
    if (input.incomingGroupedPageMass < input.loadFence) {
      return { action: 'skip', guard: '5:loadFence' };
    }
  }

  if (input.dataExists) {
    const iSave = input.incomingSaveId;
    const lSave = input.localSaveId;
    if (iSave > 0 && lSave > 0 && iSave < lSave) {
      return { action: 'skip', guard: '6:staleSaveId' };
    }
  }

  return { action: 'apply' };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProjectPersistence(options: {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  addToast: (msg: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}): ProjectPersistence {
  const { projects, setProjects, addToast } = options;

  // ── 14 persisted state variables ──────────────────────────────────────
  const [results, setResults] = useState<ProcessedRow[] | null>(null);
  const [clusterSummary, setClusterSummary] = useState<ClusterSummary[] | null>(null);
  const [tokenSummary, setTokenSummary] = useState<TokenSummary[] | null>(null);
  const [groupedClusters, setGroupedClusters] = useState<GroupedCluster[]>([]);
  const [approvedGroups, setApprovedGroups] = useState<GroupedCluster[]>([]);
  const [blockedKeywords, setBlockedKeywords] = useState<BlockedKeyword[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [datasetStats, setDatasetStats] = useState<any | null>(null);
  const [autoGroupSuggestions, setAutoGroupSuggestions] = useState<AutoGroupSuggestion[]>([]);
  const [autoMergeRecommendations, setAutoMergeRecommendations] = useState<AutoMergeRecommendation[]>([]);
  const [groupMergeRecommendations, setGroupMergeRecommendations] = useState<GroupMergeRecommendation[]>([]);
  const [tokenMergeRules, setTokenMergeRules] = useState<TokenMergeRule[]>([]);
  const [blockedTokens, setBlockedTokens] = useState<Set<string>>(new Set());
  const [labelSections, setLabelSections] = useState<LabelSection[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  // ── Project ID ────────────────────────────────────────────────────────
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [storageMode, setStorageModeState] = useState<'legacy' | 'v2'>('legacy');
  const [activeOperation, setActiveOperation] = useState<ProjectOperationLockDoc | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const storageModeRef = useRef<'legacy' | 'v2'>('legacy');
  const addToastRef = useRef(addToast);
  const projectsRef = useRef(projects);
  const baseSnapshotRef = useRef<ProjectBaseSnapshot | null>(null);
  const groupDocsRef = useRef<ProjectGroupDoc[]>([]);
  const blockedTokenDocsRef = useRef<ProjectBlockedTokenDoc[]>([]);
  const manualBlockedKeywordDocsRef = useRef<ProjectBlockedKeywordDoc[]>([]);
  const tokenMergeRuleDocsRef = useRef<ProjectTokenMergeRuleDoc[]>([]);
  const labelSectionDocsRef = useRef<ProjectLabelSectionDoc[]>([]);
  const activityLogDocsRef = useRef<ProjectActivityLogDoc[]>([]);
  const collabMetaRef = useRef<ProjectCollabMetaDoc | null>(null);
  const activeEpochRef = useRef<number | null>(null);
  const epochLoadGenerationRef = useRef(0);
  const epochLoadAbortRef = useRef<AbortController | null>(null);
  const entityListenersCleanupRef = useRef<(() => void) | null>(null);
  const serverRevisionByDocKeyRef = useRef<Map<string, number>>(new Map());
  const pendingMutationByDocKeyRef = useRef<Map<string, string>>(new Map());
  const optimisticOverlayByDocKeyRef = useRef<Map<string, unknown>>(new Map());
  const lastAckedMutationByDocKeyRef = useRef<Map<string, string | null>>(new Map());
  const legacyWritesBlockedRef = useRef(false);
  const v2RecoveryModeRef = useRef(false);
  const projectStorageModeResolvedRef = useRef(false);
  const lockHeartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockHeartbeatLostRef = useRef(false);
  const activeOperationRef = useRef<ProjectOperationLockDoc | null>(null);
  const pendingV2WriteRef = useRef<Promise<void>>(Promise.resolve());
  const pendingV2LocalRef = useRef<Promise<void>>(Promise.resolve());
  const lastV2WriteErrorRef = useRef<Error | null>(null);
  const lastV2LocalErrorRef = useRef<Error | null>(null);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);
  useEffect(() => { storageModeRef.current = storageMode; }, [storageMode]);
  useEffect(() => { activeOperationRef.current = activeOperation; }, [activeOperation]);
  useEffect(() => { addToastRef.current = addToast; }, [addToast]);

  const setStorageMode = useCallback((mode: 'legacy' | 'v2') => {
    storageModeRef.current = mode;
    setStorageModeState(mode);
  }, []);

  // ── Consolidated "latest" ref — always in sync, never stale ──────────
  const latest = useRef<PersistedState>({ ...EMPTY });

  // Keep `latest` in sync with every state change.
  // This single useEffect replaces 15 individual useEffect+ref pairs.
  useEffect(() => {
    latest.current = {
      results, clusterSummary, tokenSummary, groupedClusters,
      approvedGroups, blockedKeywords, activityLog, stats,
      datasetStats, autoGroupSuggestions, autoMergeRecommendations, groupMergeRecommendations, tokenMergeRules,
      blockedTokens, labelSections, fileName,
    };
  });

  // ── Individual refs (transitional — exposed via .refs for migration) ──
  const resultsRef = useRef(results);
  const clusterSummaryRef = useRef(clusterSummary);
  const tokenSummaryRef = useRef(tokenSummary);
  const groupedClustersRef = useRef(groupedClusters);
  const approvedGroupsRef = useRef(approvedGroups);
  const blockedKeywordsRef = useRef(blockedKeywords);
  const activityLogRef = useRef(activityLog);
  const statsRef = useRef(stats);
  const datasetStatsRef = useRef(datasetStats);
  const autoGroupSuggestionsRef = useRef(autoGroupSuggestions);
  const autoMergeRecommendationsRef = useRef(autoMergeRecommendations);
  const groupMergeRecommendationsRef = useRef(groupMergeRecommendations);
  const tokenMergeRulesRef = useRef(tokenMergeRules);
  const blockedTokensRef = useRef(blockedTokens);
  const labelSectionsRef = useRef(labelSections);
  const fileNameRef = useRef(fileName);

  // Sync individual refs (transitional)
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { clusterSummaryRef.current = clusterSummary; }, [clusterSummary]);
  useEffect(() => { tokenSummaryRef.current = tokenSummary; }, [tokenSummary]);
  useEffect(() => { groupedClustersRef.current = groupedClusters; }, [groupedClusters]);
  useEffect(() => { approvedGroupsRef.current = approvedGroups; }, [approvedGroups]);
  useEffect(() => { blockedKeywordsRef.current = blockedKeywords; }, [blockedKeywords]);
  useEffect(() => { activityLogRef.current = activityLog; }, [activityLog]);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { datasetStatsRef.current = datasetStats; }, [datasetStats]);
  useEffect(() => { autoGroupSuggestionsRef.current = autoGroupSuggestions; }, [autoGroupSuggestions]);
  useEffect(() => { autoMergeRecommendationsRef.current = autoMergeRecommendations; }, [autoMergeRecommendations]);
  useEffect(() => { groupMergeRecommendationsRef.current = groupMergeRecommendations; }, [groupMergeRecommendations]);
  useEffect(() => { tokenMergeRulesRef.current = tokenMergeRules; }, [tokenMergeRules]);
  useEffect(() => { blockedTokensRef.current = blockedTokens; }, [blockedTokens]);
  useEffect(() => { labelSectionsRef.current = labelSections; }, [labelSections]);
  useEffect(() => { fileNameRef.current = fileName; }, [fileName]);

  // ── Save infrastructure ───────────────────────────────────────────────
  // Unique per browser session — written to Firestore meta doc so the
  // onSnapshot listener can recognise (and skip) our own save echoes.
  const clientIdRef = useRef(SESSION_CLIENT_ID);
  const projectLoadingRef = useRef(false);
  const pendingSaveRef = useRef<Promise<void>>(Promise.resolve());
  const pendingLocalPersistRef = useRef<Promise<void>>(Promise.resolve());
  const saveCounterRef = useRef(0);
  const activePersistTraceRef = useRef<string | null>(null);
  const activePersistSourceRef = useRef<string>('unknown');
  /** True if a mutation happened since we started the current persist iteration (coalesced saves). */
  const needsPersistFlushRef = useRef(false);
  /** True while flushPersistQueue is awaiting IDB/Firestore writes. Prevents onSnapshot
   *  from calling applyViewState and overwriting `latest.current` mid-flush, which would
   *  cause the next loop iteration to save remote data instead of local edits. */
  const isFlushingRef = useRef(false);
  // Load fence: prevents a stale onSnapshot (from a previous session with a
  // different clientId) from shrinking grouped/approved state below what was
  // loaded from IDB. Set after loadProject, cleared on first local save.
  const loadFenceRef = useRef(0);
  const getLegacyPersistBlockReason = useCallback((): string | null => {
    if (!activeProjectIdRef.current) return 'no-active-project';
    if (storageModeRef.current !== 'legacy') return 'storage-mode-not-legacy';
    if (!projectStorageModeResolvedRef.current) return 'storage-mode-unresolved';
    if (projectLoadingRef.current) return 'project-loading';
    if (legacyWritesBlockedRef.current) return 'legacy-writes-blocked';
    if (v2RecoveryModeRef.current) return 'v2-recovery';
    if (collabMetaRef.current?.readMode === 'v2') return 'collab-meta-v2';
    return null;
  }, []);

  /** Build a full ProjectDataPayload from `latest.current` + optional overrides. */
  const buildPayload = useCallback((overrides?: Partial<PersistedState>): ProjectDataPayload => {
    const s = { ...latest.current, ...overrides };
    return {
      results: s.results,
      clusterSummary: s.clusterSummary,
      tokenSummary: s.tokenSummary,
      groupedClusters: s.groupedClusters,
      approvedGroups: s.approvedGroups,
      stats: s.stats,
      datasetStats: s.datasetStats,
      blockedTokens: Array.from(s.blockedTokens),
      blockedKeywords: s.blockedKeywords,
      labelSections: s.labelSections,
      activityLog: s.activityLog.slice(0, 500),
      tokenMergeRules: s.tokenMergeRules,
      autoGroupSuggestions: s.autoGroupSuggestions,
      autoMergeRecommendations: s.autoMergeRecommendations,
      groupMergeRecommendations: s.groupMergeRecommendations,
      updatedAt: new Date().toISOString(),
      lastSaveId: saveCounterRef.current,
    };
  }, []);

  const persistProjectPayloadToIDB = useCallback(async (
    projectId: string,
    payload: ProjectDataPayload,
    options?: { mode?: 'checkpoint' | 'flush'; traceId?: string; traceSource?: string },
  ): Promise<boolean> => {
    const mode = options?.mode ?? 'checkpoint';
    const localTrace = options?.traceId
      ? {
          traceId: options.traceId,
          source: options.traceSource ?? 'useProjectPersistence.persistProjectPayloadToIDB',
          data: { mode },
        }
      : undefined;
    if (mode === 'checkpoint') {
      recordLocalPersistStart(localTrace);
    }
    try {
      await withPersistTimeout(
        saveToIDB(projectId, payload),
        PROJECT_LOCAL_WRITE_TIMEOUT_MS,
        `project local write (${mode}:${projectId})`,
      );
      // Both modes clear the failed flag on success — this is critical so that
      // a flush after a failed checkpoint can recover the durability status.
      recordLocalPersistOk({ decrementPending: mode === 'checkpoint', trace: localTrace });
      return true;
    } catch (err) {
      if (mode === 'checkpoint') {
        recordLocalPersistError({ trace: localTrace });
        reportLocalPersistFailure(addToastRef.current, 'project data local save', err);
      } else {
        // Flush mode: still update durability status so the UI reflects reality,
        // but skip the toast (flushes are background work, don't spam the user).
        recordLocalPersistError({ decrementPending: false, trace: localTrace });
        logPersistError('IDB save (flush)', err);
      }
      return false;
    }
  }, []);

  /**
   * Flush pending state to IDB + Firestore. Uses a while-loop so rapid auto-group /
   * review updates coalesce: many mutateAndSave calls in one burst become one or a few
   * writes (whatever fits between awaits), always reading `latest.current` at flush time.
   * Order is still strictly serialized — no parallel IDB/Firestore writes.
   */
  const flushPersistQueue = useCallback(async () => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    const traceId = activePersistTraceRef.current;
    const blockReason = getLegacyPersistBlockReason();
    if (blockReason) {
      if (traceId) {
        traceRuntimeEvent({
          traceId,
          event: 'persist:flush-suppressed',
          source: 'useProjectPersistence.flushPersistQueue',
          projectId,
          data: { trigger: activePersistSourceRef.current, reason: blockReason },
        });
      }
      return;
    }
    if (traceId) {
      traceRuntimeEvent({
        traceId,
        event: 'persist:flush-enter',
        source: 'useProjectPersistence.flushPersistQueue',
        projectId,
        data: { trigger: activePersistSourceRef.current },
      });
    }

    isFlushingRef.current = true;
    recordProjectFlushEnter();
    try {
      while (needsPersistFlushRef.current) {
        needsPersistFlushRef.current = false;

        // saveCounterRef is bumped in mutateAndSave (and suggestion checkpoints), not here —
        // otherwise IDB checkpoints would reuse the previous id and merge could prefer stale FS.
        const saveId = saveCounterRef.current;
        const payload = buildPayload();
        payload.lastSaveId = saveId;
        const clientId = clientIdRef.current;
        if (traceId) {
          traceRuntimeEvent({
            traceId,
            event: 'persist:loop-iteration',
            source: 'useProjectPersistence.flushPersistQueue',
            projectId,
            data: {
              saveId,
              resultsCount: payload.results?.length ?? 0,
              groupedCount: payload.groupedClusters?.length ?? 0,
              approvedCount: payload.approvedGroups?.length ?? 0,
            },
          });
        }

        // Guard: refuse to save a completely empty payload. A project with zero
        // results, zero grouped clusters, AND zero approved groups is never a
        // valid user state worth persisting — it's always a clearProject race
        // artifact. Saving it would overwrite real data in IDB/Firestore.
        if (!(payload.results?.length) && !(payload.groupedClusters?.length) && !(payload.approvedGroups?.length)) {
          console.warn('[PERSIST] Skipping flush of empty payload (no results/groups/approved)');
          if (traceId) {
            traceRuntimeEvent({
              traceId,
              event: 'persist:skip-empty-payload',
              source: 'useProjectPersistence.flushPersistQueue',
              projectId,
              data: { saveId },
            });
          }
          break;
        }

        loadFenceRef.current = 0;

        await persistProjectPayloadToIDB(projectId, payload, {
          mode: 'flush',
          traceId: traceId ?? undefined,
          traceSource: 'useProjectPersistence.flushPersistQueue',
        });
        try {
          recordProjectCloudWriteStart();
          if (traceId) {
            traceRuntimeEvent({
              traceId,
              event: 'persist:cloud-write-start',
              source: 'useProjectPersistence.flushPersistQueue',
              projectId,
              data: { saveId },
            });
          }
          await withPersistTimeout(
            saveProjectDataToFirestore(projectId, payload, { saveId, clientId }),
            PROJECT_CLOUD_WRITE_TIMEOUT_MS,
            `project cloud write (${projectId})`,
          );
          recordProjectFirestoreSaveOk();
          if (traceId) {
            traceRuntimeEvent({
              traceId,
              event: 'persist:cloud-write-ok',
              source: 'useProjectPersistence.flushPersistQueue',
              projectId,
              data: { saveId },
            });
          }
          console.log(
            '[PERSIST] Firestore save OK - grouped:',
            (payload.groupedClusters || []).length,
            'groups, saveId:',
            saveId,
          );
        } catch (err) {
          recordProjectFirestoreSaveError();
          if (traceId) {
            traceRuntimeEvent({
              traceId,
              event: 'persist:cloud-write-error',
              source: 'useProjectPersistence.flushPersistQueue',
              projectId,
              data: { saveId, error: err instanceof Error ? err.message : String(err) },
            });
          }
          reportPersistFailure(addToastRef.current, 'project data save', err);
        }
        // If mutateAndSave ran during the awaits above, needsPersistFlushRef is true → loop
      }
    } finally {
      isFlushingRef.current = false;
      recordProjectFlushExit();
      if (traceId) {
        traceRuntimeEvent({
          traceId,
          event: 'persist:flush-exit',
          source: 'useProjectPersistence.flushPersistQueue',
          projectId,
        });
      }
    }
  }, [buildPayload, getLegacyPersistBlockReason, persistProjectPayloadToIDB]);

  /** Queue Firestore + IDB flush (no debounce). `latest.current` is read at flush time. */
  const enqueueSave = useCallback((source: string = 'unknown', traceId?: string) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    const blockReason = getLegacyPersistBlockReason();
    if (blockReason) {
      const existingTraceId = traceId ?? activePersistTraceRef.current;
      if (existingTraceId) {
        traceRuntimeEvent({
          traceId: existingTraceId,
          event: 'persist:enqueue-suppressed',
          source: 'useProjectPersistence.enqueueSave',
          projectId,
          data: { source, reason: blockReason },
        });
      }
      return;
    }
    if (traceId) {
      activePersistTraceRef.current = traceId;
    } else if (!activePersistTraceRef.current) {
      activePersistTraceRef.current = beginRuntimeTrace('useProjectPersistence.enqueueSave', projectId, {
        source,
      });
    }
    activePersistSourceRef.current = source;
    if (activePersistTraceRef.current) {
      traceRuntimeEvent({
        traceId: activePersistTraceRef.current,
        event: 'persist:enqueue',
        source: 'useProjectPersistence.enqueueSave',
        projectId: activeProjectIdRef.current,
        data: { source },
      });
    }
    needsPersistFlushRef.current = true;
    pendingSaveRef.current = pendingSaveRef.current
      .then(flushPersistQueue)
      .catch((err) => logPersistError('persist queue flush', err));
  }, [flushPersistQueue, getLegacyPersistBlockReason]);

  /**
   * Durability barrier for long-running jobs that need a user-visible "done and synced"
   * moment before returning control.
   */
  const flushNow = useCallback(async () => {
    if (!activeProjectIdRef.current) return;
    if (storageModeRef.current === 'v2') {
      // V2 writes can enqueue canonical-cache persists after cloud acks.
      // Keep draining until both queues stabilize so callers get a true
      // "cloud + canonical local cache" durability barrier.
      while (true) {
        const writePromise = pendingV2WriteRef.current;
        await writePromise;
        const localPromise = pendingV2LocalRef.current;
        await localPromise;
        if (writePromise === pendingV2WriteRef.current && localPromise === pendingV2LocalRef.current) {
          break;
        }
      }
      if (lastV2LocalErrorRef.current) {
        const err = lastV2LocalErrorRef.current;
        lastV2LocalErrorRef.current = null;
        throw err;
      }
      if (lastV2WriteErrorRef.current) {
        const err = lastV2WriteErrorRef.current;
        lastV2WriteErrorRef.current = null;
        throw err;
      }
      return;
    }
    enqueueSave('flush-now');
    await pendingLocalPersistRef.current;
    await pendingSaveRef.current;
  }, [enqueueSave]);

  /**
   * Crash-safety checkpoint: persist latest state to IDB immediately.
   * `enqueueSave` runs the same payload to Firestore on the serialized queue.
   */
  const checkpointToIDB = useCallback(async (
    overrides?: Partial<PersistedState>,
    options?: { traceId?: string; traceSource?: string },
  ) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    const payload = buildPayload(overrides);
    await persistProjectPayloadToIDB(projectId, payload, {
      mode: 'checkpoint',
      traceId: options?.traceId,
      traceSource: options?.traceSource,
    });
  }, [buildPayload, persistProjectPayloadToIDB]);

  const applyViewState = useCallback((vs: ProjectViewState) => {
    const next: PersistedState = {
      results: ensureNullableArray(vs.results),
      clusterSummary: ensureNullableArray(vs.clusterSummary),
      tokenSummary: ensureNullableArray(vs.tokenSummary),
      groupedClusters: ensureArray(vs.groupedClusters),
      approvedGroups: ensureArray(vs.approvedGroups),
      activityLog: ensureArray(vs.activityLog),
      tokenMergeRules: ensureArray(vs.tokenMergeRules),
      autoGroupSuggestions: ensureArray(vs.autoGroupSuggestions),
      autoMergeRecommendations: ensureArray(vs.autoMergeRecommendations),
      groupMergeRecommendations: ensureArray(vs.groupMergeRecommendations),
      stats: vs.stats,
      datasetStats: vs.datasetStats as any,
      blockedTokens: new Set<string>(ensureArray(vs.blockedTokens)),
      blockedKeywords: ensureArray(vs.blockedKeywords),
      labelSections: ensureArray(vs.labelSections),
      fileName: vs.fileName,
    };
    latest.current = next;
    setResults(next.results);
    setClusterSummary(next.clusterSummary);
    setTokenSummary(next.tokenSummary);
    setGroupedClusters(next.groupedClusters);
    setApprovedGroups(next.approvedGroups);
    setActivityLog(next.activityLog);
    setTokenMergeRules(next.tokenMergeRules);
    setAutoGroupSuggestions(next.autoGroupSuggestions);
    setAutoMergeRecommendations(next.autoMergeRecommendations);
    setGroupMergeRecommendations(next.groupMergeRecommendations);
    setStats(next.stats);
    setDatasetStats(next.datasetStats);
    setBlockedTokens(next.blockedTokens);
    setBlockedKeywords(next.blockedKeywords);
    setLabelSections(next.labelSections);
    setFileName(next.fileName);
  }, []);

  const syncCanonicalRefsFromResolvedPayload = useCallback((payload: ProjectDataPayload) => {
    baseSnapshotRef.current = buildBaseSnapshotFromResolvedPayload(payload);
    const entities = buildEntityStateFromResolvedPayload(
      payload,
      clientIdRef.current,
      baseSnapshotRef.current?.datasetEpoch ?? (payload.lastSaveId ?? 1),
    );
    groupDocsRef.current = entities.groups;
    blockedTokenDocsRef.current = entities.blockedTokens;
    manualBlockedKeywordDocsRef.current = entities.manualBlockedKeywords;
    tokenMergeRuleDocsRef.current = entities.tokenMergeRules;
    labelSectionDocsRef.current = entities.labelSections;
    activityLogDocsRef.current = entities.activityLog;
  }, []);

  const currentDatasetEpoch = useCallback(() => {
    const baseEpoch = baseSnapshotRef.current?.datasetEpoch ?? 0;
    return Math.max(baseEpoch, saveCounterRef.current, 1);
  }, []);

  const v2DocKey = useCallback((datasetEpoch: number, subcollection: string, id: string) => {
    return `${datasetEpoch}::${subcollection}::${id}`;
  }, []);

  interface V2WriteContext {
    projectId: string;
    datasetEpoch: number | null;
    generation: number;
    allowEpochAdvance?: boolean;
  }

  const isV2WriteContextCurrent = useCallback((context: V2WriteContext): boolean => {
    if (activeProjectIdRef.current !== context.projectId) return false;
    if (epochLoadGenerationRef.current !== context.generation) return false;
    if (context.allowEpochAdvance) return true;
    if (context.datasetEpoch == null) return true;
    if (activeEpochRef.current == null) return true;
    return activeEpochRef.current === context.datasetEpoch;
  }, []);

  interface V2CacheContext {
    projectId: string;
    datasetEpoch: number;
    baseCommitId: string;
    metaRevision: number;
  }

  const isV2CacheContextCurrent = useCallback((context: V2CacheContext): boolean => {
    if (activeProjectIdRef.current !== context.projectId) return false;
    const currentMeta = collabMetaRef.current;
    if (!currentMeta || currentMeta.readMode !== 'v2') return false;
    return (
      currentMeta.datasetEpoch === context.datasetEpoch &&
      currentMeta.baseCommitId === context.baseCommitId &&
      currentMeta.revision === context.metaRevision &&
      currentMeta.commitState === 'ready' &&
      currentMeta.migrationState === 'complete'
    );
  }, []);

  const persistCanonicalCacheToIDB = useCallback(async (
    projectId: string,
    payload: ProjectDataPayload,
    meta: ProjectCollabMetaDoc,
  ) => {
    recordLocalPersistStart();
    try {
      await withPersistTimeout(
        saveCanonicalCacheToIDB(projectId, payload, meta),
        PROJECT_LOCAL_WRITE_TIMEOUT_MS,
        `project canonical V2 cache write (${projectId})`,
      );
      recordLocalPersistOk();
      lastV2LocalErrorRef.current = null;
      return true;
    } catch (err) {
      recordLocalPersistError();
      reportLocalPersistFailure(addToastRef.current, 'project canonical V2 cache save', err);
      lastV2LocalErrorRef.current = err instanceof Error ? err : new Error('v2-local-cache-failed');
      return false;
    }
  }, []);

  const updateCanonicalCache = useCallback((payload: ProjectDataPayload, meta: ProjectCollabMetaDoc | null) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    if (!meta || meta.readMode !== 'v2' || meta.commitState !== 'ready' || meta.migrationState !== 'complete') return;
    if (!meta.baseCommitId) return;
    const context: V2CacheContext = {
      projectId,
      datasetEpoch: meta.datasetEpoch,
      baseCommitId: meta.baseCommitId,
      metaRevision: meta.revision,
    };
    pendingV2LocalRef.current = pendingV2LocalRef.current.then(async () => {
      if (!isV2CacheContextCurrent(context)) {
        return;
      }
      const ok = await persistCanonicalCacheToIDB(projectId, payload, meta);
      if (!isV2CacheContextCurrent(context)) {
        return;
      }
      if (!ok && !lastV2LocalErrorRef.current) {
        lastV2LocalErrorRef.current = new Error('v2-local-cache-failed');
      }
    }).catch((err) => {
      lastV2LocalErrorRef.current = err instanceof Error ? err : new Error('v2-local-cache-failed');
      logPersistError('cache canonical V2 project to IDB', err);
    });
  }, [isV2CacheContextCurrent, persistCanonicalCacheToIDB]);

  const resetEpochScopedMutationState = useCallback((activeEpoch: number | null) => {
    if (activeEpoch == null) {
      serverRevisionByDocKeyRef.current.clear();
      pendingMutationByDocKeyRef.current.clear();
      optimisticOverlayByDocKeyRef.current.clear();
      lastAckedMutationByDocKeyRef.current.clear();
      return;
    }

    const prefix = `${activeEpoch}::`;
    for (const mapRef of [
      serverRevisionByDocKeyRef.current,
      pendingMutationByDocKeyRef.current,
      optimisticOverlayByDocKeyRef.current,
      lastAckedMutationByDocKeyRef.current,
    ] as Array<Map<string, unknown>>) {
      for (const key of Array.from(mapRef.keys()) as string[]) {
        if (!key.startsWith(prefix)) {
          mapRef.delete(key);
        }
      }
    }
  }, []);

  const rebuildRevisionMap = useCallback((datasetEpoch: number | null) => {
    resetEpochScopedMutationState(datasetEpoch);
    if (datasetEpoch == null) return;
    const register = <T extends { id: string; revision?: number }>(subcollection: string, docs: T[]) => {
      for (const docItem of docs) {
        serverRevisionByDocKeyRef.current.set(v2DocKey(datasetEpoch, subcollection, docItem.id), docItem.revision ?? 0);
      }
    };
    register(PROJECT_GROUPS_SUBCOLLECTION, groupDocsRef.current);
    register(PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, blockedTokenDocsRef.current);
    register(PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, manualBlockedKeywordDocsRef.current);
    register(PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, tokenMergeRuleDocsRef.current);
    register(PROJECT_LABEL_SECTIONS_SUBCOLLECTION, labelSectionDocsRef.current);
  }, [resetEpochScopedMutationState, v2DocKey]);

  const clearPendingForEpoch = useCallback((datasetEpoch: number | null) => {
    if (datasetEpoch == null) return;
    const prefix = `${datasetEpoch}::`;
    for (const key of Array.from(pendingMutationByDocKeyRef.current.keys()) as string[]) {
      if (key.startsWith(prefix)) {
        pendingMutationByDocKeyRef.current.delete(key);
        optimisticOverlayByDocKeyRef.current.delete(key);
      }
    }
  }, []);

  const recomposeFromCanonicalRefs = useCallback(() => {
    const project = projectsRef.current.find((item) => item.id === activeProjectIdRef.current);
    const payload = assembleCanonicalPayload(baseSnapshotRef.current, {
      meta: collabMetaRef.current,
      groups: groupDocsRef.current,
      blockedTokens: blockedTokenDocsRef.current,
      manualBlockedKeywords: manualBlockedKeywordDocsRef.current,
      tokenMergeRules: tokenMergeRuleDocsRef.current,
      labelSections: labelSectionDocsRef.current,
      activityLog: activityLogDocsRef.current,
      activeOperation: activeOperationRef.current,
    });
    if (!payload) {
      applyViewState(createEmptyProjectViewState());
      return null;
    }
    applyViewState(toProjectViewState(payload, project));
    return payload;
  }, [applyViewState]);

  const rollbackConflictedMutation = useCallback((message: string, datasetEpoch: number | null) => {
    if (datasetEpoch == null || !message.startsWith('conflict:')) return;
    const [, subcollection, logicalId] = message.split(':', 3);
    if (!subcollection || !logicalId) return;
    const docKey = v2DocKey(datasetEpoch, subcollection, logicalId);
    pendingMutationByDocKeyRef.current.delete(docKey);
    optimisticOverlayByDocKeyRef.current.delete(docKey);
    recomposeFromCanonicalRefs();
  }, [recomposeFromCanonicalRefs, v2DocKey]);

  const applyCanonicalState = useCallback((canonical: CanonicalProjectState) => {
    if (canonical.mode !== 'v2') return;
    collabMetaRef.current = canonical.entities.meta;
    legacyWritesBlockedRef.current = Boolean(
      canonical.entities.meta &&
      canonical.entities.meta.readMode === 'v2' &&
      (canonical.entities.meta.requiredClientSchema ?? CLIENT_SCHEMA_VERSION) > CLIENT_SCHEMA_VERSION,
    );
    baseSnapshotRef.current = canonical.base;
    groupDocsRef.current = canonical.entities.groups;
    blockedTokenDocsRef.current = canonical.entities.blockedTokens;
    manualBlockedKeywordDocsRef.current = canonical.entities.manualBlockedKeywords;
    tokenMergeRuleDocsRef.current = canonical.entities.tokenMergeRules;
    labelSectionDocsRef.current = canonical.entities.labelSections;
    activityLogDocsRef.current = canonical.entities.activityLog;
    activeEpochRef.current = canonical.entities.meta?.datasetEpoch ?? canonical.base?.datasetEpoch ?? null;
    rebuildRevisionMap(activeEpochRef.current);
    setActiveOperation(canonical.entities.activeOperation);
    activeOperationRef.current = canonical.entities.activeOperation;
    v2RecoveryModeRef.current = !(
      canonical.resolved &&
      canonical.entities.meta?.readMode === 'v2' &&
      canonical.entities.meta?.commitState === 'ready' &&
      canonical.entities.meta?.migrationState === 'complete'
    );
    if (!canonical.resolved) {
      return;
    }
    const project = projectsRef.current.find((item) => item.id === activeProjectIdRef.current);
    applyViewState(toProjectViewState(canonical.resolved, project));
    saveCounterRef.current = canonical.resolved.lastSaveId ?? saveCounterRef.current;
  }, [applyViewState, rebuildRevisionMap]);

  const reloadCanonicalStateFromCloud = useCallback(async () => {
    const projectId = activeProjectIdRef.current;
    if (!projectId || storageModeRef.current !== 'v2') return;
    const meta = collabMetaRef.current;
    const reloadGeneration = epochLoadGenerationRef.current;
    const reloadMetaRevision = meta?.revision ?? null;
    const reloadDatasetEpoch = meta?.datasetEpoch ?? null;
    const reloadBaseCommitId = meta?.baseCommitId ?? null;
    const canonical = (
      meta ? await loadCanonicalEpoch(projectId, meta) : null
    ) ?? await loadCanonicalProjectState(
      projectId,
      clientIdRef.current,
      () => loadProjectDataForView(projectId),
    );
    if (activeProjectIdRef.current !== projectId) return;
    if (epochLoadGenerationRef.current !== reloadGeneration) return;
    const currentMeta = collabMetaRef.current;
    if (
      currentMeta &&
      (
        currentMeta.revision !== reloadMetaRevision ||
        currentMeta.datasetEpoch !== reloadDatasetEpoch ||
        currentMeta.baseCommitId !== reloadBaseCommitId
      )
    ) {
      return;
    }
    if (!canonical) return;
    clearPendingForEpoch(canonical.entities.meta?.datasetEpoch ?? canonical.base?.datasetEpoch ?? null);
    applyCanonicalState(canonical);
    if (canonical.entities.meta && canonical.resolved) {
      updateCanonicalCache(canonical.resolved, canonical.entities.meta);
    }
  }, [applyCanonicalState, clearPendingForEpoch, updateCanonicalCache]);

  const hasOwnedActiveOperationLock = useCallback((): boolean => {
    const lock = activeOperationRef.current;
    if (!lock) return false;
    if (lock.ownerId !== clientIdRef.current && lock.ownerClientId !== clientIdRef.current) {
      return false;
    }
    return Date.parse(lock.expiresAt || '0') > Date.now();
  }, []);

  const queueV2Write = useCallback((
    label: string,
    task: (context: V2WriteContext) => Promise<void>,
    datasetEpoch?: number | null,
    options?: { allowEpochAdvance?: boolean },
  ) => {
    const queuedProjectId = activeProjectIdRef.current;
    if (!queuedProjectId) return;
    const context: V2WriteContext = {
      projectId: queuedProjectId,
      datasetEpoch: datasetEpoch ?? activeEpochRef.current,
      generation: epochLoadGenerationRef.current,
      allowEpochAdvance: options?.allowEpochAdvance,
    };
    pendingV2WriteRef.current = pendingV2WriteRef.current.then(async () => {
      if (!isV2WriteContextCurrent(context)) {
        return;
      }
      recordProjectCloudWriteStart();
      try {
        await task(context);
        if (isV2WriteContextCurrent(context)) {
          lastV2WriteErrorRef.current = null;
        }
        recordProjectFirestoreSaveOk();
      } catch (err) {
        const message = String((err as Error)?.message || '');
        const isConflict = message.startsWith('conflict:') || message === 'meta-conflict';
        const isOperationConflict = message === 'lock-conflict' || message === 'operation-locked' || message === 'lock-lost';
        const errorInfo = getPersistErrorInfo(err);
        const stillSameProject = isV2WriteContextCurrent(context);
        if (!stillSameProject) {
          recordProjectFirestoreSaveOk();
          return;
        }

        if (isConflict || isOperationConflict) {
          recordProjectFirestoreSaveOk();
        } else {
          recordProjectFirestoreSaveError();
        }
        lastV2WriteErrorRef.current = err instanceof Error ? err : new Error(message || 'v2-write-failed');

        if (isConflict) {
          rollbackConflictedMutation(message, context.datasetEpoch);
          addToastRef.current('Another client changed this project item. The latest shared state was reloaded.', 'warning');
          await reloadCanonicalStateFromCloud();
          return;
        }
        if (isOperationConflict) {
          addToastRef.current('Another client is running a project-wide operation. Try again after it finishes.', 'warning');
          await reloadCanonicalStateFromCloud();
          return;
        }
        reportPersistFailure(
          addToastRef.current,
          errorInfo.step ? `${label} (${errorInfo.step})` : label,
          err,
        );
      }
    });
  }, [isV2WriteContextCurrent, reloadCanonicalStateFromCloud, rollbackConflictedMutation]);

  const persistCanonicalPayloadV2 = useCallback((payload: ProjectDataPayload, options?: { requireOwnedLock?: boolean }) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    if (
      activeOperationRef.current &&
      activeOperationRef.current.ownerId !== clientIdRef.current &&
      activeOperationRef.current.ownerClientId !== clientIdRef.current &&
      Date.parse(activeOperationRef.current.expiresAt || '0') > Date.now()
    ) {
        addToastRef.current('Another client is running a project-wide operation. Try again after it finishes.', 'warning');
      return;
    }
    if (options?.requireOwnedLock && !hasOwnedActiveOperationLock()) {
      addToastRef.current('This action requires an active project operation lock. Try again from the operation flow.', 'warning');
      lastV2WriteErrorRef.current = new Error('operation-locked');
      return;
    }
    const expectedEpoch = collabMetaRef.current?.datasetEpoch ?? activeEpochRef.current;
    queueV2Write('project V2 save', async (context) => {
      const meta = collabMetaRef.current;
      if (!meta) {
        throw new Error('meta-conflict');
      }
      const canonical = await commitCanonicalProjectState(projectId, payload, clientIdRef.current, {
        expectedMetaRevision: meta.revision,
        expectedDatasetEpoch: meta.datasetEpoch,
      });
      if (!isV2WriteContextCurrent(context)) {
        return;
      }
      applyCanonicalState(canonical);
      if (canonical.entities.meta && canonical.resolved) {
        updateCanonicalCache(canonical.resolved, canonical.entities.meta);
      }
    }, expectedEpoch, { allowEpochAdvance: true });
  }, [applyCanonicalState, hasOwnedActiveOperationLock, isV2WriteContextCurrent, queueV2Write, updateCanonicalCache]);

  const ensureV2MutationAllowed = useCallback((actionLabel: string): boolean => {
    if (storageModeRef.current !== 'v2') return true;
    if (legacyWritesBlockedRef.current) {
      addToastRef.current('This shared project requires a newer client version. Writes are disabled.', 'warning');
      return false;
    }
    if (v2RecoveryModeRef.current) {
      addToastRef.current(`Shared state is still recovering. ${actionLabel} is temporarily read-only.`, 'warning');
      return false;
    }
    if (
      activeOperationRef.current &&
      activeOperationRef.current.ownerId !== clientIdRef.current &&
      activeOperationRef.current.ownerClientId !== clientIdRef.current &&
      Date.parse(activeOperationRef.current.expiresAt || '0') > Date.now()
    ) {
      addToastRef.current(`Another client is running a project-wide operation. ${actionLabel} is temporarily read-only.`, 'warning');
      return false;
    }
    return true;
  }, []);

  const mergeAckedDocs = useCallback(<T extends { id: string; revision?: number; lastMutationId?: string | null }>(
    currentDocs: T[],
    acknowledgements: Array<{ kind: 'upsert' | 'delete'; id: string; revision: number; lastMutationId: string | null; value?: T }>,
    subcollection: string,
    datasetEpoch: number,
  ): T[] => {
    const next = new Map(currentDocs.map((docItem) => [docItem.id, docItem]));
    for (const ack of acknowledgements) {
      const docKey = v2DocKey(datasetEpoch, subcollection, ack.id);
      serverRevisionByDocKeyRef.current.set(docKey, ack.revision);
      pendingMutationByDocKeyRef.current.delete(docKey);
      optimisticOverlayByDocKeyRef.current.delete(docKey);
      lastAckedMutationByDocKeyRef.current.set(docKey, ack.lastMutationId);
      if (ack.kind === 'delete') {
        next.delete(ack.id);
      } else if (ack.value) {
        next.set(ack.id, ack.value);
      }
    }
    return Array.from(next.values());
  }, [v2DocKey]);

  const runWithExclusiveOperation = useCallback(async <T,>(
    type: ProjectOperationLockDoc['type'],
    task: () => Promise<T>,
  ): Promise<T | null> => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return null;
    if (storageModeRef.current !== 'v2') {
      return task();
    }
    const lock = await acquireProjectOperationLock(projectId, type, clientIdRef.current);
    if (!lock) {
      addToastRef.current('Another client is running a project-wide operation. Try again after it finishes.', 'warning');
      return null;
    }
    setActiveOperation(lock);
    activeOperationRef.current = lock;
    lockHeartbeatLostRef.current = false;
    if (lockHeartbeatTimerRef.current) {
      clearInterval(lockHeartbeatTimerRef.current);
    }
    lockHeartbeatTimerRef.current = setInterval(() => {
      void heartbeatProjectOperationLock(projectId, clientIdRef.current).then((nextLock) => {
        if (!nextLock) {
          lockHeartbeatLostRef.current = true;
          return;
        }
        activeOperationRef.current = nextLock;
        setActiveOperation(nextLock);
      }).catch((err) => {
        lockHeartbeatLostRef.current = true;
        reportPersistFailure(addToastRef.current, 'project lock heartbeat', err);
      });
    }, 5_000);
    try {
      const result = await task();
      if (lockHeartbeatLostRef.current) {
        throw new Error('lock-lost');
      }
      await flushNow();
      if (lockHeartbeatLostRef.current) {
        throw new Error('lock-lost');
      }
      return result;
    } catch (err) {
      if (String((err as Error)?.message || '') === 'lock-lost') {
        addToastRef.current('Project operation lock was lost before completion. Shared state was not finalized.', 'warning');
        await reloadCanonicalStateFromCloud();
        return null;
      }
      throw err;
    } finally {
      if (lockHeartbeatTimerRef.current) {
        clearInterval(lockHeartbeatTimerRef.current);
        lockHeartbeatTimerRef.current = null;
      }
      lockHeartbeatLostRef.current = false;
      await releaseProjectOperationLock(projectId, clientIdRef.current);
      setActiveOperation(null);
      activeOperationRef.current = null;
    }
  }, [flushNow, reloadCanonicalStateFromCloud]);

  // Best-effort: extra flush when the tab hides or unloads (navigation may already queue saves).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && storageModeRef.current === 'legacy') {
        enqueueSave('visibility-hidden');
      }
    };
    const onPageHide = () => {
      if (storageModeRef.current === 'legacy') {
        enqueueSave('pagehide');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enqueueSave]);

  // ── Auto-recovery: when local durability is "Failed", periodically retry ──
  // This ensures that transient IDB failures (busy connection, temporary lock)
  // automatically recover once IDB becomes available again, rather than staying
  // stuck in the "Failed" state forever.
  useEffect(() => {
    const RECOVERY_INTERVAL_MS = 10_000; // retry every 10s
    const timer = setInterval(() => {
      if (!isLocalWriteFailed()) return;
      if (!activeProjectIdRef.current) return;
      if (isFlushingRef.current) return; // don't interfere with active flush
      console.log('[PERSIST] Local durability failed — attempting recovery save...');
      enqueueSave('local-durability-recovery');
    }, RECOVERY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enqueueSave]);

  // ── Helper: update latest + state + save atomically ───────────────────
  const mutateAndSave = useCallback((
    updater: (s: PersistedState) => Partial<PersistedState>,
  ) => {
    const projectId = activeProjectIdRef.current;
    const traceId = beginRuntimeTrace('useProjectPersistence.mutateAndSave', projectId, {
      storageMode: storageModeRef.current,
      isFlushing: isFlushingRef.current,
    });
    const changes = updater(latest.current);
    traceRuntimeEvent({
      traceId,
      event: 'mutate:computed-changes',
      source: 'useProjectPersistence.mutateAndSave',
      projectId,
      data: { keys: Object.keys(changes) },
    });
    // 1. Update latest ref synchronously
    latest.current = { ...latest.current, ...changes };
    // 1b. Monotonic save id — every mutation gets a new id before IDB checkpoint so
    // pickNewerProjectPayload prefers this session over stale Firestore on refresh.
    saveCounterRef.current += 1;
    // 2. Update React state for rendering
    if ('results' in changes) setResults(changes.results!);
    if ('clusterSummary' in changes) setClusterSummary(changes.clusterSummary!);
    if ('tokenSummary' in changes) setTokenSummary(changes.tokenSummary!);
    if ('groupedClusters' in changes) setGroupedClusters(changes.groupedClusters!);
    if ('approvedGroups' in changes) setApprovedGroups(changes.approvedGroups!);
    if ('blockedKeywords' in changes) setBlockedKeywords(changes.blockedKeywords!);
    if ('activityLog' in changes) setActivityLog(changes.activityLog!);
    if ('stats' in changes) setStats(changes.stats!);
    if ('datasetStats' in changes) setDatasetStats(changes.datasetStats!);
    if ('autoGroupSuggestions' in changes) setAutoGroupSuggestions(changes.autoGroupSuggestions!);
    if ('autoMergeRecommendations' in changes) setAutoMergeRecommendations(changes.autoMergeRecommendations!);
    if ('groupMergeRecommendations' in changes) setGroupMergeRecommendations(changes.groupMergeRecommendations!);
    if ('tokenMergeRules' in changes) setTokenMergeRules(changes.tokenMergeRules!);
    if ('blockedTokens' in changes) setBlockedTokens(changes.blockedTokens!);
    if ('labelSections' in changes) setLabelSections(changes.labelSections!);
    if ('fileName' in changes) setFileName(changes.fileName!);
    const blockReason = getLegacyPersistBlockReason();
    if (blockReason) {
      traceRuntimeEvent({
        traceId,
        event: 'mutate:legacy-persist-suppressed',
        source: 'useProjectPersistence.mutateAndSave',
        projectId,
        data: { reason: blockReason },
      });
      return;
    }
    // 3. Immediate local durability (crash-safe)
    pendingLocalPersistRef.current = checkpointToIDB(undefined, {
      traceId,
      traceSource: 'useProjectPersistence.mutateAndSave',
    });
    // 4. Queue Firestore + IDB flush (serialized queue; loop coalesces mid-await mutations)
    enqueueSave('mutate-and-save', traceId);
  }, [checkpointToIDB, enqueueSave, getLegacyPersistBlockReason]);

  const applyLocalChanges = useCallback((
    changes: Partial<PersistedState>,
    options?: { checkpoint?: boolean },
  ) => {
    latest.current = { ...latest.current, ...changes };
    saveCounterRef.current += 1;
    if ('results' in changes) setResults(changes.results!);
    if ('clusterSummary' in changes) setClusterSummary(changes.clusterSummary!);
    if ('tokenSummary' in changes) setTokenSummary(changes.tokenSummary!);
    if ('groupedClusters' in changes) setGroupedClusters(changes.groupedClusters!);
    if ('approvedGroups' in changes) setApprovedGroups(changes.approvedGroups!);
    if ('blockedKeywords' in changes) setBlockedKeywords(changes.blockedKeywords!);
    if ('activityLog' in changes) setActivityLog(changes.activityLog!);
    if ('stats' in changes) setStats(changes.stats!);
    if ('datasetStats' in changes) setDatasetStats(changes.datasetStats!);
    if ('autoGroupSuggestions' in changes) setAutoGroupSuggestions(changes.autoGroupSuggestions!);
    if ('autoMergeRecommendations' in changes) setAutoMergeRecommendations(changes.autoMergeRecommendations!);
    if ('groupMergeRecommendations' in changes) setGroupMergeRecommendations(changes.groupMergeRecommendations!);
    if ('tokenMergeRules' in changes) setTokenMergeRules(changes.tokenMergeRules!);
    if ('blockedTokens' in changes) setBlockedTokens(changes.blockedTokens!);
    if ('labelSections' in changes) setLabelSections(changes.labelSections!);
    if ('fileName' in changes) setFileName(changes.fileName!);
    if (options?.checkpoint && storageModeRef.current !== 'v2' && !getLegacyPersistBlockReason()) {
      pendingV2LocalRef.current = checkpointToIDB(changes);
    }
  }, [checkpointToIDB, getLegacyPersistBlockReason]);

  // ── applyViewState: batch-set all 14 fields from a ProjectViewState ──
  const persistGroupsV2 = useCallback((nextGrouped: GroupedCluster[], nextApproved: GroupedCluster[]) => {
    const projectId = activeProjectIdRef.current;
    const base = baseSnapshotRef.current;
    if (!projectId || !base || !ensureV2MutationAllowed('Group edits')) return;
    queueV2Write('project groups save', async (context) => {
      const mutationId = createMutationId(clientIdRef.current);
      const changes = buildGroupDocChanges(
        groupDocsRef.current,
        nextGrouped,
        nextApproved,
        clientIdRef.current,
        base.datasetEpoch,
      ).map((change) => ({ ...change, mutationId }));
      for (const change of changes) {
        const docKey = v2DocKey(base.datasetEpoch, PROJECT_GROUPS_SUBCOLLECTION, change.id);
        pendingMutationByDocKeyRef.current.set(docKey, mutationId);
        optimisticOverlayByDocKeyRef.current.set(docKey, change.kind === 'upsert' ? change.value ?? null : null);
      }
      const acknowledgements = await commitRevisionedDocChanges(projectId, PROJECT_GROUPS_SUBCOLLECTION, changes, clientIdRef.current);
      if (!isV2WriteContextCurrent(context)) return;
      groupDocsRef.current = mergeAckedDocs(groupDocsRef.current, acknowledgements, PROJECT_GROUPS_SUBCOLLECTION, base.datasetEpoch);
      const payload = recomposeFromCanonicalRefs();
      if (payload) {
        updateCanonicalCache(payload, collabMetaRef.current);
      }
    }, base.datasetEpoch);
  }, [ensureV2MutationAllowed, isV2WriteContextCurrent, mergeAckedDocs, queueV2Write, recomposeFromCanonicalRefs, updateCanonicalCache, v2DocKey]);

  const persistBlockedTokensV2 = useCallback((nextTokens: Set<string>) => {
    const projectId = activeProjectIdRef.current;
    const base = baseSnapshotRef.current;
    if (!projectId || !base || !ensureV2MutationAllowed('Blocked-token edits')) return;
    queueV2Write('blocked tokens save', async (context) => {
      const mutationId = createMutationId(clientIdRef.current);
      const changes = buildBlockedTokenDocChanges(
        blockedTokenDocsRef.current,
        Array.from(nextTokens),
        clientIdRef.current,
        base.datasetEpoch,
      ).map((change) => ({ ...change, mutationId }));
      for (const change of changes) {
        const docKey = v2DocKey(base.datasetEpoch, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, change.id);
        pendingMutationByDocKeyRef.current.set(docKey, mutationId);
        optimisticOverlayByDocKeyRef.current.set(docKey, change.kind === 'upsert' ? change.value ?? null : null);
      }
      const acknowledgements = await commitRevisionedDocChanges(projectId, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, changes, clientIdRef.current);
      if (!isV2WriteContextCurrent(context)) return;
      blockedTokenDocsRef.current = mergeAckedDocs(blockedTokenDocsRef.current, acknowledgements, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, base.datasetEpoch);
      const payload = recomposeFromCanonicalRefs();
      if (payload) {
        updateCanonicalCache(payload, collabMetaRef.current);
      }
    }, base.datasetEpoch);
  }, [ensureV2MutationAllowed, isV2WriteContextCurrent, mergeAckedDocs, queueV2Write, recomposeFromCanonicalRefs, updateCanonicalCache, v2DocKey]);

  const persistLabelSectionsV2 = useCallback((sections: LabelSection[]) => {
    const projectId = activeProjectIdRef.current;
    const base = baseSnapshotRef.current;
    if (!projectId || !base || !ensureV2MutationAllowed('Label edits')) return;
    queueV2Write('label sections save', async (context) => {
      const mutationId = createMutationId(clientIdRef.current);
      const changes = buildLabelSectionDocChanges(
        labelSectionDocsRef.current,
        sections,
        clientIdRef.current,
        base.datasetEpoch,
      ).map((change) => ({ ...change, mutationId }));
      for (const change of changes) {
        const docKey = v2DocKey(base.datasetEpoch, PROJECT_LABEL_SECTIONS_SUBCOLLECTION, change.id);
        pendingMutationByDocKeyRef.current.set(docKey, mutationId);
        optimisticOverlayByDocKeyRef.current.set(docKey, change.kind === 'upsert' ? change.value ?? null : null);
      }
      const acknowledgements = await commitRevisionedDocChanges(projectId, PROJECT_LABEL_SECTIONS_SUBCOLLECTION, changes, clientIdRef.current);
      if (!isV2WriteContextCurrent(context)) return;
      labelSectionDocsRef.current = mergeAckedDocs(labelSectionDocsRef.current, acknowledgements, PROJECT_LABEL_SECTIONS_SUBCOLLECTION, base.datasetEpoch);
      const payload = recomposeFromCanonicalRefs();
      if (payload) {
        updateCanonicalCache(payload, collabMetaRef.current);
      }
    }, base.datasetEpoch);
  }, [ensureV2MutationAllowed, isV2WriteContextCurrent, mergeAckedDocs, queueV2Write, recomposeFromCanonicalRefs, updateCanonicalCache, v2DocKey]);

  const persistTokenMergeRulesV2 = useCallback((rules: TokenMergeRule[]) => {
    const projectId = activeProjectIdRef.current;
    const base = baseSnapshotRef.current;
    if (!projectId || !base || !ensureV2MutationAllowed('Token merge edits')) return;
    queueV2Write('token merge rules save', async (context) => {
      const mutationId = createMutationId(clientIdRef.current);
      const changes = buildTokenMergeRuleDocChanges(
        tokenMergeRuleDocsRef.current,
        rules,
        clientIdRef.current,
        base.datasetEpoch,
      ).map((change) => ({ ...change, mutationId }));
      for (const change of changes) {
        const docKey = v2DocKey(base.datasetEpoch, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, change.id);
        pendingMutationByDocKeyRef.current.set(docKey, mutationId);
        optimisticOverlayByDocKeyRef.current.set(docKey, change.kind === 'upsert' ? change.value ?? null : null);
      }
      const acknowledgements = await commitRevisionedDocChanges(projectId, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, changes, clientIdRef.current);
      if (!isV2WriteContextCurrent(context)) return;
      tokenMergeRuleDocsRef.current = mergeAckedDocs(tokenMergeRuleDocsRef.current, acknowledgements, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, base.datasetEpoch);
      const payload = recomposeFromCanonicalRefs();
      if (payload) {
        updateCanonicalCache(payload, collabMetaRef.current);
      }
    }, base.datasetEpoch);
  }, [ensureV2MutationAllowed, isV2WriteContextCurrent, mergeAckedDocs, queueV2Write, recomposeFromCanonicalRefs, updateCanonicalCache, v2DocKey]);

  const persistManualBlockedKeywordsV2 = useCallback((keywords: BlockedKeyword[]) => {
    const projectId = activeProjectIdRef.current;
    const base = baseSnapshotRef.current;
    if (!projectId || !base || !ensureV2MutationAllowed('Blocked-keyword edits')) return;
    queueV2Write('manual blocked keywords save', async (context) => {
      const mutationId = createMutationId(clientIdRef.current);
      const changes = buildManualBlockedKeywordDocChanges(
        manualBlockedKeywordDocsRef.current,
        keywords,
        clientIdRef.current,
        base.datasetEpoch,
      ).map((change) => ({ ...change, mutationId }));
      for (const change of changes) {
        const docKey = v2DocKey(base.datasetEpoch, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, change.id);
        pendingMutationByDocKeyRef.current.set(docKey, mutationId);
        optimisticOverlayByDocKeyRef.current.set(docKey, change.kind === 'upsert' ? change.value ?? null : null);
      }
      const acknowledgements = await commitRevisionedDocChanges(projectId, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, changes, clientIdRef.current);
      if (!isV2WriteContextCurrent(context)) return;
      manualBlockedKeywordDocsRef.current = mergeAckedDocs(manualBlockedKeywordDocsRef.current, acknowledgements, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, base.datasetEpoch);
      const payload = recomposeFromCanonicalRefs();
      if (payload) {
        updateCanonicalCache(payload, collabMetaRef.current);
      }
    }, base.datasetEpoch);
  }, [ensureV2MutationAllowed, isV2WriteContextCurrent, mergeAckedDocs, queueV2Write, recomposeFromCanonicalRefs, updateCanonicalCache, v2DocKey]);

  const persistActivityLogEntryV2 = useCallback((entry: ActivityLogEntry) => {
    const projectId = activeProjectIdRef.current;
    const base = baseSnapshotRef.current;
    if (!projectId || !base || !ensureV2MutationAllowed('Activity-log edits')) return;
    queueV2Write('activity log append', async (context) => {
      const mutationId = createMutationId(clientIdRef.current);
      await appendActivityLogEntry(projectId, entry, clientIdRef.current, base.datasetEpoch, mutationId);
      if (!isV2WriteContextCurrent(context)) return;
      activityLogDocsRef.current = [
        { ...entry, id: activityLogDocId(entry), datasetEpoch: base.datasetEpoch, createdByClientId: clientIdRef.current, mutationId },
        ...activityLogDocsRef.current,
      ].slice(0, 500);
      const payload = recomposeFromCanonicalRefs();
      if (payload) {
        updateCanonicalCache(payload, collabMetaRef.current);
      }
    }, base.datasetEpoch);
  }, [ensureV2MutationAllowed, isV2WriteContextCurrent, queueV2Write, recomposeFromCanonicalRefs, updateCanonicalCache]);

  const replaceActivityLogV2 = useCallback((entries: ActivityLogEntry[]) => {
    const projectId = activeProjectIdRef.current;
    const base = baseSnapshotRef.current;
    if (!projectId || !base || !ensureV2MutationAllowed('Activity-log edits')) return;
    queueV2Write('activity log replace', async (context) => {
      await replaceActivityLog(projectId, entries, clientIdRef.current, base.datasetEpoch);
      if (!isV2WriteContextCurrent(context)) return;
      activityLogDocsRef.current = entries.map((entry) => ({
        ...entry,
        id: activityLogDocId(entry),
        datasetEpoch: base.datasetEpoch,
        createdByClientId: clientIdRef.current,
        mutationId: null,
      }));
      const payload = recomposeFromCanonicalRefs();
      if (payload) {
        updateCanonicalCache(payload, collabMetaRef.current);
      }
    }, base.datasetEpoch);
  }, [ensureV2MutationAllowed, isV2WriteContextCurrent, queueV2Write, recomposeFromCanonicalRefs, updateCanonicalCache]);

  // ── Project lifecycle ─────────────────────────────────────────────────

  const setActiveProjectId = useCallback((id: string | null) => {
    activeProjectIdRef.current = id;
    projectStorageModeResolvedRef.current = Boolean(id);
    setActiveProjectIdState(id);
  }, []);

  const loadProject = useCallback(async (projectId: string, projectList: Project[]) => {
    projectLoadingRef.current = true;
    projectStorageModeResolvedRef.current = false;
    const loadTraceId = beginRuntimeTrace('useProjectPersistence.loadProject', projectId, {
      activeProjectId: activeProjectIdRef.current,
      projectCount: projectList.length,
    });
    const project = projectList.find(p => p.id === projectId);
    const canonicalCache = await loadCanonicalCacheFromIDB(projectId);
    const idbData = canonicalCache?.payload ?? await loadProjectDataFromIDBOnly(projectId);
    traceRuntimeEvent({
      traceId: loadTraceId,
      event: 'load:idb-stage-finished',
      source: 'useProjectPersistence.loadProject',
      projectId,
      data: {
        hasCanonicalCache: !!canonicalCache,
        hasIdbData: !!idbData,
        activeProjectId: activeProjectIdRef.current,
      },
    });
    if (activeProjectIdRef.current !== projectId) {
      projectLoadingRef.current = false;
      return;
    }
    if (idbData) {
      applyViewState(toProjectViewState(idbData, project, { skipRebuild: true }));
    }

    const canonical = await loadCanonicalProjectState(
      projectId,
      clientIdRef.current,
      async () => idbData ?? loadProjectDataForView(projectId),
    ).catch((error) => {
      traceRuntimeEvent({
        traceId: loadTraceId,
        event: 'load:canonical-error',
        source: 'useProjectPersistence.loadProject',
        projectId,
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    });
    traceRuntimeEvent({
      traceId: loadTraceId,
      event: 'load:canonical-resolved',
      source: 'useProjectPersistence.loadProject',
      projectId,
      data: {
        mode: canonical.mode,
        hasResolved: !!canonical.resolved,
        activeProjectId: activeProjectIdRef.current,
      },
    });

    if (activeProjectIdRef.current !== projectId) {
      projectLoadingRef.current = false;
      return;
    }

    if (canonical.mode === 'v2') {
      setStorageMode('v2');
      storageModeRef.current = 'v2';
      projectStorageModeResolvedRef.current = true;
      applyCanonicalState(canonical);
      if (canonical.resolved) {
        const viewState = toProjectViewState(canonical.resolved, project);
        loadFenceRef.current = countGroupedPages(viewState);
        v2RecoveryModeRef.current = false;
        if (canonical.entities.meta) {
          updateCanonicalCache(canonical.resolved, canonical.entities.meta);
        }
      } else {
        v2RecoveryModeRef.current = true;
        if (!idbData) {
          applyViewState(createEmptyProjectViewState());
          loadFenceRef.current = 0;
        }
        const recoveryDiagnostics = canonical.diagnostics?.recovery;
        const recoveryBlockedByPermissions = recoveryDiagnostics?.outcome === 'failed' && recoveryDiagnostics.code === 'permission-denied';
        addToastRef.current(
          recoveryBlockedByPermissions
            ? 'Shared project recovery is blocked by Firestore permissions. Edits are temporarily read-only until the shared rules or deployment are repaired.'
            : 'Shared project is recovering from an incomplete cloud commit. Edits are temporarily read-only.',
          'warning',
        );
      }
    } else {
      collabMetaRef.current = null;
      legacyWritesBlockedRef.current = false;
      setStorageMode('legacy');
      storageModeRef.current = 'legacy';
      projectStorageModeResolvedRef.current = true;
      v2RecoveryModeRef.current = false;
      const data = canonical.resolved ?? idbData;
      const viewState = data ? toProjectViewState(data, project) : createEmptyProjectViewState();
      applyViewState(viewState);
      const loadedSaveId = data?.lastSaveId ?? 0;
      if (loadedSaveId > saveCounterRef.current) {
        saveCounterRef.current = loadedSaveId;
      }
      loadFenceRef.current = countGroupedPages(viewState);
    }

    projectLoadingRef.current = false;
    traceRuntimeEvent({
      traceId: loadTraceId,
      event: 'load:complete',
      source: 'useProjectPersistence.loadProject',
      projectId,
      data: { activeProjectId: activeProjectIdRef.current },
    });
    return;
    /*

    // ── Phase 1: IDB-first fast path (~5ms) ──────────────────────────────
    // Show cached data instantly. Reconcile with Firestore in background.



      const viewState = toProjectViewState(idbData, project, { skipRebuild: true });
      applyViewState(viewState);

      const loadedSaveId = idbData.lastSaveId ?? 0;
      if (loadedSaveId > saveCounterRef.current) {
        saveCounterRef.current = loadedSaveId;
      }
      loadFenceRef.current = countGroupedPages(viewState);

      // Phase 1 done — spinner can disappear, data is visible.
      projectLoadingRef.current = false;

      // ── Phase 2: Background Firestore reconciliation (fire-and-forget) ──
      // The onSnapshot listener handles real-time sync going forward.
      // This is a safety net for when IDB is stale and the first snapshot
      // was suppressed by the projectLoading guard during Phase 1.
      const saveIdAtLoad = saveCounterRef.current;
      reconcileWithFirestore(projectId, idbData)
        .then((result) => {
          if (activeProjectIdRef.current !== projectId) return;   // user switched projects
          if (saveCounterRef.current > saveIdAtLoad) return;      // user edited or onSnapshot advanced
          if (result.action === 'update' && result.data) {
            const fsSaveId = result.data.lastSaveId ?? 0;
            if (fsSaveId <= saveCounterRef.current) return;       // already up to date
            const fsViewState = toProjectViewState(result.data, project);
            applyViewState(fsViewState);
            saveCounterRef.current = fsSaveId;
            const fsTotal = countGroupedPages(fsViewState);
            if (fsTotal > loadFenceRef.current) loadFenceRef.current = fsTotal;
          }
        })
        .catch((err) => {
          console.warn('[PERSIST] Background Firestore reconciliation failed:', err);
        });

      return;
    }

    // ── Fallback: No IDB cache — blocking load from both sources ────────
    const data = await loadProjectDataForView(projectId);
    const viewState = data ? toProjectViewState(data, project) : createEmptyProjectViewState();
    applyViewState(viewState);

    const loadedSaveId = data?.lastSaveId ?? 0;
    if (loadedSaveId > saveCounterRef.current) {
      saveCounterRef.current = loadedSaveId;
    }
    loadFenceRef.current = countGroupedPages(viewState);

    projectLoadingRef.current = false;
    */
  }, [applyCanonicalState, applyViewState, updateCanonicalCache]);

  const clearProject = useCallback(() => {
    // Cancel any pending flushes so stale mutations from the previous project
    // don't persist empty state to the NEW project's IDB/Firestore slot.
    needsPersistFlushRef.current = false;
    pendingV2WriteRef.current = Promise.resolve();
    pendingV2LocalRef.current = Promise.resolve();
    baseSnapshotRef.current = null;
    collabMetaRef.current = null;
    activeEpochRef.current = null;
    epochLoadGenerationRef.current += 1;
    epochLoadAbortRef.current?.abort();
    epochLoadAbortRef.current = null;
    entityListenersCleanupRef.current?.();
    entityListenersCleanupRef.current = null;
    serverRevisionByDocKeyRef.current.clear();
    pendingMutationByDocKeyRef.current.clear();
    optimisticOverlayByDocKeyRef.current.clear();
    lastAckedMutationByDocKeyRef.current.clear();
    groupDocsRef.current = [];
    blockedTokenDocsRef.current = [];
    manualBlockedKeywordDocsRef.current = [];
    tokenMergeRuleDocsRef.current = [];
    labelSectionDocsRef.current = [];
    activityLogDocsRef.current = [];
    legacyWritesBlockedRef.current = false;
    v2RecoveryModeRef.current = false;
    projectStorageModeResolvedRef.current = false;
    lockHeartbeatLostRef.current = false;
    lastV2WriteErrorRef.current = null;
    lastV2LocalErrorRef.current = null;
    lastV2LocalErrorRef.current = null;
    clearListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
    if (lockHeartbeatTimerRef.current) {
      clearInterval(lockHeartbeatTimerRef.current);
      lockHeartbeatTimerRef.current = null;
    }
    setStorageMode('legacy');
    storageModeRef.current = 'legacy';
    setActiveOperation(null);
    activeOperationRef.current = null;
    applyViewState(createEmptyProjectViewState());
  }, [applyViewState]);

  const syncFileNameLocal = useCallback((name: string | null) => {
    latest.current = { ...latest.current, fileName: name };
    setFileName(name);
  }, []);

  // ── onSnapshot listener for project chunks ────────────────────────────
  // projectsRef defined above (with other refs) so the listener isn't torn down/recreated
  // when projects changes — recreating it fires immediately with potentially stale Firestore
  // state, which wipes in-flight data (e.g. CSV upload results not yet saved to Firestore).
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    if (storageMode !== 'legacy') return;
    const ourClientId = clientIdRef.current;
    const unsub = onSnapshot(
      collection(db, 'projects', pid, 'chunks'),
      (snap) => {
        markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
        const traceId = activePersistTraceRef.current;
        if (traceId) {
          traceRuntimeEvent({
            traceId,
            event: 'snapshot:received',
            source: 'useProjectPersistence.projectChunksSnapshot',
            projectId: pid,
            data: {
              fromCache: Boolean(snap.metadata?.fromCache),
              hasPendingWrites: Boolean(snap.metadata?.hasPendingWrites),
              docCount: snap.docs.length,
              isProjectLoading: projectLoadingRef.current,
              isFlushing: isFlushingRef.current,
            },
          });
        }

        const metaDoc = snap.docs.find((d) => (d.data() as any)?.type === 'meta');
        const meta = metaDoc ? (metaDoc.data() as any) : null;
        const data = snap.empty ? null : buildProjectDataPayloadFromChunkDocs(snap.docs);

        const guardResult = evaluateSnapshotGuards({
          hasPendingWrites: Boolean(snap.metadata?.hasPendingWrites),
          isProjectLoading: projectLoadingRef.current,
          isFlushing: isFlushingRef.current,
          metaClientId: meta?.clientId ?? null,
          ourClientId,
          dataExists: data != null,
          localResults: latest.current.results?.length ?? 0,
          localGroupedCount: latest.current.groupedClusters.length,
          localApprovedCount: latest.current.approvedGroups.length,
          localClusterCount: latest.current.clusterSummary?.length ?? 0,
          incomingGroupedChunkCount:
            typeof meta?.groupedClusterCount === 'number' ? meta.groupedClusterCount : null,
          incomingApprovedChunkCount:
            typeof meta?.approvedGroupCount === 'number' ? meta.approvedGroupCount : null,
          incomingDataGroupedCount: data?.groupedClusters?.length ?? 0,
          incomingDataApprovedCount: data?.approvedGroups?.length ?? 0,
          incomingResultsCount: data?.results?.length ?? 0,
          incomingClusterCount: data?.clusterSummary?.length ?? 0,
          loadFence: loadFenceRef.current,
          incomingGroupedPageMass: data ? groupedPageMass(data) : 0,
          incomingSaveId: data?.lastSaveId ?? 0,
          localSaveId: saveCounterRef.current,
          incomingFromCache: Boolean(snap.metadata?.fromCache),
        });

        if (guardResult.action === 'skip') {
          if (traceId) {
            traceRuntimeEvent({
              traceId,
              event: 'snapshot:guard-skip',
              source: 'useProjectPersistence.projectChunksSnapshot',
              projectId: pid,
              data: {
                guard: guardResult.guard,
                fromCache: Boolean(snap.metadata?.fromCache),
                hasPendingWrites: Boolean(snap.metadata?.hasPendingWrites),
              },
            });
          }
          if (guardResult.guard.startsWith('6:') || guardResult.guard.startsWith('3:') || guardResult.guard.startsWith('5:')) {
            console.warn('[PERSIST] Snapshot rejected by guard:', guardResult.guard);
          }
          return;
        }

        // Guard 5 side-effect: clear load fence when snapshot passes it
        if (data && loadFenceRef.current > 0) {
          loadFenceRef.current = 0;
        }

        const project = projectsRef.current.find(p => p.id === pid);

        applyViewState(
          data ? toProjectViewState(data, project) : createEmptyProjectViewState()
        );
        if (traceId) {
          traceRuntimeEvent({
            traceId,
            event: 'snapshot:applied',
            source: 'useProjectPersistence.projectChunksSnapshot',
            projectId: pid,
            data: {
              incomingSaveId: data?.lastSaveId ?? 0,
              localSaveId: saveCounterRef.current,
              incomingGroupedCount: data?.groupedClusters?.length ?? 0,
              incomingApprovedCount: data?.approvedGroups?.length ?? 0,
            },
          });
        }
        // Advance saveCounterRef so subsequent local mutations produce IDs
        // higher than the remote snapshot. Without this, a local edit after a
        // remote apply could have a LOWER saveId than Firestore, causing
        // pickNewerProjectPayload to discard it on refresh.
        if (data) {
          const incomingSaveId = data.lastSaveId ?? 0;
          if (incomingSaveId > saveCounterRef.current) {
            saveCounterRef.current = incomingSaveId;
          }
        }
        // Only cache remote snapshot to IDB when it's at least as new as local
        // state. Otherwise a stale echo overwrites the correct IDB checkpoint
        // from mutateAndSave, causing data loss on next refresh.
        // SAFETY: Never cache a completely empty snapshot to IDB — it's a
        // corruption artifact from a clearProject race, not real user data.
        if (data && pid) {
          const incomingSaveId = data.lastSaveId ?? 0;
          const localSaveId = saveCounterRef.current;
          const incomingHasData = (data.results?.length ?? 0) > 0 ||
            (data.groupedClusters?.length ?? 0) > 0 ||
            (data.approvedGroups?.length ?? 0) > 0;
          if (incomingSaveId >= localSaveId && incomingHasData) {
            saveToIDB(pid, data).catch((err) =>
              logPersistError('IDB cache after remote snapshot', err),
            );
          }
        }
      },
      (err) => {
        markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
        reportPersistFailure(addToastRef.current, 'project chunks listener', err);
      },
    );
    return () => {
      clearListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
      if (typeof unsub === 'function') unsub();
    };
  }, [activeProjectId, applyViewState, storageMode]);

  useEffect(() => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    if (storageMode !== 'v2') return;
    const listenerProjectId = pid;
    const mergeRevisionedDocs = <T extends { id: string; revision?: number; lastMutationId?: string | null }>(
      current: T[],
      changes: Array<{ type: string; doc: { id: string; data: () => unknown } }>,
      subcollection: string,
      datasetEpoch: number,
    ): { docs: T[]; changed: boolean } => {
      const next = new Map(current.map((item) => [item.id, item]));
      let changed = false;
      for (const change of changes) {
        const raw = change.doc.data() as Record<string, unknown>;
        const logicalId = typeof raw.id === 'string'
          ? raw.id
          : change.doc.id.includes('::')
            ? change.doc.id.slice(change.doc.id.lastIndexOf('::') + 2)
            : change.doc.id;
        const docKey = v2DocKey(datasetEpoch, subcollection, logicalId);
        if (change.type === 'removed') {
          if (next.delete(logicalId)) changed = true;
          serverRevisionByDocKeyRef.current.delete(docKey);
          pendingMutationByDocKeyRef.current.delete(docKey);
          optimisticOverlayByDocKeyRef.current.delete(docKey);
          continue;
        }

        const incoming = { id: logicalId, ...(raw as object) } as T;
        const existing = next.get(logicalId);
        const incomingRevision = typeof incoming.revision === 'number' ? incoming.revision : 0;
        const existingRevision = typeof existing?.revision === 'number' ? existing.revision : 0;
        const ackedMutationId = lastAckedMutationByDocKeyRef.current.get(docKey);

        if (existing && incomingRevision < existingRevision) continue;
        if (existing && incomingRevision === existingRevision && incoming.lastMutationId === existing.lastMutationId) continue;
        if (ackedMutationId && incoming.lastMutationId === ackedMutationId && incomingRevision <= existingRevision) continue;

        next.set(logicalId, incoming);
        serverRevisionByDocKeyRef.current.set(docKey, incomingRevision);
        pendingMutationByDocKeyRef.current.delete(docKey);
        optimisticOverlayByDocKeyRef.current.delete(docKey);
        if (typeof incoming.lastMutationId !== 'undefined') {
          lastAckedMutationByDocKeyRef.current.set(docKey, incoming.lastMutationId ?? null);
        }
        changed = true;
      }
      return { docs: Array.from(next.values()), changed };
    };

    const attachEpochListeners = (datasetEpoch: number, listenerMeta: ProjectCollabMetaDoc) => {
      entityListenersCleanupRef.current?.();
      const listenerGeneration = epochLoadGenerationRef.current;
      const isEntityListenerCurrent = () =>
        activeProjectIdRef.current === listenerProjectId &&
        epochLoadGenerationRef.current === listenerGeneration;
      const cacheCanonicalView = () => {
        if (!isEntityListenerCurrent()) return;
        const currentMeta = collabMetaRef.current;
        if (!currentMeta || currentMeta.readMode !== 'v2') return;
        if (currentMeta.datasetEpoch !== datasetEpoch) return;
        if (currentMeta.baseCommitId !== listenerMeta.baseCommitId) return;
        const payload = recomposeFromCanonicalRefs();
        if (payload) {
          updateCanonicalCache(payload, currentMeta);
        }
      };

      const listeners = [
        onSnapshot(
          query(collection(db, 'projects', pid, PROJECT_GROUPS_SUBCOLLECTION), where('datasetEpoch', '==', datasetEpoch)),
          (snap) => {
            if (!isEntityListenerCurrent()) return;
            markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
            if (snap.metadata?.hasPendingWrites) return;
            const merged = mergeRevisionedDocs(groupDocsRef.current, snap.docChanges() as any, PROJECT_GROUPS_SUBCOLLECTION, datasetEpoch);
            if (!merged.changed) return;
            groupDocsRef.current = merged.docs;
            cacheCanonicalView();
          },
          (err) => {
            markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
            reportPersistFailure(addToastRef.current, 'project groups listener', err);
          },
        ),
        onSnapshot(
          query(collection(db, 'projects', pid, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION), where('datasetEpoch', '==', datasetEpoch)),
          (snap) => {
            if (!isEntityListenerCurrent()) return;
            markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
            if (snap.metadata?.hasPendingWrites) return;
            const merged = mergeRevisionedDocs(blockedTokenDocsRef.current, snap.docChanges() as any, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, datasetEpoch);
            if (!merged.changed) return;
            blockedTokenDocsRef.current = merged.docs;
            cacheCanonicalView();
          },
          (err) => {
            markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
            reportPersistFailure(addToastRef.current, 'blocked tokens listener', err);
          },
        ),
        onSnapshot(
          query(collection(db, 'projects', pid, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION), where('datasetEpoch', '==', datasetEpoch)),
          (snap) => {
            if (!isEntityListenerCurrent()) return;
            markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
            if (snap.metadata?.hasPendingWrites) return;
            const merged = mergeRevisionedDocs(manualBlockedKeywordDocsRef.current, snap.docChanges() as any, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, datasetEpoch);
            if (!merged.changed) return;
            manualBlockedKeywordDocsRef.current = merged.docs;
            cacheCanonicalView();
          },
          (err) => {
            markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
            reportPersistFailure(addToastRef.current, 'manual blocked keywords listener', err);
          },
        ),
        onSnapshot(
          query(collection(db, 'projects', pid, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION), where('datasetEpoch', '==', datasetEpoch)),
          (snap) => {
            if (!isEntityListenerCurrent()) return;
            markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
            if (snap.metadata?.hasPendingWrites) return;
            const merged = mergeRevisionedDocs(tokenMergeRuleDocsRef.current, snap.docChanges() as any, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, datasetEpoch);
            if (!merged.changed) return;
            tokenMergeRuleDocsRef.current = merged.docs;
            cacheCanonicalView();
          },
          (err) => {
            markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
            reportPersistFailure(addToastRef.current, 'token merge rules listener', err);
          },
        ),
        onSnapshot(
          query(collection(db, 'projects', pid, PROJECT_LABEL_SECTIONS_SUBCOLLECTION), where('datasetEpoch', '==', datasetEpoch)),
          (snap) => {
            if (!isEntityListenerCurrent()) return;
            markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
            if (snap.metadata?.hasPendingWrites) return;
            const merged = mergeRevisionedDocs(labelSectionDocsRef.current, snap.docChanges() as any, PROJECT_LABEL_SECTIONS_SUBCOLLECTION, datasetEpoch);
            if (!merged.changed) return;
            labelSectionDocsRef.current = merged.docs;
            cacheCanonicalView();
          },
          (err) => {
            markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
            reportPersistFailure(addToastRef.current, 'label sections listener', err);
          },
        ),
        onSnapshot(
          query(collection(db, 'projects', pid, PROJECT_ACTIVITY_LOG_SUBCOLLECTION), where('datasetEpoch', '==', datasetEpoch)),
          (snap) => {
            if (!isEntityListenerCurrent()) return;
            markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
            if (snap.metadata?.hasPendingWrites) return;
            const merged = mergeRevisionedDocs(activityLogDocsRef.current as Array<ProjectActivityLogDoc & { revision?: number; lastMutationId?: string | null }>, snap.docChanges() as any, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, datasetEpoch);
            if (!merged.changed) return;
            activityLogDocsRef.current = merged.docs as ProjectActivityLogDoc[];
            cacheCanonicalView();
          },
          (err) => {
            markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
            reportPersistFailure(addToastRef.current, 'activity log listener', err);
          },
        ),
      ];

      entityListenersCleanupRef.current = () => {
        for (const unsubscribe of listeners) unsubscribe();
      };
    };

    const initialMeta = collabMetaRef.current;
    if (
      initialMeta &&
      initialMeta.readMode === 'v2' &&
      initialMeta.commitState === 'ready' &&
      initialMeta.migrationState === 'complete'
    ) {
      attachEpochListeners(initialMeta.datasetEpoch, initialMeta);
    }

    let cancelled = false;

    const metaUnsub = onSnapshot(
      doc(db, 'projects', pid, PROJECT_COLLAB_META_COLLECTION, PROJECT_COLLAB_META_DOC),
      (snap) => {
        if (activeProjectIdRef.current !== listenerProjectId) return;
        markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
        if (snap.metadata?.hasPendingWrites) return;
        const nextMeta = snap.exists() ? (snap.data() as ProjectCollabMetaDoc) : null;
        const previousMeta = collabMetaRef.current;
        collabMetaRef.current = nextMeta;
        legacyWritesBlockedRef.current = Boolean(
          nextMeta &&
          nextMeta.readMode === 'v2' &&
          (nextMeta.requiredClientSchema ?? CLIENT_SCHEMA_VERSION) > CLIENT_SCHEMA_VERSION,
        );
        if (!nextMeta || nextMeta.readMode !== 'v2') {
          v2RecoveryModeRef.current = false;
          return;
        }
        if (legacyWritesBlockedRef.current) {
          v2RecoveryModeRef.current = false;
          return;
        }
        if (
          previousMeta &&
          previousMeta.revision === nextMeta.revision &&
          previousMeta.datasetEpoch === nextMeta.datasetEpoch &&
          previousMeta.baseCommitId === nextMeta.baseCommitId &&
          previousMeta.commitState === nextMeta.commitState
        ) {
          return;
        }

        const generation = epochLoadGenerationRef.current + 1;
        epochLoadGenerationRef.current = generation;
        epochLoadAbortRef.current?.abort();
        const abortController = new AbortController();
        epochLoadAbortRef.current = abortController;
        v2RecoveryModeRef.current = true;
        void loadCanonicalEpoch(pid, nextMeta).then((canonical) => {
          if (
            cancelled ||
            abortController.signal.aborted ||
            generation !== epochLoadGenerationRef.current ||
            activeProjectIdRef.current !== pid ||
            !canonical ||
            !canonical.resolved
          ) {
            return;
          }
          applyCanonicalState(canonical);
          if (canonical.entities.meta && canonical.resolved) {
            updateCanonicalCache(canonical.resolved, canonical.entities.meta);
          }
          attachEpochListeners(nextMeta.datasetEpoch, nextMeta);
        }).catch((err) => {
          if (abortController.signal.aborted) {
            return;
          }
          reportPersistFailure(addToastRef.current, 'project collab meta listener', err);
        });
      },
      (err) => {
        markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
        reportPersistFailure(addToastRef.current, 'project collab meta listener', err);
      },
    );

    const operationUnsub = onSnapshot(
      doc(db, 'projects', pid, PROJECT_OPERATIONS_SUBCOLLECTION, PROJECT_OPERATION_CURRENT_DOC),
      (snap) => {
        if (activeProjectIdRef.current !== listenerProjectId) return;
        markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);
        if (snap.metadata?.hasPendingWrites) return;
        const rawOperation = snap.exists() ? (snap.data() as ProjectOperationLockDoc) : null;
        const nextOperation = (
          rawOperation &&
          rawOperation.status !== 'releasing' &&
          Date.parse(rawOperation.expiresAt || '0') > Date.now()
        ) ? rawOperation : null;
        activeOperationRef.current = nextOperation;
        setActiveOperation(nextOperation);
      },
      (err) => {
        markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
        reportPersistFailure(addToastRef.current, 'project operation listener', err);
      },
    );

    return () => {
      cancelled = true;
      epochLoadGenerationRef.current += 1;
      epochLoadAbortRef.current?.abort();
      epochLoadAbortRef.current = null;
      entityListenersCleanupRef.current?.();
      entityListenersCleanupRef.current = null;
      metaUnsub();
      operationUnsub();
      clearListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
    };
  }, [activeProjectId, applyCanonicalState, recomposeFromCanonicalRefs, storageMode, updateCanonicalCache, v2DocKey]);

  // ── Atomic mutation functions ─────────────────────────────────────────

  const addGroupsAndRemovePages = useCallback((newGroups: GroupedCluster[], removedTokens: Set<string>) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Group edits')) return;
      const s = latest.current;
      const nextGrouped = [...s.groupedClusters, ...newGroups];
      const nextClusters = s.clusterSummary?.filter(c => !removedTokens.has(c.tokens)) || null;
      const nextResults = s.results?.filter(r => !removedTokens.has(r.tokens)) || null;
      applyLocalChanges({
        groupedClusters: nextGrouped,
        clusterSummary: nextClusters,
        results: nextResults,
      }, { checkpoint: true });
      persistGroupsV2(nextGrouped, s.approvedGroups);
      return;
    }
    mutateAndSave(s => {
      const nextGrouped = [...s.groupedClusters, ...newGroups];
      const nextClusters = s.clusterSummary?.filter(c => !removedTokens.has(c.tokens)) || null;
      const nextResults = s.results?.filter(r => !removedTokens.has(r.tokens)) || null;
      return { groupedClusters: nextGrouped, clusterSummary: nextClusters, results: nextResults };
    });
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistGroupsV2]);

  const mergeGroupsByName = useCallback((opts: MergeGroupsByNameOpts) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Group edits')) return;
      const s = latest.current;
      const merged = opts.mergeFn(s.groupedClusters, opts.incoming, opts.hasReviewApi);
      const nextClusters = s.clusterSummary?.filter(c => !opts.removedTokens.has(c.tokens)) || null;
      const nextResults = s.results?.filter(r => !opts.removedTokens.has(r.tokens)) || null;
      applyLocalChanges({
        groupedClusters: merged,
        clusterSummary: nextClusters,
        results: nextResults,
      }, { checkpoint: true });
      persistGroupsV2(merged, s.approvedGroups);
      return;
    }
    mutateAndSave(s => {
      const merged = opts.mergeFn(s.groupedClusters, opts.incoming, opts.hasReviewApi);
      const nextClusters = s.clusterSummary?.filter(c => !opts.removedTokens.has(c.tokens)) || null;
      const nextResults = s.results?.filter(r => !opts.removedTokens.has(r.tokens)) || null;
      return { groupedClusters: merged, clusterSummary: nextClusters, results: nextResults };
    });
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistGroupsV2]);

  const updateGroups = useCallback((updaterOrValue: ((groups: GroupedCluster[]) => GroupedCluster[]) | GroupedCluster[], approvedOverride?: GroupedCluster[]) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Group edits')) return;
      const s = latest.current;
      const nextGrouped = typeof updaterOrValue === 'function'
        ? updaterOrValue(s.groupedClusters)
        : updaterOrValue;
      const nextApproved = approvedOverride !== undefined ? approvedOverride : s.approvedGroups;
      applyLocalChanges({
        groupedClusters: nextGrouped,
        approvedGroups: nextApproved,
      }, { checkpoint: true });
      persistGroupsV2(nextGrouped, nextApproved);
      return;
    }
    mutateAndSave(s => {
      const nextGrouped = typeof updaterOrValue === 'function'
        ? updaterOrValue(s.groupedClusters)
        : updaterOrValue;
      const changes: Partial<PersistedState> = { groupedClusters: nextGrouped };
      if (approvedOverride !== undefined) changes.approvedGroups = approvedOverride;
      return changes;
    });
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistGroupsV2]);

  const approveGroup = useCallback((groupName: string): GroupedCluster | null => {
    const s = latest.current;
    const group = s.groupedClusters.find(g => g.groupName === groupName);
    if (!group) return null;
    const nextGrouped = s.groupedClusters.filter(g => g.groupName !== groupName);
    const nextApproved = [...s.approvedGroups, group];
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Group edits')) return group;
      applyLocalChanges({ groupedClusters: nextGrouped, approvedGroups: nextApproved }, { checkpoint: true });
      persistGroupsV2(nextGrouped, nextApproved);
      return group;
    }
    mutateAndSave(() => ({ groupedClusters: nextGrouped, approvedGroups: nextApproved }));
    return group;
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistGroupsV2]);

  const unapproveGroup = useCallback((groupName: string): GroupedCluster | null => {
    const s = latest.current;
    const group = s.approvedGroups.find(g => g.groupName === groupName);
    if (!group) return null;
    const nextApproved = s.approvedGroups.filter(g => g.groupName !== groupName);
    const nextGrouped = [...s.groupedClusters, group];
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Group edits')) return group;
      applyLocalChanges({ approvedGroups: nextApproved, groupedClusters: nextGrouped }, { checkpoint: true });
      persistGroupsV2(nextGrouped, nextApproved);
      return group;
    }
    mutateAndSave(() => ({ approvedGroups: nextApproved, groupedClusters: nextGrouped }));
    return group;
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistGroupsV2]);

  const removeFromApproved = useCallback((
    groupIds: Set<string>,
    subKeys: Set<string>,
    recalc: RecalcFn,
  ) => {
    const s = latest.current;
    let newApproved = [...s.approvedGroups];
    const clustersToReturn: ClusterSummary[] = [];
    const groupsToReturn: GroupedCluster[] = [];

    // Entire groups being removed — restore whole groups to Grouped tab only (not clusterSummary)
    for (const gId of groupIds) {
      const group = newApproved.find(g => g.id === gId);
      if (group) {
        groupsToReturn.push(group);
      }
    }
    newApproved = newApproved.filter(g => !groupIds.has(g.id));

    // Individual sub-clusters being removed — return those pages to clusterSummary + results
    for (const subKey of subKeys) {
      const parsed = parseSubClusterKey(subKey);
      if (!parsed) continue;
      const { groupId, clusterTokens } = parsed;
      if (groupIds.has(groupId)) continue;
      const groupIdx = newApproved.findIndex(g => g.id === groupId);
      if (groupIdx === -1) continue;
      const group = newApproved[groupIdx];
      const cluster = group.clusters.find(c => c.tokens === clusterTokens);
      if (cluster) {
        clustersToReturn.push(cluster);
        const remaining = group.clusters.filter(c => c.tokens !== clusterTokens);
        if (remaining.length === 0) {
          newApproved.splice(groupIdx, 1);
        } else {
          newApproved[groupIdx] = recalc(group, remaining);
        }
      }
    }

    const { clustersToAppend, duplicateTokens } = getUniqueClustersToRestore(
      s.clusterSummary,
      clustersToReturn,
    );
    if (duplicateTokens.length > 0) {
      console.warn('[PERSIST] Prevented duplicate approved restore for tokens:', duplicateTokens);
    }

    const nextGrouped = groupsToReturn.length > 0
      ? [...s.groupedClusters, ...groupsToReturn]
      : s.groupedClusters;

    const nextClusters = clustersToAppend.length > 0
      ? [...(s.clusterSummary || []), ...clustersToAppend]
      : s.clusterSummary;

    let nextResults = s.results;
    if (s.results && clustersToAppend.length > 0) {
      nextResults = appendResultRowsRemoveFromApproved(s.results, clustersToAppend);
    }

    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Group edits')) {
        return { clustersReturned: clustersToReturn, groupsReturned: groupsToReturn };
      }
      applyLocalChanges({
        approvedGroups: newApproved,
        groupedClusters: nextGrouped,
        clusterSummary: nextClusters,
        results: nextResults,
      }, { checkpoint: true });
      persistGroupsV2(nextGrouped, newApproved);
      return { clustersReturned: clustersToReturn, groupsReturned: groupsToReturn };
    }

    mutateAndSave(() => ({
      approvedGroups: newApproved,
      groupedClusters: nextGrouped,
      clusterSummary: nextClusters,
      results: nextResults,
    }));

    return { clustersReturned: clustersToReturn, groupsReturned: groupsToReturn };
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistGroupsV2]);

  const ungroupPages = useCallback((
    groupIds: Set<string>,
    subKeys: Set<string>,
    recalc: RecalcFn,
  ) => {
    const s = latest.current;
    let newGrouped = [...s.groupedClusters];
    const clustersToReturn: ClusterSummary[] = [];
    const groupsWithPartialRemoval: string[] = [];

    // Entire groups
    for (const gId of groupIds) {
      const group = newGrouped.find(g => g.id === gId);
      if (group) clustersToReturn.push(...group.clusters);
    }
    newGrouped = newGrouped.filter(g => !groupIds.has(g.id));

    // Individual sub-clusters
    for (const subKey of subKeys) {
      const parsed = parseSubClusterKey(subKey);
      if (!parsed) continue;
      const { groupId, clusterTokens } = parsed;
      if (groupIds.has(groupId)) continue;
      const groupIdx = newGrouped.findIndex(g => g.id === groupId);
      if (groupIdx === -1) continue;
      const group = newGrouped[groupIdx];
      const cluster = group.clusters.find(c => c.tokens === clusterTokens);
      if (cluster) {
        clustersToReturn.push(cluster);
        const remaining = group.clusters.filter(c => c.tokens !== clusterTokens);
        if (remaining.length === 0) {
          newGrouped.splice(groupIdx, 1);
        } else {
          newGrouped[groupIdx] = recalc(group, remaining);
          groupsWithPartialRemoval.push(group.id);
        }
      }
    }

    const { clustersToAppend, duplicateTokens } = getUniqueClustersToRestore(
      s.clusterSummary,
      clustersToReturn,
    );
    if (duplicateTokens.length > 0) {
      console.warn('[PERSIST] Prevented duplicate ungroup restore for tokens:', duplicateTokens);
    }

    const nextClusters = clustersToAppend.length > 0
      ? [...(s.clusterSummary || []), ...clustersToAppend]
      : s.clusterSummary;

    let nextResults = s.results;
    if (s.results && clustersToAppend.length > 0) {
      nextResults = appendResultRowsUngroup(s.results, clustersToAppend);
    }

    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Group edits')) {
        return { clustersReturned: clustersToReturn, groupsWithPartialRemoval };
      }
      applyLocalChanges({
        groupedClusters: newGrouped,
        clusterSummary: nextClusters,
        results: nextResults,
      }, { checkpoint: true });
      persistGroupsV2(newGrouped, s.approvedGroups);
      return { clustersReturned: clustersToReturn, groupsWithPartialRemoval };
    }

    mutateAndSave(() => ({
      groupedClusters: newGrouped,
      clusterSummary: nextClusters,
      results: nextResults,
    }));

    return { clustersReturned: clustersToReturn, groupsWithPartialRemoval };
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistGroupsV2]);

  const blockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Blocked-token edits')) return;
      const next = new Set(latest.current.blockedTokens);
      tokens.forEach(t => next.add(t));
      applyLocalChanges({ blockedTokens: next }, { checkpoint: true });
      persistBlockedTokensV2(next);
      return;
    }
    mutateAndSave(s => {
      const next = new Set(s.blockedTokens);
      tokens.forEach(t => next.add(t));
      return { blockedTokens: next };
    });
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistBlockedTokensV2]);

  const unblockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Blocked-token edits')) return;
      const next = new Set(latest.current.blockedTokens);
      tokens.forEach(t => next.delete(t));
      applyLocalChanges({ blockedTokens: next }, { checkpoint: true });
      persistBlockedTokensV2(next);
      return;
    }
    mutateAndSave(s => {
      const next = new Set(s.blockedTokens);
      tokens.forEach(t => next.delete(t));
      return { blockedTokens: next };
    });
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistBlockedTokensV2]);

  const applyMergeCascade = useCallback((cascade: {
    results: ProcessedRow[] | null;
    clusterSummary: ClusterSummary[] | null;
    tokenSummary: TokenSummary[] | null;
    groupedClusters: GroupedCluster[];
    approvedGroups: GroupedCluster[];
  }, newRule: TokenMergeRule) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Token merge edits')) return;
      const payload = buildPayload({
        results: cascade.results,
        clusterSummary: cascade.clusterSummary,
        tokenSummary: cascade.tokenSummary,
        groupedClusters: cascade.groupedClusters,
        approvedGroups: cascade.approvedGroups,
        tokenMergeRules: [...latest.current.tokenMergeRules, newRule],
      });
      applyViewState(toProjectViewState(payload));
      persistCanonicalPayloadV2(payload, { requireOwnedLock: true });
      return;
    }
    mutateAndSave(s => ({
      results: cascade.results,
      clusterSummary: cascade.clusterSummary,
      tokenSummary: cascade.tokenSummary,
      groupedClusters: cascade.groupedClusters,
      approvedGroups: cascade.approvedGroups,
      tokenMergeRules: [...s.tokenMergeRules, newRule],
    }));
  }, [applyViewState, buildPayload, ensureV2MutationAllowed, mutateAndSave, persistCanonicalPayloadV2]);

  const undoMerge = useCallback((data: {
    results: ProcessedRow[] | null;
    clusterSummary: ClusterSummary[] | null;
    tokenSummary: TokenSummary[] | null;
    groupedClusters: GroupedCluster[];
    approvedGroups: GroupedCluster[];
    tokenMergeRules: TokenMergeRule[];
  }) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Token merge edits')) return;
      const payload = buildPayload({
        results: data.results,
        clusterSummary: data.clusterSummary,
        tokenSummary: data.tokenSummary,
        groupedClusters: data.groupedClusters,
        approvedGroups: data.approvedGroups,
        tokenMergeRules: data.tokenMergeRules,
      });
      applyViewState(toProjectViewState(payload));
      persistCanonicalPayloadV2(payload, { requireOwnedLock: true });
      return;
    }
    mutateAndSave(() => ({
      results: data.results,
      clusterSummary: data.clusterSummary,
      tokenSummary: data.tokenSummary,
      groupedClusters: data.groupedClusters,
      approvedGroups: data.approvedGroups,
      tokenMergeRules: data.tokenMergeRules,
    }));
  }, [applyViewState, buildPayload, ensureV2MutationAllowed, mutateAndSave, persistCanonicalPayloadV2]);

  const updateLabelSections = useCallback((sections: LabelSection[]) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Label edits')) return;
      applyLocalChanges({ labelSections: sections }, { checkpoint: true });
      persistLabelSectionsV2(sections);
      return;
    }
    mutateAndSave(() => ({ labelSections: sections }));
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistLabelSectionsV2]);

  const updateAutoMergeRecommendations = useCallback((recommendations: AutoMergeRecommendation[]) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Bulk project edits')) return;
      const payload = buildPayload({ autoMergeRecommendations: recommendations });
      applyViewState(toProjectViewState(payload));
      persistCanonicalPayloadV2(payload, { requireOwnedLock: true });
      return;
    }
    mutateAndSave(() => ({ autoMergeRecommendations: recommendations }));
  }, [applyViewState, buildPayload, ensureV2MutationAllowed, mutateAndSave, persistCanonicalPayloadV2]);

  const updateGroupMergeRecommendations = useCallback((recommendations: GroupMergeRecommendation[]) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Bulk project edits')) return;
      const payload = buildPayload({ groupMergeRecommendations: recommendations });
      applyViewState(toProjectViewState(payload));
      persistCanonicalPayloadV2(payload, { requireOwnedLock: true });
      return;
    }
    mutateAndSave(() => ({ groupMergeRecommendations: recommendations }));
  }, [applyViewState, buildPayload, ensureV2MutationAllowed, mutateAndSave, persistCanonicalPayloadV2]);

  // Debounced suggestion-only persistence — onSuggestionsChange can still fire very
  // often; main mutations now coalesce in flushPersistQueue. Suggestions alone use
  // a 2s idle timer so we do not schedule redundant flushes on every keystroke.
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSuggestions = useCallback((suggestions: AutoGroupSuggestion[]) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Bulk project edits')) return;
      const payload = buildPayload({ autoGroupSuggestions: suggestions });
      applyViewState(toProjectViewState(payload));
      persistCanonicalPayloadV2(payload, { requireOwnedLock: true });
      return;
    }
    // Update state + ref immediately (UI stays responsive)
    latest.current = { ...latest.current, autoGroupSuggestions: suggestions };
    setAutoGroupSuggestions(suggestions);
    saveCounterRef.current += 1;
    const traceId = beginRuntimeTrace('useProjectPersistence.updateSuggestions', activeProjectIdRef.current, {
      suggestionCount: suggestions.length,
    });
    // Persist immediately to local cache for crash resilience.
    pendingLocalPersistRef.current = checkpointToIDB(
      { autoGroupSuggestions: suggestions },
      { traceId, traceSource: 'useProjectPersistence.updateSuggestions' },
    );

    // Debounce the actual save
    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    suggestionTimerRef.current = setTimeout(() => {
      suggestionTimerRef.current = null;
      enqueueSave('suggestions-debounce', traceId);
    }, 2000);
  }, [applyViewState, buildPayload, checkpointToIDB, enqueueSave, ensureV2MutationAllowed, persistCanonicalPayloadV2]);

  const addActivityEntry = useCallback((entry: ActivityLogEntry) => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Activity-log edits')) return;
      const next = [entry, ...latest.current.activityLog].slice(0, 500);
      applyLocalChanges({ activityLog: next }, { checkpoint: true });
      persistActivityLogEntryV2(entry);
      return;
    }
    mutateAndSave(s => {
      const next = [entry, ...s.activityLog];
      return { activityLog: next.length > 500 ? next.slice(0, 500) : next };
    });
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, persistActivityLogEntryV2]);

  const clearActivityLog = useCallback(() => {
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Activity-log edits')) return;
      applyLocalChanges({ activityLog: [] }, { checkpoint: true });
      replaceActivityLogV2([]);
      return;
    }
    mutateAndSave(() => ({ activityLog: [] }));
  }, [applyLocalChanges, ensureV2MutationAllowed, mutateAndSave, replaceActivityLogV2]);

  const bulkSet = useCallback((data: Partial<ProjectViewState>) => {
    const changes: Partial<PersistedState> = {};
    if ('results' in data) changes.results = data.results!;
    if ('clusterSummary' in data) changes.clusterSummary = data.clusterSummary!;
    if ('tokenSummary' in data) changes.tokenSummary = data.tokenSummary!;
    if ('groupedClusters' in data) changes.groupedClusters = data.groupedClusters!;
    if ('approvedGroups' in data) changes.approvedGroups = data.approvedGroups!;
    if ('activityLog' in data) changes.activityLog = data.activityLog!;
    if ('tokenMergeRules' in data) changes.tokenMergeRules = data.tokenMergeRules!;
    if ('autoGroupSuggestions' in data) changes.autoGroupSuggestions = data.autoGroupSuggestions!;
    if ('autoMergeRecommendations' in data) changes.autoMergeRecommendations = data.autoMergeRecommendations!;
    if ('groupMergeRecommendations' in data) changes.groupMergeRecommendations = data.groupMergeRecommendations!;
    if ('stats' in data) changes.stats = data.stats!;
    if ('datasetStats' in data) changes.datasetStats = data.datasetStats;
    if ('blockedTokens' in data) changes.blockedTokens = new Set<string>(data.blockedTokens!);
    if ('blockedKeywords' in data) changes.blockedKeywords = data.blockedKeywords!;
    if ('labelSections' in data) changes.labelSections = data.labelSections!;
    const metadataWriteAllowed = storageModeRef.current === 'v2'
      ? ensureV2MutationAllowed('Project metadata edits')
      : !getLegacyPersistBlockReason();
    if ('fileName' in data) {
      changes.fileName = data.fileName!;
      // Also update project metadata
      const projectId = activeProjectIdRef.current;
      if (projectId && data.fileName && metadataWriteAllowed) {
        const updatedProjects = projects.map(p =>
          p.id === projectId ? { ...p, fileName: data.fileName! } : p
        );
        setProjects(updatedProjects);
        const proj = updatedProjects.find(p => p.id === projectId);
        if (proj) {
          saveProjectToFirestore(proj).catch((err) => {
            reportPersistFailure(addToastRef.current, 'project metadata save', err);
          });
        }
      }
    }
    if (storageModeRef.current === 'v2') {
      if (!ensureV2MutationAllowed('Bulk project edits')) return;
      const payload = buildPayload(changes);
      const project = projectsRef.current.find((item) => item.id === activeProjectIdRef.current);
      applyViewState(toProjectViewState(payload, project));
      persistCanonicalPayloadV2(payload, { requireOwnedLock: true });
      return;
    }
    mutateAndSave(() => changes);
  }, [applyViewState, buildPayload, ensureV2MutationAllowed, getLegacyPersistBlockReason, mutateAndSave, persistCanonicalPayloadV2, projects, setProjects]);

  // ── Return ────────────────────────────────────────────────────────────
  const isProjectBusy = Boolean(
    activeOperation &&
    activeOperation.ownerId !== clientIdRef.current &&
    activeOperation.ownerClientId !== clientIdRef.current &&
    Date.parse(activeOperation.expiresAt || '0') > Date.now(),
  );

  const canUseExternalSetter = useCallback((label: string): boolean => {
    if (storageModeRef.current !== 'v2') return true;
    if (!activeProjectIdRef.current) return true;
    addToastRef.current(`${label} is blocked for shared V2 projects. Use the persistence action APIs instead.`, 'warning');
    return false;
  }, []);

  const guardedSetResults: React.Dispatch<React.SetStateAction<ProcessedRow[] | null>> = (value) => {
    if (!canUseExternalSetter('Direct result updates')) return;
    setResults(value);
  };
  const guardedSetClusterSummary: React.Dispatch<React.SetStateAction<ClusterSummary[] | null>> = (value) => {
    if (!canUseExternalSetter('Direct cluster updates')) return;
    setClusterSummary(value);
  };
  const guardedSetTokenSummary: React.Dispatch<React.SetStateAction<TokenSummary[] | null>> = (value) => {
    if (!canUseExternalSetter('Direct token-summary updates')) return;
    setTokenSummary(value);
  };
  const guardedSetGroupedClusters: React.Dispatch<React.SetStateAction<GroupedCluster[]>> = (value) => {
    if (!canUseExternalSetter('Direct grouped-cluster updates')) return;
    setGroupedClusters(value);
  };
  const guardedSetApprovedGroups: React.Dispatch<React.SetStateAction<GroupedCluster[]>> = (value) => {
    if (!canUseExternalSetter('Direct approved-group updates')) return;
    setApprovedGroups(value);
  };
  const guardedSetBlockedKeywords: React.Dispatch<React.SetStateAction<BlockedKeyword[]>> = (value) => {
    if (!canUseExternalSetter('Direct blocked-keyword updates')) return;
    setBlockedKeywords(value);
  };
  const guardedSetActivityLog: React.Dispatch<React.SetStateAction<ActivityLogEntry[]>> = (value) => {
    if (!canUseExternalSetter('Direct activity-log updates')) return;
    setActivityLog(value);
  };
  const guardedSetStats: React.Dispatch<React.SetStateAction<Stats | null>> = (value) => {
    if (!canUseExternalSetter('Direct stats updates')) return;
    setStats(value);
  };
  const guardedSetDatasetStats: React.Dispatch<React.SetStateAction<any | null>> = (value) => {
    if (!canUseExternalSetter('Direct dataset-stat updates')) return;
    setDatasetStats(value);
  };
  const guardedSetAutoGroupSuggestions: React.Dispatch<React.SetStateAction<AutoGroupSuggestion[]>> = (value) => {
    if (!canUseExternalSetter('Direct suggestion updates')) return;
    setAutoGroupSuggestions(value);
  };
  const guardedSetAutoMergeRecommendations: React.Dispatch<React.SetStateAction<AutoMergeRecommendation[]>> = (value) => {
    if (!canUseExternalSetter('Direct auto-merge updates')) return;
    setAutoMergeRecommendations(value);
  };
  const guardedSetGroupMergeRecommendations: React.Dispatch<React.SetStateAction<GroupMergeRecommendation[]>> = (value) => {
    if (!canUseExternalSetter('Direct group-merge updates')) return;
    setGroupMergeRecommendations(value);
  };
  const guardedSetTokenMergeRules: React.Dispatch<React.SetStateAction<TokenMergeRule[]>> = (value) => {
    if (!canUseExternalSetter('Direct token-merge updates')) return;
    setTokenMergeRules(value);
  };
  const guardedSetBlockedTokens: React.Dispatch<React.SetStateAction<Set<string>>> = (value) => {
    if (!canUseExternalSetter('Direct blocked-token updates')) return;
    setBlockedTokens(value);
  };
  const guardedSetLabelSections: React.Dispatch<React.SetStateAction<LabelSection[]>> = (value) => {
    if (!canUseExternalSetter('Direct label-section updates')) return;
    setLabelSections(value);
  };
  const guardedSetFileName: React.Dispatch<React.SetStateAction<string | null>> = (value) => {
    if (!canUseExternalSetter('Direct file-name updates')) return;
    setFileName(value);
  };

  return {
    // Read-only state
    results, clusterSummary, tokenSummary, groupedClusters,
    approvedGroups, blockedKeywords, activityLog, stats,
    datasetStats, autoGroupSuggestions, tokenMergeRules,
    autoMergeRecommendations, groupMergeRecommendations,
    blockedTokens, labelSections, fileName,
    activeProjectId,

    // Project lifecycle
    setActiveProjectId,
    loadProject,
    clearProject,
    syncFileNameLocal,
    flushNow,
    storageMode,
    activeOperation,
    isProjectBusy,
    runWithExclusiveOperation,

    // Atomic mutations
    addGroupsAndRemovePages,
    mergeGroupsByName,
    updateGroups,
    approveGroup,
    unapproveGroup,
    removeFromApproved,
    ungroupPages,
    blockTokens,
    unblockTokens,
    applyMergeCascade,
    undoMerge,
    updateLabelSections,
    updateAutoMergeRecommendations,
    updateGroupMergeRecommendations,
    updateSuggestions,
    addActivityEntry,
    clearActivityLog,
    bulkSet,

    // Transitional setters (for code not yet migrated to atomic mutations)
    setResults: guardedSetResults,
    setClusterSummary: guardedSetClusterSummary,
    setTokenSummary: guardedSetTokenSummary,
    setGroupedClusters: guardedSetGroupedClusters,
    setApprovedGroups: guardedSetApprovedGroups,
    setBlockedKeywords: guardedSetBlockedKeywords,
    setActivityLog: guardedSetActivityLog,
    setStats: guardedSetStats,
    setDatasetStats: guardedSetDatasetStats,
    setAutoGroupSuggestions: guardedSetAutoGroupSuggestions,
    setTokenMergeRules: guardedSetTokenMergeRules,
    setAutoMergeRecommendations: guardedSetAutoMergeRecommendations,
    setGroupMergeRecommendations: guardedSetGroupMergeRecommendations,
    setBlockedTokens: guardedSetBlockedTokens,
    setLabelSections: guardedSetLabelSections,
    setFileName: guardedSetFileName,

    // Transitional refs
    refs: {
      results: resultsRef,
      clusterSummary: clusterSummaryRef,
      tokenSummary: tokenSummaryRef,
      groupedClusters: groupedClustersRef,
      approvedGroups: approvedGroupsRef,
      blockedKeywords: blockedKeywordsRef,
      activityLog: activityLogRef,
      stats: statsRef,
      datasetStats: datasetStatsRef,
      autoGroupSuggestions: autoGroupSuggestionsRef,
      autoMergeRecommendations: autoMergeRecommendationsRef,
      groupMergeRecommendations: groupMergeRecommendationsRef,
      tokenMergeRules: tokenMergeRulesRef,
      blockedTokens: blockedTokensRef,
      labelSections: labelSectionsRef,
      fileName: fileNameRef,
      activeProjectId: activeProjectIdRef,
    },
  };
}
