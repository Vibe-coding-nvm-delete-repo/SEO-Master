import { db } from './firebase';
import { collection, deleteDoc, doc, getDocFromServer, getDocs, getDocsFromServer, setDoc, writeBatch } from 'firebase/firestore';
import {
  recordLocalPersistError,
  recordLocalPersistOk,
  recordLocalPersistStart,
  recordSharedCloudWriteError,
  recordSharedCloudWriteOk,
  recordSharedCloudWriteStart,
} from './cloudSyncStatus';
import {
  deleteQaLocalCache,
  isContentPipelineQaMode,
  loadQaLocalCache,
  saveQaLocalCache,
} from './qa/contentPipelineQaRuntime';
import { withPersistTimeout } from './persistTimeout';
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
  ProjectFolder,
  Stats,
  TokenMergeRule,
  TokenSummary,
} from './types';

export const LS_PROJECTS_KEY = 'kwg_projects';
export const LS_PROJECT_FOLDERS_KEY = 'kwg_project_folders';
export const LS_SAVED_CLUSTERS_KEY = 'kwg_saved_clusters';
export const LS_ACTIVE_PROJECT_KEY = 'kwg_active_project';

const IDB_NAME = 'kwg_database';
const IDB_STORE = 'project_data';
const IDB_VERSION = 2;
const FIRESTORE_PROJECTS_COLLECTION = 'projects';
const APP_SETTINGS_COLLECTION = 'app_settings';
const APP_PREFS_DOC = 'user_preferences';
/** Firestore doc for project folder definitions (Projects tab). */
export const PROJECT_FOLDERS_FS_DOC = 'project_folders';
/** Rows per chunk — keep under Firestore’s ~1 MiB/doc limit for heavy rows + nested cluster data */
const CHUNK_SIZE = 200;
const CHUNKS_SUBCOLLECTION = 'chunks';

/**
 * Firestore rejects nested `undefined` values.
 * Apply JSON normalization before `batch.set` so cloud payloads are Firestore-safe.
 */
export function sanitizeJsonForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toIDBRecord(projectId: string, data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { projectId, ...(data as Record<string, unknown>) };
  }
  return { projectId, value: data };
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
  groupMergeRecommendations?: GroupMergeRecommendation[];
  updatedAt: string;
  /** Incrementing save counter — persisted so that on reload we can reject stale
   *  Firestore snapshots that predate the IDB data (prevents data loss on refresh). */
  lastSaveId?: number;
}

export interface AppPrefs {
  activeProjectId: string | null;
  savedClusters: any[];
}

export interface LoadProjectsBootstrapResult {
  projects: Project[];
  source: 'firestore' | 'local-cache' | 'empty';
}

/** Any meaningful data present (rows, clusters, groups, approved)? */
function hasAnyData(p: ProjectDataPayload): boolean {
  return (
    (p.results?.length ?? 0) > 0 ||
    (p.clusterSummary?.length ?? 0) > 0 ||
    (p.groupedClusters?.length ?? 0) > 0 ||
    (p.approvedGroups?.length ?? 0) > 0
  );
}

import {
  buildProjectDataPayloadFromChunkDocs,
  countGroupedPages,
  groupedPageMass,
} from './projectChunkPayload';

export { buildProjectDataPayloadFromChunkDocs, countGroupedPages, groupedPageMass };

/**
 * Merge IDB (first arg) vs Firestore (second arg).
 * Primary: monotonic lastSaveId, then updatedAt.
 * Tie: prefer Firestore — it is the shared source of truth once written.
 *
 * Safety: When one side has `lastSaveId = 0` (legacy data written before
 * saveId was introduced), trust the side that has actual CSV rows — the
 * other side is likely an empty/corrupt cache.
 *
 * IMPORTANT: When both sides have a valid saveId (> 0), the higher saveId
 * ALWAYS wins.  Every `mutateAndSave` call increments saveId atomically
 * before IDB checkpoint, so a higher id means newer *regardless* of whether
 * group count or row count decreased (the user may have intentionally
 * ungrouped or unblocked).  Never override saveId with heuristics about
 * data "mass" — that caused data loss when ungroup reduced group count and
 * the stale Firestore side was chosen because it had "more groups."
 */
export function pickNewerProjectPayload(idb: ProjectDataPayload, fs: ProjectDataPayload): ProjectDataPayload {
  const idI = idb.lastSaveId ?? 0;
  const idF = fs.lastSaveId ?? 0;

  // Legacy / missing saveId: one side is 0, the other has data — trust the one with data.
  if (idI === 0 && idF === 0) {
    // Neither has saveId — fall through to timestamp comparison.
  } else if (idI === 0 && idF > 0) {
    // IDB is legacy (no saveId). Trust Firestore if it has data; otherwise IDB.
    return hasAnyData(fs) ? fs : idb;
  } else if (idF === 0 && idI > 0) {
    // Firestore is legacy (no saveId). Trust IDB if it has data; otherwise Firestore.
    return hasAnyData(idb) ? idb : fs;
  } else {
    // Both have valid saveId — higher wins, UNLESS the higher side is completely
    // empty while the lower side has real data. A totally empty payload with a
    // high saveId is a corruption artifact from a clearProject race condition,
    // not an intentional user action. Prefer the side with data.
    if (idI > idF) {
      if (!hasAnyData(idb) && hasAnyData(fs)) return fs;
      return idb;
    }
    if (idF > idI) {
      if (!hasAnyData(fs) && hasAnyData(idb)) return idb;
      return fs;
    }
  }

  // Tie (same saveId or both 0): prefer Firestore as shared source of truth,
  // but check timestamps first.
  const tI = Date.parse(idb.updatedAt || '0');
  const tF = Date.parse(fs.updatedAt || '0');
  if (tF > tI) return fs;
  if (tI > tF) return idb;
  return fs; // absolute tie: prefer Firestore
}

export const loadFromLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

function loadProjectsFromLocalCache(): Project[] {
  try {
    const cached = localStorage.getItem(LS_PROJECTS_KEY);
    if (!cached) return [];
    const projects = JSON.parse(cached) as Project[];
    return Array.isArray(projects) ? projects : [];
  } catch {
    return [];
  }
}

export const saveToLS = (key: string, data: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn('localStorage save error:', error);
  }
};

/**
 * Cached IDB connection — reused across saves to avoid open/close churn.
 * Automatically reopens if the connection is closed or invalidated.
 */
let cachedDb: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase> | null = null;
const IDB_OPEN_TIMEOUT_MS = 8_000;
const IDB_TX_TIMEOUT_MS = 12_000;

function invalidateCachedDb(): void {
  try {
    cachedDb?.close();
  } catch {
    // Ignore close errors; we only care about dropping the cached handle.
  }
  cachedDb = null;
  dbOpenPromise = null;
}

const getIDB = (): Promise<IDBDatabase> => {
  // Return existing healthy connection
  if (cachedDb) {
    try {
      // Probe: if the connection is closed, accessing objectStoreNames throws
      void cachedDb.objectStoreNames;
      return Promise.resolve(cachedDb);
    } catch {
      cachedDb = null;
    }
  }
  // Deduplicate concurrent open requests
  if (dbOpenPromise) return dbOpenPromise;

  const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const dbInstance = request.result;
      if (!dbInstance.objectStoreNames.contains(IDB_STORE)) {
        dbInstance.createObjectStore(IDB_STORE, { keyPath: 'projectId' });
      }
    };
    request.onsuccess = () => {
      const dbInstance = request.result;
      // If the browser closes the connection (e.g. version change), clear cache
      dbInstance.onclose = () => { cachedDb = null; };
      dbInstance.onversionchange = () => {
        dbInstance.close();
        cachedDb = null;
      };
      cachedDb = dbInstance;
      dbOpenPromise = null;
      resolve(dbInstance);
    };
    request.onerror = () => {
      dbOpenPromise = null;
      reject(request.error);
    };
  });
  dbOpenPromise = withPersistTimeout(openPromise, IDB_OPEN_TIMEOUT_MS, 'indexedDB.open').catch((error) => {
    dbOpenPromise = null;
    if ((error as { code?: string })?.code === 'persist-timeout') {
      invalidateCachedDb();
    }
    throw error;
  });
  return dbOpenPromise;
};

/** For tests only — reset the cached IDB connection. */
export const _resetIDBCache = () => { cachedDb = null; dbOpenPromise = null; };

const IDB_MAX_RETRIES = 3;
const IDB_BASE_DELAY_MS = 200;

/**
 * Check if an IDB error is transient and worth retrying.
 * QuotaExceeded is NOT transient (retrying won't help).
 */
function isTransientIDBError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name;
  // Abort/timeout/unknown errors are typically transient
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'UnknownError') return true;
  // InvalidStateError can mean the connection was unexpectedly closed — retry with fresh connection
  if (name === 'InvalidStateError') {
    invalidateCachedDb();
    return true;
  }
  if ((err as { code?: string })?.code === 'persist-timeout') return true;
  return false;
}

async function awaitIDBTransaction(
  tx: IDBTransaction,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const txDone = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  try {
    await withPersistTimeout(txDone, timeoutMs, label);
  } catch (error) {
    if ((error as { code?: string })?.code === 'persist-timeout') {
      try {
        tx.abort();
      } catch {
        // Ignore abort failures; the connection will be invalidated below.
      }
      invalidateCachedDb();
    }
    throw error;
  }
}

export const saveToIDB = async (projectId: string, data: unknown) => {
  if (isContentPipelineQaMode()) {
    await saveQaLocalCache(projectId, data);
    return;
  }
  const record = toIDBRecord(projectId, data);

  let lastError: unknown;
  for (let attempt = 0; attempt <= IDB_MAX_RETRIES; attempt++) {
    try {
      const dbInstance = await getIDB();
      const tx = dbInstance.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
      await awaitIDBTransaction(tx, IDB_TX_TIMEOUT_MS, `IndexedDB write (${projectId})`);
      return; // success
    } catch (error) {
      lastError = error;
      // If connection went bad, clear cache so next attempt gets a fresh one
      if ((error as { name?: string })?.name === 'InvalidStateError') {
        invalidateCachedDb();
      }
      if (attempt < IDB_MAX_RETRIES && isTransientIDBError(error)) {
        const delay = IDB_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[IDB] Save attempt ${attempt + 1} failed (${(error as Error)?.name}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break; // non-transient error or out of retries
    }
  }
  console.error('IndexedDB save error (after retries):', lastError);
  throw lastError;
};

export const loadFromIDB = async <T,>(projectId: string): Promise<T | null> => {
  try {
    if (isContentPipelineQaMode()) {
      return loadQaLocalCache<T>(projectId);
    }
    const dbInstance = await getIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).get(projectId);
    const result = new Promise<T | null>((resolve, reject) => {
      request.onsuccess = () => {
        resolve((request.result as T) || null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
    return await withPersistTimeout(result, IDB_TX_TIMEOUT_MS, `IndexedDB read (${projectId})`);
  } catch (error) {
    console.error('IndexedDB load error:', error);
    if ((error as { code?: string })?.code === 'persist-timeout') {
      invalidateCachedDb();
    }
    return null;
  }
};

export const deleteFromIDB = async (projectId: string) => {
  try {
    if (isContentPipelineQaMode()) {
      await deleteQaLocalCache(projectId);
      return;
    }
    const dbInstance = await getIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(projectId);
    await awaitIDBTransaction(tx, IDB_TX_TIMEOUT_MS, `IndexedDB delete (${projectId})`);
  } catch (error) {
    console.error('IndexedDB delete error:', error);
  }
};

/** Firestore rejects `undefined`; keep optional fields only when defined or explicitly null. */
export function projectMetaForFirestore(project: Project): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    uid: project.uid,
    updatedAt: new Date().toISOString(),
    folderId: project.folderId ?? null,
    deletedAt: project.deletedAt ?? null,
  };
  if (project.fileName !== undefined) base.fileName = project.fileName;
  return sanitizeJsonForFirestore(base);
}

/** Normalize Firestore project document fields into a `Project` (shared by load + snapshot listeners). */
export function projectFromFirestoreData(id: string, data: Record<string, unknown> | undefined): Project {
  const d = data || {};
  return {
    id,
    name: typeof d.name === 'string' ? d.name : '',
    description: typeof d.description === 'string' ? d.description : '',
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
    uid: typeof d.uid === 'string' ? d.uid : 'local',
    fileName: typeof d.fileName === 'string' ? d.fileName : undefined,
    folderId: typeof d.folderId === 'string' ? d.folderId : d.folderId === null ? null : undefined,
    deletedAt: typeof d.deletedAt === 'string' ? d.deletedAt : d.deletedAt === null ? null : undefined,
  };
}

export async function saveProjectFoldersToFirestore(folders: ProjectFolder[]): Promise<void> {
  const clean = sanitizeJsonForFirestore(folders);
  const updatedAt = new Date().toISOString();
  recordLocalPersistStart();
  try {
    await saveToIDB('__project_folders__', { folders: clean, updatedAt });
    recordLocalPersistOk();
  } catch (error) {
    recordLocalPersistError();
    throw error;
  }
  try {
    localStorage.setItem(LS_PROJECT_FOLDERS_KEY, JSON.stringify(clean));
  } catch {
    /* ignore */
  }
  recordSharedCloudWriteStart();
  try {
    await setDoc(doc(db, APP_SETTINGS_COLLECTION, PROJECT_FOLDERS_FS_DOC), {
      folders: clean,
      updatedAt,
    });
    recordSharedCloudWriteOk();
  } catch (error) {
    recordSharedCloudWriteError();
    throw error;
  }
}

/** Sets `folderId` on many projects (e.g. when removing a folder, move all to unassigned). */
export async function batchSetProjectsFolderId(projectIds: string[], folderId: string | null): Promise<void> {
  if (projectIds.length === 0) return;
  const MAX = 500;
  for (let i = 0; i < projectIds.length; i += MAX) {
    const slice = projectIds.slice(i, i + MAX);
    const batch = writeBatch(db);
    for (const id of slice) {
      batch.set(
        doc(db, FIRESTORE_PROJECTS_COLLECTION, id),
        {
          folderId,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

export async function softDeleteProjectInFirestore(projectId: string): Promise<void> {
  await setDoc(
    doc(db, FIRESTORE_PROJECTS_COLLECTION, projectId),
    {
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function reviveProjectInFirestore(project: Project): Promise<void> {
  const revived: Project = { ...project, deletedAt: null };
  await setDoc(doc(db, FIRESTORE_PROJECTS_COLLECTION, project.id), projectMetaForFirestore(revived));
}

export const saveProjectToFirestore = async (project: Project) => {
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
  recordSharedCloudWriteStart();
  try {
    await setDoc(doc(db, FIRESTORE_PROJECTS_COLLECTION, project.id), projectMetaForFirestore(project));
    recordSharedCloudWriteOk();
  } catch (error) {
    recordSharedCloudWriteError();
    console.warn('Firestore save error (project metadata):', error);
    throw error;
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
    const dbInstance = await getIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({
      projectId: '__app_prefs__',
      activeProjectId: activeId,
      savedClusters: clusters,
      updatedAt: new Date().toISOString(),
    });
    await awaitIDBTransaction(tx, IDB_TX_TIMEOUT_MS, 'IndexedDB write (__app_prefs__)');
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
    const dbInstance = await getIDB();
    const tx = dbInstance.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).get('__app_prefs__');
    const result = new Promise<AppPrefs | null>((resolve, reject) => {
      request.onsuccess = () => {
        if (request.result) {
          const wrapped = request.result.value ?? request.result;
          resolve({
            activeProjectId: wrapped.activeProjectId || null,
            savedClusters: wrapped.savedClusters || [],
          });
          return;
        }
        resolve(null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
    return await withPersistTimeout(result, IDB_TX_TIMEOUT_MS, 'IndexedDB read (__app_prefs__)');
  } catch (error) {
    console.warn('IDB app prefs load error:', error);
    if ((error as { code?: string })?.code === 'persist-timeout') {
      invalidateCachedDb();
    }
    return null;
  }
};

/** Firestore batch commit timeout — prevents indefinite hangs if the connection is stale. */
const FIRESTORE_BATCH_TIMEOUT_MS = 30_000;

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
    const groupMergeRecommendations = dataClean.groupMergeRecommendations || [];
    const groupMergeChunks: GroupMergeRecommendation[][] = [];
    for (let i = 0; i < groupMergeRecommendations.length; i += CHUNK_SIZE) {
      groupMergeChunks.push(groupMergeRecommendations.slice(i, i + CHUNK_SIZE));
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
    groupMergeChunks.forEach((chunk, idx) => addToBatch(`group_merge_${idx}`, { type: 'group_merge', index: idx, data: chunk }));
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
      groupMergeChunkCount: groupMergeChunks.length,
    });

    if (ops > 0) writeBatches.push(batch.commit());
    await withPersistTimeout(
      Promise.all(writeBatches),
      FIRESTORE_BATCH_TIMEOUT_MS,
      `Firestore project save (${writeBatches.length} batches, project ${projectId})`,
    );

    // Signal success immediately — writes are durable. Stale-chunk cleanup below
    // is best-effort and must never block the caller or delay the sync status.
    options?.onSyncStatus?.('synced');

    // Clean up stale chunks (fire-and-forget — never blocks the save promise).
    // We still await internally so errors are caught, but wrap in a void IIFE
    // so the caller's await resolves as soon as the writes above land.
    void (async () => {
      try {
        const existingChunks = await existingChunksPromise;
        if (!existingChunks || existingChunks.empty) return;

        // Prevent cross-writer destructive cleanup:
        // Only delete stale chunks if the project's current meta.saveId still matches
        // the saveId for this save request.
        if (options?.saveId != null) {
          try {
            const metaSnap = await getDocFromServer(
              doc(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION, 'meta'),
            );
            const remoteSaveId = metaSnap.exists() ? (metaSnap.data() as any)?.saveId : null;
            if (remoteSaveId !== options.saveId) return;
          } catch {
            // If we cannot verify, keep existing chunks instead of risking deletion.
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
          ...groupMergeChunks.map((_, idx) => `group_merge_${idx}`),
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
      } catch (cleanupErr) {
        console.warn('[PERSIST] Stale chunk cleanup failed (non-fatal):', cleanupErr);
      }
    })();
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

export const loadProjectsBootstrapState = async (): Promise<LoadProjectsBootstrapResult> => {
  try {
    const snapshot = await getDocs(collection(db, FIRESTORE_PROJECTS_COLLECTION));

    const firestoreProjects: Project[] = [];
    snapshot.forEach((docSnap: any) => {
      firestoreProjects.push(projectFromFirestoreData(docSnap.id, docSnap.data()));
    });

    if (firestoreProjects.length > 0) {
      // Cache to localStorage so projects survive Firestore quota errors
      try {
        localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(firestoreProjects));
      } catch {
        // Ignore localStorage write failures (quota/private mode).
      }
      return { projects: firestoreProjects, source: 'firestore' };
    }

    const cachedProjects = loadProjectsFromLocalCache();
    if (cachedProjects.length > 0) {
      console.log('[PROJECTS] Firestore returned empty collection; using localStorage cache:', cachedProjects.length, 'projects');
      return { projects: cachedProjects, source: 'local-cache' };
    }
  } catch (error) {
    console.warn('Firestore load error (likely quota exceeded):', error);
    // Fallback: try loading from localStorage cache
    const cachedProjects = loadProjectsFromLocalCache();
    if (cachedProjects.length > 0) {
      console.log('[PROJECTS] Using localStorage cache:', cachedProjects.length, 'projects');
      return { projects: cachedProjects, source: 'local-cache' };
    }
  }

  return { projects: [], source: 'empty' };
};

export const loadProjectsFromFirestore = async (): Promise<Project[]> => {
  const result = await loadProjectsBootstrapState();
  return result.projects;
};
