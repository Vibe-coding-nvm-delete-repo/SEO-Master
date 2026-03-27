/**
 * useProjectPersistence — single source of truth for all persisted project state.
 *
 * Every mutation atomically updates:
 *   1. The `latest` ref (synchronous, never stale)
 *   2. React state (for rendering)
 *   3. Firestore + IDB (via enqueueSave)
 *
 * No external code should ever call saveProjectData or touch refs directly.
 * The stale-closure bug class is structurally impossible because:
 *   - All mutation functions have EMPTY dependency arrays
 *   - They read from `latest.current` (always fresh), never from closures
 *   - `enqueueSave` requests a coalesced flush; the queue reads `latest.current`
 *     at write time so bursts (rapid auto-group) collapse to few Firestore writes
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
  toProjectViewState,
  createEmptyProjectViewState,
  type ProjectViewState,
} from './projectWorkspace';
import type {
  ProcessedRow,
  ClusterSummary,
  TokenSummary,
  GroupedCluster,
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
import { logPersistError, reportPersistFailure } from './persistenceErrors';
import {
  clearListenerError,
  markListenerError,
  markListenerSnapshot,
  recordProjectFirestoreSaveError,
  recordProjectFirestoreSaveOk,
  recordProjectFlushEnter,
  recordProjectFlushExit,
} from './cloudSyncStatus';

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
  tokenMergeRules: [],
  blockedTokens: new Set<string>(),
  labelSections: [],
  fileName: null,
};

const SESSION_CLIENT_ID = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

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
      datasetStats, autoGroupSuggestions, autoMergeRecommendations, tokenMergeRules,
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
  /** Coalesce rapid saves (e.g. keyword rating batches) — Firestore flushes after quiet period */
  const firestoreFlushDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveCounterRef = useRef(0);
  /** True if a mutation happened since we started the current persist iteration (coalesced saves). */
  const needsPersistFlushRef = useRef(false);
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
      updatedAt: new Date().toISOString(),
      lastSaveId: saveCounterRef.current,
    };
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

    recordProjectFlushEnter();
    try {
      while (needsPersistFlushRef.current) {
        needsPersistFlushRef.current = false;

        const saveId = ++saveCounterRef.current;
        const payload = buildPayload();
        payload.lastSaveId = saveId;
        const clientId = clientIdRef.current;

        loadFenceRef.current = 0;

        try {
          await saveToIDB(projectId, payload);
        } catch (err) {
          logPersistError('IDB save (flush)', err);
        }
        try {
          await saveProjectDataToFirestore(projectId, payload, { saveId, clientId });
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
      recordProjectFlushExit();
    }
  }, [buildPayload, addToast]);

  /** Queue Firestore sync (debounced). `latest.current` is always read at flush time. */
  const enqueueSave = useCallback(() => {
    if (!activeProjectIdRef.current) return;
    needsPersistFlushRef.current = true;
    if (firestoreFlushDebounceRef.current) clearTimeout(firestoreFlushDebounceRef.current);
    firestoreFlushDebounceRef.current = setTimeout(() => {
      firestoreFlushDebounceRef.current = null;
      pendingSaveRef.current = pendingSaveRef.current
        .then(flushPersistQueue)
        .catch((err) => logPersistError('persist queue flush', err));
    }, 500);
  }, [flushPersistQueue]);

  /** Flush cloud sync immediately (e.g. tab hidden) — skip debounce */
  const enqueueSaveImmediate = useCallback(() => {
    if (!activeProjectIdRef.current) return;
    needsPersistFlushRef.current = true;
    if (firestoreFlushDebounceRef.current) {
      clearTimeout(firestoreFlushDebounceRef.current);
      firestoreFlushDebounceRef.current = null;
    }
    pendingSaveRef.current = pendingSaveRef.current
      .then(flushPersistQueue)
      .catch((err) => logPersistError('persist queue flush', err));
  }, [flushPersistQueue]);

  /**
   * Crash-safety checkpoint: persist latest state to IDB immediately.
   * Firestore remains coalesced via enqueueSave, but IDB gets a best-effort
   * snapshot right away so reloads recover the newest local edits.
   */
  const checkpointToIDB = useCallback((overrides?: Partial<PersistedState>) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    const payload = buildPayload(overrides);
    saveToIDB(projectId, payload).catch((err) =>
      logPersistError('IDB checkpoint', err),
    );
  }, [buildPayload]);

  // Best-effort: queue a flush when the tab hides so refresh/navigation is less likely
  // to hit the server before the coalesced queue finishes writing.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') enqueueSaveImmediate();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enqueueSaveImmediate]);

  // ── Helper: update latest + state + save atomically ───────────────────
  const mutateAndSave = useCallback((
    updater: (s: PersistedState) => Partial<PersistedState>,
  ) => {
    const changes = updater(latest.current);
    // 1. Update latest ref synchronously
    latest.current = { ...latest.current, ...changes };
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
    if ('tokenMergeRules' in changes) setTokenMergeRules(changes.tokenMergeRules!);
    if ('blockedTokens' in changes) setBlockedTokens(changes.blockedTokens!);
    if ('labelSections' in changes) setLabelSections(changes.labelSections!);
    if ('fileName' in changes) setFileName(changes.fileName!);
    // 3. Immediate local durability (crash-safe)
    checkpointToIDB();
    // 4. Queue save (coalesced — latest.current already has full state)
    enqueueSave();
  }, [checkpointToIDB, enqueueSave]);

  // ── applyViewState: batch-set all 14 fields from a ProjectViewState ──
  const applyViewState = useCallback((vs: ProjectViewState) => {
    const next: PersistedState = {
      results: vs.results,
      clusterSummary: vs.clusterSummary,
      tokenSummary: vs.tokenSummary,
      groupedClusters: vs.groupedClusters,
      approvedGroups: vs.approvedGroups,
      activityLog: vs.activityLog,
      tokenMergeRules: vs.tokenMergeRules,
      autoGroupSuggestions: vs.autoGroupSuggestions,
      autoMergeRecommendations: vs.autoMergeRecommendations,
      stats: vs.stats,
      datasetStats: vs.datasetStats as any,
      blockedTokens: new Set<string>(vs.blockedTokens),
      blockedKeywords: vs.blockedKeywords,
      labelSections: vs.labelSections,
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
    const data = await loadProjectDataForView(projectId);
    const project = projectList.find(p => p.id === projectId);
    const viewState = data ? toProjectViewState(data, project) : createEmptyProjectViewState();
    applyViewState(viewState);

    // Initialize save counter from IDB so new saves continue from where we
    // left off. This ensures that Firestore meta.saveId from our previous
    // session is always <= saveCounterRef, which lets the stale-save guard work.
    const loadedSaveId = data?.lastSaveId ?? 0;
    if (loadedSaveId > saveCounterRef.current) {
      saveCounterRef.current = loadedSaveId;
    }

    // Set load fence = total grouped pages loaded at startup. The onSnapshot
    // listener will reject any snapshot that would shrink below this count — preventing
    // stale Firestore data (from incomplete saves of a prior session) from
    // overwriting the fresher IDB state.
    const loadedTotal = countGroupedPages(viewState);
    loadFenceRef.current = loadedTotal;

    projectLoadingRef.current = false;
  }, [applyViewState]);

  const clearProject = useCallback(() => {
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
        markListenerSnapshot('project_chunks', snap);
        const metaDoc = snap.docs.find((d) => (d.data() as any)?.type === 'meta');
        const meta = metaDoc ? (metaDoc.data() as any) : null;

        // ── Guard 1: project is loading — loadProject is the authority ──
        if (projectLoadingRef.current) return;

        // ── Guard 2: skip our OWN save echoes ──
        // Every save writes our clientId into the meta doc. If the incoming
        // snapshot came from us, the local state is already correct (set by
        // mutateAndSave). Applying the echo would overwrite fresher local
        // data with stale intermediate snapshots during rapid chained saves.
        if (meta?.clientId === ourClientId) return;

        // From here on we're handling another client's write (or a first-load
        // snapshot from a previous session with a different clientId).

        const project = projectsRef.current.find(p => p.id === pid);
        const data = snap.empty ? null : buildProjectDataPayloadFromChunkDocs(snap.docs);

        // ── Guard 3: don't wipe local state with empty/null data ──
        if (!data && latest.current.results && latest.current.results.length > 0) {
          console.warn('[PERSIST] Ignoring empty snapshot — local has', latest.current.results.length, 'results');
          return;
        }
        if (!data && latest.current.groupedClusters.length > 0) {
          console.warn('[PERSIST] Ignoring null snapshot — local has', latest.current.groupedClusters.length, 'grouped');
          return;
        }
        if (!data && latest.current.approvedGroups.length > 0) {
          console.warn('[PERSIST] Ignoring null snapshot — local has', latest.current.approvedGroups.length, 'approved');
          return;
        }
        if (!data && latest.current.clusterSummary && latest.current.clusterSummary.length > 0) {
          console.warn('[PERSIST] Ignoring null snapshot — local has', latest.current.clusterSummary.length, 'clusters');
          return;
        }

        // ── Guard 4: partial multi-batch writes from other clients ──
        if (data) {
          const incomingGroupedCount =
            typeof meta?.groupedClusterCount === 'number' ? meta.groupedClusterCount : null;
          const incomingApprovedCount =
            typeof meta?.approvedGroupCount === 'number' ? meta.approvedGroupCount : null;
          if (
            incomingGroupedCount != null && incomingGroupedCount > 0 &&
            latest.current.groupedClusters.length > 0 && data.groupedClusters.length === 0
          ) {
            console.warn('[PERSIST] Ignoring partial grouped snapshot from other client');
            return;
          }
          if (
            incomingApprovedCount != null && incomingApprovedCount > 0 &&
            latest.current.approvedGroups.length > 0 && data.approvedGroups.length === 0
          ) {
            console.warn('[PERSIST] Ignoring partial approved snapshot from other client');
            return;
          }
        }

        // ── Guard 5: load fence — don't shrink below grouped page mass loaded at session start ──
        // After refresh, loadProjectDataForView merges IDB + Firestore by lastSaveId.
        // If Firestore still lags an incomplete write, the fence blocks a shrink until
        // a local save clears it.
        if (data && loadFenceRef.current > 0) {
          const incomingTotal = groupedPageMass(data);
          if (incomingTotal < loadFenceRef.current) {
            console.warn(
              '[PERSIST] Load fence active — rejecting snapshot that would shrink grouped pages from',
              loadFenceRef.current, 'to', incomingTotal,
              '(fence clears on first local save)',
            );
            return;
          }
          // Snapshot is >= fence, safe to apply. Clear fence since Firestore is caught up.
          loadFenceRef.current = 0;
        }

        // ── Guard 6: stale saveId snapshot shrink protection ──
        // Prevent late arrival of an older save (often from cache/listener timing) from
        // shrinking grouped pages after we've already advanced locally.
        if (data) {
          const incomingSaveId = data.lastSaveId ?? 0;
          const localSaveId = saveCounterRef.current;
          const incomingPages = groupedPageMass(data);
          const localPages = countGroupedPages(latest.current);
          if (
            incomingSaveId > 0 &&
            localSaveId > 0 &&
            incomingSaveId < localSaveId &&
            incomingPages < localPages
          ) {
            console.warn(
              '[PERSIST] Rejecting stale snapshot shrink: saveId',
              incomingSaveId,
              '<',
              localSaveId,
              'pages',
              incomingPages,
              '<',
              localPages,
            );
            return;
          }
        }

        applyViewState(
          data ? toProjectViewState(data, project) : createEmptyProjectViewState()
        );
        if (data && pid) {
          saveToIDB(pid, data).catch((err) =>
            logPersistError('IDB cache after remote snapshot', err),
          );
        }
      },
      (err) => {
        markListenerError('project_chunks');
        reportPersistFailure(addToast, 'project chunks listener', err);
      },
    );
    return () => {
      clearListenerError('project_chunks');
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

    const nextGrouped = groupsToReturn.length > 0
      ? [...s.groupedClusters, ...groupsToReturn]
      : s.groupedClusters;

    const nextClusters = clustersToReturn.length > 0 && s.clusterSummary
      ? [...s.clusterSummary, ...clustersToReturn]
      : s.clusterSummary;

    let nextResults = s.results;
    if (s.results && clustersToReturn.length > 0) {
      nextResults = appendResultRowsRemoveFromApproved(s.results, clustersToReturn);
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

    const nextClusters = s.clusterSummary
      ? [...s.clusterSummary, ...clustersToReturn]
      : null;

    let nextResults = s.results;
    if (s.results && clustersToReturn.length > 0) {
      nextResults = appendResultRowsUngroup(s.results, clustersToReturn);
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

  // Debounced suggestion-only persistence — onSuggestionsChange can still fire very
  // often; main mutations now coalesce in flushPersistQueue. Suggestions alone use
  // a 2s idle timer so we do not schedule redundant flushes on every keystroke.
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSuggestions = useCallback((suggestions: AutoGroupSuggestion[]) => {
    // Update state + ref immediately (UI stays responsive)
    latest.current = { ...latest.current, autoGroupSuggestions: suggestions };
    setAutoGroupSuggestions(suggestions);
    // Persist immediately to local cache for crash resilience.
    checkpointToIDB({ autoGroupSuggestions: suggestions });

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
        if (proj) saveProjectToFirestore(proj);
      }
    }
    mutateAndSave(() => changes);
  }, [mutateAndSave, projects, setProjects]);

  // ── Return ────────────────────────────────────────────────────────────
  return {
    // Read-only state
    results, clusterSummary, tokenSummary, groupedClusters,
    approvedGroups, blockedKeywords, activityLog, stats,
    datasetStats, autoGroupSuggestions, tokenMergeRules,
    autoMergeRecommendations,
    blockedTokens, labelSections, fileName,
    activeProjectId,

    // Project lifecycle
    setActiveProjectId,
    loadProject,
    clearProject,
    syncFileNameLocal,

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
    updateSuggestions,
    addActivityEntry,
    clearActivityLog,
    bulkSet,

    // Transitional setters (for code not yet migrated to atomic mutations)
    setResults, setClusterSummary, setTokenSummary, setGroupedClusters,
    setApprovedGroups, setBlockedKeywords, setActivityLog, setStats,
    setDatasetStats, setAutoGroupSuggestions, setTokenMergeRules,
    setAutoMergeRecommendations,
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
      tokenMergeRules: tokenMergeRulesRef,
      blockedTokens: blockedTokensRef,
      labelSections: labelSectionsRef,
      fileName: fileNameRef,
      activeProjectId: activeProjectIdRef,
    },
  };
}
