import { createCanonicalH2Context } from './contentPipelineContext';
import { loadContentPipelineDocData, loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';

/** Firestore doc id for the Page Names generate step (source for H2 Content pipeline). */
export const UPSTREAM_PAGE_NAMES_DOC_ID = 'generate_rows_page_names';

/** Firestore doc id for persisted H2 body rows/state. */
export const H2_CONTENT_ROWS_DOC_ID = 'generate_rows_h2_content';

/** Firestore doc id for H2 Content generate settings (`prompt` = primary body template). */
export const H2_PIPELINE_SETTINGS_DOC_ID = 'generate_settings_h2_content';

/** Firestore doc id for persisted rating rows/state. */
export const H2_RATING_ROWS_DOC_ID = 'generate_rows_h2_rating';

export type PageNamesSourceRow = {
  id: string;
  status?: string;
  input: string;
  output: string;
  slots?: Record<string, { status: string; input: string; output: string }>;
};

export type H2PipelineRow = {
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

export type ParsedH2Item = {
  order: number;
  h2Name: string;
};

export type H2NamesJsonItem = {
  order: number;
  h2: string;
};

export type H2NamesJson = {
  h2s: H2NamesJsonItem[];
};

export type H2QaFlag = {
  h2: string;
  reason: string;
};

export type H2QaJson = {
  rating: 1 | 2 | 3 | 4;
  flaggedH2s: H2QaFlag[];
};

export type PageGuidelineJsonItem = {
  h2: string;
  guidelines: string;
  formatting: string;
};

export type PageGuidelinesJson = {
  guidelines: PageGuidelineJsonItem[];
};

type PersistedH2StateRow = Partial<H2PipelineRow> & { id: string };
type PersistedRatingStateRow = { id: string; status?: string; output?: string; metadata?: Record<string, string> };
const TABLE_FORMATTING_PATTERN = /\btable(?:s)?\b|\btabular\b|\bchart(?:s)?\b|\brow(?:s)?\b|\bcolumn(?:s)?\b/iu;
const SAFE_NON_TABLE_FORMATTING = 'Use concise paragraphs, bullet lists, or numbered steps for structured details.';

function stripFence(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned.startsWith('```')) return cleaned;
  return cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

function normalizeH2Text(raw: string): string {
  return raw
    .replace(/^[\s•\-*]+/, '')
    .replace(/^\d+\s*[.)\-:]\s*/, '')
    .replace(/\s*-\s*\d+(\.\d+)?\s*$/, '')
    .trim();
}

function slugify(raw: string): string {
  const slug = normalizeH2Text(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

function parseOrderValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function normalizePersistedStatus(value: unknown): H2PipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function formattingContainsTableRecommendation(raw: string): boolean {
  return TABLE_FORMATTING_PATTERN.test(raw.trim());
}

function sanitizeFormattingRecommendation(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return formattingContainsTableRecommendation(trimmed) ? SAFE_NON_TABLE_FORMATTING : trimmed;
}

function parseLooseH2ItemsFromJsonValue(value: unknown): ParsedH2Item[] {
  if (Array.isArray(value)) {
    return value
      .map((item, idx): ParsedH2Item | null => {
        if (typeof item === 'string') {
          const h2Name = normalizeH2Text(item);
          if (!h2Name || h2Name.toLowerCase().startsWith('cross-check')) return null;
          return { order: idx + 1, h2Name };
        }
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const rawName = record.h2 ?? record.name ?? record.title ?? record.heading ?? record.h2Name;
        if (typeof rawName !== 'string') return null;
        const h2Name = normalizeH2Text(rawName);
        if (!h2Name || h2Name.toLowerCase().startsWith('cross-check')) return null;
        return {
          order:
            parseOrderValue(record.order) ??
            parseOrderValue(record.number) ??
            parseOrderValue(record.index) ??
            idx + 1,
          h2Name,
        };
      })
      .filter((item): item is ParsedH2Item => item !== null);
  }

  if (isPlainObject(value) && Array.isArray(value.h2s)) {
    return parseLooseH2ItemsFromJsonValue(value.h2s);
  }

  return [];
}

function parseJsonOrThrow(rawOutput: string, errorPrefix: string): unknown {
  const cleaned = stripFence(rawOutput);
  if (!cleaned) throw new Error(`${errorPrefix} output was empty.`);
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`${errorPrefix} output was invalid JSON.`);
  }
}

export function formatCanonicalH2NamesJson(items: ParsedH2Item[]): string {
  return JSON.stringify(
    {
      h2s: items.map((item) => ({ order: item.order, h2: item.h2Name })),
    },
    null,
    2,
  );
}

export function parseStrictH2NamesJsonOutput(rawOutput: string): {
  json: H2NamesJson;
  items: ParsedH2Item[];
  normalizedOutput: string;
} {
  const parsed = parseJsonOrThrow(rawOutput, 'H2 JSON');

  if (!isPlainObject(parsed)) {
    throw new Error('H2 JSON must be a single object with an "h2s" array.');
  }

  const rootKeys = Object.keys(parsed);
  if (rootKeys.length !== 1 || rootKeys[0] !== 'h2s') {
    throw new Error('H2 JSON must contain exactly one top-level key: "h2s".');
  }

  if (!Array.isArray(parsed.h2s)) {
    throw new Error('H2 JSON field "h2s" must be an array.');
  }

  if (parsed.h2s.length < 7 || parsed.h2s.length > 11) {
    throw new Error('H2 JSON must contain between 7 and 11 H2 entries.');
  }

  const seen = new Set<string>();
  const items = parsed.h2s.map((item, idx): ParsedH2Item => {
    if (!isPlainObject(item)) {
      throw new Error(`H2 JSON item ${idx + 1} must be an object with exactly "order" and "h2".`);
    }

    const keys = Object.keys(item).sort();
    if (keys.length !== 2 || keys[0] !== 'h2' || keys[1] !== 'order') {
      throw new Error(`H2 JSON item ${idx + 1} must contain exactly the keys "order" and "h2".`);
    }

    const order = typeof item.order === 'number' ? item.order : Number.NaN;
    if (!Number.isInteger(order) || order <= 0) {
      throw new Error(`H2 JSON item ${idx + 1} has an invalid "order". Expected a positive integer.`);
    }

    if (order !== idx + 1) {
      throw new Error(`H2 JSON orders must start at 1 and increase by 1 with no gaps. Item ${idx + 1} should have order ${idx + 1}.`);
    }

    const rawH2 = item.h2;
    if (typeof rawH2 !== 'string') {
      throw new Error(`H2 JSON item ${idx + 1} is missing required string field "h2".`);
    }

    const h2Name = normalizeH2Text(rawH2);
    if (!h2Name) {
      throw new Error(`H2 JSON item ${idx + 1} has an empty "h2" value.`);
    }

    if (h2Name.toLowerCase().startsWith('cross-check')) {
      throw new Error(`H2 JSON item ${idx + 1} contains forbidden cross-check text.`);
    }

    const duplicateKey = normalizeH2LookupKey(h2Name);
    if (seen.has(duplicateKey)) {
      throw new Error(`H2 JSON contains a duplicate H2: "${h2Name}".`);
    }
    seen.add(duplicateKey);

    return { order, h2Name };
  });

  const json: H2NamesJson = {
    h2s: items.map((item) => ({ order: item.order, h2: item.h2Name })),
  };

  return {
    json,
    items,
    normalizedOutput: formatCanonicalH2NamesJson(items),
  };
}

export function formatH2ListForQa(items: ParsedH2Item[]): string {
  return items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => `${item.order}. ${item.h2Name}`)
    .join('\n');
}

export function parseH2QaJsonOutput(rawOutput: string): {
  json: H2QaJson;
  normalizedOutput: string;
} {
  const parsed = parseJsonOrThrow(rawOutput, 'H2 QA JSON');

  if (!isPlainObject(parsed)) {
    throw new Error('H2 QA JSON must be a single object.');
  }

  const rootKeys = Object.keys(parsed).sort();
  if (rootKeys.length !== 2 || rootKeys[0] !== 'flaggedH2s' || rootKeys[1] !== 'rating') {
    throw new Error('H2 QA JSON must contain exactly the keys "rating" and "flaggedH2s".');
  }

  const ratingValue = parsed.rating;
  const rating = typeof ratingValue === 'number' ? ratingValue : Number.NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
    throw new Error('H2 QA JSON field "rating" must be an integer from 1 to 4.');
  }

  if (!Array.isArray(parsed.flaggedH2s)) {
    throw new Error('H2 QA JSON field "flaggedH2s" must be an array.');
  }

  const flaggedH2s = parsed.flaggedH2s.map((item, idx): H2QaFlag => {
    if (!isPlainObject(item)) {
      throw new Error(`H2 QA flagged item ${idx + 1} must be an object with "h2" and "reason".`);
    }
    const keys = Object.keys(item).sort();
    if (keys.length !== 2 || keys[0] !== 'h2' || keys[1] !== 'reason') {
      throw new Error(`H2 QA flagged item ${idx + 1} must contain exactly the keys "h2" and "reason".`);
    }
    const h2 = normalizeH2Text(typeof item.h2 === 'string' ? item.h2 : '');
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    if (!h2) throw new Error(`H2 QA flagged item ${idx + 1} is missing required string field "h2".`);
    if (!reason) throw new Error(`H2 QA flagged item ${idx + 1} is missing required string field "reason".`);
    return { h2, reason };
  });

  if (rating === 4 && flaggedH2s.length > 0) {
    throw new Error('H2 QA JSON must leave "flaggedH2s" empty when rating is 4.');
  }

  if (rating < 4 && flaggedH2s.length === 0) {
    throw new Error('H2 QA JSON must include one or more flagged H2s when rating is 1, 2, or 3.');
  }

  const json: H2QaJson = { rating: rating as 1 | 2 | 3 | 4, flaggedH2s };
  return {
    json,
    normalizedOutput: JSON.stringify(json, null, 2),
  };
}

export function formatH2QaFlags(flags: H2QaFlag[]): string {
  return flags.map((flag) => `${flag.h2}: ${flag.reason}`).join('\n');
}

export function mergeH2QaMetadataFromOutput(
  rawOutput: string,
  fallbackMetadata?: Record<string, string>,
): Record<string, string> | undefined {
  const nextMetadata = { ...(fallbackMetadata ?? {}) };
  const trimmedOutput = rawOutput.trim();

  if (!trimmedOutput) {
    return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
  }

  try {
    const parsed = parseH2QaJsonOutput(rawOutput);
    if (!(nextMetadata.h2QaRating ?? '').trim()) {
      nextMetadata.h2QaRating = String(parsed.json.rating);
    }
    if (!(nextMetadata.h2QaFlags ?? '').trim() && parsed.json.flaggedH2s.length > 0) {
      nextMetadata.h2QaFlags = formatH2QaFlags(parsed.json.flaggedH2s);
    }
  } catch {
    // Keep any persisted metadata and leave invalid JSON untouched.
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

export function formatCanonicalPageGuidelinesJson(items: PageGuidelineJsonItem[]): string {
  return JSON.stringify(
    {
      guidelines: items,
    },
    null,
    2,
  );
}

export function parseStrictPageGuidelinesJsonOutput(
  rawOutput: string,
  expectedH2Names?: string[],
): {
  json: PageGuidelinesJson;
  normalizedOutput: string;
} {
  const parsed = parseJsonOrThrow(rawOutput, 'Page Guide JSON');

  if (!isPlainObject(parsed)) {
    throw new Error('Page Guide JSON must be a single object with a "guidelines" array.');
  }

  const rootKeys = Object.keys(parsed);
  if (rootKeys.length !== 1 || rootKeys[0] !== 'guidelines') {
    throw new Error('Page Guide JSON must contain exactly one top-level key: "guidelines".');
  }

  if (!Array.isArray(parsed.guidelines)) {
    throw new Error('Page Guide JSON field "guidelines" must be an array.');
  }

  if (parsed.guidelines.length === 0) {
    throw new Error('Page Guide JSON must contain at least one guideline entry.');
  }

  const normalizedExpected = expectedH2Names?.map(normalizeH2LookupKey) ?? [];
  if (normalizedExpected.length > 0 && parsed.guidelines.length !== normalizedExpected.length) {
    throw new Error(`Page Guide JSON must include exactly ${normalizedExpected.length} guideline entries to match the H2 list.`);
  }

  const seen = new Set<string>();
  const guidelines = parsed.guidelines.map((item, idx): PageGuidelineJsonItem => {
    if (!isPlainObject(item)) {
      throw new Error(`Page Guide JSON item ${idx + 1} must be an object with exactly "h2", "guidelines", and "formatting".`);
    }

    const keys = Object.keys(item).sort();
    if (keys.length !== 3 || keys[0] !== 'formatting' || keys[1] !== 'guidelines' || keys[2] !== 'h2') {
      throw new Error(`Page Guide JSON item ${idx + 1} must contain exactly the keys "h2", "guidelines", and "formatting".`);
    }

    const h2 = normalizeH2Text(typeof item.h2 === 'string' ? item.h2 : '');
    const guidelineText = typeof item.guidelines === 'string' ? item.guidelines.trim() : '';
    const formattingText = typeof item.formatting === 'string' ? item.formatting.trim() : '';

    if (!h2) throw new Error(`Page Guide JSON item ${idx + 1} is missing required string field "h2".`);
    if (!guidelineText) throw new Error(`Page Guide JSON item ${idx + 1} is missing required string field "guidelines".`);
    if (!formattingText) throw new Error(`Page Guide JSON item ${idx + 1} is missing required string field "formatting".`);
    if (formattingContainsTableRecommendation(formattingText)) {
      throw new Error(`Page Guide JSON item ${idx + 1} formatting must not recommend tables or tabular layouts.`);
    }

    const normalizedH2 = normalizeH2LookupKey(h2);
    if (seen.has(normalizedH2)) {
      throw new Error(`Page Guide JSON contains a duplicate H2 guideline entry: "${h2}".`);
    }
    seen.add(normalizedH2);

    if (normalizedExpected.length > 0 && normalizedExpected[idx] !== normalizedH2) {
      throw new Error(`Page Guide JSON item ${idx + 1} must match H2 "${expectedH2Names?.[idx] ?? ''}" in the same order.`);
    }

    return {
      h2,
      guidelines: guidelineText,
      formatting: formattingText,
    };
  });

  const json: PageGuidelinesJson = { guidelines };
  return {
    json,
    normalizedOutput: formatCanonicalPageGuidelinesJson(guidelines),
  };
}

export function normalizeH2LookupKey(raw: string): string {
  return normalizeH2Text(raw).toLowerCase();
}

export function deriveH2RowId(sourceRowId: string, order: number, h2Name: string): string {
  return `h2_${sourceRowId}_${order}_${slugify(h2Name)}`;
}

function buildH2ContentPrompt(template: string, values: {
  pageName: string;
  h2Name: string;
  allH2s: string;
  contentGuidelines: string;
  factualCorrections: string;
}): string {
  return template
    .replace(/\{PAGE_NAME\}/g, values.pageName)
    .replace(/\{H2_NAME\}/g, values.h2Name)
    .replace(/\{ALL_H2S\}/g, values.allH2s)
    .replace(/\{CONTENT_GUIDELINES\}/g, values.contentGuidelines)
    .replace(/\{FACTUAL_CORRECTIONS\}/g, values.factualCorrections);
}

export function parseH2ItemsFromOutput(h2Output: string): ParsedH2Item[] {
  const cleaned = stripFence(h2Output);
  if (!cleaned) return [];

  try {
    const parsed = JSON.parse(cleaned);
    const jsonItems = parseLooseH2ItemsFromJsonValue(parsed);
    if (jsonItems.length > 0) return jsonItems;
    if (Array.isArray(parsed) || isPlainObject(parsed)) return [];
  } catch {
    // Fall through to line-based parsing.
  }

  return cleaned
    .split('\n')
    .map((line, idx): ParsedH2Item | null => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith('cross-check')) return null;
      const numberedMatch = trimmed.match(/^\s*(\d+)\s*[.)\-:]\s*(.+)$/);
      if (numberedMatch) {
        const h2Name = normalizeH2Text(numberedMatch[2]);
        if (!h2Name) return null;
        return { order: Number(numberedMatch[1]), h2Name };
      }
      const h2Name = normalizeH2Text(trimmed);
      if (!h2Name) return null;
      return { order: idx + 1, h2Name };
    })
    .filter((item): item is ParsedH2Item => item !== null);
}

export function parseH2NamesFromOutput(h2Output: string): string[] {
  return parseH2ItemsFromOutput(h2Output).map(item => item.h2Name);
}

export function parseGuidelinesJson(guidelinesOutput: string): Map<string, { guidelines: string; formatting: string }> {
  const map = new Map<string, { guidelines: string; formatting: string }>();
  try {
    const cleaned = stripFence(guidelinesOutput);
    const parsed = JSON.parse(cleaned);
    const items = Array.isArray(parsed)
      ? parsed
      : isPlainObject(parsed) && Array.isArray(parsed.guidelines)
        ? parsed.guidelines
        : [];
    if (items.length > 0) {
      for (const item of items) {
        if (item && typeof item.h2 === 'string') {
          map.set(normalizeH2LookupKey(item.h2), {
            guidelines: typeof item.guidelines === 'string' ? item.guidelines : '',
            formatting: sanitizeFormattingRecommendation(typeof item.formatting === 'string' ? item.formatting : ''),
          });
        }
      }
    }
  } catch {
    // JSON parse failed; old non-JSON guidelines may still be present.
  }
  return map;
}

async function loadRowsFromFirestore<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  // Derived H2 rows must rebuild from authoritative shared state.
  // Local-preferred cache reads can be newer by timestamp but still stale in content
  // while an upstream slot write is propagating, which leaves H2 rows stuck with
  // "(No guidelines generated yet)" after Page Guide has already been saved.
  return loadContentPipelineRows<T>(docId, loadMode);
}

export async function loadPageNamesRowsFromFirestore(
  docId: string = UPSTREAM_PAGE_NAMES_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PageNamesSourceRow[]> {
  return loadRowsFromFirestore<PageNamesSourceRow>(docId, loadMode);
}

export async function loadPersistedH2RowsFromFirestore(
  docId: string = H2_CONTENT_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedH2StateRow[]> {
  return loadRowsFromFirestore<PersistedH2StateRow>(docId, loadMode);
}

export async function loadPersistedRatingRowsFromFirestore(
  docId: string = H2_RATING_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedRatingStateRow[]> {
  return loadRowsFromFirestore<PersistedRatingStateRow>(docId, loadMode);
}

export function buildH2ExplodedRowsFromPageRows(
  sourceRows: PageNamesSourceRow[],
  promptTemplate: string,
): H2PipelineRow[] {
  const result: H2PipelineRow[] = [];

  for (const row of sourceRows) {
    const pageName = row.status === 'generated' ? (row.output ?? '').trim() : '';
    if (!pageName) continue;

    const h2Output = row.slots?.h2names?.status === 'generated' ? row.slots?.h2names?.output ?? '' : '';
    const h2Items = parseH2ItemsFromOutput(h2Output);
    if (h2Items.length === 0) continue;

    const guidelinesOutput = row.slots?.guidelines?.status === 'generated' ? row.slots?.guidelines?.output ?? '' : '';
    const guidelinesMap = parseGuidelinesJson(guidelinesOutput);
    const allH2sOrdered = h2Items.map(item => `${item.order}. ${item.h2Name}`).join('\n');

    for (const h2Item of h2Items) {
      const h2Name = h2Item.h2Name;
      const order = h2Item.order;
      const guideline = guidelinesMap.get(normalizeH2LookupKey(h2Name));
      const contentGuidelines = guideline
        ? `${guideline.guidelines}\n\nFormatting: ${guideline.formatting}`
        : guidelinesOutput
          ? '(Guidelines not matched for this H2)'
          : '(No guidelines generated yet)';

      const input = buildH2ContentPrompt(promptTemplate, {
        pageName,
        h2Name,
        allH2s: allH2sOrdered,
        contentGuidelines,
        factualCorrections: '',
      });

      result.push({
        id: deriveH2RowId(row.id, order, h2Name),
        status: 'pending',
        input,
        output: '',
        metadata: createCanonicalH2Context({
          pageName,
          order: String(order),
          h2Name,
          contentGuidelines,
          sourceRowId: row.id,
        }),
      });
    }
  }

  return result;
}

export function mergeDerivedWithPersistedRows(
  derivedRows: H2PipelineRow[],
  persistedRows: PersistedH2StateRow[],
): H2PipelineRow[] {
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
    return {
      ...row,
      status: normalizePersistedStatus(persisted.status),
      output: typeof persisted.output === 'string' ? persisted.output : '',
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

export function mergeH2RowsWithRatingScores(
  rows: H2PipelineRow[],
  ratingRows: PersistedRatingStateRow[],
): H2PipelineRow[] {
  const scoreByH2RowId = new Map<string, string>();
  for (const ratingRow of ratingRows) {
    const h2ContentRowId = ratingRow.metadata?.h2ContentRowId;
    const score = ratingRow.metadata?.ratingScore;
    if (!h2ContentRowId || !score) continue;
    scoreByH2RowId.set(h2ContentRowId, score);
  }

  return rows.map((row) => {
    const nextMetadata = { ...(row.metadata ?? {}) };
    const score = scoreByH2RowId.get(row.id);
    if (row.status === 'generated' && row.output.trim() && score) {
      nextMetadata.ratingScore = score;
    } else {
      delete nextMetadata.ratingScore;
    }
    return {
      ...row,
      metadata: nextMetadata,
    };
  });
}

export async function loadGeneratePrimaryPrompt(
  settingsDocId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<string | undefined> {
  const data = await loadContentPipelineDocData(settingsDocId, loadMode);
  if (!data) return undefined;
  const p = data?.prompt;
  if (typeof p !== 'string') return undefined;
  const t = p.trim();
  return t.length > 0 ? t : undefined;
}

export function resolveH2ContentPromptTemplate(saved: string | undefined, fallback: string): string {
  const t = (saved ?? '').trim();
  return t.length > 0 ? t : fallback;
}

export async function buildH2ContentRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
  persistedRatingRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<H2PipelineRow[]> {
  const [savedPrompt, sourceRows, persistedRows, persistedRatingRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadPageNamesRowsFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadPersistedH2RowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
    loadPersistedRatingRowsFromFirestore(opts.persistedRatingRowsDocId, opts.loadMode),
  ]);
  const template = resolveH2ContentPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = buildH2ExplodedRowsFromPageRows(sourceRows, template);
  return mergeH2RowsWithRatingScores(mergeDerivedWithPersistedRows(derivedRows, persistedRows), persistedRatingRows);
}

export async function buildH2ContentRows(promptTemplate: string): Promise<H2PipelineRow[]> {
  const [sourceRows, persistedRows] = await Promise.all([
    loadPageNamesRowsFromFirestore(),
    loadPersistedH2RowsFromFirestore(),
  ]);
  const derivedRows = buildH2ExplodedRowsFromPageRows(sourceRows, promptTemplate);
  return mergeDerivedWithPersistedRows(derivedRows, persistedRows);
}
