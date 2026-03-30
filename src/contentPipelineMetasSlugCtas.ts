import { loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { QUICK_ANSWER_HTML_ROWS_DOC_ID } from './contentPipelineQuickAnswerHtml';
import { hasMeaningfulContent } from './contentReadiness';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { mergeCanonicalH2Context } from './contentPipelineContext';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';

export const METAS_SLUG_CTAS_ROWS_DOC_ID = 'generate_rows_metas_slug_ctas';
export const METAS_SLUG_CTAS_SETTINGS_DOC_ID = 'generate_settings_metas_slug_ctas';

type SlotState = {
  status?: 'pending' | 'generating' | 'generated' | 'error';
  input?: string;
  output?: string;
  error?: string;
  generatedAt?: string;
  durationMs?: number;
  retries?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
};

export type MetasSlugCtasPipelineRow = {
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
  slots?: Record<string, SlotState>;
  metadata: Record<string, string>;
};

type QuickAnswerHtmlRow = {
  id: string;
  status?: string;
  output?: string;
  metadata?: Record<string, string>;
};

type PersistedMetasSlugCtasRow = Partial<MetasSlugCtasPipelineRow> & { id: string };

function replaceAllTokens(template: string, replacements: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return next;
}

function stripFence(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned.startsWith('```')) return cleaned;
  return cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

function normalizePersistedStatus(value: unknown): MetasSlugCtasPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

function normalizeReusablePrimaryStatus(value: unknown, output: unknown): MetasSlugCtasPipelineRow['status'] {
  const normalized = normalizePersistedStatus(value);
  if (normalized === 'generated' && !hasMeaningfulContent(output)) return 'pending';
  return normalized;
}

function normalizePersistedSlot(slot: SlotState | undefined): SlotState | undefined {
  if (!slot) return undefined;
  return {
    ...slot,
    status: slot.status === 'generated' || slot.status === 'error' || slot.status === 'pending'
      ? slot.status
      : 'pending',
  };
}

function deriveMetasSlugCtasRowId(quickAnswerHtmlRowId: string): string {
  return `meta_${quickAnswerHtmlRowId}`;
}

export function buildMetaDescriptionPrompt(template: string, values: { pageName: string }): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
  });
}

export function buildSlugPrompt(template: string, values: {
  pageName: string;
  referenceContext: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    REFERENCE_CONTEXT: values.referenceContext,
  });
}

export function buildCtaPrompt(template: string, values: { pageName: string }): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
  });
}

export function parseCtaJsonOutput(rawOutput: string): { headline: string; body: string } {
  const cleaned = stripFence(rawOutput);
  if (!cleaned) throw new Error('CTA JSON output was empty.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('CTA JSON output was invalid.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CTA JSON must be a single object.');
  }

  const record = parsed as Record<string, unknown>;
  const headline = typeof record.headline === 'string' ? record.headline.trim() : '';
  const body = typeof record.body === 'string' ? record.body.trim() : '';

  if (!headline) throw new Error('CTA JSON is missing required string field "headline".');
  if (!body) throw new Error('CTA JSON is missing required string field "body".');

  return { headline, body };
}

export function buildMetasSlugCtasRowsFromSource(
  quickAnswerHtmlRows: QuickAnswerHtmlRow[],
  promptTemplate: string,
): MetasSlugCtasPipelineRow[] {
  const rows: MetasSlugCtasPipelineRow[] = [];

  for (const row of quickAnswerHtmlRows) {
    const pageName = row.metadata?.pageName?.trim() ?? '';
    const h2Name = row.metadata?.h2Name?.trim() ?? '';
    const h2Content = row.metadata?.h2Content?.trim() ?? '';
    const h2Summaries = row.metadata?.h2Summaries?.trim() ?? '';
    const h1Body = row.metadata?.h1Body?.trim() ?? '';
    const quickAnswer = row.metadata?.quickAnswer?.trim() ?? '';
    const quickAnswerHtml = (row.output ?? '').trim();
    const metaTitle = pageName;
    const accepted = row.status === 'generated' && pageName && quickAnswerHtml;

    rows.push({
      id: deriveMetasSlugCtasRowId(row.id),
      status: 'pending',
      input: accepted ? buildMetaDescriptionPrompt(promptTemplate, { pageName }) : '',
      output: '',
      metadata: mergeCanonicalH2Context(row.metadata, {
        pageName,
        h2Name,
        h2Content,
        h2Summaries,
        h1Body,
        quickAnswer,
        quickAnswerHtml,
        metaTitle,
        quickAnswerHtmlRowId: row.id,
        sourceRowId: row.metadata?.sourceRowId ?? '',
      }),
    });
  }

  return rows;
}

export function mergeDerivedWithPersistedMetasSlugCtasRows(
  derivedRows: MetasSlugCtasPipelineRow[],
  persistedRows: PersistedMetasSlugCtasRow[],
): MetasSlugCtasPipelineRow[] {
  const persistedMap = new Map(persistedRows.map((row) => [row.id, row]));

  return derivedRows.map((row) => {
    const persisted = persistedMap.get(row.id);
    if (!persisted) return row;

    const sourceUnchanged =
      persisted.metadata?.pageName === row.metadata.pageName &&
      persisted.metadata?.quickAnswerHtml === row.metadata.quickAnswerHtml &&
      persisted.metadata?.quickAnswer === row.metadata.quickAnswer &&
      persisted.metadata?.h1Body === row.metadata.h1Body;

    const canReuseState = canReusePersistedDerivedRowState({
      derivedInput: row.input,
      persistedInput: persisted.input,
      persistedOutput: persisted.output,
      requireNonEmptyOutput: false,
      extraGuard: sourceUnchanged,
    });
    if (!canReuseState) return row;

    return {
      ...row,
      status: normalizeReusablePrimaryStatus(persisted.status, persisted.output),
      output: typeof persisted.output === 'string' ? persisted.output : '',
      slots: persisted.slots
        ? Object.fromEntries(
          Object.entries(persisted.slots).map(([key, slot]) => [key, normalizePersistedSlot(slot)]),
        )
        : undefined,
      metadata: {
        ...row.metadata,
        ...(typeof persisted.metadata?.slug === 'string' ? { slug: persisted.metadata.slug } : {}),
        ...(typeof persisted.metadata?.ctaHeadline === 'string' ? { ctaHeadline: persisted.metadata.ctaHeadline } : {}),
        ...(typeof persisted.metadata?.ctaBody === 'string' ? { ctaBody: persisted.metadata.ctaBody } : {}),
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

export async function loadQuickAnswerHtmlRowsForMetasFromFirestore(
  docId: string = QUICK_ANSWER_HTML_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<QuickAnswerHtmlRow[]> {
  return loadRowsFromFirestore<QuickAnswerHtmlRow>(docId, loadMode);
}

export async function loadPersistedMetasSlugCtasRowsFromFirestore(
  docId: string = METAS_SLUG_CTAS_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedMetasSlugCtasRow[]> {
  return loadRowsFromFirestore<PersistedMetasSlugCtasRow>(docId, loadMode);
}

export function resolveMetasSlugCtasPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function buildMetasSlugCtasRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<MetasSlugCtasPipelineRow[]> {
  const [savedPrompt, quickAnswerHtmlRows, persistedRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadQuickAnswerHtmlRowsForMetasFromFirestore(opts.sourceRowsDocId, opts.loadMode),
    loadPersistedMetasSlugCtasRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);

  const template = resolveMetasSlugCtasPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = buildMetasSlugCtasRowsFromSource(quickAnswerHtmlRows, template);
  return mergeDerivedWithPersistedMetasSlugCtasRows(derivedRows, persistedRows);
}
