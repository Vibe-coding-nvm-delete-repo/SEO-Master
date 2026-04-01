import { loadGeneratePrimaryPrompt } from './contentPipelineH2';
import { METAS_SLUG_CTAS_ROWS_DOC_ID } from './contentPipelineMetasSlugCtas';
import { loadAppSettingsRows } from './appSettingsPersistence';
import { hasMeaningfulContent } from './contentReadiness';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { mergeCanonicalH2Context } from './contentPipelineContext';

export const TIPS_REDFLAGS_ROWS_DOC_ID = 'generate_rows_tips_redflags';
export const TIPS_REDFLAGS_SETTINGS_DOC_ID = 'generate_settings_tips_redflags';

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

export type TipsRedflagsPipelineRow = {
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

type MetasRow = {
  id: string;
  status?: string;
  output?: string;
  metadata?: Record<string, string>;
};

type PersistedTipsRedflagsRow = Partial<TipsRedflagsPipelineRow> & { id: string };

function replaceAllTokens(template: string, replacements: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return next;
}

function normalizePersistedStatus(value: unknown): TipsRedflagsPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

function normalizeReusablePrimaryStatus(value: unknown, output: unknown): TipsRedflagsPipelineRow['status'] {
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

function deriveTipsRedflagsRowId(metasRowId: string): string {
  return `tip_${metasRowId}`;
}

export function buildProTipPrompt(template: string, values: {
  pageName: string;
  articleContext: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    ARTICLE_CONTEXT: values.articleContext,
  });
}

export function buildRedFlagPrompt(template: string, values: {
  pageName: string;
  articleContext: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    ARTICLE_CONTEXT: values.articleContext,
  });
}

export function buildKeyTakeawaysPrompt(template: string, values: {
  pageName: string;
  articleContext: string;
}): string {
  return replaceAllTokens(template, {
    PAGE_NAME: values.pageName,
    ARTICLE_CONTEXT: values.articleContext,
  });
}

export function buildTipsRedflagsRowsFromSource(
  metasRows: MetasRow[],
  promptTemplate: string,
): TipsRedflagsPipelineRow[] {
  const rows: TipsRedflagsPipelineRow[] = [];

  for (const row of metasRows) {
    const pageName = row.metadata?.pageName?.trim() ?? '';
    const h2Name = row.metadata?.h2Name?.trim() ?? '';
    const h2Content = row.metadata?.h2Content?.trim() ?? '';
    const h2Summaries = row.metadata?.h2Summaries?.trim() ?? '';
    const metaTitle = row.metadata?.metaTitle?.trim() ?? '';
    const slug = row.metadata?.slug?.trim() ?? '';
    const ctaHeadline = row.metadata?.ctaHeadline?.trim() ?? '';
    const ctaBody = row.metadata?.ctaBody?.trim() ?? '';
    const accepted = Boolean(pageName && h2Summaries);

    rows.push({
      id: deriveTipsRedflagsRowId(row.id),
      status: 'pending',
      input: accepted ? buildProTipPrompt(promptTemplate, { pageName, articleContext: h2Summaries }) : '',
      output: '',
      metadata: mergeCanonicalH2Context(row.metadata, {
        pageName,
        h2Name,
        h2Content,
        h2Summaries,
        metaTitle,
        slug,
        ctaHeadline,
        ctaBody,
        sourceRowId: row.metadata?.sourceRowId ?? '',
        metasRowId: row.id,
      }),
    });
  }

  return rows;
}

export function mergeDerivedWithPersistedTipsRedflagsRows(
  derivedRows: TipsRedflagsPipelineRow[],
  persistedRows: PersistedTipsRedflagsRow[],
): TipsRedflagsPipelineRow[] {
  const persistedMap = new Map(persistedRows.map((row) => [row.id, row]));

  return derivedRows.map((row) => {
    const persisted = persistedMap.get(row.id);
    if (!persisted) return row;

    const sourceUnchanged =
      persisted.metadata?.pageName === row.metadata.pageName &&
      persisted.metadata?.h2Name === row.metadata.h2Name &&
      persisted.metadata?.h2Content === row.metadata.h2Content &&
      persisted.metadata?.h2Summaries === row.metadata.h2Summaries;

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

async function loadRowsFromFirestore<T>(docId: string): Promise<T[]> {
  return loadAppSettingsRows<T>({
    docId,
    registryKind: 'rows',
  });
}

export async function loadMetasRowsForTipsFromFirestore(
  docId: string = METAS_SLUG_CTAS_ROWS_DOC_ID,
): Promise<MetasRow[]> {
  return loadRowsFromFirestore<MetasRow>(docId);
}

export async function loadPersistedTipsRedflagsRowsFromFirestore(
  docId: string = TIPS_REDFLAGS_ROWS_DOC_ID,
): Promise<PersistedTipsRedflagsRow[]> {
  return loadRowsFromFirestore<PersistedTipsRedflagsRow>(docId);
}

export function resolveTipsRedflagsPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function buildTipsRedflagsRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  sourceRowsDocId?: string;
  persistedRowsDocId?: string;
}): Promise<TipsRedflagsPipelineRow[]> {
  const [savedPrompt, metasRows, persistedRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId),
    loadMetasRowsForTipsFromFirestore(opts.sourceRowsDocId),
    loadPersistedTipsRedflagsRowsFromFirestore(opts.persistedRowsDocId),
  ]);

  const template = resolveTipsRedflagsPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = buildTipsRedflagsRowsFromSource(metasRows, template);
  return mergeDerivedWithPersistedTipsRedflagsRows(derivedRows, persistedRows);
}
