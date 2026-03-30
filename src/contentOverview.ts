import { buildFinalPagesViewModel } from './contentFinalPages';
import {
  hasGeneratedPrimaryOutput,
  hasGeneratedSlotOutput,
  hasMeaningfulContent,
} from './contentReadiness';

export type OverviewSlotState = {
  status?: string;
  output?: string;
  cost?: number;
  generatedAt?: string;
};

export type OverviewRow = {
  id: string;
  input?: string;
  status?: string;
  output?: string;
  cost?: number;
  generatedAt?: string;
  slots?: Record<string, OverviewSlotState | undefined>;
  metadata?: Record<string, string | undefined>;
};

export type OverviewStageState = 'complete' | 'active' | 'blocked' | 'partial' | 'not-started';

export type OverviewStageChild = {
  id: string;
  label: string;
  completed: number;
  total: number;
  percent: number;
  cost: number;
  costSharePercent: number;
  state: OverviewStageState;
};

export type OverviewStageSummary = {
  id: string;
  label: string;
  completed: number;
  total: number;
  percent: number;
  cost: number;
  costSharePercent: number;
  state: OverviewStageState;
  children?: OverviewStageChild[];
};

export type ContentOverviewSummary = {
  totalPages: number;
  completePages: number;
  activePages: number;
  blockedPages: number;
  readyPages: number;
  overallCompletedOutputs: number;
  overallOutputTarget: number;
  overallPercent: number;
  totalCost: number;
  latestCompletedStage: string;
  latestCompletedStageId: string;
  pagesFullyThroughFinalStage: number;
  bottleneckStage: string;
  bottleneckStageId: string;
  highestCostStage: string;
  highestCostStageId: string;
  lastUpdatedAt: string;
  firstActiveStageId: string;
  firstBlockedStageId: string;
  firstReadyStageId: string;
  finalImplementedStageId: string;
  stages: OverviewStageSummary[];
};

type StageChildConfig = {
  id: string;
  label: string;
  isComplete: (row: OverviewRow) => boolean;
  isActive: (row: OverviewRow) => boolean;
  isBlocked: (row: OverviewRow) => boolean;
  getCost: (row: OverviewRow) => number;
  getGeneratedAt: (row: OverviewRow) => string;
};

type StageConfig = {
  id: string;
  label: string;
  rows: OverviewRow[];
  getPageId: (row: OverviewRow) => string;
  isComplete: (row: OverviewRow) => boolean;
  isActive: (row: OverviewRow) => boolean;
  isBlocked: (row: OverviewRow) => boolean;
  getCost: (row: OverviewRow) => number;
  getGeneratedAt: (row: OverviewRow) => string;
  children?: StageChildConfig[];
};

type FlatStage = {
  id: string;
  label: string;
  parentStageId: string;
  completed: number;
  total: number;
  percent: number;
  cost: number;
  state: OverviewStageState;
};

export type ContentOverviewInputs = {
  pages: OverviewRow[];
  h2Content: OverviewRow[];
  rating: OverviewRow[];
  h2Html: OverviewRow[];
  h2Summary: OverviewRow[];
  h1Body: OverviewRow[];
  h1Html: OverviewRow[];
  quickAnswer: OverviewRow[];
  quickAnswerHtml: OverviewRow[];
  metasSlugCtas: OverviewRow[];
  tipsRedflags: OverviewRow[];
};

function toPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function sumCosts(rows: OverviewRow[], getCost: (row: OverviewRow) => number): number {
  return rows.reduce((sum, row) => sum + getCost(row), 0);
}

function countCompletedPages(
  pageIds: string[],
  rows: OverviewRow[],
  getPageId: (row: OverviewRow) => string,
  isComplete: (row: OverviewRow) => boolean,
): number {
  let completed = 0;
  for (const pageId of pageIds) {
    const pageRows = rows.filter((row) => getPageId(row) === pageId);
    if (pageRows.length === 0) continue;
    if (pageRows.every(isComplete)) completed += 1;
  }
  return completed;
}

function anyPageRowsMatch(
  pageIds: string[],
  rows: OverviewRow[],
  getPageId: (row: OverviewRow) => string,
  predicate: (row: OverviewRow) => boolean,
): number {
  let count = 0;
  for (const pageId of pageIds) {
    const pageRows = rows.filter((row) => getPageId(row) === pageId);
    if (pageRows.length === 0) continue;
    if (pageRows.some(predicate)) count += 1;
  }
  return count;
}

function collectLatestTimestamp(rows: OverviewRow[], getGeneratedAt: (row: OverviewRow) => string): string {
  const timestamps = rows
    .map((row) => getGeneratedAt(row))
    .filter((value) => value.trim().length > 0)
    .sort();
  return timestamps.at(-1) ?? '';
}

function deriveStageState(args: {
  total: number;
  completed: number;
  hasActive: boolean;
  hasBlocked: boolean;
  hasAnyRows: boolean;
}): OverviewStageState {
  if (args.total === 0 || !args.hasAnyRows) return 'not-started';
  if (args.completed === args.total) return 'complete';
  if (args.hasActive) return 'active';
  if (args.hasBlocked) return 'blocked';
  if (args.completed > 0) return 'partial';
  return 'not-started';
}

export function buildContentOverview(inputs: ContentOverviewInputs): ContentOverviewSummary {
  const pageRows = inputs.pages.filter((row) => (row.input ?? '').trim().length > 0);
  const pageIds = pageRows.map((row) => row.id);
  const totalPages = pageIds.length;
  const finalPagesViewModel = buildFinalPagesViewModel({
    pages: inputs.pages,
    h2Html: inputs.h2Html,
    h1Html: inputs.h1Html,
    quickAnswerHtml: inputs.quickAnswerHtml,
    metasSlugCtas: inputs.metasSlugCtas,
    tipsRedflags: inputs.tipsRedflags,
  });
  const finalPagesRows: OverviewRow[] = finalPagesViewModel.rows
    .filter((row) => pageIds.includes(row.id))
    .map((row) => ({
      id: row.id,
      status: row.readyToPublish ? 'generated' : 'pending',
      output: row.readyToPublish ? 'Ready to publish' : '',
      generatedAt: row.lastUpdatedAt,
      metadata: { sourceRowId: row.id },
    }));

  const pageIdOf = (row: OverviewRow): string => row.metadata?.sourceRowId ?? row.id;
  const rowGenerated = (row: OverviewRow): boolean => hasGeneratedPrimaryOutput(row);
  const rowActive = (row: OverviewRow): boolean => row.status === 'generating';
  const rowBlocked = (row: OverviewRow): boolean => row.status === 'error';
  const rowCost = (row: OverviewRow): number => row.cost ?? 0;
  const rowGeneratedAt = (row: OverviewRow): string => row.generatedAt ?? '';
  const slotGenerated = (slotId: string) => (row: OverviewRow): boolean => hasGeneratedSlotOutput(row.slots?.[slotId]);
  const slotActive = (slotId: string) => (row: OverviewRow): boolean => row.slots?.[slotId]?.status === 'generating';
  const slotBlocked = (slotId: string) => (row: OverviewRow): boolean => row.slots?.[slotId]?.status === 'error';
  const slotCost = (slotId: string) => (row: OverviewRow): number => row.slots?.[slotId]?.cost ?? 0;
  const slotGeneratedAt = (slotId: string) => (row: OverviewRow): string => row.slots?.[slotId]?.generatedAt ?? '';
  const slugGenerated = (row: OverviewRow): boolean =>
    hasGeneratedSlotOutput(row.slots?.slug) && hasMeaningfulContent(row.metadata?.slug);
  const ctaGenerated = (row: OverviewRow): boolean =>
    hasGeneratedSlotOutput(row.slots?.cta)
    && hasMeaningfulContent(row.metadata?.ctaHeadline)
    && hasMeaningfulContent(row.metadata?.ctaBody);
  const keepPageRows = (rows: OverviewRow[]) => rows.filter((row) => pageIds.includes(pageIdOf(row)));

  const stageConfigs: StageConfig[] = [
    { id: 'pages', label: 'Pages', rows: pageRows, getPageId: (row) => row.id, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'h2-body', label: 'H2 Body', rows: keepPageRows(inputs.h2Content), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'h2-rate', label: 'H2 Rate', rows: keepPageRows(inputs.rating), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'h2-html', label: 'H2 Body HTML', rows: keepPageRows(inputs.h2Html), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'h2-summary', label: 'H2 Summ.', rows: keepPageRows(inputs.h2Summary), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'h1-body', label: 'H1 Body', rows: keepPageRows(inputs.h1Body), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'h1-html', label: 'H1 Body HTML', rows: keepPageRows(inputs.h1Html), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'quick-answer', label: 'Quick Answer', rows: keepPageRows(inputs.quickAnswer), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    { id: 'quick-answer-html', label: 'Quick Answer HTML', rows: keepPageRows(inputs.quickAnswerHtml), getPageId: pageIdOf, isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
    {
      id: 'metas-slug-ctas',
      label: 'Metas/Slug/CTAs',
      rows: keepPageRows(inputs.metasSlugCtas),
      getPageId: pageIdOf,
      isComplete: rowGenerated,
      isActive: rowActive,
      isBlocked: rowBlocked,
      getCost: rowCost,
      getGeneratedAt: rowGeneratedAt,
      children: [
        { id: 'meta-description', label: 'Meta Description', isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
        { id: 'slug', label: 'Slug', isComplete: slugGenerated, isActive: slotActive('slug'), isBlocked: slotBlocked('slug'), getCost: slotCost('slug'), getGeneratedAt: slotGeneratedAt('slug') },
        { id: 'ctas', label: 'CTAs', isComplete: ctaGenerated, isActive: slotActive('cta'), isBlocked: slotBlocked('cta'), getCost: slotCost('cta'), getGeneratedAt: slotGeneratedAt('cta') },
      ],
    },
    {
      id: 'tips-redflags',
      label: 'Pro Tip/Red Flag/Key Takeaways',
      rows: keepPageRows(inputs.tipsRedflags),
      getPageId: pageIdOf,
      isComplete: rowGenerated,
      isActive: rowActive,
      isBlocked: rowBlocked,
      getCost: rowCost,
      getGeneratedAt: rowGeneratedAt,
      children: [
        { id: 'pro-tip', label: 'Pro Tip', isComplete: rowGenerated, isActive: rowActive, isBlocked: rowBlocked, getCost: rowCost, getGeneratedAt: rowGeneratedAt },
        { id: 'red-flag', label: 'Red Flag', isComplete: slotGenerated('redflag'), isActive: slotActive('redflag'), isBlocked: slotBlocked('redflag'), getCost: slotCost('redflag'), getGeneratedAt: slotGeneratedAt('redflag') },
        { id: 'key-takeaways', label: 'Key Takeaways', isComplete: slotGenerated('keytakeaways'), isActive: slotActive('keytakeaways'), isBlocked: slotBlocked('keytakeaways'), getCost: slotCost('keytakeaways'), getGeneratedAt: slotGeneratedAt('keytakeaways') },
      ],
    },
    {
      id: 'final-pages',
      label: 'Final Pages',
      rows: finalPagesRows,
      getPageId: (row) => row.id,
      isComplete: rowGenerated,
      isActive: () => false,
      isBlocked: () => false,
      getCost: () => 0,
      getGeneratedAt: rowGeneratedAt,
    },
  ];

  const rawStages = stageConfigs.map((stage) => {
    const completed = countCompletedPages(pageIds, stage.rows, stage.getPageId, stage.isComplete);
    const total = totalPages;
    const hasActive = anyPageRowsMatch(pageIds, stage.rows, stage.getPageId, stage.isActive) > 0;
    const hasBlocked = anyPageRowsMatch(pageIds, stage.rows, stage.getPageId, stage.isBlocked) > 0;
    const children = stage.children?.map((child) => {
      const childCompleted = countCompletedPages(pageIds, stage.rows, stage.getPageId, child.isComplete);
      const childHasActive = anyPageRowsMatch(pageIds, stage.rows, stage.getPageId, child.isActive) > 0;
      const childHasBlocked = anyPageRowsMatch(pageIds, stage.rows, stage.getPageId, child.isBlocked) > 0;
      return {
        id: child.id,
        label: child.label,
        completed: childCompleted,
        total,
        percent: toPercent(childCompleted, total),
        cost: sumCosts(stage.rows, child.getCost),
        costSharePercent: 0,
        state: deriveStageState({
          total,
          completed: childCompleted,
          hasActive: childHasActive,
          hasBlocked: childHasBlocked,
          hasAnyRows: stage.rows.length > 0,
        }),
      };
    });

    return {
      id: stage.id,
      label: stage.label,
      completed,
      total,
      percent: toPercent(completed, total),
      cost: children?.length ? children.reduce((sum, child) => sum + child.cost, 0) : sumCosts(stage.rows, stage.getCost),
      costSharePercent: 0,
      state: deriveStageState({
        total,
        completed,
        hasActive,
        hasBlocked,
        hasAnyRows: stage.rows.length > 0,
      }),
      children,
    };
  });

  const flatStages: FlatStage[] = rawStages.flatMap((stage) =>
    stage.children?.length
      ? stage.children.map((child) => ({
        id: child.id,
        label: child.label,
        parentStageId: stage.id,
        completed: child.completed,
        total: child.total,
        percent: child.percent,
        cost: child.cost,
        state: child.state,
      }))
      : [{
        id: stage.id,
        label: stage.label,
        parentStageId: stage.id,
        completed: stage.completed,
        total: stage.total,
        percent: stage.percent,
        cost: stage.cost,
        state: stage.state,
      }],
  );
  const totalCost = flatStages.reduce((sum, stage) => sum + stage.cost, 0);

  const stages: OverviewStageSummary[] = rawStages.map((stage) => ({
    ...stage,
    costSharePercent: toPercent(stage.cost, totalCost || 1),
    children: stage.children?.map((child) => ({
      ...child,
      costSharePercent: toPercent(child.cost, totalCost || 1),
    })),
  }));

  const finalPagesStage = stages.find((stage) => stage.id === 'final-pages');
  const pagesFullyThroughFinalStage = finalPagesStage?.completed ?? 0;
  const completePages = pagesFullyThroughFinalStage;

  const allRowsByPage = (pageId: string): OverviewRow[] =>
    stageConfigs.flatMap((stage) => stage.rows.filter((row) => stage.getPageId(row) === pageId));

  const activePages = pageIds.filter((pageId) =>
    allRowsByPage(pageId).some((row) => row.status === 'generating' || Object.values(row.slots ?? {}).some((slot) => slot?.status === 'generating')),
  ).length;
  const blockedPages = pageIds.filter((pageId) =>
    allRowsByPage(pageId).some((row) => row.status === 'error' || Object.values(row.slots ?? {}).some((slot) => slot?.status === 'error')),
  ).length;
  const readyPages = Math.max(totalPages - completePages - activePages - blockedPages, 0);

  const incompleteLeafStages = flatStages.filter((stage) => stage.total > 0 && stage.completed < stage.total);
  const bottleneckLeaf = [...incompleteLeafStages]
    .sort((a, b) => {
      const remainingDiff = (b.total - b.completed) - (a.total - a.completed);
      if (remainingDiff !== 0) return remainingDiff;
      return a.percent - b.percent;
    })
    .at(0);
  const highestCostLeaf = [...flatStages].sort((a, b) => b.cost - a.cost).at(0);
  const latestCompletedLeaf = [...flatStages].reverse().find((stage) => stage.total > 0 && stage.completed === stage.total);
  const firstActiveLeaf = flatStages.find((stage) => stage.state === 'active');
  const firstBlockedLeaf = flatStages.find((stage) => stage.state === 'blocked');
  const firstReadyLeaf = flatStages.find((stage) => stage.state === 'partial' || stage.state === 'not-started');

  const lastUpdatedAt = stageConfigs
    .flatMap((stage) => {
      const values = [collectLatestTimestamp(stage.rows, stage.getGeneratedAt)];
      for (const child of stage.children ?? []) values.push(collectLatestTimestamp(stage.rows, child.getGeneratedAt));
      return values;
    })
    .filter((value) => value.trim().length > 0)
    .sort()
    .at(-1) ?? '';

  const overallCompletedOutputs = flatStages.reduce((sum, stage) => sum + stage.completed, 0);
  const overallOutputTarget = flatStages.reduce((sum, stage) => sum + stage.total, 0);

  return {
    totalPages,
    completePages,
    activePages,
    blockedPages,
    readyPages,
    overallCompletedOutputs,
    overallOutputTarget,
    overallPercent: toPercent(overallCompletedOutputs, overallOutputTarget),
    totalCost,
    latestCompletedStage: latestCompletedLeaf?.label ?? 'Not started',
    latestCompletedStageId: latestCompletedLeaf?.parentStageId ?? 'overview',
    pagesFullyThroughFinalStage,
    bottleneckStage: bottleneckLeaf?.label ?? 'None',
    bottleneckStageId: bottleneckLeaf?.parentStageId ?? 'overview',
    highestCostStage: highestCostLeaf?.label ?? 'None',
    highestCostStageId: highestCostLeaf?.parentStageId ?? 'overview',
    lastUpdatedAt,
    firstActiveStageId: firstActiveLeaf?.parentStageId ?? 'overview',
    firstBlockedStageId: firstBlockedLeaf?.parentStageId ?? 'overview',
    firstReadyStageId: firstReadyLeaf?.parentStageId ?? 'pages',
    finalImplementedStageId: 'final-pages',
    stages,
  };
}
