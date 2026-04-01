import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  rowDocs: new Map<string, Array<Record<string, unknown>>>(),
  failDocId: null as string | null,
}));

vi.mock('./appSettingsDocStore', () => ({
  getAppSettingsDocData: vi.fn(async (docId: string) => testState.docs.get(docId) ?? null),
  loadChunkedAppSettingsRows: vi.fn(async (docId: string) => testState.rowDocs.get(docId) ?? []),
  setAppSettingsDocData: vi.fn(async (docId: string, data: Record<string, unknown>) => {
    if (testState.failDocId === docId) {
      throw new Error('permission-denied');
    }
    testState.docs.set(docId, data);
  }),
  writeChunkedAppSettingsRows: vi.fn(async (docId: string, rows: Array<Record<string, unknown>>, meta?: Record<string, unknown>) => {
    testState.rowDocs.set(docId, rows);
    testState.docs.set(docId, {
      ...(meta ?? {}),
      rows,
    });
  }),
}));

import {
  ensureProjectGenerateWorkspace,
  getGenerateWorkspaceMetaDocId,
  resolveGenerateScopedDocIds,
  scopeGenerateWorkspaceDocId,
} from './generateWorkspaceScope';

describe('generateWorkspaceScope', () => {
  beforeEach(() => {
    testState.docs.clear();
    testState.rowDocs.clear();
    testState.failDocId = null;
  });

  it('scopes Generate workspace doc ids to the active project', () => {
    expect(scopeGenerateWorkspaceDocId('proj-1', 'generate_rows')).toBe('project_proj-1__generate_rows');
    expect(scopeGenerateWorkspaceDocId(null, 'generate_rows')).toBe('generate_rows');
    expect(resolveGenerateScopedDocIds('proj-1', {
      rows: 'generate_rows',
      settings: 'generate_settings',
    })).toEqual({
      rows: 'project_proj-1__generate_rows',
      settings: 'project_proj-1__generate_settings',
    });
  });

  it('imports legacy Generate docs once and does not overwrite existing scoped docs', async () => {
    testState.docs.set('generate_settings', { prompt: 'legacy prompt', updatedAt: '2026-03-30T10:00:00.000Z' });
    testState.docs.set('generate_rows', { updatedAt: '2026-03-30T10:00:00.000Z', totalRows: 1 });
    testState.rowDocs.set('generate_rows', [{ id: 'legacy-row', input: 'keyword', output: 'Legacy output' }]);

    const existingScopedRowsDocId = scopeGenerateWorkspaceDocId('proj-1', 'generate_rows');
    testState.docs.set(existingScopedRowsDocId, { updatedAt: '2026-03-30T11:00:00.000Z', totalRows: 1 });
    testState.rowDocs.set(existingScopedRowsDocId, [{ id: 'scoped-row', input: 'keyword', output: 'Scoped output' }]);

    await expect(ensureProjectGenerateWorkspace('proj-1')).resolves.toMatchObject({ status: 'ready' });
    await expect(ensureProjectGenerateWorkspace('proj-1')).resolves.toMatchObject({ status: 'ready' });

    expect(testState.rowDocs.get(existingScopedRowsDocId)).toEqual([
      { id: 'scoped-row', input: 'keyword', output: 'Scoped output' },
    ]);
    expect(testState.docs.get(scopeGenerateWorkspaceDocId('proj-1', 'generate_settings'))).toMatchObject({
      prompt: 'legacy prompt',
      updatedAt: '2026-03-30T10:00:00.000Z',
    });
    expect(testState.docs.get(getGenerateWorkspaceMetaDocId('proj-1'))).toMatchObject({
      version: 1,
      source: 'global-app-settings-v1',
    });
  });

  it('returns a blocked result when shared workspace meta write is permission denied', async () => {
    const metaDocId = getGenerateWorkspaceMetaDocId('proj-1');
    testState.failDocId = metaDocId;

    await expect(ensureProjectGenerateWorkspace('proj-1')).resolves.toMatchObject({
      status: 'blocked',
      step: 'meta',
    });
  });
});
