import type { DocumentData, FirestoreError, Unsubscribe } from 'firebase/firestore';
import { loadFromIDB, saveToIDB } from './projectStorage';
import { withPersistTimeout } from './persistTimeout';
import { setAppSettingsDocData, subscribeAppSettingsDocData } from './appSettingsDocStore';
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
}: PersistTrackedStateOptions<T>): Promise<{ localOk: boolean; cloudOk: boolean }> {
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
    await writeRemote();
    recordSharedCloudWriteOk();
    return { localOk, cloudOk: true };
  } catch (err) {
    recordSharedCloudWriteError();
    reportPersistFailure(addToast, cloudContext, err);
    return { localOk, cloudOk: false };
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
}: PersistAppSettingsDocOptions<T>): Promise<{ localOk: boolean; cloudOk: boolean }> {
  return persistTrackedState({
    idbKey: idbKey ?? appSettingsIdbKey(docId),
    value: data,
    localStorageKey,
    localStorageValue,
    addToast,
    localContext,
    cloudContext,
    writeRemote: () => setAppSettingsDocData(docId, data, { merge }),
  });
}

type SubscribeAppSettingsDocOptions = {
  docId: string;
  channel?: CloudSyncChannelId;
  onData: (snap: any) => void;
  onError?: (err: FirestoreError) => void;
};

export function subscribeAppSettingsDoc({
  docId,
  channel,
  onData,
  onError,
}: SubscribeAppSettingsDocOptions): Unsubscribe {
  const resolvedChannel = channel ?? (docId as CloudSyncChannelId);
  const unsub = subscribeAppSettingsDocData({
    docId,
    onData: (snap) => {
      markListenerSnapshot(resolvedChannel, snap);
      onData(snap);
    },
    onError: (err) => {
      markListenerError(resolvedChannel);
      onError?.(err);
    },
  });
  return () => {
    clearListenerError(resolvedChannel);
    unsub();
  };
}
