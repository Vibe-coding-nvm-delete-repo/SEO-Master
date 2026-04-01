import type { ChangelogEntry } from '../changelogStorage';
import {
  deriveH2RowId,
  formatCanonicalH2NamesJson,
  formatCanonicalPageGuidelinesJson,
} from '../contentPipelineH2';

type QaDoc = Record<string, unknown>;
type QaRow = Record<string, unknown>;

type QaSnapshot = {
  exists: () => boolean;
  data: () => QaDoc;
  metadata: { fromCache: boolean };
};

type QaFetchContext = {
  scenario: string;
};

type QaState = {
  appSettingsDocs: Map<string, QaDoc>;
  appSettingsListeners: Map<string, Set<(snap: QaSnapshot) => void>>;
  localCache: Map<string, unknown>;
  changelogEntries: ChangelogEntry[];
  changelogListeners: Set<(entries: ChangelogEntry[]) => void>;
  buildName: string;
  buildNameListeners: Set<(name: string) => void>;
};

type QaH2Seed = {
  order: number;
  h2Name: string;
  guidelines: string;
  formatting: string;
  content: string;
  summary: string;
  ratingScore: string;
  metaHeading: string;
};

const QA_PATH = '/__qa/content-pipeline';
const SHARED_API_KEY = 'qa-shared-openrouter-key';
export const QA_PROJECT_ID = 'qa-content-project';
export const QA_SCENARIO_INIT_PREFIX = 'kwg:qa:content-pipeline:init';
const PAGE_ROW_ID = 'page_row_1';
const PAGE_KEYWORD = 'installment loans';
const PAGE_TITLE = 'Can You Get Installment Loans?';
const QA_DOC_STORAGE_PREFIX = 'kwg:qa:content-pipeline:doc';
const QA_CACHE_STORAGE_PREFIX = 'kwg:qa:content-pipeline:cache';

const QA_PROMPTS = {
  pageNames: 'PAGE_TITLE::{KEYWORD}',
  h2Content: 'H2_BODY::{PAGE_NAME}::{H2_NAME}::{ALL_H2S}::{CONTENT_GUIDELINES}::{FACTUAL_CORRECTIONS}',
  rating: 'H2_RATE::{FACT_CHECK_TARGET}::{H2_NAME}::{H2_CONTENT}::{PAGE_NAME}',
  h2Html: 'H2_HTML::{PAGE_NAME}::{H2_NAME}::{H2_CONTENT}',
  h2Summary: 'H2_SUMMARY::{PAGE_NAME}::{H2_NAME}::{H2_CONTENT}',
  h1Body: 'H1_BODY::{MAIN_KEYWORD}::{PAGE_NAME}::{H2_NAMES}::{H2_CONTENT}::{H2_SUMMARIES}::{CONTEXT}',
  h1Html: 'H1_HTML::{PAGE_NAME}::{H1_BODY}',
  quickAnswer: 'QUICK_ANSWER::{PAGE_NAME}::{H1_BODY}',
  quickAnswerHtml: 'QUICK_ANSWER_HTML::{PAGE_NAME}::{QUICK_ANSWER}',
  metaDescription: 'META::{PAGE_NAME}',
  slug: 'SLUG::{PAGE_NAME}::{REFERENCE_CONTEXT}',
  cta: 'CTA::{PAGE_NAME}',
  proTip: 'PRO_TIP::{PAGE_NAME}::{ARTICLE_CONTEXT}',
  redFlag: 'RED_FLAG::{PAGE_NAME}::{ARTICLE_CONTEXT}',
  keyTakeaways: 'KEY_TAKEAWAYS::{PAGE_NAME}::{ARTICLE_CONTEXT}',
} as const;

const FULL_FLOW_H2S: QaH2Seed[] = [
  {
    order: 1,
    h2Name: 'What Are Installment Loans?',
    guidelines: 'Define the product plainly before moving into fit, risk, or comparison guidance.',
    formatting: '2 short paragraphs',
    content: 'Installment loans are repaid in equal scheduled payments over time.',
    summary: 'Installment loans spread repayment across scheduled installments.',
    ratingScore: '2',
    metaHeading: 'Definition',
  },
  {
    order: 2,
    h2Name: 'When Do Installment Loans Make Sense?',
    guidelines: 'Explain fit in practical terms and anchor the answer to predictable repayment ability.',
    formatting: 'paragraph + bullets',
    content: 'They can fit planned one-time expenses when the terms are clear and affordable.',
    summary: 'They fit planned expenses when the repayment schedule is affordable.',
    ratingScore: '2',
    metaHeading: 'Fit',
  },
  {
    order: 3,
    h2Name: 'What Risks Should You Watch For?',
    guidelines: 'Be direct about cost, pressure, and verification risks without drifting into absolutes.',
    formatting: '2 short paragraphs',
    content: 'Watch rates, fees, rollover pressure, and lender credibility before you commit.',
    summary: 'Borrowers should compare cost, pressure points, and lender credibility.',
    ratingScore: '5',
    metaHeading: 'Risk',
  },
  {
    order: 4,
    h2Name: 'How Can You Compare Lenders Safely?',
    guidelines: 'Keep the answer procedural and emphasize evidence, not marketing claims.',
    formatting: 'opening paragraph + numbered steps',
    content: 'Compare APR, fees, payoff flexibility, and complaint history before choosing a lender.',
    summary: 'Safe comparison focuses on total cost, payoff flexibility, and lender history.',
    ratingScore: '1',
    metaHeading: 'Comparison',
  },
  {
    order: 5,
    h2Name: 'What Should You Check Before Applying?',
    guidelines: 'Close with a practical checklist that reinforces affordability and document review.',
    formatting: 'bullet list only',
    content: 'Check your budget, the due date, the full loan cost, and the lender terms before applying.',
    summary: 'Review budget, due dates, full cost, and lender terms before applying.',
    ratingScore: '2',
    metaHeading: 'Checklist',
  },
];

let qaState: QaState | null = null;
let originalFetch: typeof fetch | null = null;
let fetchInstalled = false;
let storageSyncInstalled = false;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeQaDocId(docId: string): string {
  return docId.replace(/^project_.+?__/, '');
}

export function getQaScenarioInitKey(scenario: string): string {
  return `${QA_SCENARIO_INIT_PREFIX}:${scenario}`;
}

function qaDocStorageKey(scenario: string, docId: string): string {
  return `${QA_DOC_STORAGE_PREFIX}:${scenario}:${normalizeQaDocId(docId)}`;
}

function qaCacheStorageKey(scenario: string, key: string): string {
  return `${QA_CACHE_STORAGE_PREFIX}:${scenario}:${normalizeQaDocId(key)}`;
}

export function parseScenarioKey(prefix: string, storageKey: string): { scenario: string; name: string } | null {
  if (!storageKey.startsWith(`${prefix}:`)) return null;
  const remainder = storageKey.slice(prefix.length + 1);
  const separatorIndex = remainder.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= remainder.length - 1) return null;
  const scenario = remainder.slice(0, separatorIndex);
  return {
    scenario,
    name: remainder.slice(separatorIndex + 1),
  };
}

function forEachScenarioStorageKey(prefix: string, scenario: string, onEntry: (storageKey: string, name: string) => void): void {
  if (typeof window === 'undefined') return;
  const scenarioPrefix = `${prefix}:${scenario}:`;
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey || !storageKey.startsWith(scenarioPrefix)) continue;
    const parsed = parseScenarioKey(prefix, storageKey);
    if (!parsed) continue;
    onEntry(storageKey, parsed.name);
  }
}

function loadScenarioDocsFromStorage(scenario: string): Map<string, QaDoc> {
  const docs = new Map<string, QaDoc>();
  if (typeof window === 'undefined') return docs;
  forEachScenarioStorageKey(QA_DOC_STORAGE_PREFIX, scenario, (storageKey, docId) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      docs.set(docId, JSON.parse(raw) as QaDoc);
    } catch {
      /* ignore malformed QA storage */
    }
  });
  return docs;
}

function loadScenarioLocalCacheFromStorage(scenario: string): Map<string, unknown> {
  const cache = new Map<string, unknown>();
  if (typeof window === 'undefined') return cache;
  forEachScenarioStorageKey(QA_CACHE_STORAGE_PREFIX, scenario, (storageKey, cacheKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      cache.set(cacheKey, JSON.parse(raw));
    } catch {
      /* ignore malformed QA storage */
    }
  });
  return cache;
}

function writeScenarioDocToStorage(scenario: string, docId: string, data: QaDoc | null): void {
  if (typeof window === 'undefined') return;
  const storageKey = qaDocStorageKey(scenario, docId);
  if (data == null) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(data));
}

function writeScenarioCacheToStorage(scenario: string, key: string, value: unknown | null): void {
  if (typeof window === 'undefined') return;
  const storageKey = qaCacheStorageKey(scenario, key);
  if (value == null) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

function clearScenarioStorage(scenario: string): void {
  if (typeof window === 'undefined') return;
  const keysToDelete: string[] = [];
  forEachScenarioStorageKey(QA_DOC_STORAGE_PREFIX, scenario, (storageKey) => {
    keysToDelete.push(storageKey);
  });
  forEachScenarioStorageKey(QA_CACHE_STORAGE_PREFIX, scenario, (storageKey) => {
    keysToDelete.push(storageKey);
  });
  window.localStorage.removeItem(getQaScenarioInitKey(scenario));
  keysToDelete.forEach((storageKey) => window.localStorage.removeItem(storageKey));
}

function getRowMetadata(row: QaRow): Record<string, string> {
  const metadata = row.metadata;
  return metadata && typeof metadata === 'object' ? metadata as Record<string, string> : {};
}

function makeSnapshot(data: QaDoc | null): QaSnapshot {
  return {
    exists: () => Boolean(data),
    data: () => clone(data ?? {}),
    metadata: { fromCache: false },
  };
}

function ensureState(): QaState {
  if (!qaState) {
    const scenario = getContentPipelineQaScenario();
    qaState = mergeScenarioStorage(createScenarioState(scenario), scenario);
  }
  return qaState;
}

function isoAt(minuteOffset: number): string {
  return new Date(Date.UTC(2026, 2, 28, 12, minuteOffset, 0)).toISOString();
}

function fillTemplate(template: string, replacements: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return next;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAnswerWrapper(raw: string): string {
  const cleaned = raw.trim();
  const match = cleaned.match(/^<answer>\s*([\s\S]*?)\s*<\/answer>$/i);
  return match ? match[1].trim() : cleaned;
}

function stripHtmlValidationFeedback(raw: string): string {
  const idx = raw.indexOf('\n### HTML VALIDATION FEEDBACK');
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

function matchQaMarker(promptText: string, prefix: string, pattern = ''): RegExpMatchArray | null {
  return promptText.match(new RegExp(`${escapeRegex(prefix)}${pattern}`, 's'));
}

function findH2Seed(h2Name: string): QaH2Seed | undefined {
  return FULL_FLOW_H2S.find((item) => item.h2Name === h2Name.trim());
}

function makeSettings(prompt: string, slotPrompts?: Record<string, string>) {
  return {
    selectedModel: 'openrouter/qa-model',
    rateLimit: 2,
    minLen: 0,
    maxLen: 0,
    maxRetries: 1,
    temperature: 0.2,
    maxTokens: 600,
    reasoning: 'medium',
    webSearch: false,
    prompt,
    ...(slotPrompts ? { slotPrompts } : {}),
    updatedAt: isoAt(0),
  };
}

function makeViewState(tableView = 'primary') {
  return {
    genSubTab: 'table',
    statusFilter: 'all',
    tableView,
    updatedAt: isoAt(0),
  };
}

function makeSlotData({
  status = 'generated',
  input = '',
  output = '',
  generatedAt = isoAt(0),
  cost = 0,
}: {
  status?: 'pending' | 'generating' | 'generated' | 'error';
  input?: string;
  output?: string;
  generatedAt?: string;
  cost?: number;
}) {
  return {
    status,
    input,
    output,
    generatedAt,
    cost,
  };
}

function buildOrderedH2List(): string {
  return FULL_FLOW_H2S.map((item) => `${item.order}. ${item.h2Name}`).join('\n');
}

function buildGuidelinesOutput(): string {
  return formatCanonicalPageGuidelinesJson(
    FULL_FLOW_H2S.map((item) => ({
      h2: item.h2Name,
      guidelines: item.guidelines,
      formatting: item.formatting,
    })),
  );
}

function buildH2NamesOutput(): string {
  return formatCanonicalH2NamesJson(
    FULL_FLOW_H2S.map((item) => ({
      order: item.order,
      h2Name: item.h2Name,
    })),
  );
}

function contentGuidelinesFor(item: QaH2Seed): string {
  return `${item.guidelines}\n\nFormatting: ${item.formatting}`;
}

function buildPageNameRows(): QaRow[] {
  return [
    {
      id: PAGE_ROW_ID,
      status: 'generated',
      input: PAGE_KEYWORD,
      output: PAGE_TITLE,
      generatedAt: isoAt(1),
      cost: 0.0005,
      metadata: {
        h2JsonStatus: 'Pass',
        pageGuideJsonStatus: 'Pass',
        h2QaRating: '4',
      },
      slots: {
        h2names: makeSlotData({
          input: fillTemplate(QA_PROMPTS.pageNames, { KEYWORD: PAGE_KEYWORD }),
          output: buildH2NamesOutput(),
          generatedAt: isoAt(2),
          cost: 0.0002,
        }),
        h2qa: makeSlotData({
          input: 'H2_QA::Can You Get Installment Loans?',
          output: JSON.stringify({ rating: 4, flaggedH2s: [] }, null, 2),
          generatedAt: isoAt(3),
          cost: 0.0001,
        }),
        guidelines: makeSlotData({
          input: 'PAGE_GUIDE::Can You Get Installment Loans?',
          output: buildGuidelinesOutput(),
          generatedAt: isoAt(4),
          cost: 0.0002,
        }),
      },
    },
  ];
}

function resetRowToPending(row: QaRow): QaRow {
  return {
    ...row,
    status: 'pending',
    output: '',
    error: undefined,
    generatedAt: undefined,
    durationMs: undefined,
    retries: 0,
    promptTokens: undefined,
    completionTokens: undefined,
    cost: undefined,
  };
}

function buildH2ContentRows(h2s: QaH2Seed[] = FULL_FLOW_H2S): QaRow[] {
  const allH2s = buildOrderedH2List();
  return h2s.map((item) => {
    const id = deriveH2RowId(PAGE_ROW_ID, item.order, item.h2Name);
    const h2Content = `<answer>${item.content}</answer>`;
    return {
      id,
      status: 'generated',
      input: fillTemplate(QA_PROMPTS.h2Content, {
        PAGE_NAME: PAGE_TITLE,
        H2_NAME: item.h2Name,
        ALL_H2S: allH2s,
        CONTENT_GUIDELINES: contentGuidelinesFor(item),
        FACTUAL_CORRECTIONS: '',
      }),
      output: h2Content,
      generatedAt: isoAt(10 + item.order),
      cost: 0.0006 + item.order * 0.0001,
      metadata: {
        pageName: PAGE_TITLE,
        order: String(item.order),
        h2Name: item.h2Name,
        contentGuidelines: contentGuidelinesFor(item),
        sourceRowId: PAGE_ROW_ID,
      },
    };
  });
}

function buildRatingOutput(score: string): string {
  return [
    'Major Errors: 0',
    `Minor Errors: ${score === '2' ? 1 : 0}`,
    'Summary: QA harness rating summary.',
    'Corrections: None needed.',
    'Factually Incorrect Info: None',
  ].join('\n');
}

function buildRatingRows(h2Rows: QaRow[], scores?: Record<string, string>): QaRow[] {
  return h2Rows.map((row) => {
    const metadata = getRowMetadata(row);
    const h2ContentRowId = row.id as string;
    const score = scores?.[h2ContentRowId] ?? FULL_FLOW_H2S.find((item) => item.h2Name === metadata.h2Name)?.ratingScore ?? '2';
    const h2Content = stripAnswerWrapper(String(row.output ?? ''));
    const h2Name = metadata.h2Name ?? '';
    return {
      id: `rating_${h2ContentRowId}`,
      status: 'generated',
      input: fillTemplate(QA_PROMPTS.rating, {
        FACT_CHECK_TARGET: PAGE_TITLE,
        H2_NAME: h2Name,
        H2_CONTENT: h2Content,
        PAGE_NAME: PAGE_TITLE,
      }),
      output: buildRatingOutput(score),
      generatedAt: isoAt(20 + Number(metadata.order ?? '0')),
      cost: 0.0004,
      metadata: {
        factCheckTarget: PAGE_TITLE,
        pageName: PAGE_TITLE,
        order: String(metadata.order ?? ''),
        h2Name,
        h2Content,
        sourceRowId: PAGE_ROW_ID,
        h2ContentRowId,
        ratingScore: score,
      },
    };
  });
}

function buildH2HtmlRows(h2Rows: QaRow[], ratingRows: QaRow[]): QaRow[] {
  const scoreById = new Map<string, string>();
  for (const row of ratingRows) {
    const metadata = getRowMetadata(row);
    const h2ContentRowId = String(metadata.h2ContentRowId ?? '');
    const score = String(metadata.ratingScore ?? '');
    if (h2ContentRowId && score) scoreById.set(h2ContentRowId, score);
  }

  return h2Rows.map((row) => {
    const metadata = getRowMetadata(row);
    const h2ContentRowId = row.id as string;
    const h2Name = String(metadata.h2Name ?? '');
    const h2Content = stripAnswerWrapper(String(row.output ?? ''));
    return {
      id: `html_${h2ContentRowId}`,
      status: 'generated',
      input: fillTemplate(QA_PROMPTS.h2Html, {
        PAGE_NAME: PAGE_TITLE,
        H2_NAME: h2Name,
        H2_CONTENT: h2Content,
      }),
      output: `<h2>${h2Name}</h2><p>${h2Content}</p>`,
      generatedAt: isoAt(30 + Number(metadata.order ?? '0')),
      cost: 0.0005,
      metadata: {
        pageName: PAGE_TITLE,
        h2Name,
        h2Content,
        ratingScore: scoreById.get(h2ContentRowId) ?? '',
        sourceRowId: PAGE_ROW_ID,
        h2ContentRowId,
        validationStatus: 'Pass',
      },
    };
  });
}

function buildSummaryRows(h2Rows: QaRow[]): QaRow[] {
  return h2Rows.map((row) => {
    const metadata = getRowMetadata(row);
    const h2ContentRowId = row.id as string;
    const order = Number(metadata.order ?? '0');
    const seed = FULL_FLOW_H2S.find((item) => item.order === order);
    const h2Content = stripAnswerWrapper(String(row.output ?? ''));
    return {
      id: `summary_${h2ContentRowId}`,
      status: 'generated',
      input: fillTemplate(QA_PROMPTS.h2Summary, {
        PAGE_NAME: PAGE_TITLE,
        H2_NAME: String(metadata.h2Name ?? ''),
        H2_CONTENT: h2Content,
      }),
      output: `<answer>${seed?.summary ?? h2Content}</answer>`,
      generatedAt: isoAt(40 + order),
      cost: 0.0003,
      metadata: {
        pageName: PAGE_TITLE,
        order: String(metadata.order ?? ''),
        h2Name: String(metadata.h2Name ?? ''),
        h2Content,
        sourceRowId: PAGE_ROW_ID,
        h2ContentRowId,
      },
    };
  });
}

function buildH1BodyRow(summaryRows: QaRow[]): QaRow {
  const orderedSummaryRows = [...summaryRows].sort(
    (a, b) => Number(getRowMetadata(a).order ?? '0') - Number(getRowMetadata(b).order ?? '0'),
  );
  const h2Names = FULL_FLOW_H2S.map((item) => item.h2Name).join('\n');
  const h2Content = orderedSummaryRows
    .map((row) => {
      const metadata = getRowMetadata(row);
      return `${String(metadata.h2Name ?? '')}: ${String(metadata.h2Content ?? '')}`;
    })
    .join('\n\n');
  const h2Summaries = orderedSummaryRows
    .map((row) => {
      const metadata = getRowMetadata(row);
      return `${String(metadata.h2Name ?? '')}: ${stripAnswerWrapper(String(row.output ?? ''))}`;
    })
    .join('\n\n');
  const pageGuideContext = `${buildGuidelinesOutput()}\n\nH2 Summaries:\n${h2Summaries}`;
  const h1Body = '<answer>Installment loans can be useful when the repayment schedule is clear, affordable, and compared carefully against alternatives.</answer>';

  return {
    id: `h1_${PAGE_ROW_ID}`,
    status: 'generated',
    input: fillTemplate(QA_PROMPTS.h1Body, {
      MAIN_KEYWORD: PAGE_KEYWORD,
      PAGE_NAME: PAGE_TITLE,
      H2_NAMES: h2Names,
      H2_CONTENT: h2Content,
      H2_SUMMARIES: h2Summaries,
      CONTEXT: pageGuideContext,
    }),
    output: h1Body,
    generatedAt: isoAt(60),
    cost: 0.0009,
    metadata: {
      pageName: PAGE_TITLE,
      h2Name: h2Names,
      h2Content,
      h2Summaries,
      context: pageGuideContext,
      mainKeyword: PAGE_KEYWORD,
      sourceRowId: PAGE_ROW_ID,
    },
  };
}

function buildH1HtmlRow(h1BodyRow: QaRow): QaRow {
  const metadata = getRowMetadata(h1BodyRow);
  const h1Body = stripAnswerWrapper(String(h1BodyRow.output ?? ''));
  return {
    id: `html_${String(h1BodyRow.id)}`,
    status: 'generated',
    input: fillTemplate(QA_PROMPTS.h1Html, {
      PAGE_NAME: PAGE_TITLE,
      H1_BODY: h1Body,
    }),
    output: `<h1>${PAGE_TITLE}</h1><p>${h1Body}</p>`,
    generatedAt: isoAt(61),
    cost: 0.0006,
    metadata: {
      pageName: PAGE_TITLE,
      h2Name: String(metadata.h2Name ?? ''),
      h2Content: String(metadata.h2Content ?? ''),
      h2Summaries: String(metadata.h2Summaries ?? ''),
      h1Body,
      h1BodyRowId: String(h1BodyRow.id),
      sourceRowId: PAGE_ROW_ID,
      validationStatus: 'Pass',
    },
  };
}

function buildQuickAnswerRow(h1BodyRow: QaRow): QaRow {
  const metadata = getRowMetadata(h1BodyRow);
  const h1Body = stripAnswerWrapper(String(h1BodyRow.output ?? ''));
  return {
    id: `quick_${String(h1BodyRow.id)}`,
    status: 'generated',
    input: fillTemplate(QA_PROMPTS.quickAnswer, {
      PAGE_NAME: PAGE_TITLE,
      H1_BODY: h1Body,
    }),
    output: 'Installment loans provide a lump sum that is repaid in fixed scheduled payments.',
    generatedAt: isoAt(62),
    cost: 0.0004,
    metadata: {
      pageName: PAGE_TITLE,
      h2Name: String(metadata.h2Name ?? ''),
      h2Content: String(metadata.h2Content ?? ''),
      h2Summaries: String(metadata.h2Summaries ?? ''),
      h1Body,
      h1BodyRowId: String(h1BodyRow.id),
      sourceRowId: PAGE_ROW_ID,
    },
  };
}

function buildQuickAnswerHtmlRow(quickAnswerRow: QaRow): QaRow {
  const metadata = getRowMetadata(quickAnswerRow);
  const quickAnswer = String(quickAnswerRow.output ?? '').trim();
  return {
    id: `html_${String(quickAnswerRow.id)}`,
    status: 'generated',
    input: fillTemplate(QA_PROMPTS.quickAnswerHtml, {
      PAGE_NAME: PAGE_TITLE,
      QUICK_ANSWER: quickAnswer,
    }),
    output: `<p>${quickAnswer}</p>`,
    generatedAt: isoAt(63),
    cost: 0.0004,
    metadata: {
      pageName: PAGE_TITLE,
      h2Name: String(metadata.h2Name ?? ''),
      h2Content: String(metadata.h2Content ?? ''),
      h2Summaries: String(metadata.h2Summaries ?? ''),
      h1Body: String(metadata.h1Body ?? ''),
      quickAnswer,
      quickAnswerRowId: String(quickAnswerRow.id),
      sourceRowId: PAGE_ROW_ID,
      validationStatus: 'Pass',
    },
  };
}

function buildMetasRow(quickAnswerHtmlRow: QaRow): QaRow {
  const metadata = getRowMetadata(quickAnswerHtmlRow);
  const quickAnswer = String(metadata.quickAnswer ?? '');
  const quickAnswerHtml = String(quickAnswerHtmlRow.output ?? '').trim();
  return {
    id: `meta_${String(quickAnswerHtmlRow.id)}`,
    status: 'generated',
    input: fillTemplate(QA_PROMPTS.metaDescription, {
      PAGE_NAME: PAGE_TITLE,
    }),
    output: 'Compare installment loan costs, repayment schedules, and lender terms before you apply.',
    generatedAt: isoAt(64),
    cost: 0.0005,
    metadata: {
      pageName: PAGE_TITLE,
      h2Name: String(metadata.h2Name ?? ''),
      h2Content: String(metadata.h2Content ?? ''),
      h2Summaries: String(metadata.h2Summaries ?? ''),
      h1Body: String(metadata.h1Body ?? ''),
      quickAnswer,
      quickAnswerHtml,
      metaTitle: PAGE_TITLE,
      quickAnswerHtmlRowId: String(quickAnswerHtmlRow.id),
      sourceRowId: PAGE_ROW_ID,
      slug: 'can-you-get-installment-loans',
      ctaHeadline: 'Talk Through Your Options',
      ctaBody: 'Review total cost and repayment timing before you move forward.',
    },
    slots: {
      slug: makeSlotData({
        input: fillTemplate(QA_PROMPTS.slug, {
          PAGE_NAME: PAGE_TITLE,
          REFERENCE_CONTEXT: quickAnswerHtml,
        }),
        output: 'can-you-get-installment-loans',
        generatedAt: isoAt(65),
        cost: 0.0001,
      }),
      cta: makeSlotData({
        input: fillTemplate(QA_PROMPTS.cta, {
          PAGE_NAME: PAGE_TITLE,
        }),
        output: JSON.stringify(
          {
            headline: 'Talk Through Your Options',
            body: 'Review total cost and repayment timing before you move forward.',
          },
          null,
          2,
        ),
        generatedAt: isoAt(66),
        cost: 0.0002,
      }),
    },
  };
}

function buildTipsRow(metasRow: QaRow): QaRow {
  const metadata = getRowMetadata(metasRow);
  const articleContext = String(metadata.h2Summaries ?? '');
  return {
    id: `tip_${String(metasRow.id)}`,
    status: 'generated',
    input: fillTemplate(QA_PROMPTS.proTip, {
      PAGE_NAME: PAGE_TITLE,
      ARTICLE_CONTEXT: articleContext,
    }),
    output: 'Pro Tip: Compare the total repayment amount, not just the payment size.',
    generatedAt: isoAt(67),
    cost: 0.0003,
    metadata: {
      pageName: PAGE_TITLE,
      h2Name: String(metadata.h2Name ?? ''),
      h2Content: String(metadata.h2Content ?? ''),
      h2Summaries: articleContext,
      metaTitle: String(metadata.metaTitle ?? ''),
      slug: String(metadata.slug ?? ''),
      ctaHeadline: String(metadata.ctaHeadline ?? ''),
      ctaBody: String(metadata.ctaBody ?? ''),
      sourceRowId: PAGE_ROW_ID,
      metasRowId: String(metasRow.id),
    },
    slots: {
      redflag: makeSlotData({
        input: fillTemplate(QA_PROMPTS.redFlag, {
          PAGE_NAME: PAGE_TITLE,
          ARTICLE_CONTEXT: articleContext,
        }),
        output: 'Red Flag: Any lender that obscures the full cost before you apply.',
        generatedAt: isoAt(68),
        cost: 0.0001,
      }),
      keytakeaways: makeSlotData({
        input: fillTemplate(QA_PROMPTS.keyTakeaways, {
          PAGE_NAME: PAGE_TITLE,
          ARTICLE_CONTEXT: articleContext,
        }),
        output: 'Key Takeaways: Verify affordability, compare full cost, and confirm lender terms.',
        generatedAt: isoAt(69),
        cost: 0.0001,
      }),
    },
  };
}

function createSharedLogs(summary = 'Seeded content pipeline QA scenarios.') {
  return {
    logs: [
      {
        id: 'log_seed_1',
        timestamp: '2026-03-28T12:05:00.000Z',
        action: 'seed',
        details: summary,
        model: 'openrouter/qa-model',
        outputCount: 0,
        errorCount: 0,
      },
    ],
    updatedAt: '2026-03-28T12:05:00.000Z',
  };
}

function getBaseDocs(): Record<string, QaDoc> {
  const pageRows = buildPageNameRows();
  const h2Rows = buildH2ContentRows();
  const ratingRows = buildRatingRows(h2Rows);
  const h2HtmlRows = buildH2HtmlRows(h2Rows, ratingRows);
  const summaryRows = buildSummaryRows(h2Rows);
  const h1BodyRows = [buildH1BodyRow(summaryRows)];
  const h1HtmlRows = [buildH1HtmlRow(h1BodyRows[0])];
  const quickAnswerRows = [buildQuickAnswerRow(h1BodyRows[0])];
  const quickAnswerHtmlRows = [buildQuickAnswerHtmlRow(quickAnswerRows[0])];
  const metasRows = [buildMetasRow(quickAnswerHtmlRows[0])];
  const tipsRows = [buildTipsRow(metasRows[0])];

  return {
    generate_rows_page_names: { rows: pageRows, updatedAt: isoAt(4) },
    generate_rows_h2_content: { rows: h2Rows, updatedAt: isoAt(15) },
    generate_rows_h2_rating: { rows: ratingRows, updatedAt: isoAt(25) },
    generate_rows_h2_html: { rows: h2HtmlRows, updatedAt: isoAt(35) },
    generate_rows_h2_summary: { rows: summaryRows, updatedAt: isoAt(45) },
    generate_rows_h1_body: { rows: h1BodyRows, updatedAt: isoAt(60) },
    generate_rows_h1_html: { rows: h1HtmlRows, updatedAt: isoAt(61) },
    generate_rows_quick_answer: { rows: quickAnswerRows, updatedAt: isoAt(62) },
    generate_rows_quick_answer_html: { rows: quickAnswerHtmlRows, updatedAt: isoAt(63) },
    generate_rows_metas_slug_ctas: { rows: metasRows, updatedAt: isoAt(66) },
    generate_rows_tips_redflags: { rows: tipsRows, updatedAt: isoAt(69) },
    generate_logs_page_names: createSharedLogs(),
    generate_settings_page_names: makeSettings(QA_PROMPTS.pageNames),
    generate_settings_h2_content: makeSettings(QA_PROMPTS.h2Content),
    generate_settings_h2_rating: makeSettings(QA_PROMPTS.rating),
    generate_settings_h2_html: makeSettings(QA_PROMPTS.h2Html),
    generate_settings_h2_summary: makeSettings(QA_PROMPTS.h2Summary),
    generate_settings_h1_body: makeSettings(QA_PROMPTS.h1Body),
    generate_settings_h1_html: makeSettings(QA_PROMPTS.h1Html),
    generate_settings_quick_answer: makeSettings(QA_PROMPTS.quickAnswer),
    generate_settings_quick_answer_html: makeSettings(QA_PROMPTS.quickAnswerHtml),
    generate_settings_metas_slug_ctas: makeSettings(QA_PROMPTS.metaDescription, {
      slug: QA_PROMPTS.slug,
      cta: QA_PROMPTS.cta,
    }),
    generate_settings_tips_redflags: makeSettings(QA_PROMPTS.proTip, {
      redflag: QA_PROMPTS.redFlag,
      keytakeaways: QA_PROMPTS.keyTakeaways,
    }),
    generate_view_state_page_names: makeViewState('primary'),
    generate_view_state_h2_content: makeViewState('primary'),
    generate_view_state_h2_rating: makeViewState('primary'),
    generate_view_state_h2_html: makeViewState('primary'),
    generate_view_state_h2_summary: makeViewState('primary'),
    generate_view_state_h1_body: makeViewState('primary'),
    generate_view_state_h1_html: makeViewState('primary'),
    generate_view_state_quick_answer: makeViewState('primary'),
    generate_view_state_quick_answer_html: makeViewState('primary'),
    generate_view_state_metas_slug_ctas: makeViewState('primary'),
    generate_view_state_tips_redflags: makeViewState('primary'),
  };
}

function createScenarioState(name: string): QaState {
  const docs: Record<string, QaDoc> = getBaseDocs();
  const baseH2Rows = docs.generate_rows_h2_content.rows as QaRow[];

  const rowIdByOrder = new Map<number, string>(
    baseH2Rows.map((row) => [Number(getRowMetadata(row).order ?? '0'), String(row.id)]),
  );

  switch (name) {
    case 'rating-rewrite': {
      docs.generate_rows_h2_content = {
        rows: baseH2Rows.slice(0, 3),
        updatedAt: isoAt(15),
      };
      docs.generate_rows_h2_rating = {
        rows: buildRatingRows(baseH2Rows.slice(0, 3), {
          [rowIdByOrder.get(1) ?? '']: '2',
          [rowIdByOrder.get(2) ?? '']: '3',
          [rowIdByOrder.get(3) ?? '']: '4',
        }),
        updatedAt: isoAt(25),
      };
      docs.generate_rows_h2_html = { rows: [], updatedAt: isoAt(35) };
      docs.generate_rows_h2_summary = { rows: [], updatedAt: isoAt(45) };
      docs.generate_rows_h1_body = { rows: [], updatedAt: isoAt(60) };
      docs.generate_rows_h1_html = { rows: [], updatedAt: isoAt(61) };
      docs.generate_rows_quick_answer = { rows: [], updatedAt: isoAt(62) };
      docs.generate_rows_quick_answer_html = { rows: [], updatedAt: isoAt(63) };
      docs.generate_rows_metas_slug_ctas = { rows: [], updatedAt: isoAt(66) };
      docs.generate_rows_tips_redflags = { rows: [], updatedAt: isoAt(69) };
      break;
    }
    case 'html-locking': {
      docs.generate_rows_h2_rating = {
        rows: buildRatingRows(baseH2Rows.slice(0, 4), {
          [rowIdByOrder.get(1) ?? '']: '1',
          [rowIdByOrder.get(2) ?? '']: '2',
          [rowIdByOrder.get(3) ?? '']: '5',
          [rowIdByOrder.get(4) ?? '']: '3',
        }),
        updatedAt: isoAt(25),
      };
      docs.generate_rows_h2_html = { rows: [], updatedAt: isoAt(35) };
      docs.generate_rows_h2_summary = { rows: [], updatedAt: isoAt(45) };
      docs.generate_rows_h1_body = { rows: [], updatedAt: isoAt(60) };
      docs.generate_rows_h1_html = { rows: [], updatedAt: isoAt(61) };
      docs.generate_rows_quick_answer = { rows: [], updatedAt: isoAt(62) };
      docs.generate_rows_quick_answer_html = { rows: [], updatedAt: isoAt(63) };
      docs.generate_rows_metas_slug_ctas = { rows: [], updatedAt: isoAt(66) };
      docs.generate_rows_tips_redflags = { rows: [], updatedAt: isoAt(69) };
      break;
    }
    case 'html-validation': {
      const subsetH2Rows = baseH2Rows.slice(0, 2);
      docs.generate_rows_h2_content = {
        rows: subsetH2Rows,
        updatedAt: isoAt(15),
      };
      docs.generate_rows_h2_rating = {
        rows: buildRatingRows(subsetH2Rows, {
          [rowIdByOrder.get(1) ?? '']: '1',
          [rowIdByOrder.get(2) ?? '']: '2',
        }),
        updatedAt: isoAt(25),
      };
      docs.generate_rows_h2_html = {
        rows: [
          (() => {
            const metadata = getRowMetadata(subsetH2Rows[0]);
            return {
              id: `html_${String(subsetH2Rows[0].id)}`,
              status: 'generated',
              input: fillTemplate(QA_PROMPTS.h2Html, {
                PAGE_NAME: PAGE_TITLE,
                H2_NAME: String(metadata.h2Name ?? ''),
                H2_CONTENT: stripAnswerWrapper(String(subsetH2Rows[0].output ?? '')),
              }),
              output: `<h2>${String(metadata.h2Name ?? '')}</h2><p>${stripAnswerWrapper(String(subsetH2Rows[0].output ?? ''))}</p>`,
              generatedAt: isoAt(31),
              metadata: {
                pageName: PAGE_TITLE,
                h2Name: String(metadata.h2Name ?? ''),
                h2Content: stripAnswerWrapper(String(subsetH2Rows[0].output ?? '')),
                ratingScore: '1',
                sourceRowId: PAGE_ROW_ID,
                h2ContentRowId: String(subsetH2Rows[0].id),
                validationStatus: 'Pass',
              },
            };
          })(),
          {
            ...(() => {
              const metadata = getRowMetadata(subsetH2Rows[1]);
              return {
              id: `html_${String(subsetH2Rows[1].id)}`,
              status: 'error',
              input: `${fillTemplate(QA_PROMPTS.h2Html, {
                PAGE_NAME: PAGE_TITLE,
                H2_NAME: String(metadata.h2Name ?? ''),
                H2_CONTENT: stripAnswerWrapper(String(subsetH2Rows[1].output ?? '')),
              })}\n\n### HTML VALIDATION FEEDBACK\n- Previous validator result: Forbidden <h4> tag.\n- If a validator error is listed above, fix that exact issue before returning HTML.\n- Never repeat a failed anchor, tag, markdown, or wrapper-quote pattern.\n- If a previous anchor failed validation, either preserve its real source URL in href or remove the anchor wrapper entirely.`,
              output: '<h4>bad html</h4> **leftover**',
              error: 'Forbidden <h4> tag.',
              generatedAt: isoAt(32),
              metadata: {
                pageName: PAGE_TITLE,
                h2Name: String(metadata.h2Name ?? ''),
                h2Content: stripAnswerWrapper(String(subsetH2Rows[1].output ?? '')),
                ratingScore: '2',
                sourceRowId: PAGE_ROW_ID,
                h2ContentRowId: String(subsetH2Rows[1].id),
                validationStatus: 'Fail',
              },
            };
            })(),
          },
        ],
        updatedAt: isoAt(35),
      };
      docs.generate_rows_h2_summary = { rows: [], updatedAt: isoAt(45) };
      docs.generate_rows_h1_body = { rows: [], updatedAt: isoAt(60) };
      docs.generate_rows_h1_html = { rows: [], updatedAt: isoAt(61) };
      docs.generate_rows_quick_answer = { rows: [], updatedAt: isoAt(62) };
      docs.generate_rows_quick_answer_html = { rows: [], updatedAt: isoAt(63) };
      docs.generate_rows_metas_slug_ctas = { rows: [], updatedAt: isoAt(66) };
      docs.generate_rows_tips_redflags = { rows: [], updatedAt: isoAt(69) };
      break;
    }
    case 'shared-state': {
      docs.generate_rows_h2_content = { rows: baseH2Rows, updatedAt: isoAt(15) };
      docs.generate_rows_h2_rating = {
        rows: buildRatingRows(baseH2Rows).map((row) => resetRowToPending(row)),
        updatedAt: isoAt(25),
      };
      docs.generate_rows_h2_html = { rows: [], updatedAt: isoAt(35) };
      docs.generate_rows_h2_summary = { rows: [], updatedAt: isoAt(45) };
      docs.generate_rows_h1_body = { rows: [], updatedAt: isoAt(60) };
      docs.generate_rows_h1_html = { rows: [], updatedAt: isoAt(61) };
      docs.generate_rows_quick_answer = { rows: [], updatedAt: isoAt(62) };
      docs.generate_rows_quick_answer_html = { rows: [], updatedAt: isoAt(63) };
      docs.generate_rows_metas_slug_ctas = { rows: [], updatedAt: isoAt(66) };
      docs.generate_rows_tips_redflags = { rows: [], updatedAt: isoAt(69) };
      break;
    }
    case 'full-flow-actions': {
      docs.generate_rows_h2_content = {
        rows: [resetRowToPending(baseH2Rows[0])],
        updatedAt: isoAt(15),
      };
      docs.generate_rows_h2_rating = { rows: [], updatedAt: isoAt(25) };
      docs.generate_rows_h2_html = { rows: [], updatedAt: isoAt(35) };
      docs.generate_rows_h2_summary = { rows: [], updatedAt: isoAt(45) };
      docs.generate_rows_h1_body = { rows: [], updatedAt: isoAt(60) };
      docs.generate_rows_h1_html = { rows: [], updatedAt: isoAt(61) };
      docs.generate_rows_quick_answer = { rows: [], updatedAt: isoAt(62) };
      docs.generate_rows_quick_answer_html = { rows: [], updatedAt: isoAt(63) };
      docs.generate_rows_metas_slug_ctas = { rows: [], updatedAt: isoAt(66) };
      docs.generate_rows_tips_redflags = { rows: [], updatedAt: isoAt(69) };
      break;
    }
    case 'missing-upstream': {
      docs.generate_rows_quick_answer = { rows: [], updatedAt: isoAt(62) };
      docs.generate_rows_quick_answer_html = { rows: [], updatedAt: isoAt(63) };
      docs.generate_rows_metas_slug_ctas = { rows: [], updatedAt: isoAt(66) };
      docs.generate_rows_tips_redflags = { rows: [], updatedAt: isoAt(69) };
      break;
    }
    case 'build-chip':
    case 'full-flow':
    case 'default':
    default:
      break;
  }

  const initialEntries: ChangelogEntry[] = [
    {
      id: 'qa_change_1',
      buildName: name === 'build-chip' ? 'Content Pipeline QA Build' : 'QA Harness Build',
      timestamp: '2026-03-28T12:05:00.000Z',
      summary: 'Seeded content pipeline QA scenarios.',
      changes: [
        'Seeded deterministic page, H2, H1, quick answer, meta, and final-page source state',
        'Mocked OpenRouter, credits, and weather requests in QA mode',
      ],
    },
  ];

  return {
    appSettingsDocs: new Map(Object.entries(docs).map(([key, value]) => [key, clone(value)])),
    appSettingsListeners: new Map(),
    localCache: new Map(),
    changelogEntries: initialEntries,
    changelogListeners: new Set(),
    buildName: name === 'build-chip' ? 'Content Pipeline QA Build' : 'QA Harness Build',
    buildNameListeners: new Set(),
  };
}

function mergeScenarioStorage(state: QaState, scenario: string): QaState {
  loadScenarioDocsFromStorage(scenario).forEach((value, key) => {
    state.appSettingsDocs.set(key, clone(value));
  });
  loadScenarioLocalCacheFromStorage(scenario).forEach((value, key) => {
    state.localCache.set(key, clone(value));
  });
  return state;
}

function notifyAppSettingsDoc(docId: string) {
  const state = ensureState();
  const listeners = state.appSettingsListeners.get(docId);
  if (!listeners?.size) return;
  const payload = state.appSettingsDocs.get(docId) ?? null;
  const snap = makeSnapshot(payload);
  listeners.forEach((listener) => listener(snap));
}

function notifyChangelog() {
  const state = ensureState();
  const entries = clone(state.changelogEntries);
  state.changelogListeners.forEach((listener) => listener(entries));
}

function notifyBuildName() {
  const state = ensureState();
  state.buildNameListeners.forEach((listener) => listener(state.buildName));
}

function completionTextFromRequest(body: Record<string, unknown>, ctx: QaFetchContext): string {
  const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
  const systemText = messages
    .filter((msg) => msg.role === 'system' && typeof msg.content === 'string')
    .map((msg) => msg.content as string)
    .join('\n');
  const userText = messages
    .filter((msg) => msg.role === 'user' && typeof msg.content === 'string')
    .map((msg) => msg.content as string)
    .join('\n');
  const promptText = [systemText, userText].filter(Boolean).join('\n');
  const filledPromptText = userText || promptText;

  const h2HtmlMatch = matchQaMarker(filledPromptText, 'H2_HTML::', '(.+?)::(.+?)::([\\s\\S]*?)(?:\\n### HTML VALIDATION FEEDBACK|$)');
  if (h2HtmlMatch) {
    const [, , rawH2Name, rawH2Content] = h2HtmlMatch;
    const h2Name = rawH2Name.trim();
    if (ctx.scenario === 'html-validation' && h2Name === 'When Do Installment Loans Make Sense?') {
      return '<h4>bad html</h4> **leftover**';
    }
    const seed = findH2Seed(h2Name);
    const h2Content = stripAnswerWrapper(stripHtmlValidationFeedback(rawH2Content))
      || seed?.content
      || 'QA HTML output.';
    return `<h2>${h2Name}</h2><p>${h2Content}</p>`;
  }

  const h1HtmlMatch = matchQaMarker(filledPromptText, 'H1_HTML::', '(.+?)::([\\s\\S]*?)(?:\\n### HTML VALIDATION FEEDBACK|$)');
  if (h1HtmlMatch) {
    const [, rawPageName, rawBody] = h1HtmlMatch;
    const pageName = rawPageName.trim() || PAGE_TITLE;
    const h1Body = stripAnswerWrapper(stripHtmlValidationFeedback(rawBody))
      || 'QA H1 introduction.';
    return pageName ? `<p>${h1Body}</p>` : '<p>QA H1 introduction.</p>';
  }

  const quickAnswerHtmlMatch = matchQaMarker(filledPromptText, 'QUICK_ANSWER_HTML::', '(.+?)::([\\s\\S]*?)(?:\\n### HTML VALIDATION FEEDBACK|$)');
  if (quickAnswerHtmlMatch) {
    const [, , rawQuickAnswer] = quickAnswerHtmlMatch;
    const quickAnswer = stripHtmlValidationFeedback(rawQuickAnswer)
      || 'Installment loans provide a lump sum that you repay in scheduled installments.';
    return `<p>${quickAnswer}</p>`;
  }

  const h2BodyMatch = matchQaMarker(filledPromptText, 'H2_BODY::', '(.+?)::(.+?)::');
  if (h2BodyMatch) {
    const [, , rawH2Name] = h2BodyMatch;
    const h2Name = rawH2Name.trim();
    const seed = findH2Seed(h2Name);
    return `<answer>${seed?.content ?? `QA rewrite for ${h2Name} with safer, clearer guidance.`}</answer>`;
  }

  const h2SummaryMatch = matchQaMarker(filledPromptText, 'H2_SUMMARY::', '(.+?)::(.+?)::');
  if (h2SummaryMatch) {
    const [, , rawH2Name] = h2SummaryMatch;
    const h2Name = rawH2Name.trim();
    const seed = findH2Seed(h2Name);
    return `<answer>${seed?.summary ?? `QA summary for ${h2Name}.`}</answer>`;
  }

  const h2RatingMatch = matchQaMarker(filledPromptText, 'H2_RATE::', '(.+?)::(.+?)::');
  if (h2RatingMatch) {
    const [, , rawH2Name] = h2RatingMatch;
    const h2Name = rawH2Name.trim();
    const seed = findH2Seed(h2Name);
    const rating = Number(seed?.ratingScore ?? '2');
    return JSON.stringify({
      rating,
      majorErrors: rating >= 4 ? 1 : 0,
      minorErrors: rating === 2 ? 1 : 0,
      summary: 'The answer is broadly accurate with minor nuance gaps.',
      corrections: 'None needed.',
      factuallyIncorrectInfo: [],
    });
  }

  const h1BodyMatch = matchQaMarker(filledPromptText, 'H1_BODY::', '(.+?)::(.+?)::');
  if (h1BodyMatch) {
    return '<answer>Installment loans can work for planned expenses when the terms are clear, affordable, and compared carefully before you commit.</answer>';
  }

  const quickAnswerMatch = matchQaMarker(filledPromptText, 'QUICK_ANSWER::', '(.+?)::');
  if (quickAnswerMatch) {
    return 'Installment loans provide a lump sum that is repaid in predictable scheduled payments.';
  }

  if (promptText.includes('CTA::')) {
    return JSON.stringify({
      headline: 'Review your options before you apply',
      body: 'Compare the full cost first. Call us for a free credit review and next steps.',
    });
  }

  if (promptText.includes('SLUG::')) {
    return 'can-you-get-installment-loans';
  }

  if (promptText.includes('META::')) {
    return 'Compare installment loan costs, repayment schedules, and lender terms before you apply.';
  }

  if (promptText.includes('PRO_TIP::')) {
    return 'QA output: Compare the total repayment amount, not just the payment size.';
  }

  if (promptText.includes('RED_FLAG::')) {
    return 'QA output: Urgency, missing disclosures, or pressure to skip the terms is a red flag.';
  }

  if (promptText.includes('KEY_TAKEAWAYS::')) {
    return 'QA output: Compare total cost, verify the lender, and confirm the payment fits your budget.';
  }

  if (promptText.includes('PAGE_TITLE::')) {
    return PAGE_TITLE;
  }

  if (systemText.includes('Text-to-HTML Compiler')) {
    if (ctx.scenario === 'html-validation' && userText.includes('When Do Installment Loans Make Sense?')) {
      return '<h4>bad html</h4> **leftover**';
    }
    const h2NameMatch = userText.match(/H2 Name:\s*(.+)/);
    const h2Name = h2NameMatch?.[1]?.trim();
    if (h2Name) {
      const seed = FULL_FLOW_H2S.find((item) => item.h2Name === h2Name);
      if (seed) return `<h2>${seed.h2Name}</h2><p>${seed.content}</p>`;
    }
    return `<h1>${PAGE_TITLE}</h1><p>QA HTML output.</p>`;
  }

  if (body.response_format && typeof body.response_format === 'object') {
    if (userText.includes('CTA headline') || userText.includes('"headline"')) {
      return JSON.stringify({
        headline: 'Review your options before you apply',
        body: 'Compare the full cost first. Call us for a free credit review and next steps.',
      });
    }
    return JSON.stringify({
      rating: 2,
      majorErrors: 0,
      minorErrors: 1,
      summary: 'The answer is broadly accurate with minor nuance gaps.',
      corrections: 'None needed.',
      factuallyIncorrectInfo: [],
    });
  }

  if (systemText.includes('expert blog content writer')) {
    return `<answer>QA rewrite for ${userText.match(/H2 to Write: (.+)/)?.[1] ?? 'the requested H2'} with safer, clearer guidance.</answer>`;
  }

  if (userText.includes('Provide ONLY the final slug string') || userText.includes('Target Phrase:')) {
    return 'can-you-get-installment-loans';
  }

  return '<answer>QA output</answer>';
}

function buildChatCompletionResponse(body: Record<string, unknown>, ctx: QaFetchContext) {
  const content = completionTextFromRequest(body, ctx);
  return {
    id: `qa_completion_${Date.now()}`,
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: Math.max(20, Math.ceil(content.length / 5)),
    },
  };
}

async function qaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const scenario = getContentPipelineQaScenario();
  if (url.includes('openrouter.ai/api/v1/models')) {
    return new Response(JSON.stringify({
      data: [
        {
          id: 'openrouter/qa-model',
          name: 'QA Model',
          pricing: { prompt: '0.000001', completion: '0.000002' },
          context_length: 64000,
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('openrouter.ai/api/v1/credits')) {
    return new Response(JSON.stringify({
      data: {
        total_credits: 10,
        total_usage: 1.5,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('openrouter.ai/api/v1/chat/completions')) {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    return new Response(JSON.stringify(buildChatCompletionResponse(body, { scenario })), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes('api.open-meteo.com')) {
    return new Response(JSON.stringify({
      current_weather: { temperature: 68, weathercode: 1 },
      daily: {
        time: ['2026-03-28', '2026-03-29', '2026-03-30'],
        weathercode: [1, 2, 3],
        temperature_2m_max: [68, 70, 72],
        temperature_2m_min: [50, 51, 52],
      },
      hourly: {
        time: ['2026-03-28T12:00', '2026-03-28T13:00'],
        weathercode: [1, 2],
        precipitation_probability: [5, 10],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (!originalFetch) throw new Error('Original fetch is unavailable in QA mode.');
  return originalFetch(input, init);
}

export function isContentPipelineQaMode(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith(QA_PATH);
}

export function getContentPipelineQaScenario(): string {
  if (typeof window === 'undefined') return 'default';
  const params = new URLSearchParams(window.location.search);
  return params.get('scenario')?.trim() || 'default';
}

export function installContentPipelineQaRuntime(): void {
  if (!isContentPipelineQaMode() || fetchInstalled || typeof window === 'undefined') return;
  originalFetch = window.fetch.bind(window);
  window.fetch = qaFetch;
  fetchInstalled = true;
  if (!storageSyncInstalled) {
    window.addEventListener('storage', (event) => {
      if (!event.key) return;
      const scenario = getContentPipelineQaScenario();
      const docEntry = parseScenarioKey(QA_DOC_STORAGE_PREFIX, event.key);
      if (docEntry && docEntry.scenario === scenario) {
        const state = ensureState();
        if (event.newValue == null) {
          state.appSettingsDocs.delete(docEntry.name);
        } else {
          try {
            state.appSettingsDocs.set(docEntry.name, JSON.parse(event.newValue) as QaDoc);
          } catch {
            return;
          }
        }
        notifyAppSettingsDoc(docEntry.name);
        return;
      }
      const cacheEntry = parseScenarioKey(QA_CACHE_STORAGE_PREFIX, event.key);
      if (cacheEntry && cacheEntry.scenario === scenario) {
        const state = ensureState();
        if (event.newValue == null) {
          state.localCache.delete(cacheEntry.name);
          return;
        }
        try {
          state.localCache.set(cacheEntry.name, JSON.parse(event.newValue));
        } catch {
          /* ignore malformed QA cache payloads */
        }
      }
    });
    storageSyncInstalled = true;
  }
  if (!navigator.geolocation) {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success: (position: GeolocationPosition) => void) {
          success({
            coords: {
              latitude: 40.7128,
              longitude: -74.0060,
              accuracy: 1,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          } as GeolocationPosition);
        },
      },
    });
  }
}

export function resetContentPipelineQaRuntime(scenario = getContentPipelineQaScenario()): void {
  clearScenarioStorage(scenario);
  qaState = mergeScenarioStorage(createScenarioState(scenario), scenario);
  const state = qaState;
  state.appSettingsDocs.forEach((value, key) => {
    writeScenarioDocToStorage(scenario, key, value);
  });
  state.localCache.forEach((value, key) => {
    writeScenarioCacheToStorage(scenario, key, value);
  });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(getQaScenarioInitKey(scenario), new Date().toISOString());
  }
}

export function getQaSharedApiKey(): string {
  return SHARED_API_KEY;
}

export async function getQaAppSettingsDoc(docId: string): Promise<QaDoc | null> {
  const state = ensureState();
  return clone(state.appSettingsDocs.get(normalizeQaDocId(docId)) ?? null);
}

export async function loadQaLocalCache<T>(key: string): Promise<T | null> {
  const state = ensureState();
  return clone((state.localCache.get(normalizeQaDocId(key)) as T | undefined) ?? null);
}

export async function saveQaLocalCache(key: string, value: unknown): Promise<void> {
  const state = ensureState();
  const normalizedKey = normalizeQaDocId(key);
  const nextValue = clone(value);
  state.localCache.set(normalizedKey, nextValue);
  writeScenarioCacheToStorage(getContentPipelineQaScenario(), normalizedKey, nextValue);
}

export async function deleteQaLocalCache(key: string): Promise<void> {
  const state = ensureState();
  const normalizedKey = normalizeQaDocId(key);
  state.localCache.delete(normalizedKey);
  writeScenarioCacheToStorage(getContentPipelineQaScenario(), normalizedKey, null);
}

export async function setQaAppSettingsDoc(docId: string, data: QaDoc, options?: { merge?: boolean }): Promise<void> {
  const state = ensureState();
  const normalizedDocId = normalizeQaDocId(docId);
  const previous = state.appSettingsDocs.get(normalizedDocId) ?? {};
  const nextValue = options?.merge ? { ...clone(previous), ...clone(data) } : clone(data);
  state.appSettingsDocs.set(normalizedDocId, nextValue);
  writeScenarioDocToStorage(getContentPipelineQaScenario(), normalizedDocId, nextValue);
  notifyAppSettingsDoc(normalizedDocId);
}

export async function deleteQaAppSettingsFields(docId: string, fields: string[]): Promise<void> {
  const state = ensureState();
  const normalizedDocId = normalizeQaDocId(docId);
  const previous = clone(state.appSettingsDocs.get(normalizedDocId) ?? {});
  for (const field of fields) delete previous[field];
  state.appSettingsDocs.set(normalizedDocId, previous);
  writeScenarioDocToStorage(getContentPipelineQaScenario(), normalizedDocId, previous);
  notifyAppSettingsDoc(normalizedDocId);
}

export function subscribeQaAppSettingsDoc(docId: string, onData: (snap: QaSnapshot) => void): () => void {
  const state = ensureState();
  const normalizedDocId = normalizeQaDocId(docId);
  const listeners = state.appSettingsListeners.get(normalizedDocId) ?? new Set<(snap: QaSnapshot) => void>();
  listeners.add(onData);
  state.appSettingsListeners.set(normalizedDocId, listeners);
  onData(makeSnapshot(state.appSettingsDocs.get(normalizedDocId) ?? null));
  return () => {
    const current = state.appSettingsListeners.get(normalizedDocId);
    if (!current) return;
    current.delete(onData);
    if (current.size === 0) state.appSettingsListeners.delete(normalizedDocId);
  };
}

export async function addQaChangelogEntry(entry: Omit<ChangelogEntry, 'id'>): Promise<string> {
  const state = ensureState();
  const next: ChangelogEntry = {
    ...entry,
    id: `qa_change_${state.changelogEntries.length + 1}`,
  };
  state.changelogEntries = [next, ...state.changelogEntries];
  notifyChangelog();
  return next.id;
}

export async function updateQaBuildName(name: string): Promise<void> {
  const state = ensureState();
  state.buildName = name;
  notifyBuildName();
}

export function subscribeQaChangelog(onEntries: (entries: ChangelogEntry[]) => void): () => void {
  const state = ensureState();
  state.changelogListeners.add(onEntries);
  onEntries(clone(state.changelogEntries));
  return () => {
    state.changelogListeners.delete(onEntries);
  };
}

export function subscribeQaBuildName(onName: (name: string) => void): () => void {
  const state = ensureState();
  state.buildNameListeners.add(onName);
  onName(state.buildName);
  return () => {
    state.buildNameListeners.delete(onName);
  };
}
