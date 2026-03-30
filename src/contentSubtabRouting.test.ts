import { describe, expect, it } from 'vitest';
import {
  buildContentHistoryState,
  buildContentPathForRoute,
  buildContentSearchForRoute,
  buildContentSearchForSubtab,
  mapContentSubtabToViewState,
  mapOverviewStageIdToContentSubtab,
  mapViewStateToContentSubtab,
  parseContentRouteFromHistoryState,
  parseContentRouteFromSearch,
  parseContentSubtabFromSearch,
} from './contentSubtabRouting';

describe('contentSubtabRouting', () => {
  it('parses valid subtabs from the content search string', () => {
    expect(parseContentSubtabFromSearch('?subtab=pages')).toBe('pages');
    expect(parseContentSubtabFromSearch('?subtab=h2-qa')).toBe('h2-qa');
    expect(parseContentSubtabFromSearch('?subtab=h2-body-html')).toBe('h2-body-html');
    expect(parseContentSubtabFromSearch('?subtab=final-pages')).toBe('final-pages');
  });

  it('falls back to overview for invalid or missing subtabs', () => {
    expect(parseContentSubtabFromSearch('')).toBe('overview');
    expect(parseContentSubtabFromSearch('?subtab=unknown')).toBe('overview');
  });

  it('parses route state with a first-class content panel', () => {
    expect(parseContentRouteFromSearch('?subtab=pages&panel=log')).toEqual({ subtab: 'pages', panel: 'log' });
    expect(parseContentRouteFromSearch('?subtab=pages&panel=unknown')).toEqual({ subtab: 'pages', panel: 'table' });
  });

  it('builds content search params without leaking the default overview subtab', () => {
    expect(buildContentSearchForSubtab('overview')).toBe('');
    expect(buildContentSearchForSubtab('pages')).toBe('?subtab=pages');
    expect(buildContentSearchForSubtab('page-guide', '?foo=1')).toBe('?foo=1&subtab=page-guide');
  });

  it('builds content search params for route-aware log state', () => {
    expect(buildContentSearchForRoute({ subtab: 'pages', panel: 'log' })).toBe('?subtab=pages&panel=log');
    expect(buildContentSearchForRoute({ subtab: 'overview', panel: 'table' }, '?foo=1')).toBe('?foo=1');
  });

  it('maps user-facing subtabs to internal content views', () => {
    expect(mapContentSubtabToViewState('pages')).toEqual({ externalView: null, pagesTableView: 'primary' });
    expect(mapContentSubtabToViewState('h2s')).toEqual({ externalView: null, pagesTableView: 'h2names' });
    expect(mapContentSubtabToViewState('h2-qa')).toEqual({ externalView: null, pagesTableView: 'h2qa' });
    expect(mapContentSubtabToViewState('page-guide')).toEqual({ externalView: null, pagesTableView: 'guidelines' });
    expect(mapContentSubtabToViewState('h2-body')).toEqual({ externalView: 'h2-content', pagesTableView: 'primary' });
  });

  it('maps internal content views back to user-facing subtabs', () => {
    expect(mapViewStateToContentSubtab({ externalView: 'overview', pagesTableView: 'primary' })).toBe('overview');
    expect(mapViewStateToContentSubtab({ externalView: null, pagesTableView: 'h2names' })).toBe('h2s');
    expect(mapViewStateToContentSubtab({ externalView: null, pagesTableView: 'h2qa' })).toBe('h2-qa');
    expect(mapViewStateToContentSubtab({ externalView: null, pagesTableView: 'guidelines' })).toBe('page-guide');
    expect(mapViewStateToContentSubtab({ externalView: 'metas-slug-ctas', pagesTableView: 'primary' })).toBe('metas-slug-ctas');
  });

  it('maps overview stage ids to real content subtabs', () => {
    expect(mapOverviewStageIdToContentSubtab('pages')).toBe('pages');
    expect(mapOverviewStageIdToContentSubtab('h2-html')).toBe('h2-body-html');
    expect(mapOverviewStageIdToContentSubtab('tips-redflags')).toBe('tips-redflags');
  });

  it('round-trips content route state through history state and paths', () => {
    const route = { subtab: 'quick-answer-html' as const, panel: 'log' as const };
    expect(parseContentRouteFromHistoryState(buildContentHistoryState(route, { foo: 'bar' }))).toEqual(route);
    expect(buildContentPathForRoute(route)).toBe('/seo-magic/content?subtab=quick-answer-html&panel=log');
  });
});
