import type {
  ActivityLogEntry,
  AutoMergeRecommendation,
  AutoGroupSuggestion,
  BlockedKeyword,
  ClusterSummary,
  GroupMergeRecommendation,
  GroupedCluster,
  LabelSection,
  ProcessedRow,
  Project,
  Stats,
  TokenMergeRule,
  TokenSummary,
} from './types';
import {
  loadAppPrefsFromFirestore,
  loadAppPrefsFromIDB,
  loadFromIDB,
  loadProjectDataFromFirestore,
  pickNewerProjectPayload,
  saveAppPrefsToIDB,
  saveToIDB,
  type AppPrefs,
  type ProjectDataPayload,
} from './projectStorage';
import { logPersistError } from './persistenceErrors';
import { rebuildClusters, refreshGroupsFromClusterSummaries } from './tokenMerge';

export interface ProjectViewState {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  tokenSummary: TokenSummary[] | null;
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];
  activityLog: ActivityLogEntry[];
  tokenMergeRules: TokenMergeRule[];
  autoGroupSuggestions: AutoGroupSuggestion[];
  autoMergeRecommendations: AutoMergeRecommendation[];
  groupMergeRecommendations: GroupMergeRecommendation[];
  stats: Stats | null;
  datasetStats: unknown | null;
  blockedTokens: string[];
  blockedKeywords: BlockedKeyword[];
  labelSections: LabelSection[];
  fileName: string | null;
}

export const createEmptyProjectViewState = (): ProjectViewState => ({
  results: null,
  clusterSummary: null,
  tokenSummary: null,
  groupedClusters: [],
  approvedGroups: [],
  activityLog: [],
  tokenMergeRules: [],
  autoGroupSuggestions: [],
  autoMergeRecommendations: [],
  groupMergeRecommendations: [],
  stats: null,
  datasetStats: null,
  blockedTokens: [],
  blockedKeywords: [],
  labelSections: [],
  fileName: null,
});

export const toProjectViewState = (
  data: ProjectDataPayload | null,
  project?: Project | null,
  opts?: { skipRebuild?: boolean },
): ProjectViewState => {
  if (!data) {
    return createEmptyProjectViewState();
  }

  const results = data.results || null;
  let clusterSummary = data.clusterSummary || null;
  let groupedClusters = data.groupedClusters || [];
  let approvedGroups = data.approvedGroups || [];

  // `results` is the source of truth for per-keyword fields (e.g. kwRating). Chunked
  // Firestore/IDB payloads can have stale clusterSummary vs results after a refresh or
  // older saves — rebuild aggregates so Ungrouped / Grouped / Approved rating columns match.
  //
  // When skipRebuild is requested (IDB-first fast path), we do a cheap consistency check:
  // if clusterSummary total keyword count matches results length, the data is consistent
  // and we can skip the expensive O(n) rebuildClusters call.
  if (results && results.length > 0) {
    let needsRebuild = true;
    if (opts?.skipRebuild && clusterSummary && clusterSummary.length > 0) {
      const totalKw = clusterSummary.reduce((sum, c) => sum + c.keywordCount, 0);
      if (totalKw === results.length) {
        needsRebuild = false;
      }
    }
    if (needsRebuild) {
      clusterSummary = rebuildClusters(results);
      const refreshed = refreshGroupsFromClusterSummaries(
        groupedClusters,
        approvedGroups,
        clusterSummary,
      );
      groupedClusters = refreshed.groupedClusters;
      approvedGroups = refreshed.approvedGroups;
    }
  }

  return {
    results,
    clusterSummary,
    tokenSummary: data.tokenSummary || null,
    groupedClusters,
    approvedGroups,
    activityLog: data.activityLog || [],
    tokenMergeRules: data.tokenMergeRules || [],
    autoGroupSuggestions: data.autoGroupSuggestions || [],
    autoMergeRecommendations: data.autoMergeRecommendations || [],
    groupMergeRecommendations: data.groupMergeRecommendations || [],
    stats: data.stats || null,
    datasetStats: data.datasetStats || null,
    blockedTokens: data.blockedTokens || [],
    blockedKeywords: data.blockedKeywords || [],
    labelSections: data.labelSections || [],
    fileName: project?.fileName || 'Project Data',
  };
};

export const loadSavedWorkspacePrefs = async (): Promise<AppPrefs> => {
  // Try IDB first (fast, offline-capable — typically <10ms)
  try {
    const idbPrefs = await loadAppPrefsFromIDB();
    if (idbPrefs) return idbPrefs;
  } catch (e) {
    logPersistError('load app prefs from IDB', e);
  }

  // IDB miss — fallback to Firestore
  const prefs = await loadAppPrefsFromFirestore();
  if (prefs) {
    saveAppPrefsToIDB(prefs.activeProjectId, prefs.savedClusters).catch((e) =>
      logPersistError('cache app prefs to IDB', e),
    );
    return prefs;
  }

  return { savedClusters: [], activeProjectId: null };
};

/**
 * Load project data from IDB only (fast path, ~5ms).
 * Used by the IDB-first loading strategy to show cached data instantly.
 */
export const loadProjectDataFromIDBOnly = async (
  projectId: string,
): Promise<ProjectDataPayload | null> => {
  try {
    return await loadFromIDB<ProjectDataPayload>(projectId);
  } catch (e) {
    logPersistError('IDB-only project load', e);
    return null;
  }
};

/**
 * Background Firestore reconciliation after IDB-first display.
 * Compares saveIds and only returns 'update' if Firestore has newer data.
 */
export const reconcileWithFirestore = async (
  projectId: string,
  idbData: ProjectDataPayload,
): Promise<{ action: 'skip' | 'update'; data?: ProjectDataPayload }> => {
  const fsData = await loadProjectDataFromFirestore(projectId);
  if (!fsData) return { action: 'skip' };

  const idbSaveId = idbData.lastSaveId ?? 0;
  const fsSaveId = fsData.lastSaveId ?? 0;

  // Fast path: if both have saveIds and Firestore is same or older, skip
  if (fsSaveId <= idbSaveId && idbSaveId > 0) return { action: 'skip' };

  // Delegate to existing merge logic for edge cases (saveId=0, timestamps, etc.)
  const picked = pickNewerProjectPayload(idbData, fsData);
  if (picked === idbData) return { action: 'skip' };

  // Firestore wins — update IDB cache
  saveToIDB(projectId, fsData).catch((e) =>
    logPersistError('refresh IDB from Firestore reconciliation', e),
  );
  return { action: 'update', data: picked };
};

export const loadProjectDataForView = async (projectId: string): Promise<ProjectDataPayload | null> => {
  // Load IDB + Firestore in parallel. IndexedDB used to race (older writes could finish
  // after newer ones), so IDB alone was not trustworthy on refresh. We merge using
  // lastSaveId + updatedAt; if Firestore wins, refresh IDB cache.
  const [idbData, fsData] = await Promise.all([
    loadFromIDB<ProjectDataPayload>(projectId),
    loadProjectDataFromFirestore(projectId),
  ]);

  if (!idbData && !fsData) return null;
  if (!idbData) {
    if (fsData) {
      saveToIDB(projectId, fsData).catch((e) =>
        logPersistError('cache Firestore project to IDB (no local)', e),
      );
    }
    return fsData;
  }
  if (!fsData) return idbData;

  const picked = pickNewerProjectPayload(idbData, fsData);
  if (picked === fsData) {
    saveToIDB(projectId, fsData).catch((e) =>
      logPersistError('refresh IDB from Firestore after merge', e),
    );
  }
  return picked;
};
