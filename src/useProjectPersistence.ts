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
import { collection, onSnapshot } from 'firebase/firestore';
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
  reconcileWithFirestore,
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
} from './types';
import { parseSubClusterKey } from './subClusterKeys';
import { logPersistError, reportLocalPersistFailure, reportPersistFailure } from './persistenceErrors';
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
  loadFence: number;
  incomingGroupedPageMass: number;
  incomingSaveId: number;
  localSaveId: number;
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
  const activeProjectIdRef = useRef<string | null>(null);
  const projectsRef = useRef(projects);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

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
    options?: { mode?: 'checkpoint' | 'flush' },
  ): Promise<boolean> => {
    const mode = options?.mode ?? 'checkpoint';
    if (mode === 'checkpoint') {
      recordLocalPersistStart();
    }
    try {
      await withPersistTimeout(
        saveToIDB(projectId, payload),
        PROJECT_LOCAL_WRITE_TIMEOUT_MS,
        `project local write (${mode}:${projectId})`,
      );
      // Both modes clear the failed flag on success — this is critical so that
      // a flush after a failed checkpoint can recover the durability status.
      recordLocalPersistOk({ decrementPending: mode === 'checkpoint' });
      return true;
    } catch (err) {
      if (mode === 'checkpoint') {
        recordLocalPersistError();
        reportLocalPersistFailure(addToast, 'project data local save', err);
      } else {
        // Flush mode: still update durability status so the UI reflects reality,
        // but skip the toast (flushes are background work, don't spam the user).
        recordLocalPersistError({ decrementPending: false });
        logPersistError('IDB save (flush)', err);
      }
      return false;
    }
  }, [addToast]);

  /**
   * Flush pending state to IDB + Firestore. Uses a while-loop so rapid auto-group /
   * review updates coalesce: many mutateAndSave calls in one burst become one or a few
   * writes (whatever fits between awaits), always reading `latest.current` at flush time.
   * Order is still strictly serialized — no parallel IDB/Firestore writes.
   */
  const flushPersistQueue = useCallback(async () => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;

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

        // Guard: refuse to save a completely empty payload. A project with zero
        // results, zero grouped clusters, AND zero approved groups is never a
        // valid user state worth persisting — it's always a clearProject race
        // artifact. Saving it would overwrite real data in IDB/Firestore.
        if (!(payload.results?.length) && !(payload.groupedClusters?.length) && !(payload.approvedGroups?.length)) {
          console.warn('[PERSIST] Skipping flush of empty payload (no results/groups/approved)');
          break;
        }

        loadFenceRef.current = 0;

        await persistProjectPayloadToIDB(projectId, payload, { mode: 'flush' });
        try {
          recordProjectCloudWriteStart();
          await withPersistTimeout(
            saveProjectDataToFirestore(projectId, payload, { saveId, clientId }),
            PROJECT_CLOUD_WRITE_TIMEOUT_MS,
            `project cloud write (${projectId})`,
          );
          recordProjectFirestoreSaveOk();
          console.log(
            '[PERSIST] Firestore save OK - grouped:',
            (payload.groupedClusters || []).length,
            'groups, saveId:',
            saveId,
          );
        } catch (err) {
          recordProjectFirestoreSaveError();
          reportPersistFailure(addToast, 'project data save', err);
        }
        // If mutateAndSave ran during the awaits above, needsPersistFlushRef is true → loop
      }
    } finally {
      isFlushingRef.current = false;
      recordProjectFlushExit();
    }
  }, [buildPayload, addToast, persistProjectPayloadToIDB]);

  /** Queue Firestore + IDB flush (no debounce). `latest.current` is read at flush time. */
  const enqueueSave = useCallback(() => {
    if (!activeProjectIdRef.current) return;
    needsPersistFlushRef.current = true;
    pendingSaveRef.current = pendingSaveRef.current
      .then(flushPersistQueue)
      .catch((err) => logPersistError('persist queue flush', err));
  }, [flushPersistQueue]);

  /**
   * Durability barrier for long-running jobs that need a user-visible "done and synced"
   * moment before returning control.
   */
  const flushNow = useCallback(async () => {
    if (!activeProjectIdRef.current) return;
    enqueueSave();
    await pendingLocalPersistRef.current;
    await pendingSaveRef.current;
  }, [enqueueSave]);

  /**
   * Crash-safety checkpoint: persist latest state to IDB immediately.
   * `enqueueSave` runs the same payload to Firestore on the serialized queue.
   */
  const checkpointToIDB = useCallback(async (overrides?: Partial<PersistedState>) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    const payload = buildPayload(overrides);
    await persistProjectPayloadToIDB(projectId, payload, { mode: 'checkpoint' });
  }, [buildPayload, persistProjectPayloadToIDB]);

  // Best-effort: extra flush when the tab hides or unloads (navigation may already queue saves).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') enqueueSave();
    };
    const onPageHide = () => {
      enqueueSave();
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
      enqueueSave();
    }, RECOVERY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enqueueSave]);

  // ── Helper: update latest + state + save atomically ───────────────────
  const mutateAndSave = useCallback((
    updater: (s: PersistedState) => Partial<PersistedState>,
  ) => {
    const changes = updater(latest.current);
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
    // 3. Immediate local durability (crash-safe)
    pendingLocalPersistRef.current = checkpointToIDB();
    // 4. Queue Firestore + IDB flush (serialized queue; loop coalesces mid-await mutations)
    enqueueSave();
  }, [checkpointToIDB, enqueueSave]);

  // ── applyViewState: batch-set all 14 fields from a ProjectViewState ──
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

  // ── Project lifecycle ─────────────────────────────────────────────────

  const setActiveProjectId = useCallback((id: string | null) => {
    activeProjectIdRef.current = id;
    setActiveProjectIdState(id);
  }, []);

  const loadProject = useCallback(async (projectId: string, projectList: Project[]) => {
    projectLoadingRef.current = true;
    const project = projectList.find(p => p.id === projectId);

    // ── Phase 1: IDB-first fast path (~5ms) ──────────────────────────────
    // Show cached data instantly. Reconcile with Firestore in background.
    const idbData = await loadProjectDataFromIDBOnly(projectId);

    if (idbData) {
      // skipRebuild: IDB data was saved by this app, clusterSummary is consistent.
      // Consistency check inside toProjectViewState falls back to rebuilding if not.
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
  }, [applyViewState]);

  const clearProject = useCallback(() => {
    // Cancel any pending flushes so stale mutations from the previous project
    // don't persist empty state to the NEW project's IDB/Firestore slot.
    needsPersistFlushRef.current = false;
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
    const ourClientId = clientIdRef.current;
    const unsub = onSnapshot(
      collection(db, 'projects', pid, 'chunks'),
      (snap) => {
        markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, snap);

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
          loadFence: loadFenceRef.current,
          incomingGroupedPageMass: data ? groupedPageMass(data) : 0,
          incomingSaveId: data?.lastSaveId ?? 0,
          localSaveId: saveCounterRef.current,
        });

        if (guardResult.action === 'skip') {
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
        reportPersistFailure(addToast, 'project chunks listener', err);
      },
    );
    return () => {
      clearListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
      if (typeof unsub === 'function') unsub();
    };
  }, [activeProjectId, applyViewState, addToast]);

  // ── Atomic mutation functions ─────────────────────────────────────────

  const addGroupsAndRemovePages = useCallback((newGroups: GroupedCluster[], removedTokens: Set<string>) => {
    mutateAndSave(s => {
      const nextGrouped = [...s.groupedClusters, ...newGroups];
      const nextClusters = s.clusterSummary?.filter(c => !removedTokens.has(c.tokens)) || null;
      const nextResults = s.results?.filter(r => !removedTokens.has(r.tokens)) || null;
      return { groupedClusters: nextGrouped, clusterSummary: nextClusters, results: nextResults };
    });
  }, [mutateAndSave]);

  const mergeGroupsByName = useCallback((opts: MergeGroupsByNameOpts) => {
    mutateAndSave(s => {
      const merged = opts.mergeFn(s.groupedClusters, opts.incoming, opts.hasReviewApi);
      const nextClusters = s.clusterSummary?.filter(c => !opts.removedTokens.has(c.tokens)) || null;
      const nextResults = s.results?.filter(r => !opts.removedTokens.has(r.tokens)) || null;
      return { groupedClusters: merged, clusterSummary: nextClusters, results: nextResults };
    });
  }, [mutateAndSave]);

  const updateGroups = useCallback((updaterOrValue: ((groups: GroupedCluster[]) => GroupedCluster[]) | GroupedCluster[], approvedOverride?: GroupedCluster[]) => {
    mutateAndSave(s => {
      const nextGrouped = typeof updaterOrValue === 'function'
        ? updaterOrValue(s.groupedClusters)
        : updaterOrValue;
      const changes: Partial<PersistedState> = { groupedClusters: nextGrouped };
      if (approvedOverride !== undefined) changes.approvedGroups = approvedOverride;
      return changes;
    });
  }, [mutateAndSave]);

  const approveGroup = useCallback((groupName: string): GroupedCluster | null => {
    const s = latest.current;
    const group = s.groupedClusters.find(g => g.groupName === groupName);
    if (!group) return null;
    const nextGrouped = s.groupedClusters.filter(g => g.groupName !== groupName);
    const nextApproved = [...s.approvedGroups, group];
    mutateAndSave(() => ({ groupedClusters: nextGrouped, approvedGroups: nextApproved }));
    return group;
  }, [mutateAndSave]);

  const unapproveGroup = useCallback((groupName: string): GroupedCluster | null => {
    const s = latest.current;
    const group = s.approvedGroups.find(g => g.groupName === groupName);
    if (!group) return null;
    const nextApproved = s.approvedGroups.filter(g => g.groupName !== groupName);
    const nextGrouped = [...s.groupedClusters, group];
    mutateAndSave(() => ({ approvedGroups: nextApproved, groupedClusters: nextGrouped }));
    return group;
  }, [mutateAndSave]);

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

    mutateAndSave(() => ({
      approvedGroups: newApproved,
      groupedClusters: nextGrouped,
      clusterSummary: nextClusters,
      results: nextResults,
    }));

    return { clustersReturned: clustersToReturn, groupsReturned: groupsToReturn };
  }, [mutateAndSave]);

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

    mutateAndSave(() => ({
      groupedClusters: newGrouped,
      clusterSummary: nextClusters,
      results: nextResults,
    }));

    return { clustersReturned: clustersToReturn, groupsWithPartialRemoval };
  }, [mutateAndSave]);

  const blockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    mutateAndSave(s => {
      const next = new Set(s.blockedTokens);
      tokens.forEach(t => next.add(t));
      return { blockedTokens: next };
    });
  }, [mutateAndSave]);

  const unblockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    mutateAndSave(s => {
      const next = new Set(s.blockedTokens);
      tokens.forEach(t => next.delete(t));
      return { blockedTokens: next };
    });
  }, [mutateAndSave]);

  const applyMergeCascade = useCallback((cascade: {
    results: ProcessedRow[] | null;
    clusterSummary: ClusterSummary[] | null;
    tokenSummary: TokenSummary[] | null;
    groupedClusters: GroupedCluster[];
    approvedGroups: GroupedCluster[];
  }, newRule: TokenMergeRule) => {
    mutateAndSave(s => ({
      results: cascade.results,
      clusterSummary: cascade.clusterSummary,
      tokenSummary: cascade.tokenSummary,
      groupedClusters: cascade.groupedClusters,
      approvedGroups: cascade.approvedGroups,
      tokenMergeRules: [...s.tokenMergeRules, newRule],
    }));
  }, [mutateAndSave]);

  const undoMerge = useCallback((data: {
    results: ProcessedRow[] | null;
    clusterSummary: ClusterSummary[] | null;
    tokenSummary: TokenSummary[] | null;
    groupedClusters: GroupedCluster[];
    approvedGroups: GroupedCluster[];
    tokenMergeRules: TokenMergeRule[];
  }) => {
    mutateAndSave(() => ({
      results: data.results,
      clusterSummary: data.clusterSummary,
      tokenSummary: data.tokenSummary,
      groupedClusters: data.groupedClusters,
      approvedGroups: data.approvedGroups,
      tokenMergeRules: data.tokenMergeRules,
    }));
  }, [mutateAndSave]);

  const updateLabelSections = useCallback((sections: LabelSection[]) => {
    mutateAndSave(() => ({ labelSections: sections }));
  }, [mutateAndSave]);

  const updateAutoMergeRecommendations = useCallback((recommendations: AutoMergeRecommendation[]) => {
    mutateAndSave(() => ({ autoMergeRecommendations: recommendations }));
  }, [mutateAndSave]);

  const updateGroupMergeRecommendations = useCallback((recommendations: GroupMergeRecommendation[]) => {
    mutateAndSave(() => ({ groupMergeRecommendations: recommendations }));
  }, [mutateAndSave]);

  // Debounced suggestion-only persistence — onSuggestionsChange can still fire very
  // often; main mutations now coalesce in flushPersistQueue. Suggestions alone use
  // a 2s idle timer so we do not schedule redundant flushes on every keystroke.
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSuggestions = useCallback((suggestions: AutoGroupSuggestion[]) => {
    // Update state + ref immediately (UI stays responsive)
    latest.current = { ...latest.current, autoGroupSuggestions: suggestions };
    setAutoGroupSuggestions(suggestions);
    saveCounterRef.current += 1;
    // Persist immediately to local cache for crash resilience.
    pendingLocalPersistRef.current = checkpointToIDB({ autoGroupSuggestions: suggestions });

    // Debounce the actual save
    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    suggestionTimerRef.current = setTimeout(() => {
      suggestionTimerRef.current = null;
      enqueueSave();
    }, 2000);
  }, [checkpointToIDB, enqueueSave]);

  const addActivityEntry = useCallback((entry: ActivityLogEntry) => {
    mutateAndSave(s => {
      const next = [entry, ...s.activityLog];
      return { activityLog: next.length > 500 ? next.slice(0, 500) : next };
    });
  }, [mutateAndSave]);

  const clearActivityLog = useCallback(() => {
    mutateAndSave(() => ({ activityLog: [] }));
  }, [mutateAndSave]);

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
    if ('fileName' in data) {
      changes.fileName = data.fileName!;
      // Also update project metadata
      const projectId = activeProjectIdRef.current;
      if (projectId && data.fileName) {
        const updatedProjects = projects.map(p =>
          p.id === projectId ? { ...p, fileName: data.fileName! } : p
        );
        setProjects(updatedProjects);
        const proj = updatedProjects.find(p => p.id === projectId);
        if (proj) {
          saveProjectToFirestore(proj).catch((err) => {
            reportPersistFailure(addToast, 'project metadata save', err);
          });
        }
      }
    }
    mutateAndSave(() => changes);
  }, [mutateAndSave, projects, setProjects, addToast]);

  // ── Return ────────────────────────────────────────────────────────────
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
    setResults, setClusterSummary, setTokenSummary, setGroupedClusters,
    setApprovedGroups, setBlockedKeywords, setActivityLog, setStats,
    setDatasetStats, setAutoGroupSuggestions, setTokenMergeRules,
    setAutoMergeRecommendations,
    setGroupMergeRecommendations,
    setBlockedTokens, setLabelSections, setFileName,

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
