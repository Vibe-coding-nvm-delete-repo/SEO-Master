import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileSpreadsheet } from 'lucide-react';
import { APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, loadAppSettingsRows, subscribeAppSettingsDoc } from './appSettingsPersistence';
import { type OverviewRow } from './contentOverview';
import { buildFinalPagesViewModel, type FinalPagesInputs } from './contentFinalPages';
import {
  buildContentHistoryState,
  buildContentPathForRoute,
  type ContentSubtabId,
} from './contentSubtabRouting';
import { H1_HTML_ROWS_DOC_ID } from './contentPipelineH1Html';
import { UPSTREAM_PAGE_NAMES_DOC_ID } from './contentPipelineH2';
import { H2_HTML_ROWS_DOC_ID } from './contentPipelineHtml';
import { METAS_SLUG_CTAS_ROWS_DOC_ID } from './contentPipelineMetasSlugCtas';
import { QUICK_ANSWER_HTML_ROWS_DOC_ID } from './contentPipelineQuickAnswerHtml';
import { TIPS_REDFLAGS_ROWS_DOC_ID } from './contentPipelineTipsRedflags';
import { FINAL_PAGES_TABLE_COLUMNS } from './generateTablePresets';
import { CELL, TABLE_TBODY_ZEBRA_CLASS } from './tableConstants';
import { makeAppSettingsChannel } from './cloudSyncStatus';
import { resolveGenerateScopedDocIds } from './generateWorkspaceScope';

const FINAL_PAGES_DOC_IDS = {
  pages: UPSTREAM_PAGE_NAMES_DOC_ID,
  h2Html: H2_HTML_ROWS_DOC_ID,
  h1Html: H1_HTML_ROWS_DOC_ID,
  quickAnswerHtml: QUICK_ANSWER_HTML_ROWS_DOC_ID,
  metasSlugCtas: METAS_SLUG_CTAS_ROWS_DOC_ID,
  tipsRedflags: TIPS_REDFLAGS_ROWS_DOC_ID,
} as const;

const EMPTY_INPUTS: FinalPagesInputs = {
  pages: [],
  h2Html: [],
  h1Html: [],
  quickAnswerHtml: [],
  metasSlugCtas: [],
  tipsRedflags: [],
};

const SHARED_SCROLL_CONTAINER_STYLE: React.CSSProperties = {
  scrollbarGutter: 'stable both-edges',
};

const FINAL_PAGES_CELL_FRAME_CLASS = 'h-[58px] overflow-hidden whitespace-pre-wrap break-words leading-[1.35]';

function getColumnSourceSubtab(columnKey: string): ContentSubtabId {
  if (columnKey === 'title') return 'pages';
  if (columnKey === 'metaTitle' || columnKey === 'metaDescription' || columnKey === 'slug' || columnKey === 'ctaTitle' || columnKey === 'ctaBody') {
    return 'metas-slug-ctas';
  }
  if (columnKey === 'quickAnswer') return 'quick-answer-html';
  if (columnKey === 'h1Body') return 'h1-body-html';
  if (columnKey === 'proTip' || columnKey === 'redFlags' || columnKey === 'keyTakeaways') return 'tips-redflags';
  if (columnKey.startsWith('dynamicHeader') || columnKey.startsWith('dynamicDescription')) return 'h2-body-html';
  return 'final-pages';
}

function buildSubtabPath(subtab: ContentSubtabId): string {
  return buildContentPathForRoute({ subtab, panel: 'table' });
}

function formatLastUpdated(value: string): string {
  if (!value.trim()) return 'Not updated yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function FinalPagesPanel({
  activeProjectId,
  onSourceSelect,
  runtimeEffectsActive = true,
}: {
  activeProjectId: string | null;
  onSourceSelect?: (subtab: ContentSubtabId) => void;
  runtimeEffectsActive?: boolean;
}) {
  const [inputs, setInputs] = useState<FinalPagesInputs | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const finalPagesDocIds = useMemo(
    () => resolveGenerateScopedDocIds(activeProjectId, FINAL_PAGES_DOC_IDS),
    [activeProjectId],
  );

  const loadInputs = useCallback(async (mode: 'remote' | 'local-preferred' = 'remote') => {
    setLoadError(null);
    const loadRows = async (docId: string) => loadAppSettingsRows<OverviewRow>({
      docId,
      loadMode: mode,
      registryKind: 'rows',
      allowProjectScopedLocalCache: mode === 'local-preferred',
    });

    const [pages, h2Html, h1Html, quickAnswerHtml, metasSlugCtas, tipsRedflags] = await Promise.all([
      loadRows(finalPagesDocIds.pages),
      loadRows(finalPagesDocIds.h2Html),
      loadRows(finalPagesDocIds.h1Html),
      loadRows(finalPagesDocIds.quickAnswerHtml),
      loadRows(finalPagesDocIds.metasSlugCtas),
      loadRows(finalPagesDocIds.tipsRedflags),
    ]);

    setInputs({
      pages,
      h2Html,
      h1Html,
      quickAnswerHtml,
      metasSlugCtas,
      tipsRedflags,
    });
  }, [finalPagesDocIds]);

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
        await loadInputs();
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load final pages.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void refresh();

    const trackedDocIds = new Set<string>(Object.values(finalPagesDocIds));
    const unsubscribers = (Object.values(finalPagesDocIds) as string[]).map((docId) =>
      subscribeAppSettingsDoc({
        docId,
        channel: makeAppSettingsChannel('final-pages', docId),
        onData: () => {
          void loadInputs('remote').catch((error) => {
            if (!active) return;
            setLoadError(error instanceof Error ? error.message : 'Failed to refresh final pages.');
          });
        },
      }),
    );

    const handleLocalRowsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string }>).detail;
      if (!detail?.docId || !trackedDocIds.has(detail.docId as (typeof FINAL_PAGES_DOC_IDS)[keyof typeof FINAL_PAGES_DOC_IDS])) return;
      void loadInputs('local-preferred').catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to refresh final pages.');
      });
    };

    window.addEventListener(APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, handleLocalRowsUpdated as EventListener);

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener(APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, handleLocalRowsUpdated as EventListener);
    };
  }, [finalPagesDocIds, loadInputs, runtimeEffectsActive]);

  const viewModel = useMemo(() => buildFinalPagesViewModel(inputs ?? EMPTY_INPUTS), [inputs]);
  const { rows, summary } = viewModel;

  const handleExport = useCallback(() => {
    if (rows.length === 0) return;
    const escapeCsv = (value: string) => {
      const normalized = value ?? '';
      if (/[",\n\r]/.test(normalized)) {
        return `"${normalized.replace(/"/g, '""')}"`;
      }
      return normalized;
    };
    const header = ['#', ...FINAL_PAGES_TABLE_COLUMNS.map((column) => column.label)].map(escapeCsv).join(',');
    const body = rows.map((row, index) =>
      [String(index + 1), ...FINAL_PAGES_TABLE_COLUMNS.map((column) => row[column.key] ?? '')]
        .map(escapeCsv)
        .join(','),
    );
    const csv = [header, ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `final-pages-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  const handleSourceSelect = useCallback((subtab: ContentSubtabId) => {
    if (onSourceSelect) {
      onSourceSelect(subtab);
      return;
    }
    const nextUrl = buildSubtabPath(subtab);
    window.history.pushState(
      buildContentHistoryState({ subtab, panel: 'table' }, window.history.state),
      '',
      nextUrl,
    );
  }, [onSourceSelect]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <FileSpreadsheet className="h-4 w-4 text-zinc-500" />
          <span>Final Pages</span>
        </div>
        <div className="mt-1 text-sm text-zinc-500">Loading final page rows...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
        <div className="text-sm font-medium text-amber-900">Final Pages unavailable</div>
        <div className="mt-1 text-sm text-amber-800">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm" data-testid="final-pages-panel">
      <div className="border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <FileSpreadsheet className="h-4 w-4 text-zinc-500" />
              <span>Final Pages</span>
            </div>
            <p className="mt-0.5 text-[12px] text-zinc-500">
              Final assembled page rows update automatically from the current content pipeline.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={rows.length === 0}
            data-testid="final-pages-export"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-zinc-500">
          No active page rows found yet. Generate page names first to populate this table.
        </div>
      ) : (
        <div>
          <div className="border-b border-zinc-100 px-4 py-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">Total Pages</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-900">{summary.totalPages}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-emerald-700">Ready</div>
                <div className="mt-1 flex items-center gap-2 text-2xl font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{summary.readyCount}</span>
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-amber-700">Needs Review</div>
                <div className="mt-1 flex items-center gap-2 text-2xl font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>{summary.needsReviewCount}</span>
                </div>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-sky-700">Completion %</div>
                <div className="mt-1 text-2xl font-semibold text-sky-900">{summary.completionPercent}%</div>
              </div>
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-violet-700">Last Updated</div>
                <div className="mt-1 text-sm font-medium text-violet-900">{formatLastUpdated(summary.lastUpdatedAt)}</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
                {summary.rowsMissingRequiredFields} rows missing required fields
              </span>
            </div>
          </div>

          <div className="overflow-auto max-h-[75vh]" style={SHARED_SCROLL_CONTAINER_STYLE}>
            <table className="w-full table-fixed text-left text-xs" data-testid="final-pages-table">
              <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                <tr className="border-b border-zinc-200">
                  <th className={`${CELL.headerBase} ${CELL.headerCompact} w-[36px] font-medium text-zinc-500`}>
                    #
                  </th>
                  {FINAL_PAGES_TABLE_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={`${CELL.headerBase} ${CELL.headerNormal} ${column.width} font-medium text-zinc-500`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSourceSelect(getColumnSourceSubtab(column.key))}
                        data-testid={`final-pages-source-${column.key}`}
                        className="inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-800"
                        title={`Open ${column.label} source tab`}
                      >
                        <span>{column.label}</span>
                        <ExternalLink className="h-3 w-3 text-zinc-350" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={TABLE_TBODY_ZEBRA_CLASS}>
                {rows.map((row, index) => (
                  <tr key={row.id} className="h-[58px] align-top" data-testid={`final-pages-row-${row.id}`}>
                    <td className={`${CELL.dataCompact} w-[36px] align-top text-zinc-400`}>
                      {index + 1}
                    </td>
                    {FINAL_PAGES_TABLE_COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className={`${CELL.dataNormal} ${column.width} align-top text-zinc-700`}
                      >
                        <div className={FINAL_PAGES_CELL_FRAME_CLASS}>
                          {String(row[column.key] ?? '') || <span className="text-zinc-300">-</span>}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
