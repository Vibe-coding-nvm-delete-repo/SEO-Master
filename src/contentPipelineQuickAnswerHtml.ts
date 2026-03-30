import { loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { QUICK_ANSWER_ROWS_DOC_ID } from './contentPipelineQuickAnswer';
import {
  H2_HTML_VALIDATION_STATUS_KEY,
  appendHtmlValidationFeedback,
  validateGeneratedHtmlOutput,
} from './contentPipelineHtml';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { mergeCanonicalH2Context } from './contentPipelineContext';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';

export const QUICK_ANSWER_HTML_ROWS_DOC_ID = 'generate_rows_quick_answer_html';
export const QUICK_ANSWER_HTML_SETTINGS_DOC_ID = 'generate_settings_quick_answer_html';

export type QuickAnswerHtmlPipelineRow = {
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

type QuickAnswerRow = {
  id: string;
  status?: string;
  output?: string;
  metadata?: Record<string, string>;
};

type PersistedQuickAnswerHtmlRow = Partial<QuickAnswerHtmlPipelineRow> & { id: string };

function replaceAllTokens(template: string, replacements: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return next;
}

function deriveQuickAnswerHtmlRowId(quickAnswerRowId: string): string {
  return `html_${quickAnswerRowId}`;
}

function normalizePersistedStatus(value: unknown): QuickAnswerHtmlPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

function buildQuickAnswerHtmlPrompt(template: string, values: {
  pageName: string;
  quickAnswer: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    QUICK_ANSWER: values.quickAnswer,
  });
}

async function loadRowsFromFirestore<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  return loadContentPipelineRows<T>(docId, loadMode);
}

export async function loadQuickAnswerRowsFromFirestore(
  docId: string = QUICK_ANSWER_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<QuickAnswerRow[]> {
  return loadRowsFromFirestore<QuickAnswerRow>(docId, loadMode);
}

export async function loadPersistedQuickAnswerHtmlRowsFromFirestore(
  docId: string = QUICK_ANSWER_HTML_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedQuickAnswerHtmlRow[]> {
  return loadRowsFromFirestore<PersistedQuickAnswerHtmlRow>(docId, loadMode);
}

export function resolveQuickAnswerHtmlPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function buildQuickAnswerHtmlRowsFromSource(
  quickAnswerRows: QuickAnswerRow[],
  promptTemplate: string,
): QuickAnswerHtmlPipelineRow[] {
  const rows: QuickAnswerHtmlPipelineRow[] = [];

  for (const row of quickAnswerRows) {
    const pageName = row.metadata?.pageName?.trim() ?? '';
    const h2Name = row.metadata?.h2Name?.trim() ?? '';
    const h2Content = row.metadata?.h2Content?.trim() ?? '';
    const h2Summaries = row.metadata?.h2Summaries?.trim() ?? '';
    const h1Body = row.metadata?.h1Body?.trim() ?? '';
    const quickAnswer = (row.output ?? '').trim();
    const accepted = row.status === 'generated' && quickAnswer;

    rows.push({
      id: deriveQuickAnswerHtmlRowId(row.id),
      status: 'pending',
      input: accepted ? buildQuickAnswerHtmlPrompt(promptTemplate, { pageName, quickAnswer }) : '',
      output: '',
      metadata: mergeCanonicalH2Context(row.metadata, {
        pageName,
        h2Name,
        h2Content,
        h2Summaries,
        h1Body,
        quickAnswer,
        quickAnswerRowId: row.id,
        sourceRowId: row.metadata?.sourceRowId ?? '',
      }),
    });
  }

  return rows;
}

export function applyQuickAnswerHtmlValidationFeedbackToInputs(
  derivedRows: QuickAnswerHtmlPipelineRow[],
  persistedRows: PersistedQuickAnswerHtmlRow[],
): QuickAnswerHtmlPipelineRow[] {
  const persistedMap = new Map(persistedRows.map((row) => [row.id, row]));

  return derivedRows.map((row) => {
    if (!row.input.trim()) return row;

    const persisted = persistedMap.get(row.id);
    const validationError =
      persisted?.metadata?.[H2_HTML_VALIDATION_STATUS_KEY] === 'Fail'
        ? (typeof persisted.error === 'string' ? persisted.error : 'HTML validation failed.')
        : undefined;

    return {
      ...row,
      input: appendHtmlValidationFeedback(row.input, validationError),
    };
  });
}

export function mergeDerivedWithPersistedQuickAnswerHtmlRows(
  derivedRows: QuickAnswerHtmlPipelineRow[],
  persistedRows: PersistedQuickAnswerHtmlRow[],
): QuickAnswerHtmlPipelineRow[] {
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
      output: persisted.output ?? '',
      metadata: {
        ...row.metadata,
        ...(typeof persisted.metadata?.[H2_HTML_VALIDATION_STATUS_KEY] === 'string'
          ? { [H2_HTML_VALIDATION_STATUS_KEY]: persisted.metadata[H2_HTML_VALIDATION_STATUS_KEY] }
          : {}),
      },
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

export async function buildQuickAnswerHtmlRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<QuickAnswerHtmlPipelineRow[]> {
  const [savedPrompt, quickAnswerRows, persistedHtmlRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadQuickAnswerRowsFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadPersistedQuickAnswerHtmlRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);

  const template = resolveQuickAnswerHtmlPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = applyQuickAnswerHtmlValidationFeedbackToInputs(
    buildQuickAnswerHtmlRowsFromSource(quickAnswerRows, template),
    persistedHtmlRows,
  );
  return mergeDerivedWithPersistedQuickAnswerHtmlRows(derivedRows, persistedHtmlRows);
}

export { validateGeneratedHtmlOutput };
