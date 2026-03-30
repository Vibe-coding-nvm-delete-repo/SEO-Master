import type { OverviewRow } from './contentOverview';
import {
  cleanGeneratedContent,
  hasGeneratedPrimaryOutput,
  hasGeneratedSlotOutput,
} from './contentReadiness';
import { FINAL_PAGES_DYNAMIC_PAIR_COUNT } from './generateTablePresets';

export type FinalPagesInputs = {
  pages: OverviewRow[];
  h2Html: OverviewRow[];
  h1Html: OverviewRow[];
  quickAnswerHtml: OverviewRow[];
  metasSlugCtas: OverviewRow[];
  tipsRedflags: OverviewRow[];
};

export type FinalPagesRequiredFieldKey =
  | 'title'
  | 'metaTitle'
  | 'metaDescription'
  | 'slug'
  | 'quickAnswer'
  | 'h1Body'
  | 'ctaTitle'
  | 'ctaBody'
  | 'proTip'
  | 'redFlags'
  | 'keyTakeaways'
  | 'dynamicHeader1'
  | 'dynamicDescription1';

export type FinalPagesRow = {
  id: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  quickAnswer: string;
  h1Body: string;
  ctaTitle: string;
  ctaBody: string;
  proTip: string;
  redFlags: string;
  keyTakeaways: string;
  readyToPublish: boolean;
  missingRequiredFields: FinalPagesRequiredFieldKey[];
  lastUpdatedAt: string;
} & Record<string, string | boolean | FinalPagesRequiredFieldKey[]>;

export type FinalPagesSummary = {
  totalPages: number;
  readyCount: number;
  needsReviewCount: number;
  completionPercent: number;
  rowsMissingRequiredFields: number;
  lastUpdatedAt: string;
};

export type FinalPagesViewModel = {
  rows: FinalPagesRow[];
  summary: FinalPagesSummary;
};

const REQUIRED_FINAL_PAGE_FIELDS: FinalPagesRequiredFieldKey[] = [
  'title',
  'metaTitle',
  'metaDescription',
  'slug',
  'quickAnswer',
  'h1Body',
  'ctaTitle',
  'ctaBody',
  'proTip',
  'redFlags',
  'keyTakeaways',
  'dynamicHeader1',
  'dynamicDescription1',
];

function sourceRowIdOf(row: OverviewRow): string {
  return row.metadata?.sourceRowId?.trim() || row.id;
}

function sortByH2Order(rows: OverviewRow[]): OverviewRow[] {
  return [...rows].sort((a, b) => {
    const orderA = Number(a.metadata?.order ?? Number.MAX_SAFE_INTEGER);
    const orderB = Number(b.metadata?.order ?? Number.MAX_SAFE_INTEGER);
    if (orderA !== orderB) return orderA - orderB;
    return (a.metadata?.h2Name ?? '').localeCompare(b.metadata?.h2Name ?? '');
  });
}

function firstRowByPage(rows: OverviewRow[]): Map<string, OverviewRow> {
  const map = new Map<string, OverviewRow>();
  for (const row of rows) {
    const pageId = sourceRowIdOf(row);
    if (!pageId || map.has(pageId)) continue;
    map.set(pageId, row);
  }
  return map;
}

function groupedH2RowsByPage(rows: OverviewRow[]): Map<string, OverviewRow[]> {
  const grouped = new Map<string, OverviewRow[]>();
  for (const row of rows) {
    const pageId = sourceRowIdOf(row);
    if (!pageId) continue;
    const current = grouped.get(pageId) ?? [];
    current.push(row);
    grouped.set(pageId, current);
  }
  for (const [pageId, pageRows] of grouped) {
    grouped.set(pageId, sortByH2Order(pageRows));
  }
  return grouped;
}

function blankDynamicPairs(): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 1; index <= FINAL_PAGES_DYNAMIC_PAIR_COUNT; index += 1) {
    result[`dynamicHeader${index}`] = '';
    result[`dynamicDescription${index}`] = '';
  }
  return result;
}

function collectLastUpdatedAt(...values: Array<string | undefined>): string {
  return values
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0)
    .sort()
    .at(-1) ?? '';
}

function slotGeneratedAt(row: OverviewRow | undefined, slotId: string): string {
  return row?.slots?.[slotId]?.generatedAt?.trim() ?? '';
}

function toPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function resolveMissingRequiredFields(row: Omit<FinalPagesRow, 'readyToPublish' | 'missingRequiredFields'>): FinalPagesRequiredFieldKey[] {
  return REQUIRED_FINAL_PAGE_FIELDS.filter((key) => cleanGeneratedContent(row[key]).length === 0);
}

export function buildFinalPagesRows(inputs: FinalPagesInputs): FinalPagesRow[] {
  const pageRows = inputs.pages.filter((row) => cleanGeneratedContent(row.input).length > 0);
  const h1RowsByPage = firstRowByPage(inputs.h1Html);
  const quickRowsByPage = firstRowByPage(inputs.quickAnswerHtml);
  const metasRowsByPage = firstRowByPage(inputs.metasSlugCtas);
  const tipsRowsByPage = firstRowByPage(inputs.tipsRedflags);
  const h2RowsByPage = groupedH2RowsByPage(inputs.h2Html);

  return pageRows.map((pageRow) => {
    const pageId = pageRow.id;
    const h1Row = h1RowsByPage.get(pageId);
    const quickRow = quickRowsByPage.get(pageId);
    const metasRow = metasRowsByPage.get(pageId);
    const tipsRow = tipsRowsByPage.get(pageId);
    const h2Rows = h2RowsByPage.get(pageId) ?? [];

    const title = cleanGeneratedContent(pageRow.output)
      || cleanGeneratedContent(tipsRow?.metadata?.pageName)
      || cleanGeneratedContent(metasRow?.metadata?.pageName)
      || cleanGeneratedContent(quickRow?.metadata?.pageName)
      || cleanGeneratedContent(h1Row?.metadata?.pageName);

    const rowBase = {
      id: pageId,
      title,
      metaTitle: cleanGeneratedContent(metasRow?.metadata?.metaTitle) || title,
      metaDescription: hasGeneratedPrimaryOutput(metasRow) ? cleanGeneratedContent(metasRow?.output) : '',
      slug: hasGeneratedSlotOutput(metasRow?.slots?.slug) ? cleanGeneratedContent(metasRow?.metadata?.slug) : '',
      quickAnswer: quickRow
        ? (hasGeneratedPrimaryOutput(quickRow) ? cleanGeneratedContent(quickRow?.output) : '')
        : cleanGeneratedContent(metasRow?.metadata?.quickAnswer),
      h1Body: h1Row
        ? (hasGeneratedPrimaryOutput(h1Row) ? cleanGeneratedContent(h1Row?.output) : '')
        : cleanGeneratedContent(metasRow?.metadata?.h1Body),
      ctaTitle: hasGeneratedSlotOutput(metasRow?.slots?.cta) ? cleanGeneratedContent(metasRow?.metadata?.ctaHeadline) : '',
      ctaBody: hasGeneratedSlotOutput(metasRow?.slots?.cta) ? cleanGeneratedContent(metasRow?.metadata?.ctaBody) : '',
      proTip: hasGeneratedPrimaryOutput(tipsRow) ? cleanGeneratedContent(tipsRow?.output) : '',
      redFlags: hasGeneratedSlotOutput(tipsRow?.slots?.redflag) ? cleanGeneratedContent(tipsRow?.slots?.redflag?.output) : '',
      keyTakeaways: hasGeneratedSlotOutput(tipsRow?.slots?.keytakeaways) ? cleanGeneratedContent(tipsRow?.slots?.keytakeaways?.output) : '',
      lastUpdatedAt: collectLastUpdatedAt(
        pageRow.generatedAt,
        h1Row?.generatedAt,
        quickRow?.generatedAt,
        metasRow?.generatedAt,
        tipsRow?.generatedAt,
        slotGeneratedAt(metasRow, 'slug'),
        slotGeneratedAt(metasRow, 'cta'),
        slotGeneratedAt(tipsRow, 'redflag'),
        slotGeneratedAt(tipsRow, 'keytakeaways'),
        ...h2Rows.map((row) => row.generatedAt?.trim() ?? ''),
      ),
      ...blankDynamicPairs(),
    };

    h2Rows.slice(0, FINAL_PAGES_DYNAMIC_PAIR_COUNT).forEach((h2Row, index) => {
      const slot = index + 1;
      rowBase[`dynamicHeader${slot}`] = cleanGeneratedContent(h2Row.metadata?.h2Name);
      rowBase[`dynamicDescription${slot}`] = hasGeneratedPrimaryOutput(h2Row) ? cleanGeneratedContent(h2Row.output) : '';
    });

    const missingRequiredFields = resolveMissingRequiredFields(rowBase);
    const row: FinalPagesRow = {
      ...rowBase,
      readyToPublish: missingRequiredFields.length === 0,
      missingRequiredFields,
    };

    return row;
  });
}

export function buildFinalPagesViewModel(inputs: FinalPagesInputs): FinalPagesViewModel {
  const rows = buildFinalPagesRows(inputs);
  const readyCount = rows.filter((row) => row.readyToPublish).length;
  const needsReviewCount = rows.length - readyCount;
  const lastUpdatedAt = rows
    .map((row) => row.lastUpdatedAt.trim())
    .filter((value) => value.length > 0)
    .sort()
    .at(-1) ?? '';

  return {
    rows,
    summary: {
      totalPages: rows.length,
      readyCount,
      needsReviewCount,
      completionPercent: toPercent(readyCount, rows.length),
      rowsMissingRequiredFields: rows.filter((row) => row.missingRequiredFields.length > 0).length,
      lastUpdatedAt,
    },
  };
}
