import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedSharedMutation, SHARED_MUTATION_ACCEPTED, type SharedMutationResult } from '../sharedMutation';

const parseMock = vi.fn();

vi.mock('papaparse', () => ({
  default: {
    parse: (...args: unknown[]) => parseMock(...args),
  },
}));

vi.mock('../collabV2WriteGuard', () => ({
  createGenerationGuard: () => ({
    generation: 0,
    projectId: 'project-1',
    isCurrent: () => true,
  }),
}));

vi.mock('../csvImportProjectScope', () => ({
  csvImportProjectMismatch: () => false,
}));

import { useCsvImport } from './useCsvImport';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function primeSuccessfulParse() {
  parseMock.mockImplementation((_file: File, options: { complete: (results: { data: string[][] }) => void }) => {
    options.complete({
      data: [
        ['Page', 'Keyword', 'C', 'D', 'Volume'],
        ['', 'alpha loan', '', '', '10'],
      ],
    });
  });
}

function renderCsvImportHook(overrides: Partial<Parameters<typeof useCsvImport>[0]> = {}) {
  return renderHook(() =>
    useCsvImport({
      activeProjectIdRef: { current: 'project-1' },
      storageMode: 'v2',
      runWithExclusiveOperation: undefined,
      tokenMergeRules: [],
      syncFileNameLocal: vi.fn(),
      bulkSet: vi.fn(async () => SHARED_MUTATION_ACCEPTED),
      setActiveTab: vi.fn(),
      setResults: vi.fn(),
      setClusterSummary: vi.fn(),
      setTokenSummary: vi.fn(),
      setAutoMergeRecommendations: vi.fn(),
      setGroupMergeRecommendations: vi.fn(),
      setStats: vi.fn(),
      setDatasetStats: vi.fn(),
      addToast: vi.fn(),
      setError: vi.fn(),
      ...overrides,
    }),
  );
}

describe('useCsvImport', () => {
  beforeEach(() => {
    parseMock.mockReset();
    primeSuccessfulParse();
  });

  it('waits for async bulkSet acceptance before switching tabs or clearing processing state', async () => {
    const persist = deferred<SharedMutationResult>();
    const bulkSet = vi.fn(() => persist.promise);
    const setActiveTab = vi.fn();

    const { result } = renderCsvImportHook({
      bulkSet,
      setActiveTab,
    });

    const file = new File(['keyword'], 'keywords.csv', { type: 'text/csv' });
    let settled = false;
    let importPromise!: Promise<void>;

    await act(async () => {
      importPromise = result.current.processCSV(file);
      importPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
    });

    expect(result.current.isProcessing).toBe(true);
    expect(settled).toBe(false);
    expect(setActiveTab).not.toHaveBeenCalled();

    await act(async () => {
      persist.resolve(SHARED_MUTATION_ACCEPTED);
      await importPromise;
    });

    expect(settled).toBe(true);
    expect(setActiveTab).toHaveBeenCalledWith('pages');
    expect(result.current.isProcessing).toBe(false);
  });

  it('surfaces blocked shared persistence instead of claiming the import completed', async () => {
    const bulkSet = vi.fn(async () => blockedSharedMutation('lock-conflict'));
    const setActiveTab = vi.fn();
    const addToast = vi.fn();
    const setError = vi.fn();

    const { result } = renderCsvImportHook({
      bulkSet,
      setActiveTab,
      addToast,
      setError,
    });

    const file = new File(['keyword'], 'keywords.csv', { type: 'text/csv' });

    await act(async () => {
      await result.current.processCSV(file);
    });

    expect(setActiveTab).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('temporarily locked or read-only'),
      'error',
    );
    expect(setError).toHaveBeenLastCalledWith(
      expect.stringContaining('temporarily locked or read-only'),
    );
    expect(result.current.isProcessing).toBe(false);
  });
});
