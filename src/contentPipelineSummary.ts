import { H2_CONTENT_ROWS_DOC_ID, loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';
import {
  hasRequiredCanonicalH2Context,
  mergeCanonicalH2Context,
  readCanonicalH2Context,
} from './contentPipelineContext';

export const H2_SUMMARY_ROWS_DOC_ID = 'generate_rows_h2_summary';
export const H2_SUMMARY_SETTINGS_DOC_ID = 'generate_settings_h2_summary';

export type H2ContentSummarySourceRow = {
  id: string;
  status?: string;
  output?: string;
  metadata?: Record<string, string>;
};

export type H2SummaryPipelineRow = {
  id: string;
  status: 'pending' | 'generating' | 'generated' | 'error';
  input: string;
  output: string;
  error?: string;
  generatedAt?: string;
  durationMs?: number;
  retries?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  metadata: Record<string, string>;
};

type PersistedSummaryRow = Partial<H2SummaryPipelineRow> & { id: string };

function stripAnswerWrapper(raw: string): string {
  const cleaned = raw.trim();
  const match = cleaned.match(/^<answer>\s*([\s\S]*?)\s*<\/answer>$/i);
  return match ? match[1].trim() : cleaned;
}

function replaceAllTokens(template: string, replacements: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return next;
}

function normalizePersistedStatus(value: unknown): H2SummaryPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

export function deriveSummaryRowId(h2ContentRowId: string): string {
  return `summary_${h2ContentRowId}`;
}

export function buildSummaryPrompt(template: string, values: {
  pageName: string;
  h2Name: string;
  h2Content: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    H2_NAME: values.h2Name,
    H2_CONTENT: values.h2Content,
  });
}

export function buildSummaryRowsFromH2Rows(
  sourceRows: H2ContentSummarySourceRow[],
  promptTemplate: string,
): H2SummaryPipelineRow[] {
  const rows: H2SummaryPipelineRow[] = [];

  for (const row of sourceRows) {
    if (row.status !== 'generated') continue;
    const canonicalContext = readCanonicalH2Context(row.metadata);
    if (!hasRequiredCanonicalH2Context(canonicalContext)) continue;
    const h2Content = stripAnswerWrapper(row.output ?? '');
    if (!h2Content) continue;

    rows.push({
      id: deriveSummaryRowId(row.id),
      status: 'pending',
      input: buildSummaryPrompt(promptTemplate, {
        pageName: canonicalContext.pageName,
        h2Name: canonicalContext.h2Name,
        h2Content,
      }),
      output: '',
      metadata: mergeCanonicalH2Context(row.metadata, {
        h2Content,
        h2ContentRowId: row.id,
      }),
    });
  }

  return rows;
}

export function mergeDerivedWithPersistedSummaryRows(
  derivedRows: H2SummaryPipelineRow[],
  persistedRows: PersistedSummaryRow[],
): H2SummaryPipelineRow[] {
  const persistedMap = new Map(persistedRows.map(row => [row.id, row]));

  return derivedRows.map((row) => {
    const persisted = persistedMap.get(row.id);
    if (!persisted) return row;

    const canReuseOutput = canReusePersistedDerivedRowState({
      derivedInput: row.input,
      persistedInput: persisted.input,
      persistedOutput: persisted.output,
    });
    if (!canReuseOutput) {
      return row;
    }

    return {
      ...row,
      status: normalizePersistedStatus(persisted.status),
      output: persisted.output,
      ...(typeof persisted.error === 'string' ? { error: persisted.error } : {}),
      ...(typeof persisted.generatedAt === 'string' ? { generatedAt: persisted.generatedAt } : {}),
      ...(typeof persisted.durationMs === 'number' ? { durationMs: persisted.durationMs } : {}),
      ...(typeof persisted.retries === 'number' ? { retries: persisted.retries } : {}),
      ...(typeof persisted.promptTokens === 'number' ? { promptTokens: persisted.promptTokens } : {}),
      ...(typeof persisted.completionTokens === 'number' ? { completionTokens: persisted.completionTokens } : {}),
      ...(typeof persisted.cost === 'number' ? { cost: persisted.cost } : {}),
    };
  });
}

async function loadRowsFromFirestore<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  return loadContentPipelineRows<T>(docId, loadMode);
}

export async function loadH2SummarySourceRowsFromFirestore(
  docId: string = H2_CONTENT_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<H2ContentSummarySourceRow[]> {
  return loadRowsFromFirestore<H2ContentSummarySourceRow>(docId, loadMode);
}

export async function loadPersistedSummaryRowsFromFirestore(
  docId: string = H2_SUMMARY_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedSummaryRow[]> {
  return loadRowsFromFirestore<PersistedSummaryRow>(docId, loadMode);
}

export function resolveSummaryPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function buildH2SummaryRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<H2SummaryPipelineRow[]> {
  const [savedPrompt, sourceRows, persistedRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadH2SummarySourceRowsFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadPersistedSummaryRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);

  const template = resolveSummaryPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = buildSummaryRowsFromH2Rows(sourceRows, template);
  return mergeDerivedWithPersistedSummaryRows(derivedRows, persistedRows);
}
