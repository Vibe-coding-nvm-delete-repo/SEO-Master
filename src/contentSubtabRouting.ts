import { buildMainPath } from './appRouting';

export type ContentSubtabId =
  | 'overview'
  | 'pages'
  | 'h2s'
  | 'h2-qa'
  | 'page-guide'
  | 'h2-body'
  | 'h2-rate'
  | 'h2-body-html'
  | 'h2-summ'
  | 'h1-body'
  | 'h1-body-html'
  | 'quick-answer'
  | 'quick-answer-html'
  | 'metas-slug-ctas'
  | 'tips-redflags'
  | 'final-pages';

export type ContentPanelId = 'table' | 'log';

export type ContentRouteState = {
  subtab: ContentSubtabId;
  panel: ContentPanelId;
};

const DEFAULT_CONTENT_SUBTAB: ContentSubtabId = 'overview';
const DEFAULT_CONTENT_PANEL: ContentPanelId = 'table';
const CONTENT_ROUTE_STATE_KEY = 'kwgContentRoute';

const VALID_CONTENT_SUBTABS = new Set<ContentSubtabId>([
  'overview',
  'pages',
  'h2s',
  'h2-qa',
  'page-guide',
  'h2-body',
  'h2-rate',
  'h2-body-html',
  'h2-summ',
  'h1-body',
  'h1-body-html',
  'quick-answer',
  'quick-answer-html',
  'metas-slug-ctas',
  'tips-redflags',
  'final-pages',
]);

function normalizeContentSubtab(value: unknown): ContentSubtabId {
  if (typeof value !== 'string') return DEFAULT_CONTENT_SUBTAB;
  const normalized = value.trim().toLowerCase() as ContentSubtabId;
  return VALID_CONTENT_SUBTABS.has(normalized) ? normalized : DEFAULT_CONTENT_SUBTAB;
}

function normalizeContentPanel(value: unknown): ContentPanelId {
  return value === 'log' ? 'log' : DEFAULT_CONTENT_PANEL;
}

export function getDefaultContentRoute(): ContentRouteState {
  return {
    subtab: DEFAULT_CONTENT_SUBTAB,
    panel: DEFAULT_CONTENT_PANEL,
  };
}

export function normalizeContentRoute(route: Partial<ContentRouteState> | null | undefined): ContentRouteState {
  return {
    subtab: normalizeContentSubtab(route?.subtab),
    panel: normalizeContentPanel(route?.panel),
  };
}

export function parseContentSubtabFromSearch(search: string): ContentSubtabId {
  return parseContentRouteFromSearch(search).subtab;
}

export function parseContentRouteFromSearch(search: string): ContentRouteState {
  const params = new URLSearchParams(search);
  return {
    subtab: normalizeContentSubtab(params.get('subtab')),
    panel: normalizeContentPanel(params.get('panel')),
  };
}

export function buildContentSearchForSubtab(subtab: ContentSubtabId, existingSearch = ''): string {
  return buildContentSearchForRoute({ subtab, panel: DEFAULT_CONTENT_PANEL }, existingSearch);
}

export function buildContentSearchForRoute(route: ContentRouteState, existingSearch = ''): string {
  const params = new URLSearchParams(existingSearch);
  if (route.subtab === DEFAULT_CONTENT_SUBTAB) {
    params.delete('subtab');
  } else {
    params.set('subtab', route.subtab);
  }
  if (route.panel === DEFAULT_CONTENT_PANEL) {
    params.delete('panel');
  } else {
    params.set('panel', route.panel);
  }
  const next = params.toString();
  return next ? `?${next}` : '';
}

export function buildContentPathForRoute(route: ContentRouteState): string {
  return `${buildMainPath('content')}${buildContentSearchForRoute(route)}`;
}

export function parseContentRouteFromHistoryState(historyState: unknown): ContentRouteState | null {
  if (!historyState || typeof historyState !== 'object') return null;
  const record = historyState as Record<string, unknown>;
  const route = record[CONTENT_ROUTE_STATE_KEY];
  if (route && typeof route === 'object') {
    return normalizeContentRoute(route as Partial<ContentRouteState>);
  }

  if (typeof record.kwgContentSubtab === 'string' || typeof record.kwgContentPanel === 'string') {
    return normalizeContentRoute({
      subtab: record.kwgContentSubtab as ContentSubtabId | undefined,
      panel: record.kwgContentPanel as ContentPanelId | undefined,
    });
  }

  return null;
}

export function buildContentHistoryState(route: ContentRouteState, existingState: unknown): Record<string, unknown> {
  const base =
    existingState && typeof existingState === 'object'
      ? { ...(existingState as Record<string, unknown>) }
      : {};

  return {
    ...base,
    [CONTENT_ROUTE_STATE_KEY]: route,
    kwgContentSubtab: route.subtab,
    kwgContentPanel: route.panel,
  };
}

export function mapContentSubtabToViewState(subtab: ContentSubtabId): {
  externalView: string | null;
  pagesTableView: 'primary' | string;
} {
  switch (subtab) {
    case 'overview':
      return { externalView: 'overview', pagesTableView: 'primary' };
    case 'pages':
      return { externalView: null, pagesTableView: 'primary' };
    case 'h2s':
      return { externalView: null, pagesTableView: 'h2names' };
    case 'h2-qa':
      return { externalView: null, pagesTableView: 'h2qa' };
    case 'page-guide':
      return { externalView: null, pagesTableView: 'guidelines' };
    case 'h2-body':
      return { externalView: 'h2-content', pagesTableView: 'primary' };
    case 'h2-rate':
      return { externalView: 'rating', pagesTableView: 'primary' };
    case 'h2-body-html':
      return { externalView: 'h2-html', pagesTableView: 'primary' };
    case 'h2-summ':
      return { externalView: 'h2-summary', pagesTableView: 'primary' };
    case 'h1-body':
      return { externalView: 'h1-body', pagesTableView: 'primary' };
    case 'h1-body-html':
      return { externalView: 'h1-html', pagesTableView: 'primary' };
    case 'quick-answer':
      return { externalView: 'quick-answer', pagesTableView: 'primary' };
    case 'quick-answer-html':
      return { externalView: 'quick-answer-html', pagesTableView: 'primary' };
    case 'metas-slug-ctas':
      return { externalView: 'metas-slug-ctas', pagesTableView: 'primary' };
    case 'tips-redflags':
      return { externalView: 'tips-redflags', pagesTableView: 'primary' };
    case 'final-pages':
      return { externalView: 'final-pages', pagesTableView: 'primary' };
  }
}

export function mapViewStateToContentSubtab(args: {
  externalView: string | null;
  pagesTableView: 'primary' | string;
}): ContentSubtabId {
  if (args.externalView === 'overview') return 'overview';
  if (!args.externalView) {
    if (args.pagesTableView === 'h2names') return 'h2s';
    if (args.pagesTableView === 'h2qa') return 'h2-qa';
    if (args.pagesTableView === 'guidelines') return 'page-guide';
    return 'pages';
  }
  switch (args.externalView) {
    case 'h2-content':
      return 'h2-body';
    case 'rating':
      return 'h2-rate';
    case 'h2-html':
      return 'h2-body-html';
    case 'h2-summary':
      return 'h2-summ';
    case 'h1-body':
      return 'h1-body';
    case 'h1-html':
      return 'h1-body-html';
    case 'quick-answer':
      return 'quick-answer';
    case 'quick-answer-html':
      return 'quick-answer-html';
    case 'metas-slug-ctas':
      return 'metas-slug-ctas';
    case 'tips-redflags':
      return 'tips-redflags';
    case 'final-pages':
      return 'final-pages';
    default:
      return DEFAULT_CONTENT_SUBTAB;
  }
}

export function mapOverviewStageIdToContentSubtab(stageId: string): ContentSubtabId {
  switch (stageId) {
    case 'pages':
      return 'pages';
    case 'h2-body':
      return 'h2-body';
    case 'h2-rate':
      return 'h2-rate';
    case 'h2-html':
      return 'h2-body-html';
    case 'h2-summary':
      return 'h2-summ';
    case 'h1-body':
      return 'h1-body';
    case 'h1-html':
      return 'h1-body-html';
    case 'quick-answer':
      return 'quick-answer';
    case 'quick-answer-html':
      return 'quick-answer-html';
    case 'metas-slug-ctas':
      return 'metas-slug-ctas';
    case 'tips-redflags':
      return 'tips-redflags';
    case 'final-pages':
      return 'final-pages';
    default:
      return DEFAULT_CONTENT_SUBTAB;
  }
}
