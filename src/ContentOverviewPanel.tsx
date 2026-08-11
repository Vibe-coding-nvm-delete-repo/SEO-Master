import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CircleDollarSign, Clock3, Code2, FileCode2, FileText, Layers3, MessageSquareQuote, NotebookPen, OctagonAlert, PanelTop, ScrollText, Sparkles, TrendingUp } from 'lucide-react';
import { APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, loadAppSettingsRows, subscribeAppSettingsDoc } from './appSettingsPersistence';
import { H1_BODY_ROWS_DOC_ID } from './contentPipelineH1';
import { H1_HTML_ROWS_DOC_ID } from './contentPipelineH1Html';
import { H2_CONTENT_ROWS_DOC_ID, H2_RATING_ROWS_DOC_ID, UPSTREAM_PAGE_NAMES_DOC_ID } from './contentPipelineH2';
import { H2_HTML_ROWS_DOC_ID } from './contentPipelineHtml';
import { METAS_SLUG_CTAS_ROWS_DOC_ID } from './contentPipelineMetasSlugCtas';
import { QUICK_ANSWER_ROWS_DOC_ID } from './contentPipelineQuickAnswer';
import { QUICK_ANSWER_HTML_ROWS_DOC_ID } from './contentPipelineQuickAnswerHtml';
import { H2_SUMMARY_ROWS_DOC_ID } from './contentPipelineSummary';
import { TIPS_REDFLAGS_ROWS_DOC_ID } from './contentPipelineTipsRedflags';
import { buildContentOverview, type ContentOverviewInputs, type OverviewRow, type OverviewStageState } from './contentOverview';
import { makeAppSettingsChannel } from './cloudSyncStatus';
import { resolveGenerateScopedDocIds } from './generateWorkspaceScope';

const OVERVIEW_DOC_IDS = {
  pages: UPSTREAM_PAGE_NAMES_DOC_ID,
  h2Content: H2_CONTENT_ROWS_DOC_ID,
  rating: H2_RATING_ROWS_DOC_ID,
  h2Html: H2_HTML_ROWS_DOC_ID,
  h2Summary: H2_SUMMARY_ROWS_DOC_ID,
  h1Body: H1_BODY_ROWS_DOC_ID,
  h1Html: H1_HTML_ROWS_DOC_ID,
  quickAnswer: QUICK_ANSWER_ROWS_DOC_ID,
  quickAnswerHtml: QUICK_ANSWER_HTML_ROWS_DOC_ID,
  metasSlugCtas: METAS_SLUG_CTAS_ROWS_DOC_ID,
  tipsRedflags: TIPS_REDFLAGS_ROWS_DOC_ID,
} as const;

const EMPTY_OVERVIEW_INPUTS: ContentOverviewInputs = {
  pages: [],
  h2Content: [],
  rating: [],
  h2Html: [],
  h2Summary: [],
  h1Body: [],
  h1Html: [],
  quickAnswer: [],
  quickAnswerHtml: [],
  metasSlugCtas: [],
  tipsRedflags: [],
};

const STAGE_ICONS: Record<string, React.ReactNode> = {
  pages: <FileText className="h-3.5 w-3.5" />,
  'h2-body': <NotebookPen className="h-3.5 w-3.5" />,
  'h2-rate': <Sparkles className="h-3.5 w-3.5" />,
  'h2-html': <Code2 className="h-3.5 w-3.5" />,
  'h2-summary': <ScrollText className="h-3.5 w-3.5" />,
  'h1-body': <PanelTop className="h-3.5 w-3.5" />,
  'h1-html': <FileCode2 className="h-3.5 w-3.5" />,
  'quick-answer': <MessageSquareQuote className="h-3.5 w-3.5" />,
  'quick-answer-html': <Code2 className="h-3.5 w-3.5" />,
  'metas-slug-ctas': <Layers3 className="h-3.5 w-3.5" />,
  'tips-redflags': <OctagonAlert className="h-3.5 w-3.5" />,
  'final-pages': <Layers3 className="h-3.5 w-3.5" />,
};

const STATE_STYLES: Record<OverviewStageState, { chip: string; bar: string; text: string }> = {
  complete: {
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
  },
  active: {
    chip: 'bg-sky-50 text-sky-700 border-sky-200',
    bar: 'bg-sky-500',
    text: 'text-sky-700',
  },
  blocked: {
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    bar: 'bg-rose-500',
    text: 'text-rose-700',
  },
  partial: {
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    bar: 'bg-amber-500',
    text: 'text-amber-700',
  },
  'not-started': {
    chip: 'bg-zinc-100 text-zinc-600 border-zinc-200',
    bar: 'bg-zinc-400',
    text: 'text-zinc-600',
  },
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}

function formatRelativeTime(iso: string): string {
  if (!iso) return 'No recent outputs';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) return 'No recent outputs';
  if (diffMs < 60_000) return 'Updated just now';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `Updated ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Updated ${days}d ago`;
}

function SummaryMetric({
  icon,
  label,
  value,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  onClick?: () => void;
}) {
  const className = `rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm ${onClick ? 'cursor-pointer hover:border-zinc-300 hover:bg-zinc-50' : ''}`;
  const content = (
    <>
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        <span className="text-zinc-400">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-0.5 text-lg font-semibold leading-none text-zinc-900">{value}</div>
      {detail ? <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{detail}</div> : null}
    </>
  );

  if (!onClick) return <div className={className}>{content}</div>;
  return <button type="button" className={`${className} text-left`} onClick={onClick}>{content}</button>;
}

function StatusPill({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick?: () => void }) {
  const className = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${tone} ${onClick ? 'cursor-pointer hover:opacity-90' : ''}`;
  const content = (
    <>
      <span>{label}</span>
      <span>{value}</span>
    </>
  );
  if (!onClick) return <div className={className}>{content}</div>;
  return <button type="button" className={className} onClick={onClick}>{content}</button>;
}

function ProgressLine({
  stageId,
  stageLabel,
  state,
  completed,
  total,
  percent,
  cost,
  costSharePercent,
  nested = false,
  testId,
  onClick,
}: {
  stageId: string;
  stageLabel: string;
  state: OverviewStageState;
  completed: number;
  total: number;
  percent: number;
  cost: number;
  costSharePercent: number;
  nested?: boolean;
  testId?: string;
  onClick?: () => void;
}) {
  const style = STATE_STYLES[state];
  const icon = STAGE_ICONS[stageId] ?? <Layers3 className="h-3.5 w-3.5" />;
  const className = `grid grid-cols-[minmax(0,1.8fr)_74px_74px_96px] gap-2 rounded-lg border px-3 py-1.5 transition ${nested ? 'ml-3 bg-zinc-50/60 border-zinc-100' : 'bg-white border-zinc-200'} ${onClick ? 'cursor-pointer hover:border-zinc-300 hover:bg-zinc-50' : ''}`;
  const content = (
    <>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={style.text}>{icon}</span>
          <div className="min-w-0 flex-1">
            <div className={`truncate text-[13px] ${nested ? 'text-zinc-700' : 'font-medium text-zinc-800'}`}>{stageLabel}</div>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.chip}`}>{state.replace('-', ' ')}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-200">
          <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Done</div>
        <div className="mt-0.5 text-sm font-semibold text-zinc-800">{completed}/{total}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Percent</div>
        <div className="mt-0.5 text-sm font-semibold text-zinc-800">{percent}%</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Cost</div>
        <div className="mt-0.5 text-sm font-semibold text-zinc-800">{formatCurrency(cost)}</div>
        <div className="text-[10px] text-zinc-500">{costSharePercent}% of spend</div>
      </div>
    </>
  );

  if (!onClick) return <div className={className} data-testid={testId}>{content}</div>;

  return (
    <button type="button" className={`${className} w-full text-left`} data-testid={testId} onClick={onClick}>
      {content}
    </button>
  );
}

export default function ContentOverviewPanel({
  activeProjectId,
  onStageSelect,
  runtimeEffectsActive = true,
}: {
  activeProjectId: string | null;
  onStageSelect?: (stageId: string) => void;
  runtimeEffectsActive?: boolean;
}) {
  const [overviewInputs, setOverviewInputs] = useState<ContentOverviewInputs | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const overviewDocIds = useMemo(
    () => resolveGenerateScopedDocIds(activeProjectId, OVERVIEW_DOC_IDS),
    [activeProjectId],
  );

  const loadOverviewInputs = useCallback(async (mode: 'remote' | 'local-preferred' = 'remote') => {
    setLoadError(null);
    const loadRows = async (docId: string) => loadAppSettingsRows<OverviewRow>({
      docId,
      loadMode: mode,
      registryKind: 'rows',
      allowProjectScopedLocalCache: mode === 'local-preferred',
    });
    const [
      pages,
      h2Content,
      rating,
      h2Html,
      h2Summary,
      h1Body,
      h1Html,
      quickAnswer,
      quickAnswerHtml,
      metasSlugCtas,
      tipsRedflags,
    ] = await Promise.all([
      loadRows(overviewDocIds.pages),
      loadRows(overviewDocIds.h2Content),
      loadRows(overviewDocIds.rating),
      loadRows(overviewDocIds.h2Html),
      loadRows(overviewDocIds.h2Summary),
      loadRows(overviewDocIds.h1Body),
      loadRows(overviewDocIds.h1Html),
      loadRows(overviewDocIds.quickAnswer),
      loadRows(overviewDocIds.quickAnswerHtml),
      loadRows(overviewDocIds.metasSlugCtas),
      loadRows(overviewDocIds.tipsRedflags),
    ]);

    setOverviewInputs({
      pages,
      h2Content,
      rating,
      h2Html,
      h2Summary,
      h1Body,
      h1Html,
      quickAnswer,
      quickAnswerHtml,
      metasSlugCtas,
      tipsRedflags,
    });
  }, [overviewDocIds]);

  useEffect(() => {
    let active = true;
    if (!runtimeEffectsActive) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    const refresh = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await loadOverviewInputs();
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load overview.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void refresh();

    const trackedDocIds = new Set<string>(Object.values(overviewDocIds));
    const unsubscribers = (Object.values(overviewDocIds) as string[]).map((docId) =>
      subscribeAppSettingsDoc({
        docId,
        channel: makeAppSettingsChannel('overview', docId),
        onData: () => {
          void loadOverviewInputs('remote').catch((error) => {
            if (!active) return;
            setLoadError(error instanceof Error ? error.message : 'Failed to refresh overview.');
          });
        },
      }),
    );

    const handleLocalRowsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string }>).detail;
      if (!detail?.docId || !trackedDocIds.has(detail.docId as (typeof OVERVIEW_DOC_IDS)[keyof typeof OVERVIEW_DOC_IDS])) return;
      void loadOverviewInputs('local-preferred').catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to refresh overview.');
      });
    };
    window.addEventListener(APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, handleLocalRowsUpdated as EventListener);

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener(APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, handleLocalRowsUpdated as EventListener);
    };
  }, [loadOverviewInputs, overviewDocIds, runtimeEffectsActive]);

  const summary = useMemo(() => buildContentOverview(overviewInputs ?? EMPTY_OVERVIEW_INPUTS), [overviewInputs]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 shadow-sm">
        <div className="text-sm font-medium text-zinc-800">Overview</div>
        <div className="mt-1 text-sm text-zinc-500">Loading pipeline progress...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 shadow-sm">
        <div className="text-sm font-medium text-amber-900">Overview unavailable</div>
        <div className="mt-1 text-sm text-amber-800">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="content-overview-panel">
      <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 shadow-sm">
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric icon={<Layers3 className="h-3.5 w-3.5" />} label="Total Pages" value={String(summary.totalPages)} detail="Active page rows in the current pipeline." onClick={() => onStageSelect?.('pages')} />
          <SummaryMetric icon={<BarChart3 className="h-3.5 w-3.5" />} label="Completed Outputs" value={`${summary.overallCompletedOutputs}/${summary.overallOutputTarget}`} detail="All implemented outputs across the pipeline." onClick={() => onStageSelect?.(summary.bottleneckStageId)} />
          <SummaryMetric icon={<TrendingUp className="h-3.5 w-3.5" />} label="Overall %" value={`${summary.overallPercent}%`} detail="Completion across all visible output lines." onClick={() => onStageSelect?.(summary.bottleneckStageId)} />
          <SummaryMetric icon={<CircleDollarSign className="h-3.5 w-3.5" />} label="Total Cost" value={formatCurrency(summary.totalCost)} detail="Combined primary and slot spend for this page set." onClick={() => onStageSelect?.(summary.highestCostStageId)} />
        </div>

        <div className="mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Overall Completion</div>
              <div className="mt-0.5 text-sm font-semibold text-zinc-800">
                {summary.overallCompletedOutputs}/{summary.overallOutputTarget} outputs complete
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-lg font-semibold leading-none text-zinc-900">{summary.overallPercent}%</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">pipeline complete</div>
            </div>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
              style={{ width: `${summary.overallPercent}%` }}
              aria-label="Overall completion progress"
            />
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusPill label="Ready" value={summary.readyPages} tone="border-zinc-200 bg-zinc-100 text-zinc-700" onClick={() => onStageSelect?.(summary.firstReadyStageId)} />
          <StatusPill label="Generating" value={summary.activePages} tone="border-sky-200 bg-sky-50 text-sky-700" onClick={() => onStageSelect?.(summary.firstActiveStageId)} />
          <StatusPill label="Blocked" value={summary.blockedPages} tone="border-rose-200 bg-rose-50 text-rose-700" onClick={() => onStageSelect?.(summary.firstBlockedStageId)} />
          <StatusPill label="Complete" value={summary.completePages} tone="border-emerald-200 bg-emerald-50 text-emerald-700" onClick={() => onStageSelect?.(summary.finalImplementedStageId)} />
          <div className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[12px] text-zinc-600">
            <Clock3 className="h-3.5 w-3.5" />
            <span>{formatRelativeTime(summary.lastUpdatedAt)}</span>
          </div>
        </div>

        <div className="mt-1.5 grid gap-1.5 md:grid-cols-3">
          <button type="button" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-left hover:border-zinc-300 hover:bg-zinc-100/70" onClick={() => onStageSelect?.(summary.bottleneckStageId)}>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Bottleneck</span>
            </div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-800">{summary.bottleneckStage}</div>
          </button>
          <button type="button" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-left hover:border-zinc-300 hover:bg-zinc-100/70" onClick={() => onStageSelect?.(summary.highestCostStageId)}>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              <CircleDollarSign className="h-3.5 w-3.5" />
              <span>Highest Cost</span>
            </div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-800">{summary.highestCostStage}</div>
          </button>
          <button type="button" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-left hover:border-zinc-300 hover:bg-zinc-100/70" onClick={() => onStageSelect?.(summary.latestCompletedStageId)}>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Latest Complete</span>
            </div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-800">{summary.latestCompletedStage}</div>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Pipeline Progress</h3>
            <p className="mt-0.5 text-[12px] text-zinc-500">Click a stage to jump straight into that tab and keep the pipeline moving.</p>
          </div>
          <div className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[12px] font-medium text-zinc-600">
            {summary.pagesFullyThroughFinalStage} fully through final stage
          </div>
        </div>
        <div className="mt-1.5 space-y-1.5">
          {summary.stages.map((stage) => (
            <div key={stage.id} className="space-y-1">
              <ProgressLine
                stageId={stage.id}
                stageLabel={stage.label}
                state={stage.state}
                completed={stage.completed}
                total={stage.total}
                percent={stage.percent}
                cost={stage.cost}
                costSharePercent={stage.costSharePercent}
                testId={`overview-stage-${stage.id}`}
                onClick={stage.id !== 'pages' ? () => onStageSelect?.(stage.id) : undefined}
              />
              {stage.children?.map((child) => (
                <React.Fragment key={child.id}>
                  <ProgressLine
                    stageId={stage.id}
                    stageLabel={child.label}
                    state={child.state}
                    completed={child.completed}
                    total={child.total}
                    percent={child.percent}
                    cost={child.cost}
                    costSharePercent={child.costSharePercent}
                    nested
                    testId={`overview-stage-${stage.id}-${child.id}`}
                    onClick={() => onStageSelect?.(stage.id)}
                  />
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
