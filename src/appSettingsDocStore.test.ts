import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('./firebase', () => ({
  db: {},
}));

vi.mock('./projectStorage', () => ({
  loadFromIDB: vi.fn(),
}));

vi.mock('./qa/contentPipelineQaRuntime', () => ({
  deleteQaAppSettingsFields: vi.fn(),
  getQaAppSettingsDoc: vi.fn(),
  isContentPipelineQaMode: vi.fn(() => false),
  setQaAppSettingsDoc: vi.fn(),
  subscribeQaAppSettingsDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  deleteField: vi.fn(),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: firestoreMocks.getDoc,
  onSnapshot: firestoreMocks.onSnapshot,
  setDoc: firestoreMocks.setDoc,
  updateDoc: firestoreMocks.updateDoc,
}));

import { writeChunkedAppSettingsRows } from './appSettingsDocStore';

type SetDocCall = [ref: { path: string }, data: Record<string, unknown>, options?: unknown];

function makeH2Row(id: string, size: number): Record<string, unknown> {
  return {
    id,
    status: 'generated',
    input: `Input for ${id}`,
    output: 'x'.repeat(size),
    metadata: {
      pageName: 'Installment Loan',
      order: '1',
      h2Name: `Heading ${id}`,
      contentGuidelines: 'Guideline '.repeat(500),
      sourceRowId: 'page-row-1',
    },
  };
}

describe('appSettingsDocStore', () => {
  beforeEach(() => {
    firestoreMocks.getDoc.mockReset();
    firestoreMocks.onSnapshot.mockReset();
    firestoreMocks.setDoc.mockReset();
    firestoreMocks.setDoc.mockResolvedValue(undefined);
    firestoreMocks.updateDoc.mockReset();
    firestoreMocks.updateDoc.mockResolvedValue(undefined);
  });

  it('writes small row sets as a single app_settings document', async () => {
    const rows = [
      { id: 'row-1', input: 'A', output: 'alpha' },
      { id: 'row-2', input: 'B', output: 'beta' },
    ];

    await writeChunkedAppSettingsRows('generate_rows_small', rows, {
      updatedAt: '2026-03-30T12:00:00.000Z',
    });

    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.setDoc).toHaveBeenCalledWith(
      { path: 'app_settings/generate_rows_small' },
      { rows, updatedAt: '2026-03-30T12:00:00.000Z' },
      undefined,
    );
  });

  it('chunks large H2 row payloads by serialized size even when row count is below the default threshold', async () => {
    const rows = [
      makeH2Row('h2-row-1', 475_000),
      makeH2Row('h2-row-2', 475_000),
    ];

    await writeChunkedAppSettingsRows('generate_rows_h2_content', rows, {
      updatedAt: '2026-03-30T12:00:00.000Z',
      totalRows: rows.length,
    });

    const calls = firestoreMocks.setDoc.mock.calls as unknown as SetDocCall[];
    expect(calls).toHaveLength(3);

    const chunkPaths = calls.slice(0, 2).map(([ref]) => ref.path);
    expect(chunkPaths).toEqual([
      'app_settings/generate_rows_h2_content_chunk_0',
      'app_settings/generate_rows_h2_content_chunk_1',
    ]);

    expect(calls[0]?.[1]).toMatchObject({
      rows: [rows[0]],
      updatedAt: '2026-03-30T12:00:00.000Z',
    });
    expect(calls[1]?.[1]).toMatchObject({
      rows: [rows[1]],
      updatedAt: '2026-03-30T12:00:00.000Z',
    });
    expect(calls[2]).toEqual([
      { path: 'app_settings/generate_rows_h2_content' },
      {
        chunked: true,
        chunkCount: 2,
        totalRows: 2,
        updatedAt: '2026-03-30T12:00:00.000Z',
      },
      undefined,
    ]);
  });

  it('still respects the row-count ceiling when rows are tiny', async () => {
    const rows = [
      { id: 'row-1', input: 'A', output: '1' },
      { id: 'row-2', input: 'B', output: '2' },
      { id: 'row-3', input: 'C', output: '3' },
    ];

    await writeChunkedAppSettingsRows('generate_rows_ceiling', rows, {
      chunkSize: 2,
      updatedAt: '2026-03-30T12:00:00.000Z',
    });

    const calls = firestoreMocks.setDoc.mock.calls as unknown as SetDocCall[];
    expect(calls).toHaveLength(3);
    expect(calls[0]?.[1]).toMatchObject({ rows: rows.slice(0, 2) });
    expect(calls[1]?.[1]).toMatchObject({ rows: rows.slice(2) });
    expect(calls[2]?.[1]).toMatchObject({ chunked: true, chunkCount: 2, totalRows: 3 });
  });

  it('throws a descriptive error before writing when a single row exceeds the Firestore limit', async () => {
    const rows = [makeH2Row('oversized-row', 950_000)];

    await expect(
      writeChunkedAppSettingsRows('generate_rows_h2_content', rows, {
        updatedAt: '2026-03-30T12:00:00.000Z',
      }),
    ).rejects.toThrow(
      'App settings document "generate_rows_h2_content" contains row "oversized-row" that exceeds the Firestore size limit by itself.',
    );

    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });
});
