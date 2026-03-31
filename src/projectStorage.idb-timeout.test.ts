import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  setDoc: vi.fn(),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(async () => undefined),
  })),
}));
vi.mock('./qa/contentPipelineQaRuntime', () => ({
  deleteQaLocalCache: vi.fn(),
  isContentPipelineQaMode: vi.fn(() => false),
  loadQaLocalCache: vi.fn(),
  saveQaLocalCache: vi.fn(),
}));
vi.mock('./projectChunkPayload', () => ({
  buildProjectDataPayloadFromChunkDocs: vi.fn(),
  countGroupedPages: vi.fn(),
  groupedPageMass: vi.fn(),
}));

import { _resetIDBCache, saveToIDB } from './projectStorage';

type FakeOpenRequest = {
  result?: FakeDb;
  onupgradeneeded: null | (() => void);
  onsuccess: null | (() => void);
  onerror: null | (() => void);
  error?: Error | null;
};

type FakeTx = {
  objectStore: (name: string) => { put: (record: unknown) => void };
  oncomplete: null | (() => void);
  onerror: null | (() => void);
  onabort: null | (() => void);
  abort: ReturnType<typeof vi.fn>;
  error: Error | null;
};

type FakeDb = {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onclose: null | (() => void);
  onversionchange: null | (() => void);
};

function makeDb(txFactory: () => FakeTx): FakeDb {
  return {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => txFactory()),
    close: vi.fn(),
    onclose: null,
    onversionchange: null,
  };
}

describe('saveToIDB timeout recovery', () => {
  beforeEach(() => {
    _resetIDBCache();
    vi.useFakeTimers();
  });

  it('aborts a timed-out transaction, invalidates the cached connection, and retries on a fresh db', async () => {
    const firstTx: FakeTx = {
      objectStore: () => ({ put: vi.fn() }),
      oncomplete: null,
      onerror: null,
      onabort: null,
      abort: vi.fn(function (this: FakeTx) {
        this.error = new DOMException('Timed out', 'AbortError');
        this.onabort?.();
      }),
      error: null,
    };
    const secondTx: FakeTx = {
      objectStore: () => ({ put: vi.fn() }),
      oncomplete: null,
      onerror: null,
      onabort: null,
      abort: vi.fn(),
      error: null,
    };

    const firstDb = makeDb(() => firstTx);
    const secondDb = makeDb(() => secondTx);
    const openRequests: FakeOpenRequest[] = [];

    const indexedDbMock = {
      open: vi.fn(() => {
        const req: FakeOpenRequest = {
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          error: null,
        };
        openRequests.push(req);
        queueMicrotask(() => {
          req.result = openRequests.length === 1 ? firstDb : secondDb;
          req.onsuccess?.();
        });
        return req;
      }),
    };

    vi.stubGlobal('indexedDB', indexedDbMock);

    const savePromise = saveToIDB('proj_timeout', { rows: [{ id: 1 }] });
    await vi.advanceTimersByTimeAsync(12_001);
    await vi.advanceTimersByTimeAsync(201);
    queueMicrotask(() => secondTx.oncomplete?.());
    await vi.advanceTimersByTimeAsync(0);
    await savePromise;

    expect(firstTx.abort).toHaveBeenCalledTimes(1);
    expect(firstDb.close).toHaveBeenCalledTimes(1);
    expect(indexedDbMock.open).toHaveBeenCalledTimes(2);
    expect(secondDb.transaction).toHaveBeenCalledTimes(1);
  }, 15_000);
});
