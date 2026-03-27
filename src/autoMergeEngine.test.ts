import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAutoMergeMatches, parseAutoMergeJson, selectAutoMergeTokenRows } from './AutoMergeEngine';
import type { TokenSummary } from './types';

describe('parseAutoMergeJson', () => {
  it('parses valid JSON payload', () => {
    const parsed = parseAutoMergeJson('{"matches":["hvac","h-v-a-c"],"confidence":0.93,"reason":"minor variants"}');
    expect(parsed).toEqual({
      matches: ['hvac', 'h-v-a-c'],
      confidence: 0.93,
      reason: 'minor variants',
    });
  });

  it('extracts JSON from wrapped text', () => {
    const parsed = parseAutoMergeJson('```json\n{"matches":["color"],"confidence":"0.8","reason":"us/uk"}\n```');
    expect(parsed).toEqual({
      matches: ['color'],
      confidence: 0.8,
      reason: 'us/uk',
    });
  });

  it('extracts first valid object when response has preface and trailing object', () => {
    const parsed = parseAutoMergeJson(
      'I will return JSON.\n{"matches":["hvac"],"confidence":0.91,"reason":"same token"}\n{"debug":true}',
    );
    expect(parsed).toEqual({
      matches: ['hvac'],
      confidence: 0.91,
      reason: 'same token',
    });
  });

  it('accepts comma-delimited matches string', () => {
    const parsed = parseAutoMergeJson('{"matches":"hvac, h-v-a-c","confidence":"0.7","reason":"variants"}');
    expect(parsed).toEqual({
      matches: ['hvac', 'h-v-a-c'],
      confidence: 0.7,
      reason: 'variants',
    });
  });

  it('normalizes invalid shapes', () => {
    const parsed = parseAutoMergeJson('{"matches":[1,null,"  term  "],"confidence":9}');
    expect(parsed).toEqual({
      matches: ['term'],
      confidence: 1,
      reason: '',
    });
  });
});

describe('fetchAutoMergeMatches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries when first response is non-JSON and succeeds on next valid JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'not json' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"matches":["hvac"],"confidence":0.9,"reason":"same"}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0002 },
        }),
      });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ac = new AbortController();
    const out = await fetchAutoMergeMatches(
      {
        apiKey: 'sk-test-key-12345',
        model: 'openrouter/test-model',
        fallbackModel: '',
        temperature: 0.2,
        maxTokens: 0,
        reasoningEffort: 'none',
        prompt: 'Return JSON.',
      },
      'hvac',
      ['h-v-a-c'],
      ac.signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.result.matches).toEqual(['hvac']);
    expect(out.result.confidence).toBe(0.9);
  });

  it('includes source and candidate top-page context in request payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"matches":[],"confidence":0.2,"reason":"none"}' } }],
        usage: { prompt_tokens: 9, completion_tokens: 2, cost: 0.0001 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ac = new AbortController();
    await fetchAutoMergeMatches(
      {
        apiKey: 'sk-test-key-12345',
        model: 'openrouter/test-model',
        fallbackModel: '',
        temperature: 0.2,
        maxTokens: 0,
        reasoningEffort: 'none',
        prompt: 'Return JSON.',
      },
      'little',
      ['short'],
      ac.signal,
      {
        sourceTopPages: [{ pageName: 'small loan', keywordCount: 5, totalVolume: 1200, avgKd: 27.5 }],
        candidateTopPagesByToken: {
          short: [{ pageName: 'short loan', keywordCount: 3, totalVolume: 700, avgKd: 22.2 }],
        },
      },
    );

    const req = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(req?.body || '{}')) as { messages?: Array<{ content?: string }> };
    const content = body.messages?.[0]?.content || '';
    expect(content).toContain('SOURCE_TOP_5_PAGES_JSON:');
    expect(content).toContain('"pageName":"small loan"');
    expect(content).toContain('CANDIDATE_TOP_5_PAGES_BY_TOKEN_JSON:');
    expect(content).toContain('"short loan"');
  });
});

describe('selectAutoMergeTokenRows', () => {
  const row = (token: string, frequency: number, totalVolume: number): TokenSummary => ({
    token,
    length: token.length,
    frequency,
    totalVolume,
    avgKd: null,
    label: '',
    labelArr: [],
    locationCity: '',
    locationState: '',
  });

  it('returns all tokens for 100 percent sampling', () => {
    const input = [row('a', 1, 10), row('b', 2, 20), row('c', 3, 30)];
    expect(selectAutoMergeTokenRows(input, 100)).toEqual(input);
  });

  it('caps sample to top 10 percent by frequency/volume', () => {
    const input = [
      row('a', 1, 100),
      row('b', 20, 200),
      row('c', 18, 180),
      row('d', 2, 20),
      row('e', 17, 170),
      row('f', 16, 160),
      row('g', 3, 30),
      row('h', 4, 40),
      row('i', 5, 50),
      row('j', 6, 60),
      row('k', 7, 70),
      row('l', 8, 80),
      row('m', 9, 90),
      row('n', 10, 95),
      row('o', 11, 110),
      row('p', 12, 120),
      row('q', 13, 130),
      row('r', 14, 140),
      row('s', 15, 150),
      row('t', 19, 190),
    ];
    const out = selectAutoMergeTokenRows(input, 10);
    expect(out.length).toBe(2);
    expect(out.map(r => r.token)).toEqual(['b', 't']);
  });

  it('always returns at least two tokens when input has more than two', () => {
    const input = [row('a', 1, 1), row('b', 2, 2), row('c', 3, 3), row('d', 4, 4)];
    const out = selectAutoMergeTokenRows(input, 1);
    expect(out.length).toBe(2);
  });
});
