import type { DocumentData, FirestoreError, Unsubscribe } from 'firebase/firestore';
import { loadFromIDB, saveToIDB } from './projectStorage';
import { withPersistTimeout } from './persistTimeout';
import {
  deleteAppSettingsDocFields,
  getAppSettingsDocData,
  loadChunkedAppSettingsRows,
  loadChunkedAppSettingsRowsLocalPreferred,
  setAppSettingsDocData,
  subscribeAppSettingsDocData,
  writeChunkedAppSettingsRows,
} from './appSettingsDocStore';
import {
  clearListenerError,
  type CloudSyncChannelId,
  markListenerError,
  markListenerSnapshot,
  recordLocalPersistError,
  recordLocalPersistOk,
  recordLocalPersistStart,
  recordSharedCloudWriteError,
  recordSharedCloudWriteOk,
  recordSharedCloudWriteStart,
} from './cloudSyncStatus';
import { reportLocalPersistFailure, reportPersistFailure, type PersistToastFn } from './persistenceErrors';
import { performSharedMutation, subscribeSharedChannel, trackSharedListenerApply } from './sharedCollabContract';
import {
  requireAppSettingsRegistryEntry,
  type AppSettingsRegistryKind,
  type SharedActionRegistryEntry,
} from './sharedCollaboration';
import { failedSharedMutation, SHARED_MUTATION_ACCEPTED, type SharedMutationResult } from './sharedMutation';

/**
 * Upper bound for app-settings IDB durability (includes time queued behind other IDB writes).
 * Without this, a hung `saveToIDB` would leave `localWritePendingCount` stuck and the status
 * bar on "Saving… don't refresh" indefinitely.
 */
export const APP_SETTINGS_LOCAL_DURABILITY_TIMEOUT_MS = 90_000;

type CachedRecord<T> = {
  value: T;
  updatedAt: string;
};

export const appSettingsIdbKey = (docId: string): string => `__app_settings__:${docId}`;
export const APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT = 'kwg:app-settings-local-rows-updated';

export function emitLocalAppSettingsRowsUpdated(docId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, { detail: { docId } }));
}

type LoadCachedStateOptions<T> = {
  idbKey: string;
  localStorageKey?: string;
  parseLocalStorage?: (raw: string) => T | null;
};

export async function loadCachedState<T>({
  idbKey,
  localStorageKey,
  parseLocalStorage,
}: LoadCachedStateOptions<T>): Promise<T | null> {
  try {
    const cached = await loadFromIDB<CachedRecord<T> & { data?: T }>(idbKey);
    if (cached) {
      if ('value' in cached && cached.value !== undefined) return cached.value;
      if ('data' in cached && cached.data !== undefined) return cached.data;
    }
  } catch {
    /* fall through to localStorage */
  }

  if (!localStorageKey) return null;
  try {
    const raw = localStorage.getItem(localStorageKey);
    if (!raw) return null;
    if (parseLocalStorage) return parseLocalStorage(raw);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type CacheStateOptions<T> = {
  idbKey: string;
  value: T;
  localStorageKey?: string;
  localStorageValue?: string;
};

export async function cacheStateLocally<T>({
  idbKey,
  value,
  localStorageKey,
  localStorageValue,
}: CacheStateOptions<T>): Promise<void> {
  if (localStorageKey) {
    try {
      localStorage.setItem(localStorageKey, localStorageValue ?? JSON.stringify(value));
    } catch {
      /* localStorage is only a fast mirror, not the durable barrier */
    }
  }
  await saveToIDB(idbKey, {
    value,
    updatedAt: new Date().toISOString(),
  });
}

type PersistLocalCachedStateOptions<T> = {
  idbKey: string;
  value: T;
  localStorageKey?: string;
  localStorageValue?: string;
  addToast?: PersistToastFn;
  localContext: string;
};

/** IndexedDB (+ optional localStorage) only — no Firestore. For per-browser UI state. */
export async function persistLocalCachedState<T>({
  idbKey,
  value,
  localStorageKey,
  localStorageValue,
  addToast,
  localContext,
}: PersistLocalCachedStateOptions<T>): Promise<boolean> {
  recordLocalPersistStart();
  try {
    await withPersistTimeout(
      cacheStateLocally({ idbKey, value, localStorageKey, localStorageValue }),
      APP_SETTINGS_LOCAL_DURABILITY_TIMEOUT_MS,
      `app settings local cache (${localContext})`,
    );
    recordLocalPersistOk();
    return true;
  } catch (err) {
    recordLocalPersistError();
    reportLocalPersistFailure(addToast, localContext, err);
    return false;
  }
}

export function cacheStateLocallyBestEffort<T>(options: CacheStateOptions<T>): void {
  void cacheStateLocally(options).catch(() => {
    /* best-effort cache writes should never break UI flows */
  });
}

type PersistTrackedStateOptions<T> = {
  idbKey: string;
  value: T;
  localStorageKey?: string;
  localStorageValue?: string;
  addToast?: PersistToastFn;
  localContext: string;
  cloudContext: string;
  writeRemote: () => Promise<void>;
  mutationEntry?: SharedActionRegistryEntry;
};

export async function persistTrackedState<T>({
  idbKey,
  value,
  localStorageKey,
  localStorageValue,
  addToast,
  localContext,
  cloudContext,
  writeRemote,
  mutationEntry,
}: PersistTrackedStateOptions<T>): Promise<{ localOk: boolean; cloudOk: boolean; mutationResult: SharedMutationResult }> {
  let localOk = false;

  recordLocalPersistStart();
  try {
    await withPersistTimeout(
      cacheStateLocally({ idbKey, value, localStorageKey, localStorageValue }),
      APP_SETTINGS_LOCAL_DURABILITY_TIMEOUT_MS,
      `app settings local durability (${localContext})`,
    );
    localOk = true;
    recordLocalPersistOk();
  } catch (err) {
    recordLocalPersistError();
    reportLocalPersistFailure(addToast, localContext, err);
  }

  recordSharedCloudWriteStart();
  try {
    let mutationResult = SHARED_MUTATION_ACCEPTED;
    if (mutationEntry) {
      mutationResult = await performSharedMutation(mutationEntry, async () => {
        await writeRemote();
        return SHARED_MUTATION_ACCEPTED;
      });
      if (mutationResult.status !== 'accepted') {
        recordSharedCloudWriteError();
        reportPersistFailure(addToast, cloudContext, new Error(`${mutationEntry.label} blocked: ${mutationResult.reason}`));
        return { localOk, cloudOk: false, mutationResult };
      }
    } else {
      await writeRemote();
    }
    recordSharedCloudWriteOk();
    return { localOk, cloudOk: true, mutationResult };
  } catch (err) {
    recordSharedCloudWriteError();
    reportPersistFailure(addToast, cloudContext, err);
    return { localOk, cloudOk: false, mutationResult: failedSharedMutation('unknown') };
  }
}

type PersistAppSettingsDocOptions<T extends DocumentData> = {
  docId: string;
  data: T;
  addToast?: PersistToastFn;
  localContext: string;
  cloudContext: string;
  idbKey?: string;
  localStorageKey?: string;
  localStorageValue?: string;
  merge?: boolean;
  registryKind?: AppSettingsRegistryKind;
};

export async function persistAppSettingsDoc<T extends DocumentData>({
  docId,
  data,
  addToast,
  localContext,
  cloudContext,
  idbKey,
  localStorageKey,
  localStorageValue,
  merge = false,
  registryKind,
}: PersistAppSettingsDocOptions<T>): Promise<{ localOk: boolean; cloudOk: boolean; mutationResult: SharedMutationResult }> {
  return persistTrackedState({
    idbKey: idbKey ?? appSettingsIdbKey(docId),
    value: data,
    localStorageKey,
    localStorageValue,
    addToast,
    localContext,
    cloudContext,
    mutationEntry: requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId)),
    writeRemote: () => setAppSettingsDocData(docId, data, { merge }),
  });
}

type LoadAppSettingsDocOptions = {
  docId: string;
  localPreferred?: boolean;
  idbKey?: string;
  registryKind?: AppSettingsRegistryKind;
};

export async function loadAppSettingsDoc<T extends DocumentData>({
  docId,
  localPreferred = false,
  idbKey,
  registryKind,
}: LoadAppSettingsDocOptions): Promise<T | null> {
  requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId));
  if (localPreferred) {
    const cached = await loadCachedState<T>({
      idbKey: idbKey ?? appSettingsIdbKey(docId),
    });
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      return cached;
    }
  }
  return await getAppSettingsDocData(docId) as T | null;
}

type PersistAppSettingsRowsOptions<T extends Record<string, unknown>> = {
  docId: string;
  rows: T[];
  addToast?: PersistToastFn;
  localContext: string;
  cloudContext: string;
  idbKey?: string;
  localStorageKey?: string;
  localStorageValue?: string;
  chunkSize?: number;
  updatedAt?: string;
  totalRows?: number;
  registryKind?: AppSettingsRegistryKind;
};

export async function persistAppSettingsRows<T extends Record<string, unknown>>({
  docId,
  rows,
  addToast,
  localContext,
  cloudContext,
  idbKey,
  localStorageKey,
  localStorageValue,
  chunkSize,
  updatedAt,
  totalRows,
  registryKind,
}: PersistAppSettingsRowsOptions<T>): Promise<{ localOk: boolean; cloudOk: boolean; mutationResult: SharedMutationResult }> {
  const writeUpdatedAt = updatedAt ?? new Date().toISOString();
  return persistTrackedState({
    idbKey: idbKey ?? appSettingsIdbKey(docId),
    value: rows,
    localStorageKey,
    localStorageValue,
    addToast,
    localContext,
    cloudContext,
    mutationEntry: requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId)),
    writeRemote: () => writeChunkedAppSettingsRows(docId, rows, {
      chunkSize,
      updatedAt: writeUpdatedAt,
      totalRows: totalRows ?? rows.length,
    }),
  });
}

type WriteAppSettingsDocRemoteOptions<T extends DocumentData> = {
  docId: string;
  data: T;
  addToast?: PersistToastFn;
  cloudContext: string;
  merge?: boolean;
  registryKind?: AppSettingsRegistryKind;
};

export async function writeAppSettingsDocRemote<T extends DocumentData>({
  docId,
  data,
  addToast,
  cloudContext,
  merge = false,
  registryKind,
}: WriteAppSettingsDocRemoteOptions<T>): Promise<SharedMutationResult> {
  const mutationEntry = requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId));
  recordSharedCloudWriteStart();
  try {
    const mutationResult = await performSharedMutation(mutationEntry, async () => {
      await setAppSettingsDocData(docId, data, { merge });
      return SHARED_MUTATION_ACCEPTED;
    });
    if (mutationResult.status === 'accepted') {
      recordSharedCloudWriteOk();
    } else {
      recordSharedCloudWriteError();
      reportPersistFailure(addToast, cloudContext, new Error(`${mutationEntry.label} blocked: ${mutationResult.reason}`));
    }
    return mutationResult;
  } catch (err) {
    recordSharedCloudWriteError();
    reportPersistFailure(addToast, cloudContext, err);
    return failedSharedMutation('unknown');
  }
}

type WriteAppSettingsRowsRemoteOptions<T extends Record<string, unknown>> = {
  docId: string;
  rows: T[];
  addToast?: PersistToastFn;
  cloudContext: string;
  chunkSize?: number;
  updatedAt?: string;
  totalRows?: number;
  registryKind?: AppSettingsRegistryKind;
};

export async function writeAppSettingsRowsRemote<T extends Record<string, unknown>>({
  docId,
  rows,
  addToast,
  cloudContext,
  chunkSize,
  updatedAt,
  totalRows,
  registryKind,
}: WriteAppSettingsRowsRemoteOptions<T>): Promise<SharedMutationResult> {
  const mutationEntry = requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId));
  recordSharedCloudWriteStart();
  try {
    const mutationResult = await performSharedMutation(mutationEntry, async () => {
      await writeChunkedAppSettingsRows(docId, rows, {
        chunkSize,
        updatedAt: updatedAt ?? new Date().toISOString(),
        totalRows: totalRows ?? rows.length,
      });
      return SHARED_MUTATION_ACCEPTED;
    });
    if (mutationResult.status === 'accepted') {
      recordSharedCloudWriteOk();
    } else {
      recordSharedCloudWriteError();
      reportPersistFailure(addToast, cloudContext, new Error(`${mutationEntry.label} blocked: ${mutationResult.reason}`));
    }
    return mutationResult;
  } catch (err) {
    recordSharedCloudWriteError();
    reportPersistFailure(addToast, cloudContext, err);
    return failedSharedMutation('unknown');
  }
}

type LoadAppSettingsRowsOptions = {
  docId: string;
  loadMode?: 'remote' | 'local-preferred';
  registryKind?: AppSettingsRegistryKind;
};

export async function loadAppSettingsRows<T>({
  docId,
  loadMode = 'remote',
  registryKind,
}: LoadAppSettingsRowsOptions): Promise<T[]> {
  requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId));
  if (loadMode === 'local-preferred') {
    return loadChunkedAppSettingsRowsLocalPreferred<T>(docId);
  }
  return loadChunkedAppSettingsRows<T>(docId);
}

type SubscribeAppSettingsDocOptions = {
  docId: string;
  channel?: CloudSyncChannelId;
  registryKind?: AppSettingsRegistryKind;
  onData: (snap: any) => void;
  onError?: (err: FirestoreError) => void;
};

export function inferAppSettingsRegistryKind(docId: string, channel?: CloudSyncChannelId): AppSettingsRegistryKind {
  if (channel?.startsWith('app-settings-rows:')) return 'rows';
  if (channel?.startsWith('app-settings-logs:')) return 'logs';
  if (channel?.startsWith('app-settings-settings:')) return 'settings';
  if (channel?.startsWith('shared-selected-model:')) return 'shared-selected-model';
  if (channel?.startsWith('pipeline-settings:')) return 'pipeline-settings';
  if (channel?.startsWith('upstream:')) return 'upstream';
  if (channel?.startsWith('overview:')) return 'overview';
  if (channel?.startsWith('final-pages:')) return 'final-pages';
  if (channel?.startsWith('content-tab:')) return 'content-tab';
  if (channel?.startsWith('cosine:')) return 'cosine';
  if (docId.includes('generate_rows')) return 'rows';
  if (docId.includes('generate_logs')) return 'logs';
  if (docId.includes('generate_settings')) return 'settings';
  if (docId.startsWith('kwg_cosine_summaries_')) return 'cosine';
  return 'doc';
}

type DeleteAppSettingsDocFieldsRemoteOptions = {
  docId: string;
  fields: string[];
  addToast?: PersistToastFn;
  cloudContext: string;
  registryKind?: AppSettingsRegistryKind;
};

export async function deleteAppSettingsDocFieldsRemote({
  docId,
  fields,
  addToast,
  cloudContext,
  registryKind,
}: DeleteAppSettingsDocFieldsRemoteOptions): Promise<SharedMutationResult> {
  if (fields.length === 0) return SHARED_MUTATION_ACCEPTED;
  const mutationEntry = requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId));
  recordSharedCloudWriteStart();
  try {
    const mutationResult = await performSharedMutation(mutationEntry, async () => {
      await deleteAppSettingsDocFields(docId, fields);
      return SHARED_MUTATION_ACCEPTED;
    });
    if (mutationResult.status === 'accepted') {
      recordSharedCloudWriteOk();
    } else {
      recordSharedCloudWriteError();
      reportPersistFailure(addToast, cloudContext, new Error(`${mutationEntry.label} blocked: ${mutationResult.reason}`));
    }
    return mutationResult;
  } catch (err) {
    recordSharedCloudWriteError();
    reportPersistFailure(addToast, cloudContext, err);
    return failedSharedMutation('unknown');
  }
}

export function subscribeAppSettingsDoc({
  docId,
  channel,
  registryKind,
  onData,
  onError,
}: SubscribeAppSettingsDocOptions): Unsubscribe {
  const resolvedChannel = channel ?? (docId as CloudSyncChannelId);
  const entry = requireAppSettingsRegistryEntry(docId, registryKind ?? inferAppSettingsRegistryKind(docId, resolvedChannel));
  const unsub = subscribeSharedChannel(entry, () => subscribeAppSettingsDocData({
    docId,
    onData: (snap) => {
      markListenerSnapshot(resolvedChannel, snap);
      trackSharedListenerApply(entry);
      onData(snap);
    },
    onError: (err) => {
      markListenerError(resolvedChannel);
      onError?.(err);
    },
  }));
  return () => {
    clearListenerError(resolvedChannel);
    unsub();
  };
}
