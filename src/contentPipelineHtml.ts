import { H2_CONTENT_ROWS_DOC_ID, H2_RATING_ROWS_DOC_ID, loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { validateHtmlPolicy } from './htmlPolicyValidator';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';
import {
  hasRequiredCanonicalH2Context,
  mergeCanonicalH2Context,
  readCanonicalH2Context,
} from './contentPipelineContext';

export const H2_HTML_ROWS_DOC_ID = 'generate_rows_h2_html';
export const H2_HTML_SETTINGS_DOC_ID = 'generate_settings_h2_html';
export const ACCEPTABLE_H2_RATINGS = new Set(['1', '2', '5']);
export const H2_HTML_LOCK_REASON_KEY = 'lockReason';
export const H2_HTML_VALIDATION_STATUS_KEY = 'validationStatus';

export type H2HtmlPipelineRow = {
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

type H2ContentRow = {
  id: string;
  status?: string;
  output?: string;
  metadata?: Record<string, string>;
};

type RatingRow = {
  id: string;
  status?: string;
  metadata?: Record<string, string>;
};

type PersistedHtmlRow = Partial<H2HtmlPipelineRow> & { id: string };
const HTML_VALIDATION_FEEDBACK_HEADING = '### HTML VALIDATION FEEDBACK';

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

function deriveHtmlRowId(h2RowId: string): string {
  return `html_${h2RowId}`;
}

function lockReasonForRating(score: string | undefined): string {
  if (!score) return 'Locked until this H2 answer has a Rating Score of 1, 2, or 5.';
  if (ACCEPTABLE_H2_RATINGS.has(score)) return '';
  return `Locked because this H2 answer is rated ${score}. Rework it in H2 Content, then re-rate it before generating HTML.`;
}

function buildHtmlPrompt(template: string, values: {
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

export function appendHtmlValidationFeedback(prompt: string, validationError?: string): string {
  const feedback = validationError?.trim()
    ? validationError.trim()
    : 'None. Return clean HTML that passes validation on the first try.';

  return `${prompt.trim()}\n\n${HTML_VALIDATION_FEEDBACK_HEADING}
- Previous validator result: ${feedback}
- If a validator error is listed above, fix that exact issue before returning HTML.
- Never repeat a failed anchor, tag, markdown, or wrapper-quote pattern.
- If a previous anchor failed validation, either preserve its real source URL in href or remove the anchor wrapper entirely.`;
}

async function loadRowsFromFirestore<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  return loadContentPipelineRows<T>(docId, loadMode);
}

export async function loadH2ContentRowsFromFirestore(
  docId: string = H2_CONTENT_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<H2ContentRow[]> {
  return loadRowsFromFirestore<H2ContentRow>(docId, loadMode);
}

export async function loadRatingRowsFromFirestore(
  docId: string = H2_RATING_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<RatingRow[]> {
  return loadRowsFromFirestore<RatingRow>(docId, loadMode);
}

export async function loadPersistedHtmlRowsFromFirestore(
  docId: string = H2_HTML_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedHtmlRow[]> {
  return loadRowsFromFirestore<PersistedHtmlRow>(docId, loadMode);
}

export function resolveHtmlPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function buildHtmlRowsFromSource(
  h2Rows: H2ContentRow[],
  ratingRows: RatingRow[],
  promptTemplate: string,
): H2HtmlPipelineRow[] {
  const ratingByH2RowId = new Map<string, string>();
  for (const ratingRow of ratingRows) {
    const h2ContentRowId = ratingRow.metadata?.h2ContentRowId;
    const score = ratingRow.metadata?.ratingScore;
    if (h2ContentRowId && score) ratingByH2RowId.set(h2ContentRowId, score);
  }

  const rows: H2HtmlPipelineRow[] = [];
  for (const row of h2Rows) {
    const canonicalContext = readCanonicalH2Context(row.metadata);
    if (!hasRequiredCanonicalH2Context(canonicalContext)) continue;
    const h2Content = stripAnswerWrapper(row.output ?? '');
    const ratingScore = ratingByH2RowId.get(row.id) ?? row.metadata?.ratingScore ?? '';
    const lockReason = lockReasonForRating(ratingScore || undefined);
    const accepted = !lockReason && row.status === 'generated' && h2Content;

    rows.push({
      id: deriveHtmlRowId(row.id),
      status: 'pending',
      input: accepted
        ? buildHtmlPrompt(promptTemplate, {
          pageName: canonicalContext.pageName,
          h2Name: canonicalContext.h2Name,
          h2Content,
        })
        : '',
      output: '',
      metadata: mergeCanonicalH2Context(row.metadata, {
        h2Content,
        ratingScore,
        h2ContentRowId: row.id,
        ...(lockReason ? { [H2_HTML_LOCK_REASON_KEY]: lockReason } : {}),
      }),
    });
  }

  return rows;
}

export function applyHtmlValidationFeedbackToInputs(
  derivedRows: H2HtmlPipelineRow[],
  persistedRows: PersistedHtmlRow[],
): H2HtmlPipelineRow[] {
  const persistedMap = new Map(persistedRows.map(row => [row.id, row]));

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

function normalizePersistedStatus(value: unknown): H2HtmlPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

export function mergeDerivedWithPersistedHtmlRows(
  derivedRows: H2HtmlPipelineRow[],
  persistedRows: PersistedHtmlRow[],
): H2HtmlPipelineRow[] {
  const persistedMap = new Map(persistedRows.map(row => [row.id, row]));
  return derivedRows.map((row) => {
    const persisted = persistedMap.get(row.id);
    if (!persisted) return row;

    const isLocked = Boolean(row.metadata[H2_HTML_LOCK_REASON_KEY]);
    const sourceContentUnchanged = persisted.metadata?.h2Content === row.metadata.h2Content;
    const ratingUnchanged = persisted.metadata?.ratingScore === row.metadata.ratingScore;
    const canReuseOutput = canReusePersistedDerivedRowState({
      derivedInput: row.input,
      persistedInput: persisted.input,
      persistedOutput: persisted.output,
      extraGuard: !isLocked && sourceContentUnchanged && ratingUnchanged,
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

export async function buildH2HtmlRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  ratingRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<H2HtmlPipelineRow[]> {
  const [savedPrompt, h2Rows, ratingRows, persistedHtmlRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadH2ContentRowsFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadRatingRowsFromFirestore(opts.ratingRowsDocId, opts.loadMode),
    loadPersistedHtmlRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);
  const template = resolveHtmlPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = applyHtmlValidationFeedbackToInputs(
    buildHtmlRowsFromSource(h2Rows, ratingRows, template),
    persistedHtmlRows,
  );
  return mergeDerivedWithPersistedHtmlRows(derivedRows, persistedHtmlRows);
}

export function validateGeneratedHtmlOutput(rawOutput: string): { output: string; metadata: Record<string, string>; validationError?: string } {
  const validation = validateHtmlPolicy(rawOutput);
  return {
    output: rawOutput,
    metadata: {
      [H2_HTML_VALIDATION_STATUS_KEY]: validation.passed ? 'Pass' : 'Fail',
    },
    ...(validation.passed ? {} : { validationError: validation.errors[0] || 'HTML validation failed.' }),
  };
}
