import { loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { H1_BODY_ROWS_DOC_ID } from './contentPipelineH1';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { mergeCanonicalH2Context } from './contentPipelineContext';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';

export const QUICK_ANSWER_ROWS_DOC_ID = 'generate_rows_quick_answer';
export const QUICK_ANSWER_SETTINGS_DOC_ID = 'generate_settings_quick_answer';

export type QuickAnswerPipelineRow = {
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

type H1BodyRow = {
  id: string;
  status?: string;
  output?: string;
  metadata?: Record<string, string>;
};

type PersistedQuickAnswerRow = Partial<QuickAnswerPipelineRow> & { id: string };

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

function deriveQuickAnswerRowId(h1RowId: string): string {
  return `quick_${h1RowId}`;
}

function normalizePersistedStatus(value: unknown): QuickAnswerPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

export function buildQuickAnswerPrompt(template: string, values: {
  pageName: string;
  h1Body: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    H1_BODY: values.h1Body,
  });
}

export function buildQuickAnswerRowsFromSource(
  h1Rows: H1BodyRow[],
  promptTemplate: string,
): QuickAnswerPipelineRow[] {
  const rows: QuickAnswerPipelineRow[] = [];

  for (const row of h1Rows) {
    const pageName = row.metadata?.pageName?.trim() ?? '';
    const h2Name = row.metadata?.h2Name?.trim() ?? '';
    const h2Content = row.metadata?.h2Content?.trim() ?? '';
    const h2Summaries = row.metadata?.h2Summaries?.trim() ?? '';
    const h1Body = stripAnswerWrapper(row.output ?? '');
    const accepted = row.status === 'generated' && h1Body;

    rows.push({
      id: deriveQuickAnswerRowId(row.id),
      status: 'pending',
      input: accepted ? buildQuickAnswerPrompt(promptTemplate, { pageName, h1Body }) : '',
      output: '',
      metadata: mergeCanonicalH2Context(row.metadata, {
        pageName,
        h2Name,
        h2Content,
        h2Summaries,
        h1Body,
        h1BodyRowId: row.id,
        sourceRowId: row.metadata?.sourceRowId ?? '',
      }),
    });
  }

  return rows;
}

export function mergeDerivedWithPersistedQuickAnswerRows(
  derivedRows: QuickAnswerPipelineRow[],
  persistedRows: PersistedQuickAnswerRow[],
): QuickAnswerPipelineRow[] {
  const persistedMap = new Map(persistedRows.map((row) => [row.id, row]));

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

export async function loadH1RowsForQuickAnswerFromFirestore(
  docId: string = H1_BODY_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<H1BodyRow[]> {
  return loadRowsFromFirestore<H1BodyRow>(docId, loadMode);
}

export async function loadPersistedQuickAnswerRowsFromFirestore(
  docId: string = QUICK_ANSWER_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedQuickAnswerRow[]> {
  return loadRowsFromFirestore<PersistedQuickAnswerRow>(docId, loadMode);
}

export function resolveQuickAnswerPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function buildQuickAnswerRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<QuickAnswerPipelineRow[]> {
  const [savedPrompt, h1Rows, persistedRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadH1RowsForQuickAnswerFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadPersistedQuickAnswerRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);

  const template = resolveQuickAnswerPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = buildQuickAnswerRowsFromSource(h1Rows, template);
  return mergeDerivedWithPersistedQuickAnswerRows(derivedRows, persistedRows);
}
