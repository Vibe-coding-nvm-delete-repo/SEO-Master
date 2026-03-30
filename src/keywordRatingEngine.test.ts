import { describe, it, expect } from 'vitest';
import {
  parseKeywordRatingJson,
  parseCoreIntentSummaryJson,
  buildKeywordLinesForSummary,
  runPool,
  keywordRatingRowKey,
  applyKeywordRatingsToResults,
  countKwRatingBucketsForRows,
  parseOpenRouterUsage,
  addOpenRouterUsage,
  formatKeywordRatingDuration,
} from './KeywordRatingEngine';
import type { ProcessedRow } from './types';

const baseRow = (keyword: string): ProcessedRow => ({
  pageName: keyword,
  pageNameLower: keyword.toLowerCase(),
  pageNameLen: keyword.length,
  tokens: 'a',
  tokenArr: ['a'],
  keyword,
  keywordLower: keyword.toLowerCase(),
  searchVolume: 1,
  kd: null,
  label: '',
  labelArr: [],
  locationCity: null,
  locationState: null,
});

describe('parseKeywordRatingJson', () => {
  it('parses object form', () => {
    expect(parseKeywordRatingJson('{"rating":2}')).toBe(2);
  });
  it('parses string rating', () => {
    expect(parseKeywordRatingJson('{"rating":"3"}')).toBe(3);
  });
  it('extracts JSON from surrounding text', () => {
    expect(parseKeywordRatingJson('here\n{"rating":1}\n')).toBe(1);
  });
  it('returns null for invalid', () => {
    expect(parseKeywordRatingJson('')).toBeNull();
    expect(parseKeywordRatingJson('{"rating":4}')).toBeNull();
    expect(parseKeywordRatingJson('not json')).toBeNull();
  });
});

describe('parseCoreIntentSummaryJson', () => {
  it('parses summary', () => {
    expect(parseCoreIntentSummaryJson('{"summary":"Plumbing services in Austin."}')).toBe(
      'Plumbing services in Austin.',
    );
  });
  it('returns null when missing', () => {
    expect(parseCoreIntentSummaryJson('{}')).toBeNull();
  });
});

describe('buildKeywordLinesForSummary', () => {
  it('joins keywords', () => {
    expect(buildKeywordLinesForSummary([baseRow('a'), baseRow('b')])).toBe('a\nb');
  });
  it('drops empty lines', () => {
    expect(buildKeywordLinesForSummary([baseRow('  x '), baseRow('')])).toBe('x');
  });
});

describe('keywordRatingRowKey + applyKeywordRatingsToResults', () => {
  it('builds stable keys', () => {
    const a = baseRow('foo');
    expect(keywordRatingRowKey(a)).toBe(`${a.pageName}\0${a.keywordLower}`);
  });
  it('merges ratings onto latest base without dropping other rows', () => {
    const r1 = baseRow('k1');
    const r2 = { ...baseRow('k2'), pageName: 'p2', pageNameLower: 'p2', keyword: 'k2', keywordLower: 'k2' };
    const map = new Map<string, 1 | 2 | 3>([[keywordRatingRowKey(r1), 2]]);
    const out = applyKeywordRatingsToResults([r1, r2], map);
    expect(out[0].kwRating).toBe(2);
    expect(out[1].kwRating).toBeUndefined();
  });
});

describe('countKwRatingBucketsForRows', () => {
  it('counts 1/2/3 for the target row set against merged results', () => {
    const t1 = baseRow('a');
    const t2 = { ...baseRow('b'), keyword: 'b', keywordLower: 'b' };
    const merged: ProcessedRow[] = [
      { ...t1, kwRating: 1 },
      { ...t2, kwRating: 3 },
    ];
    expect(countKwRatingBucketsForRows(merged, [t1, t2])).toEqual({ n1: 1, n2: 0, n3: 1 });
  });
});

describe('parseOpenRouterUsage + addOpenRouterUsage', () => {
  it('parses tokens and numeric cost', () => {
    const u = parseOpenRouterUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00012 },
    });
    expect(u).toEqual({ promptTokens: 10, completionTokens: 5, costUsd: 0.00012 });
  });
  it('parses string cost', () => {
    const u = parseOpenRouterUsage({
      usage: { prompt_tokens: 1, completion_tokens: 2, cost: '$0.0042' },
    });
    expect(u.costUsd).toBeCloseTo(0.0042, 6);
  });
  it('returns zeros when usage missing', () => {
    expect(parseOpenRouterUsage({})).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      costUsd: null,
    });
  });
  it('adds usage and sums cost when present', () => {
    const a = addOpenRouterUsage(
      { promptTokens: 1, completionTokens: 2, costUsd: 0.01 },
      { promptTokens: 3, completionTokens: 4, costUsd: 0.02 },
    );
    expect(a).toEqual({ promptTokens: 4, completionTokens: 6, costUsd: 0.03 });
  });
});

describe('formatKeywordRatingDuration', () => {
  it('formats under 1 second as milliseconds', () => {
    expect(formatKeywordRatingDuration(500)).toBe('500ms');
    expect(formatKeywordRatingDuration(999)).toBe('999ms');
  });
  it('formats zero correctly', () => {
    expect(formatKeywordRatingDuration(0)).toBe('0ms');
  });
  it('formats 1 second and above as seconds', () => {
    expect(formatKeywordRatingDuration(1000)).toBe('1.0s');
    expect(formatKeywordRatingDuration(12_340)).toBe('12.3s');
  });
  it('formats exact minutes and above as seconds', () => {
    expect(formatKeywordRatingDuration(60_000)).toBe('60.0s');
    expect(formatKeywordRatingDuration(125_000)).toBe('125.0s');
  });
});

describe('runPool', () => {
  it('returns empty for empty items', async () => {
    const out = await runPool([], 3, async () => 1, new AbortController().signal);
    expect(out).toEqual([]);
  });
  it('runs with bounded concurrency', async () => {
    let peak = 0;
    let running = 0;
    const items = [1, 2, 3, 4, 5];
    const out = await runPool(
      items,
      2,
      async (n) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 5));
        running--;
        return n * 2;
      },
      new AbortController().signal,
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });
});
