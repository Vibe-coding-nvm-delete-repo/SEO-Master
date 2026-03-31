import { describe, expect, it } from 'vitest';
import { escapeJsonFromModelResponse, parseFilteredAutoGroupResponse } from './autoGroupResponseParser';
import type { ClusterSummary } from './types';

const makePage = (pageName: string, tokens: string): ClusterSummary => ({
  pageName,
  pageNameLower: pageName.toLowerCase(),
  pageNameLen: pageName.length,
  tokens,
  tokenArr: tokens.split(' '),
  keywordCount: 1,
  totalVolume: 100,
  avgKd: 10,
  avgKwRating: null,
  label: '',
  labelArr: [],
  locationCity: null,
  locationState: null,
  keywords: [],
});

describe('autoGroupResponseParser', () => {
  it('extracts JSON from fenced code blocks', () => {
    expect(escapeJsonFromModelResponse('```json\n{"groups":[{"pageIds":["P1"]}]}\n```')).toBe('{"groups":[{"pageIds":["P1"]}]}');
  });

  it('resolves groups by page id', () => {
    const pages = [makePage('alpha page', 'alpha'), makePage('beta page', 'beta')];
    const groups = parseFilteredAutoGroupResponse('{"groups":[{"pageIds":["P1","P2"]}]}', pages);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((page) => page.pageName)).toEqual(['alpha page', 'beta page']);
  });

  it('falls back to exact page names when ids are missing', () => {
    const pages = [makePage('alpha page', 'alpha'), makePage('beta page', 'beta')];
    const groups = parseFilteredAutoGroupResponse('{"groups":[{"pages":["beta page"]}]}', pages);
    expect(groups).toHaveLength(1);
    expect(groups[0][0].pageName).toBe('beta page');
  });

  it('supports assignment payloads', () => {
    const pages = [makePage('alpha page', 'alpha'), makePage('beta page', 'beta')];
    const groups = parseFilteredAutoGroupResponse(
      '{"assignments":[{"pageId":"P1","targetGroupName":"core"},{"page":"beta page","targetGroupName":"core"}]}',
      pages,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].map((page) => page.pageName)).toEqual(['alpha page', 'beta page']);
  });
});
