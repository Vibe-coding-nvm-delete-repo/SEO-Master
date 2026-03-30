import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  loadFromIDB: vi.fn(),
  saveToIDB: vi.fn(),
}));

vi.mock('./projectStorage', () => ({
  loadFromIDB: storageMocks.loadFromIDB,
  saveToIDB: storageMocks.saveToIDB,
}));

vi.mock('./firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
}));

import {
  cacheStateLocally,
  loadCachedState,
  persistLocalCachedState,
  persistTrackedState,
} from './appSettingsPersistence';
import {
  deriveCloudStatusLine,
  getCloudSyncSnapshot,
  resetCloudSyncStateForTests,
} from './cloudSyncStatus';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('appSettingsPersistence', () => {
  beforeEach(() => {
    storageMocks.loadFromIDB.mockReset();
    storageMocks.saveToIDB.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    resetCloudSyncStateForTests();
  });

  it('prefers the IDB mirror over localStorage when loading cached state', async () => {
    storageMocks.loadFromIDB.mockResolvedValue({ value: { source: 'idb' } });
    localStorage.setItem('cache-key', JSON.stringify({ source: 'localStorage' }));

    const result = await loadCachedState<{ source: string }>({
      idbKey: 'idb-key',
      localStorageKey: 'cache-key',
    });

    expect(result).toEqual({ source: 'idb' });
  });

  it('falls back to localStorage when IDB is empty', async () => {
    storageMocks.loadFromIDB.mockResolvedValue(null);
    localStorage.setItem('cache-key', JSON.stringify({ source: 'localStorage' }));

    const result = await loadCachedState<{ source: string }>({
      idbKey: 'idb-key',
      localStorageKey: 'cache-key',
    });

    expect(result).toEqual({ source: 'localStorage' });
  });

  it('marks refresh unsafe until the local durability write finishes, then keeps cloud syncing', async () => {
    const local = deferred<void>();
    const remote = deferred<void>();
    storageMocks.saveToIDB.mockReturnValue(local.promise);

    const persistPromise = persistTrackedState({
      idbKey: 'idb-key',
      value: { tab: '1' },
      localContext: 'generate active subtab',
      cloudContext: 'generate active subtab',
      writeRemote: () => remote.promise,
    });

    let snap = getCloudSyncSnapshot();
    expect(snap.unsafeToRefresh).toBe(true);
    expect(deriveCloudStatusLine(true, snap, false).label).toBe('Saving… don’t refresh');

    local.resolve();
    await Promise.resolve();
    await Promise.resolve();

    snap = getCloudSyncSnapshot();
    expect(snap.unsafeToRefresh).toBe(false);
    expect(snap.shared.cloudWritePendingCount).toBe(1);
    expect(deriveCloudStatusLine(true, snap, false).label).toBe('Saved locally — syncing…');

    remote.resolve();
    await persistPromise;

    snap = getCloudSyncSnapshot();
    expect(snap.shared.cloudWritePendingCount).toBe(0);
    expect(snap.local.failed).toBe(false);
  });

  it('flags local failure when the IDB durability write rejects', async () => {
    storageMocks.saveToIDB.mockRejectedValue(new Error('quota exceeded'));

    await persistTrackedState({
      idbKey: 'idb-key',
      value: { setting: true },
      localContext: 'group review settings',
      cloudContext: 'group review settings',
      writeRemote: async () => undefined,
    });

    const snap = getCloudSyncSnapshot();
    expect(snap.local.failed).toBe(true);
    expect(deriveCloudStatusLine(true, snap, false).label).toBe('Save failed — local data at risk');
  });

  it('persistLocalCachedState writes IDB only and does not bump cloud write counters', async () => {
    storageMocks.saveToIDB.mockResolvedValue(undefined);
    resetCloudSyncStateForTests();

    await persistLocalCachedState({
      idbKey: 'local-only-key',
      value: { rail: '1' },
      localContext: 'test local ui',
    });

    const snap = getCloudSyncSnapshot();
    expect(snap.shared.cloudWritePendingCount).toBe(0);
    expect(snap.local.failed).toBe(false);
    expect(storageMocks.saveToIDB).toHaveBeenCalled();
  });

  it('updates the localStorage mirror before the IDB write finishes', async () => {
    const local = deferred<void>();
    storageMocks.saveToIDB.mockReturnValue(local.promise);

    const persistPromise = cacheStateLocally({
      idbKey: 'settings-key',
      value: { selectedModel: 'google/gemini-2.5-pro' },
      localStorageKey: 'settings-cache',
    });

    expect(localStorage.getItem('settings-cache')).toBe(JSON.stringify({ selectedModel: 'google/gemini-2.5-pro' }));

    local.resolve();
    await persistPromise;
  });
});
