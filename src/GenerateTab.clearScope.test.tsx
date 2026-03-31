import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  cachedByIdbKey: {} as Record<string, unknown>,
  remoteRowsByDocId: {} as Record<string, unknown[]>,
  addToast: vi.fn(),
  subscriptions: new Map<string, (snap: { exists: () => boolean; data: () => Record<string, unknown>; metadata: { fromCache: boolean } }) => void>(),
}));

vi.mock('./ToastContext', () => ({
  useToast: () => ({
    addToast: testState.addToast,
  }),
}));

vi.mock('./appSettingsPersistence', () => ({
  APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT: 'kwg:app-settings-local-rows-updated',
  appSettingsIdbKey: (docId: string) => `__app_settings__:${docId}`,
  cacheStateLocallyBestEffort: vi.fn(),
  emitLocalAppSettingsRowsUpdated: vi.fn(),
  loadCachedState: vi.fn(async ({ idbKey }: { idbKey: string }) => testState.cachedByIdbKey[idbKey] ?? null),
  persistAppSettingsDoc: vi.fn(async () => undefined),
  persistLocalCachedState: vi.fn(async () => undefined),
  persistTrackedState: vi.fn(async ({ writeRemote }: { writeRemote?: () => Promise<void> }) => {
    if (writeRemote) {
      await writeRemote();
    }
  }),
  subscribeAppSettingsDoc: vi.fn(({ docId, onData }: { docId: string; onData: (snap: { exists: () => boolean; data: () => Record<string, unknown>; metadata: { fromCache: boolean } }) => void }) => {
    testState.subscriptions.set(docId, onData);
    return () => {
      testState.subscriptions.delete(docId);
    };
  }),
}));

vi.mock('./appSettingsDocStore', () => ({
  deleteAppSettingsDocFields: vi.fn(async () => undefined),
  loadChunkedAppSettingsRows: vi.fn(async (docId: string) => testState.remoteRowsByDocId[docId] ?? []),
  writeChunkedAppSettingsRows: vi.fn(async () => undefined),
}));

import {
  GenerateTabInstance,
  clearRowsForView,
  countClearableRowsForView,
  type PromptSlotConfig,
} from './GenerateTab';

function setCachedDoc(docId: string, value: unknown): void {
  testState.cachedByIdbKey[`__app_settings__:${docId}`] = value;
}

function setRemoteRowsDoc(docId: string, value: unknown[]): void {
  testState.remoteRowsByDocId[docId] = value;
}

async function emitRemoteRowsSnapshot(docId: string): Promise<void> {
  await waitFor(() => {
    expect(testState.subscriptions.has(docId)).toBe(true);
  });

  const onData = testState.subscriptions.get(docId);
  if (!onData) {
    throw new Error(`Missing subscription for ${docId}`);
  }

  await act(async () => {
    await onData({
      exists: () => true,
      data: () => ({
        updatedAt: '2026-03-30T12:00:00.000Z',
        totalRows: (testState.remoteRowsByDocId[docId] ?? []).length,
      }),
      metadata: { fromCache: false },
    });
  });
}

describe('GenerateTab clear scoping', () => {
  beforeEach(() => {
    testState.cachedByIdbKey = {};
    testState.remoteRowsByDocId = {};
    testState.addToast.mockReset();
    testState.subscriptions.clear();
    window.localStorage.clear();
    class ResizeObserverMock {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('clears only the active slot data while preserving primary and sibling slots', () => {
    const qaSlot: PromptSlotConfig = {
      id: 'qa',
      label: 'QA',
      promptLabel: 'QA Prompt',
      defaultPrompt: 'Review: {PRIMARY}',
      clearMetadataKeysOnReset: ['qaRating'],
      buildInput: (template, primaryOutput) => ({
        input: template.replace('{PRIMARY}', primaryOutput),
      }),
    };
    const guideSlot: PromptSlotConfig = {
      id: 'guide',
      label: 'Guide',
      promptLabel: 'Guide Prompt',
      defaultPrompt: 'Guide prompt',
      clearMetadataKeysOnReset: ['guideStatus'],
    };

    const nextRows = clearRowsForView({
      rows: [
        {
          id: 'row-1',
          status: 'generated',
          input: 'installment loans',
          output: 'Primary output',
          metadata: {
            keep: 'yes',
            qaRating: '4',
            guideStatus: 'Pass',
          },
          slots: {
            qa: {
              status: 'generated',
              input: 'stale QA input',
              output: 'QA output',
              error: 'stale QA error',
              generatedAt: '2026-03-30T12:00:00.000Z',
              durationMs: 120,
              retries: 1,
              promptTokens: 10,
              completionTokens: 12,
              cost: 0.05,
            },
            guide: {
              status: 'generated',
              input: 'Guide input',
              output: 'Guide output',
            },
          },
        },
      ],
      tableView: 'qa',
      promptSlots: [qaSlot, guideSlot],
      slotPrompts: {
        qa: 'Review: {PRIMARY}',
      },
    });

    expect(nextRows[0]).toMatchObject({
      id: 'row-1',
      status: 'generated',
      input: 'installment loans',
      output: 'Primary output',
      metadata: {
        keep: 'yes',
        guideStatus: 'Pass',
      },
      slots: {
        qa: {
          status: 'pending',
          input: 'Review: Primary output',
          output: '',
        },
        guide: {
          status: 'generated',
          input: 'Guide input',
          output: 'Guide output',
        },
      },
    });
    expect(countClearableRowsForView(nextRows, 'qa', [qaSlot, guideSlot])).toBe(0);
  });

  it('keeps primary clears dependency-aware by replacing the whole primary row set', () => {
    const replacementRows = [
      { id: 'fresh-1', status: 'pending' as const, input: '', output: '' },
      { id: 'fresh-2', status: 'pending' as const, input: '', output: '' },
    ];

    const nextRows = clearRowsForView({
      rows: [
        {
          id: 'row-1',
          status: 'generated',
          input: 'keyword',
          output: 'Primary output',
          slots: {
            qa: {
              status: 'generated',
              input: 'qa input',
              output: 'qa output',
            },
          },
        },
      ],
      tableView: 'primary',
      createPrimaryRows: () => replacementRows,
    });

    expect(nextRows).toEqual(replacementRows);
  });

  it('scopes the header Clear button to the active slot view', async () => {
    setCachedDoc('generate_rows_test', [
      {
        id: 'row-1',
        status: 'generated',
        input: 'keyword',
        output: 'Primary output',
        slots: {
          qa: {
            status: 'generated',
            input: 'qa input',
            output: 'QA output',
          },
        },
      },
    ]);

    const qaSlot: PromptSlotConfig = {
      id: 'qa',
      label: 'QA',
      promptLabel: 'QA Prompt',
      defaultPrompt: 'Review: {PRIMARY}',
      buildInput: (template, primaryOutput) => ({
        input: template.replace('{PRIMARY}', primaryOutput),
      }),
    };
    setRemoteRowsDoc('generate_rows_test', [
      {
        id: 'row-1',
        status: 'generated',
        input: 'keyword',
        output: 'Primary output',
        slots: {
          qa: {
            status: 'generated',
            input: 'qa input',
            output: 'QA output',
          },
        },
      },
    ]);

    render(
      <GenerateTabInstance
        storageKey="_test"
        starredModels={new Set()}
        onToggleStar={() => undefined}
        defaultPrompt="Primary prompt"
        primaryPromptLabel="Pages"
        promptSlots={[qaSlot]}
      />,
    );

    await emitRemoteRowsSnapshot('generate_rows_test');

    await waitFor(() => {
      expect(screen.getByText('Primary output')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('content-view-qa'));

    await waitFor(() => {
      expect(screen.getByText('QA output')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(screen.queryByText('QA output')).toBeNull();
    });

    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('content-view-primary'));

    await waitFor(() => {
      expect(screen.getByText('Primary output')).toBeTruthy();
    });
  });

  it('does not let cached table/log view state override parent-controlled content routing', async () => {
    setCachedDoc('generate_rows_test', [
      {
        id: 'row-1',
        status: 'generated',
        input: 'keyword',
        output: 'Primary output',
        slots: {
          qa: {
            status: 'generated',
            input: 'qa input',
            output: 'QA output',
          },
        },
      },
    ]);
    setCachedDoc('generate_view_state_test', {
      genSubTab: 'log',
      tableView: 'qa',
      statusFilter: 'all',
    });

    const qaSlot: PromptSlotConfig = {
      id: 'qa',
      label: 'QA',
      promptLabel: 'QA Prompt',
      defaultPrompt: 'Review: {PRIMARY}',
      buildInput: (template, primaryOutput) => ({
        input: template.replace('{PRIMARY}', primaryOutput),
      }),
    };
    setRemoteRowsDoc('generate_rows_test', [
      {
        id: 'row-1',
        status: 'generated',
        input: 'keyword',
        output: 'Primary output',
        slots: {
          qa: {
            status: 'generated',
            input: 'qa input',
            output: 'QA output',
          },
        },
      },
    ]);

    render(
      <GenerateTabInstance
        storageKey="_test"
        starredModels={new Set()}
        onToggleStar={() => undefined}
        defaultPrompt="Primary prompt"
        primaryPromptLabel="Pages"
        promptSlots={[qaSlot]}
        controlledTableView="primary"
        controlledGenSubTab="table"
      />,
    );

    await emitRemoteRowsSnapshot('generate_rows_test');

    await waitFor(() => {
      expect(screen.getByText('Primary output')).toBeTruthy();
    });

    expect(screen.queryByText('QA output')).toBeNull();
    expect(screen.queryByTestId('generate-log-table')).toBeNull();
  });

  it('keeps hidden instances silent until runtime effects are activated', async () => {
    const { rerender } = render(
      <GenerateTabInstance
        runtimeEffectsActive={false}
        storageKey="_test"
        starredModels={new Set()}
        onToggleStar={() => undefined}
        defaultPrompt="Primary prompt"
        primaryPromptLabel="Pages"
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(testState.subscriptions.size).toBe(0);

    rerender(
      <GenerateTabInstance
        runtimeEffectsActive
        storageKey="_test"
        starredModels={new Set()}
        onToggleStar={() => undefined}
        defaultPrompt="Primary prompt"
        primaryPromptLabel="Pages"
      />,
    );

    await waitFor(() => {
      expect(testState.subscriptions.has('generate_rows_test')).toBe(true);
      expect(testState.subscriptions.has('generate_logs_test')).toBe(true);
      expect(testState.subscriptions.has('generate_settings_test')).toBe(true);
    });
  });

  it('notifies the parent when the user switches between table and log panels', async () => {
    setCachedDoc('generate_rows_test', [
      {
        id: 'row-1',
        status: 'generated',
        input: 'keyword',
        output: 'Primary output',
      },
    ]);

    const onGenSubTabChange = vi.fn();

    render(
      <GenerateTabInstance
        storageKey="_test"
        starredModels={new Set()}
        onToggleStar={() => undefined}
        defaultPrompt="Primary prompt"
        primaryPromptLabel="Pages"
        controlledGenSubTab="table"
        onGenSubTabChange={onGenSubTabChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Primary output')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('shared-log-tab'));
    expect(onGenSubTabChange).toHaveBeenCalledWith('log');
  });

});
