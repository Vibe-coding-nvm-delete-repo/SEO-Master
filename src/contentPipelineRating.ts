import { H2_CONTENT_ROWS_DOC_ID, loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';
import {
  hasRequiredCanonicalH2Context,
  mergeCanonicalH2Context,
  readCanonicalH2Context,
} from './contentPipelineContext';

export const H2_RATING_ROWS_DOC_ID = 'generate_rows_h2_rating';
export const H2_RATING_SETTINGS_DOC_ID = 'generate_settings_h2_rating';

export type H2ContentSourceRow = {
  id: string;
  status: string;
  input: string;
  output: string;
  metadata?: Record<string, string>;
};

export type RatingPipelineRow = {
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

type PersistedRatingStateRow = Partial<RatingPipelineRow> & { id: string };

export type ParsedIncorrectFact = {
  incorrect: string;
  correct: string;
};

export type ParsedRatingResponse = {
  rating: number;
  majorErrors: number;
  minorErrors: number;
  summary: string;
  corrections: string;
  factuallyIncorrectInfo: ParsedIncorrectFact[];
};

function stripFence(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned.startsWith('```')) return cleaned;
  return cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

export function stripAnswerWrapper(raw: string): string {
  const cleaned = raw.trim();
  const match = cleaned.match(/^<answer>\s*([\s\S]*?)\s*<\/answer>$/i);
  return match ? match[1].trim() : cleaned;
}

export function deriveRatingRowId(h2ContentRowId: string): string {
  return `rating_${h2ContentRowId}`;
}

function normalizePersistedStatus(value: unknown): RatingPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

function replaceAllTokens(template: string, replacements: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return next;
}

export function buildRatingPrompt(template: string, values: {
  factCheckTarget: string;
  h2Name: string;
  h2Content: string;
  pageName: string;
}): string {
  return replaceAllTokens(template, {
    FACT_CHECK_TARGET: values.factCheckTarget,
    H2_NAME: values.h2Name,
    H2_CONTENT: values.h2Content,
    PAGE_NAME: values.pageName,
  });
}

export function buildRatingRowsFromH2Rows(
  sourceRows: H2ContentSourceRow[],
  promptTemplate: string,
): RatingPipelineRow[] {
  const result: RatingPipelineRow[] = [];

  for (const row of sourceRows) {
    if (row.status !== 'generated') continue;
    const rawOutput = typeof row.output === 'string' ? row.output.trim() : '';
    if (!rawOutput) continue;

    const canonicalContext = readCanonicalH2Context(row.metadata);
    if (!hasRequiredCanonicalH2Context(canonicalContext)) continue;
    const h2Content = stripAnswerWrapper(rawOutput);
    if (!h2Content) continue;

    const factCheckTarget = canonicalContext.pageName || canonicalContext.h2Name;
    const input = buildRatingPrompt(promptTemplate, {
      factCheckTarget,
      h2Name: canonicalContext.h2Name,
      h2Content,
      pageName: canonicalContext.pageName,
    });

    result.push({
      id: deriveRatingRowId(row.id),
      status: 'pending',
      input,
      output: '',
      metadata: mergeCanonicalH2Context(row.metadata, {
        factCheckTarget,
        h2Content,
        h2ContentRowId: row.id,
      }),
    });
  }

  return result;
}

export function mergeDerivedWithPersistedRatingRows(
  derivedRows: RatingPipelineRow[],
  persistedRows: PersistedRatingStateRow[],
): RatingPipelineRow[] {
  const persistedMap = new Map(persistedRows.map(row => [row.id, row]));
  return derivedRows.map((row) => {
    const persisted = persistedMap.get(row.id);
    if (!persisted) return row;
    const canReuseOutput = canReusePersistedDerivedRowState({
      derivedInput: row.input,
      persistedInput: persisted.input,
      persistedOutput: persisted.output,
    });
    if (!canReuseOutput) return row;
    const persistedMetadata = persisted.metadata ?? {};
    return {
      ...row,
      status: normalizePersistedStatus(persisted.status),
      output: typeof persisted.output === 'string' ? persisted.output : '',
      metadata: {
        ...row.metadata,
        ...(typeof persistedMetadata.ratingScore === 'string' ? { ratingScore: persistedMetadata.ratingScore } : {}),
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

async function loadRowsFromFirestore<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  return loadContentPipelineRows<T>(docId, loadMode);
}

export async function loadH2ContentRowsFromFirestore(
  docId: string = H2_CONTENT_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<H2ContentSourceRow[]> {
  return loadRowsFromFirestore<H2ContentSourceRow>(docId, loadMode);
}

export async function loadPersistedRatingRowsFromFirestore(
  docId: string = H2_RATING_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedRatingStateRow[]> {
  return loadRowsFromFirestore<PersistedRatingStateRow>(docId, loadMode);
}

export function resolveRatingPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function buildRatingRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<RatingPipelineRow[]> {
  const [savedPrompt, sourceRows, persistedRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadH2ContentRowsFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadPersistedRatingRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);
  const template = resolveRatingPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = buildRatingRowsFromH2Rows(sourceRows, template);
  return mergeDerivedWithPersistedRatingRows(derivedRows, persistedRows);
}

function expectIntegerField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Rating JSON missing valid integer field "${field}".`);
  }
  return value;
}

function expectStringField(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Rating JSON missing valid string field "${field}".`);
  }
  return value.trim();
}

function normalizeIncorrectFacts(value: unknown): ParsedIncorrectFact[] {
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    return value.trim() ? [{ incorrect: value.trim(), correct: '' }] : [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Rating JSON field "factuallyIncorrectInfo" must be an array or blank.');
  }
  return value.flatMap((item) => {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      return trimmed ? [{ incorrect: trimmed, correct: '' }] : [];
    }
    if (!item || typeof item !== 'object') {
      throw new Error('Rating JSON field "factuallyIncorrectInfo" contains an invalid item.');
    }
    const incorrect = typeof item.incorrect === 'string' ? item.incorrect.trim() : '';
    const correct = typeof item.correct === 'string' ? item.correct.trim() : '';
    if (!incorrect && !correct) return [];
    return [{ incorrect, correct }];
  });
}

export function parseRatingResponse(rawOutput: string): ParsedRatingResponse {
  const cleaned = stripFence(rawOutput);
  if (!cleaned) throw new Error('Rating model returned empty JSON.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Rating model did not return valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Rating JSON must be a single object.');
  }

  const record = parsed as Record<string, unknown>;
  const rating = expectIntegerField(record.rating, 'rating');
  if (rating < 1 || rating > 5) {
    throw new Error('Rating JSON field "rating" must be an integer from 1 to 5.');
  }

  return {
    rating,
    majorErrors: expectIntegerField(record.majorErrors, 'majorErrors'),
    minorErrors: expectIntegerField(record.minorErrors, 'minorErrors'),
    summary: expectStringField(record.summary, 'summary'),
    corrections: expectStringField(record.corrections, 'corrections'),
    factuallyIncorrectInfo: normalizeIncorrectFacts(record.factuallyIncorrectInfo),
  };
}

export function formatRatingExplanation(parsed: ParsedRatingResponse): string {
  const lines = [
    `Major Errors: ${parsed.majorErrors}`,
    `Minor Errors: ${parsed.minorErrors}`,
    `Summary: ${parsed.summary}`,
    `Corrections: ${parsed.corrections}`,
  ];

  if (parsed.factuallyIncorrectInfo.length > 0) {
    lines.push('Factually Incorrect Info:');
    for (const item of parsed.factuallyIncorrectInfo) {
      if (item.correct) {
        lines.push(`- Incorrect: ${item.incorrect}`);
        lines.push(`  Correct: ${item.correct}`);
      } else {
        lines.push(`- ${item.incorrect}`);
      }
    }
  } else {
    lines.push('Factually Incorrect Info: None');
  }

  return lines.join('\n');
}

export function parseRatingModelOutput(rawOutput: string): { output: string; metadata: Record<string, string> } {
  const parsed = parseRatingResponse(rawOutput);
  return {
    output: formatRatingExplanation(parsed),
    metadata: {
      ratingScore: String(parsed.rating),
    },
  };
}
