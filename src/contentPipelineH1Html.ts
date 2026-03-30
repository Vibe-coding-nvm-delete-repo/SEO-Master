import { loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { H1_BODY_ROWS_DOC_ID } from './contentPipelineH1';
import {
  H2_HTML_LOCK_REASON_KEY,
  H2_HTML_VALIDATION_STATUS_KEY,
  appendHtmlValidationFeedback,
  validateGeneratedHtmlOutput,
} from './contentPipelineHtml';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { mergeCanonicalH2Context } from './contentPipelineContext';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';

export const H1_HTML_ROWS_DOC_ID = 'generate_rows_h1_html';
export const H1_HTML_SETTINGS_DOC_ID = 'generate_settings_h1_html';

export type H1HtmlPipelineRow = {
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

type PersistedH1HtmlRow = Partial<H1HtmlPipelineRow> & { id: string };

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

function deriveH1HtmlRowId(h1RowId: string): string {
  return `html_${h1RowId}`;
}

function normalizePersistedStatus(value: unknown): H1HtmlPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

function buildH1HtmlPrompt(template: string, values: {
  pageName: string;
  h1Body: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    H1_BODY: values.h1Body,
  });
}

async function loadRowsFromFirestore<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  return loadContentPipelineRows<T>(docId, loadMode);
}

export async function loadH1BodyRowsFromFirestore(
  docId: string = H1_BODY_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<H1BodyRow[]> {
  return loadRowsFromFirestore<H1BodyRow>(docId, loadMode);
}

export async function loadPersistedH1HtmlRowsFromFirestore(
  docId: string = H1_HTML_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedH1HtmlRow[]> {
  return loadRowsFromFirestore<PersistedH1HtmlRow>(docId, loadMode);
}

export function resolveH1HtmlPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function buildH1HtmlRowsFromSource(
  h1Rows: H1BodyRow[],
  promptTemplate: string,
): H1HtmlPipelineRow[] {
  const rows: H1HtmlPipelineRow[] = [];

  for (const row of h1Rows) {
    const pageName = row.metadata?.pageName?.trim() ?? '';
    const h2Name = row.metadata?.h2Name?.trim() ?? '';
    const h2Content = row.metadata?.h2Content?.trim() ?? '';
    const h2Summaries = row.metadata?.h2Summaries?.trim() ?? '';
    const h1Body = stripAnswerWrapper(row.output ?? '');
    const accepted = row.status === 'generated' && h1Body;

    rows.push({
      id: deriveH1HtmlRowId(row.id),
      status: 'pending',
      input: accepted ? buildH1HtmlPrompt(promptTemplate, { pageName, h1Body }) : '',
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

export function applyH1HtmlValidationFeedbackToInputs(
  derivedRows: H1HtmlPipelineRow[],
  persistedRows: PersistedH1HtmlRow[],
): H1HtmlPipelineRow[] {
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

export function mergeDerivedWithPersistedH1HtmlRows(
  derivedRows: H1HtmlPipelineRow[],
  persistedRows: PersistedH1HtmlRow[],
): H1HtmlPipelineRow[] {
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
        ...(typeof persisted.metadata?.[H2_HTML_LOCK_REASON_KEY] === 'string'
          ? { [H2_HTML_LOCK_REASON_KEY]: persisted.metadata[H2_HTML_LOCK_REASON_KEY] }
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

export async function buildH1HtmlRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<H1HtmlPipelineRow[]> {
  const [savedPrompt, h1Rows, persistedHtmlRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadH1BodyRowsFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadPersistedH1HtmlRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);

  const template = resolveH1HtmlPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = applyH1HtmlValidationFeedbackToInputs(
    buildH1HtmlRowsFromSource(h1Rows, template),
    persistedHtmlRows,
  );
  return mergeDerivedWithPersistedH1HtmlRows(derivedRows, persistedHtmlRows);
}

export { validateGeneratedHtmlOutput };
