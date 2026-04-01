import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sharedStore = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  listeners: new Map<string, Set<(snap: { exists: () => boolean; data: () => Record<string, unknown>; metadata: { fromCache: boolean } }) => void>>(),
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emitDoc(docId: string): void {
  const listeners = sharedStore.listeners.get(docId);
  if (!listeners?.size) return;
  const payload = sharedStore.docs.get(docId) ?? null;
  const snap = {
    exists: () => payload != null,
    data: () => clone(payload ?? {}),
    metadata: { fromCache: false },
  };
  listeners.forEach((listener) => listener(snap));
}

const storageMocks = vi.hoisted(() => ({
  loadFromIDB: vi.fn(async () => null),
  saveToIDB: vi.fn(async () => undefined),
}));

vi.mock('./projectStorage', () => ({
  loadFromIDB: storageMocks.loadFromIDB,
  saveToIDB: storageMocks.saveToIDB,
}));

vi.mock('./appSettingsDocStore', () => ({
  getAppSettingsDocData: vi.fn(async (docId: string) => clone(sharedStore.docs.get(docId) ?? null)),
  setAppSettingsDocData: vi.fn(async (docId: string, data: Record<string, unknown>, options?: { merge?: boolean }) => {
    const previous = sharedStore.docs.get(docId) ?? {};
    sharedStore.docs.set(docId, options?.merge ? { ...clone(previous), ...clone(data) } : clone(data));
    emitDoc(docId);
  }),
  deleteAppSettingsDocFields: vi.fn(async (docId: string, fields: string[]) => {
    const previous = clone(sharedStore.docs.get(docId) ?? {});
    for (const field of fields) delete previous[field];
    sharedStore.docs.set(docId, previous);
    emitDoc(docId);
  }),
  subscribeAppSettingsDocData: vi.fn(({ docId, onData }: { docId: string; onData: (snap: { exists: () => boolean; data: () => Record<string, unknown>; metadata: { fromCache: boolean } }) => void }) => {
    const listeners = sharedStore.listeners.get(docId) ?? new Set<typeof onData>();
    listeners.add(onData);
    sharedStore.listeners.set(docId, listeners);
    onData({
      exists: () => sharedStore.docs.has(docId),
      data: () => clone(sharedStore.docs.get(docId) ?? {}),
      metadata: { fromCache: false },
    });
    return () => {
      const current = sharedStore.listeners.get(docId);
      current?.delete(onData);
      if (current && current.size === 0) sharedStore.listeners.delete(docId);
    };
  }),
  loadChunkedAppSettingsRows: vi.fn(async <T,>(docId: string) => clone((sharedStore.docs.get(docId)?.rows as T[] | undefined) ?? [])),
  loadChunkedAppSettingsRowsLocalPreferred: vi.fn(async <T,>(docId: string) => clone((sharedStore.docs.get(docId)?.rows as T[] | undefined) ?? [])),
  writeChunkedAppSettingsRows: vi.fn(async (docId: string, rows: Array<Record<string, unknown>>, options?: { updatedAt?: string; totalRows?: number }) => {
    sharedStore.docs.set(docId, {
      rows: clone(rows),
      updatedAt: options?.updatedAt ?? new Date().toISOString(),
      totalRows: options?.totalRows ?? rows.length,
    });
    emitDoc(docId);
  }),
}));

import { makeAppSettingsChannel, resetCloudSyncStateForTests } from './cloudSyncStatus';
import {
  deleteAppSettingsDocFieldsRemote,
  loadAppSettingsDoc,
  loadAppSettingsRows,
  persistAppSettingsDoc,
  subscribeAppSettingsDoc,
  writeAppSettingsDocRemote,
  writeAppSettingsRowsRemote,
} from './appSettingsPersistence';
import { getCollaborationHealthSnapshot } from './cloudSyncStatus';

describe('appSettings collaboration contract', () => {
  beforeEach(() => {
    sharedStore.docs.clear();
    sharedStore.listeners.clear();
    storageMocks.loadFromIDB.mockClear();
    storageMocks.saveToIDB.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    resetCloudSyncStateForTests();
  });

  it.each([
    ['group-review-settings-converges', 'group-review-settings-two-session', 'group_review_settings', 'doc'],
    ['autogroup-settings-converges', 'autogroup-settings-two-session', 'autogroup_settings', 'doc'],
    ['topics-library-converges', 'topics-library-two-session', 'topics_loans', 'doc'],
    ['starred-models-converges', 'starred-models-two-session', 'starred_models', 'doc'],
    ['universal-blocked-converges', 'universal-blocked-two-session', 'universal_blocked', 'doc'],
    ['workspace-preferences-converges', 'workspace-preferences-two-session', 'user_preferences', 'doc'],
  ] as const)('[%s][%s] propagates %s through the shared app-settings contract', async (_contractId, _browserId, docId, registryKind) => {
    const seen: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeAppSettingsDoc({
      docId,
      registryKind,
      onData: (snap) => {
        if (!snap.exists()) return;
        seen.push(snap.data());
      },
    });

    const result = await persistAppSettingsDoc({
      docId,
      data: { updatedAt: '2026-04-01T00:00:00.000Z', value: docId },
      localContext: `${docId} test`,
      cloudContext: `${docId} test`,
      registryKind,
    });

    expect(result.mutationResult.status).toBe('accepted');
    expect(seen.at(-1)).toMatchObject({ value: docId });
    const channel = getCollaborationHealthSnapshot().find((entry) => entry.storageChannel.endsWith(`/${docId}`));
    expect(channel?.lastAcceptedWriteAtMs).not.toBeNull();
    expect(channel?.lastListenerApplyAtMs).not.toBeNull();

    unsubscribe();
  });

  it.each([
    ['generate-logs-converges', 'generate-logs-two-session', 'project_proj-1__generate_logs_page_names', 'logs', { entries: [{ id: 'log-1', message: 'shared log entry' }] }],
    ['generate-settings-converges', 'generate-settings-two-session', 'project_proj-1__generate_settings_page_names', 'settings', { prompt: 'Shared generate prompt', updatedAt: '2026-04-01T00:00:00.000Z' }],
    ['generate-pipeline-settings-converges', 'generate-pipeline-settings-two-session', 'project_proj-1__generate_view_state_page_names', 'pipeline-settings', { genSubTab: 'log', tableView: 'h2qa' }],
  ] as const)('[%s][%s] propagates %s through the approved shared-doc wrapper', async (_contractId, _browserId, docId, registryKind, payload) => {
    const listenerEvents: number[] = [];
    const unsubscribe = subscribeAppSettingsDoc({
      docId,
      channel: makeAppSettingsChannel(registryKind, docId),
      registryKind,
      onData: (snap) => {
        if (!snap.exists()) return;
        listenerEvents.push(Date.now());
      },
    });

    const result = await writeAppSettingsDocRemote({
      docId,
      data: payload,
      cloudContext: 'generate shared doc test',
      registryKind,
    });

    expect(result.status).toBe('accepted');
    expect(await loadAppSettingsDoc<Record<string, unknown>>({ docId, registryKind })).toMatchObject(payload);
    expect(listenerEvents.length).toBeGreaterThan(0);
    const channel = getCollaborationHealthSnapshot().find((entry) => entry.storageChannel.endsWith(`/${docId}`));
    expect(channel?.lastAcceptedWriteAtMs).not.toBeNull();
    expect(channel?.lastListenerApplyAtMs).not.toBeNull();

    unsubscribe();
  });

  it('[generate-rows-converges][generate-rows-two-session] propagates project-scoped Generate rows through the approved rows wrappers', async () => {
    const docId = 'project_proj-1__generate_rows_page_names';
    const listenerEvents: number[] = [];
    const unsubscribe = subscribeAppSettingsDoc({
      docId,
      channel: makeAppSettingsChannel('rows', docId),
      registryKind: 'rows',
      onData: () => {
        listenerEvents.push(Date.now());
      },
    });

    const rows = [{ id: 'row-1', input: 'keyword', output: 'Shared title' }];
    const result = await writeAppSettingsRowsRemote({
      docId,
      rows,
      cloudContext: 'generate rows test',
      registryKind: 'rows',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });

    expect(result.status).toBe('accepted');
    expect(await loadAppSettingsRows<typeof rows[number]>({ docId, registryKind: 'rows' })).toEqual(rows);
    expect(listenerEvents.length).toBeGreaterThan(1);

    unsubscribe();
  });

  it('deletes shared fields through the approved remote mutation wrapper', async () => {
    sharedStore.docs.set('group_review_settings', {
      updatedAt: '2026-04-01T00:00:00.000Z',
      apiKey: 'should-not-stay',
      prompt: 'keep me',
    });

    const result = await deleteAppSettingsDocFieldsRemote({
      docId: 'group_review_settings',
      fields: ['apiKey'],
      cloudContext: 'settings security scrub',
      registryKind: 'doc',
    });

    expect(result.status).toBe('accepted');
    expect(await loadAppSettingsDoc<Record<string, unknown>>({
      docId: 'group_review_settings',
      registryKind: 'doc',
    })).toEqual({
      updatedAt: '2026-04-01T00:00:00.000Z',
      prompt: 'keep me',
    });
  });
});
