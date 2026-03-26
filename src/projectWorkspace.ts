import type {
  ActivityLogEntry,
  AutoGroupSuggestion,
  BlockedKeyword,
  ClusterSummary,
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

export interface ProjectViewState {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  tokenSummary: TokenSummary[] | null;
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];
  activityLog: ActivityLogEntry[];
  tokenMergeRules: TokenMergeRule[];
  autoGroupSuggestions: AutoGroupSuggestion[];
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
): ProjectViewState => {
  if (!data) {
    return createEmptyProjectViewState();
  }

  return {
    results: data.results || null,
    clusterSummary: data.clusterSummary || null,
    tokenSummary: data.tokenSummary || null,
    groupedClusters: data.groupedClusters || [],
    approvedGroups: data.approvedGroups || [],
    activityLog: data.activityLog || [],
    tokenMergeRules: data.tokenMergeRules || [],
    autoGroupSuggestions: data.autoGroupSuggestions || [],
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
  } catch { /* fall through */ }

  // IDB miss — fallback to Firestore
  const prefs = await loadAppPrefsFromFirestore();
  if (prefs) {
    saveAppPrefsToIDB(prefs.activeProjectId, prefs.savedClusters).catch(() => {});
    return prefs;
  }

  return { savedClusters: [], activeProjectId: null };
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
    if (fsData) saveToIDB(projectId, fsData).catch(() => {});
    return fsData;
  }
  if (!fsData) return idbData;

  const picked = pickNewerProjectPayload(idbData, fsData);
  if (picked === fsData) {
    saveToIDB(projectId, fsData).catch(() => {});
  }
  return picked;
};
