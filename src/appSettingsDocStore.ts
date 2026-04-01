import {
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type FirestoreError,
  type Unsubscribe,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { loadFromIDB } from './projectStorage';
import {
  deleteQaAppSettingsFields,
  getQaAppSettingsDoc,
  isContentPipelineQaMode,
  setQaAppSettingsDoc,
  subscribeQaAppSettingsDoc,
} from './qa/contentPipelineQaRuntime';

type SnapshotLike = {
  exists: () => boolean;
  data: () => Record<string, unknown>;
  metadata: { fromCache: boolean };
};

type SubscribeOptions = {
  docId: string;
  channel?: string;
  onData: (snap: SnapshotLike) => void;
  onError?: (err: FirestoreError) => void;
};

const DEFAULT_APP_SETTINGS_ROW_CHUNK_SIZE = 400;
const MAX_APP_SETTINGS_DOC_BYTES = 900_000;
const jsonByteEncoder = new TextEncoder();

function measureJsonBytes(value: unknown): number {
  return jsonByteEncoder.encode(JSON.stringify(value)).length;
}

function measureRowsDocBytes(rows: Array<Record<string, unknown>>, updatedAt: string): number {
  return measureJsonBytes({ rows, updatedAt });
}

function describeOversizedRow(row: Record<string, unknown>, index: number): string {
  const rowId = typeof row.id === 'string' ? row.id.trim() : '';
  return rowId ? `row "${rowId}"` : `row at index ${index}`;
}

function planChunkedRowsWrite(
  docId: string,
  rows: Array<Record<string, unknown>>,
  updatedAt: string,
  maxRowsPerChunk: number,
): {
  chunked: boolean;
  chunks: Array<Array<Record<string, unknown>>>;
} {
  if (rows.length <= maxRowsPerChunk && measureRowsDocBytes(rows, updatedAt) <= MAX_APP_SETTINGS_DOC_BYTES) {
    return { chunked: false, chunks: [rows] };
  }

  const chunks: Array<Array<Record<string, unknown>>> = [];
  let currentChunk: Array<Record<string, unknown>> = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (measureRowsDocBytes([row], updatedAt) > MAX_APP_SETTINGS_DOC_BYTES) {
      throw new Error(
        `App settings document "${docId}" contains ${describeOversizedRow(row, index)} that exceeds the Firestore size limit by itself.`,
      );
    }

    const candidateChunk = [...currentChunk, row];
    const candidateTooLarge =
      candidateChunk.length > maxRowsPerChunk || measureRowsDocBytes(candidateChunk, updatedAt) > MAX_APP_SETTINGS_DOC_BYTES;

    if (candidateTooLarge) {
      if (currentChunk.length === 0) {
        throw new Error(
          `App settings document "${docId}" contains ${describeOversizedRow(row, index)} that cannot fit into a Firestore chunk.`,
        );
      }
      chunks.push(currentChunk);
      currentChunk = [row];
      continue;
    }

    currentChunk = candidateChunk;
  }

  if (currentChunk.length > 0 || rows.length === 0) {
    chunks.push(currentChunk);
  }

  return {
    chunked: chunks.length > 1,
    chunks,
  };
}

export async function getAppSettingsDocData(docId: string): Promise<Record<string, unknown> | null> {
  if (isContentPipelineQaMode()) {
    return getQaAppSettingsDoc(docId);
  }
  const snap = await getDoc(doc(db, 'app_settings', docId));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

export async function setAppSettingsDocData(
  docId: string,
  data: Record<string, unknown>,
  options?: { merge?: boolean },
): Promise<void> {
  if (isContentPipelineQaMode()) {
    await setQaAppSettingsDoc(docId, data, options);
    return;
  }
  await setDoc(doc(db, 'app_settings', docId), data, options?.merge ? { merge: true } : undefined);
}

export async function deleteAppSettingsDocFields(docId: string, fields: string[]): Promise<void> {
  if (fields.length === 0) return;
  if (isContentPipelineQaMode()) {
    await deleteQaAppSettingsFields(docId, fields);
    return;
  }
  await updateDoc(
    doc(db, 'app_settings', docId),
    Object.fromEntries(fields.map((field) => [field, deleteField()])),
  );
}

export function subscribeAppSettingsDocData({
  docId,
  onData,
  onError,
}: SubscribeOptions): Unsubscribe {
  if (isContentPipelineQaMode()) {
    return subscribeQaAppSettingsDoc(docId, onData);
  }
  return onSnapshot(doc(db, 'app_settings', docId), onData, onError);
}

export async function loadChunkedAppSettingsRows<T>(docId: string): Promise<T[]> {
  const data = await getAppSettingsDocData(docId);
  if (!data) return [];
  if (data.chunked && Number(data.chunkCount) > 0) {
    const chunkCount = Number(data.chunkCount) || 0;
    const chunks = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) => getAppSettingsDocData(`${docId}_chunk_${index}`)),
    );
    const rows: T[] = [];
    for (const chunk of chunks) {
      if (chunk && Array.isArray(chunk.rows)) rows.push(...(chunk.rows as T[]));
    }
    return rows;
  }
  return Array.isArray(data.rows) ? (data.rows as T[]) : [];
}

type CachedRowsRecord<T> = {
  value?: T[];
  data?: T[];
  updatedAt?: string;
};

function getCachedRowsValue<T>(cached: CachedRowsRecord<T> | null): T[] | null {
  if (!cached) return null;
  if (Array.isArray(cached.value)) return cached.value;
  if (Array.isArray(cached.data)) return cached.data;
  return null;
}

function hasMeaningfulCachedRows<T>(rows: T[]): boolean {
  return rows.some((row) => {
    if (!row || typeof row !== 'object') return true;
    const record = row as Record<string, unknown>;
    return Object.entries(record).some(([key, value]) => {
      if (key === 'id') return false;
      if (key === 'status') return value !== 'pending';
      if (key === 'input' || key === 'output' || key === 'error') {
        return typeof value === 'string' && value.trim().length > 0;
      }
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value).length > 0;
      return value != null;
    });
  });
}

export async function loadChunkedAppSettingsRowsLocalPreferred<T>(docId: string): Promise<T[]> {
  // Read-only convenience helper.
  // Safe for passive UI surfaces that want the fastest available local view.
  // Do NOT use this to drive derived pipeline row generation or any persistence
  // path, because a locally cached doc can be newer by timestamp but still stale
  // in content while an upstream slot write is propagating.
  const [cached, remoteRoot] = await Promise.all([
    loadFromIDB<CachedRowsRecord<T>>('__app_settings__:' + docId),
    getAppSettingsDocData(docId),
  ]);

  const cachedRows = getCachedRowsValue(cached);
  const cachedUpdatedAt = typeof cached?.updatedAt === 'string' ? cached.updatedAt : '';
  const remoteUpdatedAt = typeof remoteRoot?.updatedAt === 'string' ? remoteRoot.updatedAt : '';

  if (cachedRows && (!remoteUpdatedAt || (cachedUpdatedAt && cachedUpdatedAt >= remoteUpdatedAt))) {
    return cachedRows;
  }

  return loadChunkedAppSettingsRows<T>(docId);
}

export async function writeChunkedAppSettingsRows(
  docId: string,
  rows: Array<Record<string, unknown>>,
  options?: { chunkSize?: number; updatedAt?: string; totalRows?: number },
): Promise<void> {
  const chunkSize = Math.max(1, Math.floor(options?.chunkSize ?? DEFAULT_APP_SETTINGS_ROW_CHUNK_SIZE));
  const updatedAt = options?.updatedAt ?? new Date().toISOString();
  const plannedWrite = planChunkedRowsWrite(docId, rows, updatedAt, chunkSize);
  if (plannedWrite.chunked) {
    await Promise.all(
      plannedWrite.chunks.map((chunk, index) =>
        setAppSettingsDocData(`${docId}_chunk_${index}`, { rows: chunk, updatedAt }),
      ),
    );
    await setAppSettingsDocData(docId, {
      chunked: true,
      chunkCount: plannedWrite.chunks.length,
      totalRows: options?.totalRows ?? rows.length,
      updatedAt,
    });
    return;
  }
  await setAppSettingsDocData(docId, { rows: plannedWrite.chunks[0] ?? [], updatedAt });
}
