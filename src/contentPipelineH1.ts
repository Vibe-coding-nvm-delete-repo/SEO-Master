import {
  UPSTREAM_PAGE_NAMES_DOC_ID,
  loadGeneratePrimaryPrompt,
  parseH2NamesFromOutput,
  type PageNamesSourceRow,
} from './contentPipelineH2';
import { H2_SUMMARY_ROWS_DOC_ID } from './contentPipelineSummary';
import { canReusePersistedDerivedRowState } from './contentPipelineReuse';
import { loadContentPipelineRows, type ContentPipelineLoadMode } from './contentPipelineLoaders';

export const H1_BODY_ROWS_DOC_ID = 'generate_rows_h1_body';
export const H1_BODY_SETTINGS_DOC_ID = 'generate_settings_h1_body';

export type H1SummarySourceRow = {
  id: string;
  status?: string;
  output?: string;
  metadata?: Record<string, string>;
};

export type H1BodyPipelineRow = {
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

type PersistedH1BodyRow = Partial<H1BodyPipelineRow> & { id: string };

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

function normalizePersistedStatus(value: unknown): H1BodyPipelineRow['status'] {
  return value === 'generated' || value === 'error' || value === 'pending' ? value : 'pending';
}

function parseOrder(order: string | undefined): number {
  const n = Number(order ?? '');
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function deriveH1BodyRowId(sourceRowId: string): string {
  return `h1_${sourceRowId}`;
}

export function buildH1BodyPrompt(template: string, values: {
  mainKeyword: string;
  pageName: string;
  h2Names: string;
  h2Content: string;
  h2Summaries: string;
  context: string;
}): string {
  return replaceAllTokens(template, {
    MAIN_KEYWORD: values.mainKeyword,
    PAGE_NAME: values.pageName,
    H2_NAMES: values.h2Names,
    H2_CONTENT: values.h2Content,
    H2_SUMMARIES: values.h2Summaries,
    CONTEXT: values.context,
  });
}

export function buildH1BodyRowsFromSources(
  pageRows: PageNamesSourceRow[],
  summaryRows: H1SummarySourceRow[],
  promptTemplate: string,
): H1BodyPipelineRow[] {
  const summariesBySourceRowId = new Map<string, H1SummarySourceRow[]>();
  for (const row of summaryRows) {
    const sourceRowId = row.metadata?.sourceRowId?.trim();
    if (!sourceRowId) continue;
    const group = summariesBySourceRowId.get(sourceRowId) ?? [];
    group.push(row);
    summariesBySourceRowId.set(sourceRowId, group);
  }

  const rows: H1BodyPipelineRow[] = [];

  for (const pageRow of pageRows) {
    const pageName = pageRow.status === 'generated' ? pageRow.output.trim() : '';
    if (!pageName) continue;

    const sourceSummaryRows = (summariesBySourceRowId.get(pageRow.id) ?? [])
      .filter((row) => row.status === 'generated' && (row.output ?? '').trim())
      .sort((a, b) => parseOrder(a.metadata?.order) - parseOrder(b.metadata?.order));

    if (sourceSummaryRows.length === 0) continue;

    const h2NamesList = pageRow.slots?.h2names?.status === 'generated'
      ? parseH2NamesFromOutput(pageRow.slots?.h2names?.output ?? '')
      : [];
    const fallbackH2Names = sourceSummaryRows
      .map((row) => row.metadata?.h2Name?.trim() ?? '')
      .filter(Boolean);
    const orderedH2Names = h2NamesList.length > 0 ? h2NamesList : fallbackH2Names;
    const h2Names = orderedH2Names.join('\n');

    const h2Content = sourceSummaryRows
      .map((row) => {
        const h2Name = row.metadata?.h2Name?.trim() ?? '';
        const content = row.metadata?.h2Content?.trim() ?? '';
        return h2Name && content ? `${h2Name}: ${content}` : content || h2Name;
      })
      .filter(Boolean)
      .join('\n\n');

    const h2Summaries = sourceSummaryRows
      .map((row) => {
        const h2Name = row.metadata?.h2Name?.trim() ?? '';
        const summary = stripAnswerWrapper(row.output ?? '');
        return h2Name && summary ? `${h2Name}: ${summary}` : summary || h2Name;
      })
      .filter(Boolean)
      .join('\n\n');

    const baseContext = pageRow.slots?.guidelines?.status === 'generated'
      ? (pageRow.slots?.guidelines?.output ?? '').trim()
      : '';
    const context = baseContext
      ? `${baseContext}\n\nH2 Summaries:\n${h2Summaries}`
      : `H2 Summaries:\n${h2Summaries}`;

    rows.push({
      id: deriveH1BodyRowId(pageRow.id),
      status: 'pending',
      input: buildH1BodyPrompt(promptTemplate, {
        mainKeyword: pageRow.input.trim(),
        pageName,
        h2Names,
        h2Content,
        h2Summaries,
        context,
      }),
      output: '',
      metadata: {
        pageName,
        h2Name: h2Names,
        h2Content,
        h2Summaries,
        context,
        mainKeyword: pageRow.input.trim(),
        sourceRowId: pageRow.id,
      },
    });
  }

  return rows;
}

export function mergeDerivedWithPersistedH1BodyRows(
  derivedRows: H1BodyPipelineRow[],
  persistedRows: PersistedH1BodyRow[],
): H1BodyPipelineRow[] {
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

export async function loadPageRowsForH1BodyFromFirestore(
  docId: string = UPSTREAM_PAGE_NAMES_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PageNamesSourceRow[]> {
  return loadRowsFromFirestore<PageNamesSourceRow>(docId, loadMode);
}

export async function loadH2SummaryRowsForH1BodyFromFirestore(
  docId: string = H2_SUMMARY_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<H1SummarySourceRow[]> {
  return loadRowsFromFirestore<H1SummarySourceRow>(docId, loadMode);
}

export async function loadPersistedH1BodyRowsFromFirestore(
  docId: string = H1_BODY_ROWS_DOC_ID,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<PersistedH1BodyRow[]> {
  return loadRowsFromFirestore<PersistedH1BodyRow>(docId, loadMode);
}

export function resolveH1BodyPromptTemplate(saved: string | undefined, fallback: string): string {
  const trimmed = (saved ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function buildH1BodyRowsFromFirestore(opts: {
  settingsDocId: string;
  fallbackPrompt: string;
  pageRowsDocId?: string;
  summaryRowsDocId?: string;
  persistedRowsDocId?: string;
  loadMode?: ContentPipelineLoadMode;
}): Promise<H1BodyPipelineRow[]> {
  const [savedPrompt, pageRows, summaryRows, persistedRows] = await Promise.all([
    loadGeneratePrimaryPrompt(opts.settingsDocId, opts.loadMode),
    loadPageRowsForH1BodyFromFirestore(opts.pageRowsDocId, opts.loadMode),
    loadH2SummaryRowsForH1BodyFromFirestore(opts.summaryRowsDocId, opts.loadMode),
    loadPersistedH1BodyRowsFromFirestore(opts.persistedRowsDocId, opts.loadMode),
  ]);

  const template = resolveH1BodyPromptTemplate(savedPrompt, opts.fallbackPrompt);
  const derivedRows = buildH1BodyRowsFromSources(pageRows, summaryRows, template);
  return mergeDerivedWithPersistedH1BodyRows(derivedRows, persistedRows);
}
