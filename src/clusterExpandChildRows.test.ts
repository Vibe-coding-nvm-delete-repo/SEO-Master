import { describe, expect, it } from 'vitest';
import {
  groupedTabChildCity,
  groupedTabChildRowKey,
  groupedTabChildState,
  kdCellDisplay,
  keywordLenForCell,
  pagesTabChildCity,
  pagesTabChildRowKey,
  pagesTabChildState,
  volumeCellDisplay,
} from './clusterExpandChildRows';

describe('clusterExpandChildRows', () => {
  describe('pagesTabChildRowKey', () => {
    it('includes index so duplicate keyword strings stay unique', () => {
      const k = 'title loans';
      expect(pagesTabChildRowKey('page', 0, k)).not.toBe(pagesTabChildRowKey('page', 1, k));
    });

    it('changes when page name changes', () => {
      expect(pagesTabChildRowKey('a', 0, 'x')).not.toBe(pagesTabChildRowKey('b', 0, 'x'));
    });
  });

  describe('groupedTabChildRowKey', () => {
    it('scopes keys by subId', () => {
      expect(groupedTabChildRowKey('g-1', 0, 'kw')).not.toBe(groupedTabChildRowKey('g-2', 0, 'kw'));
    });
  });

  describe('keywordLenForCell', () => {
    it('returns string length including spaces', () => {
      expect(keywordLenForCell('a b')).toBe(3);
    });

    it('handles empty keyword', () => {
      expect(keywordLenForCell('')).toBe(0);
    });
  });

  describe('kdCellDisplay', () => {
    it('renders dash for null KD', () => {
      expect(kdCellDisplay(null)).toBe('-');
    });

    it('preserves zero KD', () => {
      expect(kdCellDisplay(0)).toBe(0);
    });
  });

  describe('volumeCellDisplay', () => {
    it('matches Number.toLocaleString for consistency with table cells', () => {
      const n = 25_000;
      expect(volumeCellDisplay(n)).toBe(n.toLocaleString());
    });
  });

  const kw = (over: Partial<{ keyword: string; volume: number; kd: number | null; locationCity: string | null; locationState: string | null }> = {}) => ({
    keyword: 'x',
    volume: 1,
    kd: null,
    locationCity: null,
    locationState: null,
    ...over,
  });

  describe('pagesTabChildCity / pagesTabChildState', () => {
    it('prefers keyword-level location over parent', () => {
      expect(pagesTabChildCity(kw({ locationCity: 'Austin' }), { locationCity: 'Dallas' })).toBe('Austin');
      expect(pagesTabChildState(kw({ locationState: 'TX' }), { locationState: 'OK' })).toBe('TX');
    });

    it('falls back to parent then dash', () => {
      expect(pagesTabChildCity(kw(), { locationCity: 'Dallas' })).toBe('Dallas');
      expect(pagesTabChildCity(kw(), { locationCity: null })).toBe('-');
    });
  });

  describe('groupedTabChildCity / groupedTabChildState', () => {
    it('matches pages-tab semantics with cluster as parent', () => {
      expect(groupedTabChildCity(kw(), { locationCity: 'Houston' })).toBe('Houston');
      expect(groupedTabChildState(kw({ locationState: 'CA' }), { locationState: 'NY' })).toBe('CA');
    });
  });
});
