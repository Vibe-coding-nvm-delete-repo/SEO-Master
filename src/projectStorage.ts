import { db } from './firebase';
import { collection, deleteDoc, doc, getDocFromServer, getDocs, getDocsFromServer, setDoc, writeBatch } from 'firebase/firestore';
import type {
  ActivityLogEntry,
  AutoMergeRecommendation,
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

export const LS_PROJECTS_KEY = 'kwg_projects';
export const LS_SAVED_CLUSTERS_KEY = 'kwg_saved_clusters';
export const LS_ACTIVE_PROJECT_KEY = 'kwg_active_project';

const IDB_NAME = 'kwg_database';
const IDB_STORE = 'project_data';
const IDB_VERSION = 2;
const FIRESTORE_PROJECTS_COLLECTION = 'projects';
const APP_SETTINGS_COLLECTION = 'app_settings';
const APP_PREFS_DOC = 'user_preferences';
/** Rows per chunk — keep under Firestore’s ~1 MiB/doc limit for heavy rows + nested cluster data */
const CHUNK_SIZE = 200;
const CHUNKS_SUBCOLLECTION = 'chunks';

/**
 * Firestore rejects nested `undefined` values; IDB saves already use JSON round-trip.
 * Apply the same normalization before `batch.set` so cloud sync matches local persistence.
 */
export function sanitizeJsonForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface GroupCollections {
  groupedClusters: GroupedCluster[] | null | undefined;
  approvedGroups: GroupedCluster[] | null | undefined;
}

export interface ProjectDataPayload {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  tokenSummary: TokenSummary[] | null;
  groupedClusters: GroupedCluster[] | null;
  approvedGroups: GroupedCluster[];
  stats: Stats | null;
  datasetStats: unknown | null;
  blockedTokens: string[];
  blockedKeywords: BlockedKeyword[];
  labelSections: LabelSection[];
  activityLog: ActivityLogEntry[];
  tokenMergeRules: TokenMergeRule[];
  autoGroupSuggestions: AutoGroupSuggestion[];
  autoMergeRecommendations?: AutoMergeRecommendation[];
  updatedAt: string;
  /** Incrementing save counter — persisted so that on reload we can reject stale
   *  Firestore snapshots that predate the IDB data (prevents data loss on refresh). */
  lastSaveId?: number;
}

export interface AppPrefs {
  activeProjectId: string | null;
  savedClusters: any[];
}

/** Total rows that represent uploaded CSV / cluster table data (not grouped-only). */
function dataRowMass(p: ProjectDataPayload): number {
  return (p.results?.length ?? 0) + (p.clusterSummary?.length ?? 0);
}

function groupMass(p: ProjectDataPayload): number {
  return (p.groupedClusters?.length ?? 0) + (p.approvedGroups?.length ?? 0);
}

/** Count pages sitting in grouped + approved collections. */
export function countGroupedPages(input: GroupCollections): number {
  let n = 0;
  for (const g of input.groupedClusters || []) n += g.clusters?.length ?? 0;
  for (const g of input.approvedGroups || []) n += g.clusters?.length ?? 0;
  return n;
}

/** Pages sitting in grouped + approved (the number users care about on refresh). */
export function groupedPageMass(p: ProjectDataPayload): number {
  return countGroupedPages(p);
}

/**
 * Merge IDB (first arg) vs Firestore (second arg).
 * Primary: monotonic lastSaveId, then updatedAt.
 * Tie: prefer Firestore — it is the shared source of truth once written.
 * Safety: IDB can have a higher lastSaveId but zero rows (raced/corrupt cache) while Firestore
 * still holds the last good CSV; legacy FS payloads may omit lastSaveId (0). Prefer the side
 * that actually has rows in those cases.
 */
export function pickNewerProjectPayload(idb: ProjectDataPayload, fs: ProjectDataPayload): ProjectDataPayload {
  const idI = idb.lastSaveId ?? 0;
  const idF = fs.lastSaveId ?? 0;
  const mI = dataRowMass(idb);
  const mF = dataRowMass(fs);

  // Higher local saveId but empty table vs server with rows (failed FS after bad IDB write, or legacy meta without saveId)
  if (idI > idF && mI === 0 && mF > 0) {
    if (idF === 0) return fs;
    if (idI - idF > 5) return fs;
  }
  if (idF > idI && mF === 0 && mI > 0) {
    if (idI === 0) return idb;
    if (idF - idI > 5) return idb;
  }

  const gI = groupMass(idb);
  const gF = groupMass(fs);
  // Same class of bug as CSV: IDB can have a higher saveId but fewer groups (raced writes)
  // while Firestore still holds the last committed grouped chunks.
  if (idI > idF && gI < gF && gF > 0) {
    if (idF === 0) return fs;
    if (idI - idF > 5) return fs;
  }
  if (idF > idI && gF < gI && gI > 0) {
    if (idI === 0) return idb;
    if (idF - idI > 5) return idb;
  }

  // ── Grouped PAGE mass (clusters inside groups) — fixes 350 → 30 on refresh ──
  // IDB can have lastSaveId = N+1 with a corrupt/partial write (few pages) while
  // Firestore still has N with the full grouped set. lastSaveId-only merge picks IDB → loss.
  // When saveIds are within 2, prefer whoever has more pages in grouped+approved.
  const pI = groupedPageMass(idb);
  const pF = groupedPageMass(fs);
  const idGap = Math.abs(idI - idF);
  if (idGap <= 2) {
    if (pI > pF) return idb;
    if (pF > pI) return fs;
  }

  if (idF > idI) return fs;
  if (idI > idF) return idb;
  const tI = Date.parse(idb.updatedAt || '0');
  const tF = Date.parse(fs.updatedAt || '0');
  if (tF > tI) return fs;
  if (tI > tF) return idb;
  return fs; // tie: prefer Firestore
}

export const buildProjectDataPayloadFromChunkDocs = (
  docs: Array<{ data: () => any }>
): ProjectDataPayload | null => {
  let meta: any = null;
  const resultChunks: { index: number; data: ProcessedRow[] }[] = [];
  const clusterChunks: { index: number; data: ClusterSummary[] }[] = [];
  const blockedChunks: { index: number; data: BlockedKeyword[] }[] = [];
  const suggestionChunks: { index: number; data: AutoGroupSuggestion[] }[] = [];
  const autoMergeChunks: { index: number; data: AutoMergeRecommendation[] }[] = [];
  // grouped/approved chunk docs can briefly lag behind `chunks/meta` updates during
  // multi-batch writes. We include `saveId` so we can detect and ignore those snapshots.
  const groupedChunks: { index: number; data: GroupedCluster[]; saveId: unknown }[] = [];
  const approvedChunks: { index: number; data: GroupedCluster[]; saveId: unknown }[] = [];

  docs.forEach((docSnap) => {
    const chunk = docSnap.data();
    if (chunk.type === 'meta') meta = chunk;
    else if (chunk.type === 'results') resultChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'clusters') clusterChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'blocked') blockedChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'suggestions') suggestionChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'auto_merge') autoMergeChunks.push({ index: chunk.index, data: chunk.data });
    else if (chunk.type === 'grouped')
      groupedChunks.push({ index: chunk.index, data: chunk.data, saveId: chunk.saveId ?? null });
    else if (chunk.type === 'approved')
      approvedChunks.push({ index: chunk.index, data: chunk.data, saveId: chunk.saveId ?? null });
  });

  if (!meta) return null;

  // If `meta.saveId` is set, require grouped/approved chunk docs in the snapshot
  // to match that same saveId. This prevents temporary shrink when `meta` updates
  // before the corresponding chunk doc contents are written.
  const metaSaveId = meta.saveId ?? null;
  if (metaSaveId != null) {
    if (groupedChunks.length > 0 && groupedChunks.some((c) => c.saveId !== metaSaveId)) return null;
    if (approvedChunks.length > 0 && approvedChunks.some((c) => c.saveId !== metaSaveId)) return null;
  }

  // Chunked fields are written across multiple Firestore batches; `meta` is last. A snapshot can
  // briefly include new chunk docs while `meta` still reflects the *previous* save. Using only
  // meta.*ChunkCount would then filter OUT new chunks (index >= stale count) and shrink state
  // (e.g. grouped pages dropping from 100 → 20). Conversely, meta can update before all chunk
  // docs are visible — treat as incomplete and return null so the listener does not apply.
  const impliedChunkSpan = (chunks: { index: number }[]) =>
    chunks.length === 0 ? 0 : Math.max(...chunks.map((c) => c.index)) + 1;

  const resultSpan = impliedChunkSpan(resultChunks);
  const clusterSpan = impliedChunkSpan(clusterChunks);
  const blockedSpan = impliedChunkSpan(blockedChunks);
  const suggestionSpan = impliedChunkSpan(suggestionChunks);
  const autoMergeSpan = impliedChunkSpan(autoMergeChunks);
  const groupedSpan = impliedChunkSpan(groupedChunks);
  const approvedSpan = impliedChunkSpan(approvedChunks);

  const resultCountMeta = meta.resultChunkCount ?? resultSpan;
  const clusterCountMeta = meta.clusterChunkCount ?? clusterSpan;
  const blockedCountMeta = meta.blockedChunkCount ?? blockedSpan;
  const suggestionCountMeta = meta.suggestionChunkCount ?? suggestionSpan;
  const autoMergeCountMeta = meta.autoMergeChunkCount ?? autoMergeSpan;
  const groupedCountMeta = meta.groupedClusterCount ?? groupedSpan;
  const approvedCountMeta = meta.approvedGroupCount ?? approvedSpan;

  if (resultChunks.length > 0 && resultSpan < resultCountMeta) return null;
  if (clusterChunks.length > 0 && clusterSpan < clusterCountMeta) return null;
  if (blockedChunks.length > 0 && blockedSpan < blockedCountMeta) return null;
  if (suggestionChunks.length > 0 && suggestionSpan < suggestionCountMeta) return null;
  if (autoMergeChunks.length > 0 && autoMergeSpan < autoMergeCountMeta) return null;
  if (groupedChunks.length > 0 && groupedSpan < groupedCountMeta) return null;
  if (approvedChunks.length > 0 && approvedSpan < approvedCountMeta) return null;

  // Auto-merge recommendations are chunked as well; if meta expects chunks but none
  // are visible yet, treat as an incomplete snapshot (same safety pattern as grouped/approved).
  if (autoMergeChunks.length === 0 && autoMergeCountMeta > 0) {
    return null;
  }

  // New scheme: grouped/approved live only in chunk docs — if meta expects chunks but none yet, wait.
  if (
    groupedChunks.length === 0 &&
    groupedCountMeta > 0 &&
    !(Array.isArray(meta.groupedClusters) && meta.groupedClusters.length > 0)
  ) {
    return null;
  }
  if (
    approvedChunks.length === 0 &&
    approvedCountMeta > 0 &&
    !(Array.isArray(meta.approvedGroups) && meta.approvedGroups.length > 0)
  ) {
    return null;
  }

  const resultCount = Math.max(resultCountMeta, resultSpan);
  const clusterCount = Math.max(clusterCountMeta, clusterSpan);
  const blockedCount = Math.max(blockedCountMeta, blockedSpan);
  const suggestionCount = Math.max(suggestionCountMeta, suggestionSpan);
  const autoMergeCount = Math.max(autoMergeCountMeta, autoMergeSpan);
  const groupedCount = Math.max(groupedCountMeta, groupedSpan);
  const approvedCount = Math.max(approvedCountMeta, approvedSpan);

  const results = resultChunks
    .filter((chunk) => chunk.index < resultCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const clusterSummary = clusterChunks
    .filter((chunk) => chunk.index < clusterCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const blockedKeywords = blockedChunks
    .filter((chunk) => chunk.index < blockedCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const autoGroupSuggestions = suggestionChunks
    .filter((chunk) => chunk.index < suggestionCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);
  const autoMergeRecommendations = autoMergeChunks
    .filter((chunk) => chunk.index < autoMergeCount)
    .sort((a, b) => a.index - b.index)
    .flatMap((chunk) => chunk.data);

  const groupedClusters = groupedChunks.length > 0
    ? groupedChunks
      .filter((chunk) => chunk.index < groupedCount)
      .sort((a, b) => a.index - b.index)
      .flatMap((chunk) => chunk.data)
    : meta.groupedClusters || [];

  const approvedGroups = approvedChunks.length > 0
    ? approvedChunks
      .filter((chunk) => chunk.index < approvedCount)
      .sort((a, b) => a.index - b.index)
      .flatMap((chunk) => chunk.data)
    : meta.approvedGroups || [];

  const lastSaveId =
    typeof metaSaveId === 'number' && Number.isFinite(metaSaveId)
      ? metaSaveId
      : metaSaveId != null && typeof metaSaveId === 'string' && /^\d+$/.test(metaSaveId)
        ? Number(metaSaveId)
        : undefined;

  return {
    // Preserve explicit empty arrays when chunk counts are zero so grouped/approved-only
    // projects still hydrate instead of being treated as an empty workspace.
    results: resultCount > 0 ? results : [],
    clusterSummary: clusterCount > 0 ? clusterSummary : [],
    tokenSummary: meta.tokenSummary || null,
    groupedClusters,
    approvedGroups,
    stats: meta.stats || null,
    datasetStats: meta.datasetStats || null,
    blockedTokens: meta.blockedTokens || [],
    blockedKeywords,
    labelSections: meta.labelSections || [],
    activityLog: meta.activityLog || [],
    tokenMergeRules: meta.tokenMergeRules || [],
    autoGroupSuggestions,
    autoMergeRecommendations,
    updatedAt: meta.updatedAt || new Date().toISOString(),
    lastSaveId,
  };
};

export const loadFromLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const saveToLS = (key: string, data: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn('localStorage save error:', error);
  }
};

const openIDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const dbInstance = request.result;
      if (!dbInstance.objectStoreNames.contains(IDB_STORE)) {
        dbInstance.createObjectStore(IDB_STORE, { keyPath: 'projectId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveToIDB = async (projectId: string, data: unknown) => {
  try {
    const cleanData = JSON.parse(JSON.stringify(data));
    const record = { projectId, ...cleanData };
    const dbInstance = await openIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readwrite');
    const putRequest = tx.objectStore(IDB_STORE).put(record);
    putRequest.onerror = (event) => console.error('IndexedDB put error:', putRequest.error, event);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    dbInstance.close();
  } catch (error) {
    console.error('IndexedDB save error:', error);
  }
};

export const loadFromIDB = async <T,>(projectId: string): Promise<T | null> => {
  try {
    const dbInstance = await openIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).get(projectId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        dbInstance.close();
        resolve((request.result as T) || null);
      };
      request.onerror = () => {
        dbInstance.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('IndexedDB load error:', error);
    return null;
  }
};

export const deleteFromIDB = async (projectId: string) => {
  try {
    const dbInstance = await openIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(projectId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dbInstance.close();
  } catch (error) {
    console.error('IndexedDB delete error:', error);
  }
};

export const saveProjectToFirestore = async (project: Project) => {
  try {
    await setDoc(doc(db, FIRESTORE_PROJECTS_COLLECTION, project.id), {
      ...project,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Firestore save error (project metadata):', error);
  }
  // Also update localStorage cache so projects survive quota errors
  try {
    const cached = localStorage.getItem(LS_PROJECTS_KEY);
    const projects: Project[] = cached ? JSON.parse(cached) : [];
    const idx = projects.findIndex(p => p.id === project.id);
    if (idx >= 0) projects[idx] = project;
    else projects.push(project);
    localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // Ignore localStorage write failures (quota/private mode).
  }
};

export const deleteProjectFromFirestore = async (projectId: string) => {
  try {
    await deleteDoc(doc(db, FIRESTORE_PROJECTS_COLLECTION, projectId));
  } catch (error) {
    console.warn('Firestore delete error:', error);
  }
};

export const saveAppPrefsToFirestore = async (activeId: string | null, clusters: any[]) => {
  try {
    await setDoc(doc(db, APP_SETTINGS_COLLECTION, APP_PREFS_DOC), {
      activeProjectId: activeId,
      savedClusters: clusters,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Firestore app prefs save error:', error);
  }
};

export const saveAppPrefsToIDB = async (activeId: string | null, clusters: any[]) => {
  try {
    const dbInstance = await openIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({
      projectId: '__app_prefs__',
      activeProjectId: activeId,
      savedClusters: clusters,
      updatedAt: new Date().toISOString(),
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dbInstance.close();
  } catch (error) {
    console.warn('IDB app prefs save error:', error);
  }
};

export const loadAppPrefsFromFirestore = async (): Promise<AppPrefs | null> => {
  try {
    const docSnap = await getDocFromServer(doc(db, APP_SETTINGS_COLLECTION, APP_PREFS_DOC));
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        activeProjectId: data.activeProjectId || null,
        savedClusters: data.savedClusters || [],
      };
    }
  } catch (error) {
    console.warn('Firestore app prefs load error:', error);
  }
  return null;
};

export const loadAppPrefsFromIDB = async (): Promise<AppPrefs | null> => {
  try {
    const dbInstance = await openIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).get('__app_prefs__');
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        dbInstance.close();
        if (request.result) {
          resolve({
            activeProjectId: request.result.activeProjectId || null,
            savedClusters: request.result.savedClusters || [],
          });
          return;
        }
        resolve(null);
      };
      request.onerror = () => {
        dbInstance.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn('IDB app prefs load error:', error);
    return null;
  }
};

export const saveProjectDataToFirestore = async (
  projectId: string,
  data: ProjectDataPayload,
  options?: { onSyncStatus?: (status: 'syncing' | 'synced' | 'error') => void; saveId?: number | string; clientId?: string },
) => {
  options?.onSyncStatus?.('syncing');
  try {
    const dataClean = sanitizeJsonForFirestore(data);

    const chunksRef = collection(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION);

    // Fetch existing chunks in background — don't block the write path
    const existingChunksPromise = getDocs(chunksRef).catch(() => null);

    const results = dataClean.results || [];
    const resultChunks: ProcessedRow[][] = [];
    for (let i = 0; i < results.length; i += CHUNK_SIZE) {
      resultChunks.push(results.slice(i, i + CHUNK_SIZE));
    }

    const clusters = dataClean.clusterSummary || [];
    const clusterChunks: ClusterSummary[][] = [];
    for (let i = 0; i < clusters.length; i += CHUNK_SIZE) {
      clusterChunks.push(clusters.slice(i, i + CHUNK_SIZE));
    }

    const blocked = dataClean.blockedKeywords || [];
    const blockedChunks: BlockedKeyword[][] = [];
    for (let i = 0; i < blocked.length; i += CHUNK_SIZE) {
      blockedChunks.push(blocked.slice(i, i + CHUNK_SIZE));
    }

    const suggestions = dataClean.autoGroupSuggestions || [];
    const suggestionChunks: AutoGroupSuggestion[][] = [];
    for (let i = 0; i < suggestions.length; i += CHUNK_SIZE) {
      suggestionChunks.push(suggestions.slice(i, i + CHUNK_SIZE));
    }
    const autoMergeRecommendations = dataClean.autoMergeRecommendations || [];
    const autoMergeChunks: AutoMergeRecommendation[][] = [];
    for (let i = 0; i < autoMergeRecommendations.length; i += CHUNK_SIZE) {
      autoMergeChunks.push(autoMergeRecommendations.slice(i, i + CHUNK_SIZE));
    }

    // groupedClusters / approvedGroups are stored chunked to avoid Firestore's 1MB doc limit.
    // (Previously they lived inside `chunks/meta`, which breaks for large group sizes.)
    const groupedClusters = dataClean.groupedClusters || [];
    const approvedGroups = dataClean.approvedGroups || [];
    const GROUPED_CHUNK_SIZE = 50;
    const groupedChunks: GroupedCluster[][] = [];
    const approvedChunks: GroupedCluster[][] = [];
    for (let i = 0; i < groupedClusters.length; i += GROUPED_CHUNK_SIZE) {
      groupedChunks.push(groupedClusters.slice(i, i + GROUPED_CHUNK_SIZE));
    }
    for (let i = 0; i < approvedGroups.length; i += GROUPED_CHUNK_SIZE) {
      approvedChunks.push(approvedGroups.slice(i, i + GROUPED_CHUNK_SIZE));
    }

    const writeBatches: Promise<void>[] = [];
    let batch = writeBatch(db);
    let ops = 0;

    const addToBatch = (docId: string, payload: unknown) => {
      batch.set(doc(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION, docId), payload);
      ops++;
      if (ops >= 500) {
        writeBatches.push(batch.commit());
        batch = writeBatch(db);
        ops = 0;
      }
    };

    resultChunks.forEach((chunk, idx) => addToBatch(`results_${idx}`, { type: 'results', index: idx, data: chunk }));
    clusterChunks.forEach((chunk, idx) => addToBatch(`clusters_${idx}`, { type: 'clusters', index: idx, data: chunk }));
    blockedChunks.forEach((chunk, idx) => addToBatch(`blocked_${idx}`, { type: 'blocked', index: idx, data: chunk }));
    suggestionChunks.forEach((chunk, idx) => addToBatch(`suggestions_${idx}`, { type: 'suggestions', index: idx, data: chunk }));
    autoMergeChunks.forEach((chunk, idx) => addToBatch(`auto_merge_${idx}`, { type: 'auto_merge', index: idx, data: chunk }));
    approvedChunks.forEach((chunk, idx) =>
      addToBatch(`approved_${idx}`, {
        type: 'approved',
        index: idx,
        saveId: options?.saveId ?? null,
        data: chunk,
      })
    );
    groupedChunks.forEach((chunk, idx) =>
      addToBatch(`grouped_${idx}`, {
        type: 'grouped',
        index: idx,
        saveId: options?.saveId ?? null,
        data: chunk,
      })
    );
    addToBatch('meta', {
      type: 'meta',
      saveId: options?.saveId ?? null,
      clientId: options?.clientId ?? null,
      stats: dataClean.stats || null,
      datasetStats: dataClean.datasetStats || null,
      tokenSummary: dataClean.tokenSummary || null,
      groupedClusterCount: groupedChunks.length,
      approvedGroupCount: approvedChunks.length,
      blockedTokens: dataClean.blockedTokens || [],
      labelSections: dataClean.labelSections || [],
      activityLog: (dataClean.activityLog || []).slice(0, 500),
      tokenMergeRules: dataClean.tokenMergeRules || [],
      updatedAt: new Date().toISOString(),
      resultChunkCount: resultChunks.length,
      clusterChunkCount: clusterChunks.length,
      blockedChunkCount: blockedChunks.length,
      suggestionChunkCount: suggestionChunks.length,
      autoMergeChunkCount: autoMergeChunks.length,
    });

    if (ops > 0) writeBatches.push(batch.commit());
    await Promise.all(writeBatches);

    // Clean up stale chunks (runs after writes complete, non-blocking for the caller)
    const existingChunks = await existingChunksPromise;
    if (existingChunks && !existingChunks.empty) {
      // Prevent cross-writer destructive cleanup:
      // Only delete stale chunks if the project's current meta.saveId still matches
      // the saveId for this save request.
      if (options?.saveId != null) {
        try {
          const metaSnap = await getDocFromServer(
            doc(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION, 'meta'),
          );
          const remoteSaveId = metaSnap.exists() ? (metaSnap.data() as any)?.saveId : null;
          if (remoteSaveId !== options.saveId) {
            options?.onSyncStatus?.('synced');
            return;
          }
        } catch {
          // If we cannot verify, keep existing chunks instead of risking deletion.
          options?.onSyncStatus?.('synced');
          return;
        }
      }

      const validDocIds = new Set<string>([
        'meta',
        ...resultChunks.map((_, idx) => `results_${idx}`),
        ...clusterChunks.map((_, idx) => `clusters_${idx}`),
        ...blockedChunks.map((_, idx) => `blocked_${idx}`),
        ...suggestionChunks.map((_, idx) => `suggestions_${idx}`),
        ...autoMergeChunks.map((_, idx) => `auto_merge_${idx}`),
        ...groupedChunks.map((_, idx) => `grouped_${idx}`),
        ...approvedChunks.map((_, idx) => `approved_${idx}`),
      ]);

      const deleteBatches: Promise<void>[] = [];
      let deleteBatch = writeBatch(db);
      let deleteOps = 0;
      existingChunks.forEach((docSnap) => {
        if (validDocIds.has(docSnap.id)) return;
        deleteBatch.delete(docSnap.ref);
        deleteOps++;
        if (deleteOps >= 500) {
          deleteBatches.push(deleteBatch.commit());
          deleteBatch = writeBatch(db);
          deleteOps = 0;
        }
      });
      if (deleteOps > 0) deleteBatches.push(deleteBatch.commit());
      if (deleteBatches.length > 0) await Promise.all(deleteBatches);
    }

    options?.onSyncStatus?.('synced');
  } catch (error) {
    console.error('[PERSIST ERROR] Firestore data save FAILED for project:', projectId, error);
    options?.onSyncStatus?.('error');
    // Important: let callers know the save failed so they don't assume
    // state was persisted (prevents "refresh reverts" confusion).
    throw error;
  }
};

export const loadProjectDataFromFirestore = async (projectId: string): Promise<ProjectDataPayload | null> => {
  try {
    const chunksRef = collection(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION);
    // Server read — avoids stale local cache after refresh (getDocs can return an older
    // persisted view while a newer write is still only partially synced to the client).
    let snapshot;
    try {
      snapshot = await getDocsFromServer(chunksRef);
    } catch {
      snapshot = await getDocs(chunksRef);
    }
    if (snapshot.empty) return null;
    return buildProjectDataPayloadFromChunkDocs(snapshot.docs);
  } catch (error) {
    console.warn('Firestore data load error:', error);
    return null;
  }
};

export const deleteProjectDataFromFirestore = async (projectId: string) => {
  try {
    const chunksRef = collection(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION);
    const snapshot = await getDocs(chunksRef);
    if (snapshot.empty) return;
    const batches: Promise<void>[] = [];
    let batch = writeBatch(db);
    let ops = 0;
    snapshot.forEach((docSnap) => {
      batch.delete(docSnap.ref);
      ops++;
      if (ops >= 500) {
        batches.push(batch.commit());
        batch = writeBatch(db);
        ops = 0;
      }
    });
    if (ops > 0) batches.push(batch.commit());
    await Promise.all(batches);
  } catch (error) {
    console.warn('Firestore data chunk delete error:', error);
  }
};

export const loadProjectsFromFirestore = async (): Promise<Project[]> => {
  try {
    const snapshot = await getDocs(collection(db, FIRESTORE_PROJECTS_COLLECTION));

    const firestoreProjects: Project[] = [];
    snapshot.forEach((docSnap: any) => {
      const data = docSnap.data();
      firestoreProjects.push({
        id: docSnap.id,
        name: data.name || '',
        description: data.description || '',
        createdAt: data.createdAt || new Date().toISOString(),
        uid: data.uid || 'local',
        fileName: data.fileName,
      });
    });

    if (firestoreProjects.length > 0) {
      // Cache to localStorage so projects survive Firestore quota errors
      try {
        localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(firestoreProjects));
      } catch {
        // Ignore localStorage write failures (quota/private mode).
      }
      return firestoreProjects;
    }
  } catch (error) {
    console.warn('Firestore load error (likely quota exceeded):', error);
    // Fallback: try loading from localStorage cache
    try {
      const cached = localStorage.getItem(LS_PROJECTS_KEY);
      if (cached) {
        const projects = JSON.parse(cached) as Project[];
        if (projects.length > 0) {
          console.log('[PROJECTS] Using localStorage cache:', projects.length, 'projects');
          return projects;
        }
      }
    } catch {
      // Ignore localStorage read failures and fall through to empty list.
    }
  }

  return [];
};
