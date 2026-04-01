import { beforeEach, describe, expect, it, vi } from 'vitest';

const qaState = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
}));

const storageMocks = vi.hoisted(() => ({
  loadFromIDB: vi.fn(async () => ({
    value: [{ id: 'row-1', status: 'pending', input: 'stale local row', output: '' }],
    updatedAt: '2026-04-01T00:00:00.000Z',
  })),
}));

vi.mock('./firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  deleteField: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock('./projectStorage', () => ({
  loadFromIDB: storageMocks.loadFromIDB,
}));

vi.mock('./qa/contentPipelineQaRuntime', () => ({
  deleteQaAppSettingsFields: vi.fn(),
  getQaAppSettingsDoc: vi.fn(async (docId: string) => {
    const doc = qaState.docs.get(docId);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }),
  isContentPipelineQaMode: vi.fn(() => true),
  setQaAppSettingsDoc: vi.fn(),
  subscribeQaAppSettingsDoc: vi.fn(),
}));

import { loadChunkedAppSettingsRows } from './appSettingsDocStore';

describe('appSettingsDocStore QA remote loads', () => {
  beforeEach(() => {
    qaState.docs.clear();
    storageMocks.loadFromIDB.mockClear();
  });

  it('rebuilds remote chunked rows from shared QA docs instead of returning stale local cache', async () => {
    qaState.docs.set('project_proj-1__generate_rows_h2_content', {
      chunked: true,
      chunkCount: 1,
      totalRows: 1,
      updatedAt: '2026-04-01T00:01:00.000Z',
    });
    qaState.docs.set('project_proj-1__generate_rows_h2_content_chunk_0', {
      rows: [{ id: 'row-1', status: 'generated', input: 'keyword', output: 'Shared row output' }],
      updatedAt: '2026-04-01T00:01:00.000Z',
    });

    await expect(
      loadChunkedAppSettingsRows<{ id: string; status: string; input: string; output: string }>(
        'project_proj-1__generate_rows_h2_content',
      ),
    ).resolves.toEqual([
      { id: 'row-1', status: 'generated', input: 'keyword', output: 'Shared row output' },
    ]);

    expect(storageMocks.loadFromIDB).not.toHaveBeenCalled();
  });
});
