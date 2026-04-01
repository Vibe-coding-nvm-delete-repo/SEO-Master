import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocMock } = vi.hoisted(() => ({ getDocMock: vi.fn() }));

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: (...args: unknown[]) => getDocMock(...args),
}));

import {
  buildH2ExplodedRowsFromPageRows,
  deriveH2RowId,
  formatH2ListForQa,
  formatH2QaFlags,
  loadGeneratePrimaryPrompt,
  mergeDerivedWithPersistedRows,
  mergeH2RowsWithRatingScores,
  normalizeH2LookupKey,
  parseH2QaJsonOutput,
  parseGuidelinesJson,
  parseH2ItemsFromOutput,
  parseH2NamesFromOutput,
  parseStrictPageGuidelinesJsonOutput,
  parseStrictH2NamesJsonOutput,
  resolveH2ContentPromptTemplate,
  type PageNamesSourceRow,
} from './contentPipelineH2';

describe('parseH2NamesFromOutput', () => {
  it('parses bullet lines and strips rank suffixes', () => {
    const raw = `• First H2
- Second H2 - 1
* Third H2
Cross-check: ignored`;
    expect(parseH2NamesFromOutput(raw)).toEqual(['First H2', 'Second H2', 'Third H2']);
  });

  it('parses numbered lines', () => {
    const raw = `1. First H2
2) Second H2
3 - Third H2`;
    expect(parseH2NamesFromOutput(raw)).toEqual(['First H2', 'Second H2', 'Third H2']);
  });

  it('parses JSON array with explicit order', () => {
    const raw = JSON.stringify([
      { order: 3, h2: 'Third H2' },
      { order: 7, h2: 'Seventh H2' },
    ]);
    expect(parseH2ItemsFromOutput(raw)).toEqual([
      { order: 3, h2Name: 'Third H2' },
      { order: 7, h2Name: 'Seventh H2' },
    ]);
  });

  it('returns empty for blank output', () => {
    expect(parseH2NamesFromOutput('')).toEqual([]);
  });

  it('parses strict JSON object with h2s array', () => {
    const raw = JSON.stringify({
      h2s: [
        { order: 1, h2: 'First H2' },
        { order: 2, h2: 'Second H2' },
      ],
    });
    expect(parseH2ItemsFromOutput(raw)).toEqual([
      { order: 1, h2Name: 'First H2' },
      { order: 2, h2Name: 'Second H2' },
    ]);
  });

  it('does not fall back to line parsing when JSON object parsing succeeds but yields no H2s', () => {
    expect(parseH2ItemsFromOutput('{"h2s":[]}')).toEqual([]);
  });
});

describe('parseStrictH2NamesJsonOutput', () => {
  const valid = JSON.stringify({
    h2s: [
      { order: 1, h2: 'First H2' },
      { order: 2, h2: 'Second H2' },
      { order: 3, h2: 'Third H2' },
      { order: 4, h2: 'Fourth H2' },
      { order: 5, h2: 'Fifth H2' },
      { order: 6, h2: 'Sixth H2' },
      { order: 7, h2: 'Seventh H2' },
    ],
  });

  it('passes valid canonical JSON and normalizes output', () => {
    const parsed = parseStrictH2NamesJsonOutput(valid);
    expect(parsed.items).toHaveLength(7);
    expect(parsed.json.h2s[0]).toEqual({ order: 1, h2: 'First H2' });
    expect(parsed.normalizedOutput).toContain('"h2s"');
  });

  it('fails when root is not an object', () => {
    expect(() => parseStrictH2NamesJsonOutput('[]')).toThrow('must be a single object');
  });

  it('fails when h2s is missing', () => {
    expect(() => parseStrictH2NamesJsonOutput('{}')).toThrow('top-level key');
  });

  it('fails on invalid order type', () => {
    const raw = JSON.stringify({
      h2s: [
        { order: '1', h2: 'First H2' },
        { order: 2, h2: 'Second H2' },
        { order: 3, h2: 'Third H2' },
        { order: 4, h2: 'Fourth H2' },
        { order: 5, h2: 'Fifth H2' },
        { order: 6, h2: 'Sixth H2' },
        { order: 7, h2: 'Seventh H2' },
      ],
    });
    expect(() => parseStrictH2NamesJsonOutput(raw)).toThrow('invalid "order"');
  });

  it('fails on empty h2', () => {
    const raw = JSON.stringify({
      h2s: [
        { order: 1, h2: 'First H2' },
        { order: 2, h2: '' },
        { order: 3, h2: 'Third H2' },
        { order: 4, h2: 'Fourth H2' },
        { order: 5, h2: 'Fifth H2' },
        { order: 6, h2: 'Sixth H2' },
        { order: 7, h2: 'Seventh H2' },
      ],
    });
    expect(() => parseStrictH2NamesJsonOutput(raw)).toThrow('empty "h2"');
  });

  it('fails on non-sequential orders', () => {
    const raw = JSON.stringify({
      h2s: [
        { order: 1, h2: 'First H2' },
        { order: 3, h2: 'Second H2' },
        { order: 4, h2: 'Third H2' },
        { order: 5, h2: 'Fourth H2' },
        { order: 6, h2: 'Fifth H2' },
        { order: 7, h2: 'Sixth H2' },
        { order: 8, h2: 'Seventh H2' },
      ],
    });
    expect(() => parseStrictH2NamesJsonOutput(raw)).toThrow('increase by 1');
  });

  it('fails on duplicate H2s', () => {
    const raw = JSON.stringify({
      h2s: [
        { order: 1, h2: 'First H2' },
        { order: 2, h2: 'First H2' },
        { order: 3, h2: 'Third H2' },
        { order: 4, h2: 'Fourth H2' },
        { order: 5, h2: 'Fifth H2' },
        { order: 6, h2: 'Sixth H2' },
        { order: 7, h2: 'Seventh H2' },
      ],
    });
    expect(() => parseStrictH2NamesJsonOutput(raw)).toThrow('duplicate H2');
  });

  it('fails when under 7 entries', () => {
    const raw = JSON.stringify({
      h2s: Array.from({ length: 6 }, (_, index) => ({ order: index + 1, h2: `H2 ${index + 1}` })),
    });
    expect(() => parseStrictH2NamesJsonOutput(raw)).toThrow('between 7 and 11');
  });

  it('fails when over 11 entries', () => {
    const raw = JSON.stringify({
      h2s: Array.from({ length: 12 }, (_, index) => ({ order: index + 1, h2: `H2 ${index + 1}` })),
    });
    expect(() => parseStrictH2NamesJsonOutput(raw)).toThrow('between 7 and 11');
  });
});

describe('parseH2QaJsonOutput', () => {
  it('passes a rating 4 response with no flags', () => {
    const parsed = parseH2QaJsonOutput(JSON.stringify({ rating: 4, flaggedH2s: [] }));
    expect(parsed.json).toEqual({ rating: 4, flaggedH2s: [] });
  });

  it('passes a low rating with flagged H2s', () => {
    const parsed = parseH2QaJsonOutput(JSON.stringify({
      rating: 3,
      flaggedH2s: [{ h2: 'Bad H2', reason: 'Too broad for the keyword.' }],
    }));
    expect(parsed.json.rating).toBe(3);
    expect(parsed.json.flaggedH2s[0].h2).toBe('Bad H2');
  });

  it('fails when rating is outside 1-4', () => {
    expect(() => parseH2QaJsonOutput(JSON.stringify({ rating: 5, flaggedH2s: [] }))).toThrow('integer from 1 to 4');
  });

  it('fails when low ratings omit flags', () => {
    expect(() => parseH2QaJsonOutput(JSON.stringify({ rating: 2, flaggedH2s: [] }))).toThrow('one or more flagged H2s');
  });

  it('fails when flagged items are missing h2 or reason', () => {
    expect(() => parseH2QaJsonOutput(JSON.stringify({
      rating: 2,
      flaggedH2s: [{ h2: 'Bad H2' }],
    }))).toThrow('must contain exactly the keys "h2" and "reason"');
  });
});

describe('H2 QA formatting helpers', () => {
  it('formats H2 lists for QA prompts', () => {
    expect(formatH2ListForQa([
      { order: 2, h2Name: 'Second' },
      { order: 1, h2Name: 'First' },
    ])).toBe('1. First\n2. Second');
  });

  it('formats flagged H2 metadata into readable text', () => {
    expect(formatH2QaFlags([
      { h2: 'One', reason: 'Reason one.' },
      { h2: 'Two', reason: 'Reason two.' },
    ])).toBe('One: Reason one.\nTwo: Reason two.');
  });
});

describe('parseGuidelinesJson', () => {
  it('parses JSON array and lowercases h2 keys', () => {
    const json = `[{"h2":"Hello There","guidelines":"g1","formatting":"f1"}]`;
    const map = parseGuidelinesJson(json);
    expect(map.get('hello there')).toEqual({ guidelines: 'g1', formatting: 'f1' });
  });

  it('parses strict JSON object with guidelines array', () => {
    const json = JSON.stringify({
      guidelines: [{ h2: 'Hello There', guidelines: 'g1', formatting: 'f1' }],
    });
    const map = parseGuidelinesJson(json);
    expect(map.get('hello there')).toEqual({ guidelines: 'g1', formatting: 'f1' });
  });

  it('matches numbered guideline h2 keys against plain h2 names', () => {
    const json = `[{"h2":"1. Hello There","guidelines":"g1","formatting":"f1"}]`;
    const map = parseGuidelinesJson(json);
    expect(map.get('hello there')).toEqual({ guidelines: 'g1', formatting: 'f1' });
  });

  it('sanitizes legacy table formatting recommendations', () => {
    const json = `[{"h2":"Hello There","guidelines":"g1","formatting":"comparison table with 3 rows"}]`;
    const map = parseGuidelinesJson(json);
    expect(map.get('hello there')).toEqual({
      guidelines: 'g1',
      formatting: 'Use concise paragraphs, bullet lists, or numbered steps for structured details.',
    });
  });

  it('normalizes lookup key', () => {
    expect(normalizeH2LookupKey('2. How It Works')).toBe('how it works');
  });
});

describe('parseStrictPageGuidelinesJsonOutput', () => {
  const expectedH2s = ['First H2', 'Second H2', 'Third H2'];

  const valid = JSON.stringify({
    guidelines: [
      { h2: 'First H2', guidelines: 'Keep terms consistent.', formatting: '2 short paragraphs only' },
      { h2: 'Second H2', guidelines: 'Avoid contradictions.', formatting: 'Single paragraph + bullet list' },
      { h2: 'Third H2', guidelines: 'Qualify claims carefully.', formatting: 'Bullet list only (3-5 items)' },
    ],
  });

  it('passes valid canonical JSON and preserves order', () => {
    const parsed = parseStrictPageGuidelinesJsonOutput(valid, expectedH2s);
    expect(parsed.json.guidelines).toHaveLength(3);
    expect(parsed.json.guidelines[1].h2).toBe('Second H2');
    expect(parsed.normalizedOutput).toContain('"guidelines"');
  });

  it('fails when root is not an object', () => {
    expect(() => parseStrictPageGuidelinesJsonOutput('[]', expectedH2s)).toThrow('must be a single object');
  });

  it('fails when top-level key is missing', () => {
    expect(() => parseStrictPageGuidelinesJsonOutput('{}', expectedH2s)).toThrow('top-level key');
  });

  it('fails when guideline entries do not match expected H2 count', () => {
    const raw = JSON.stringify({
      guidelines: [{ h2: 'First H2', guidelines: 'Keep terms consistent.', formatting: '2 short paragraphs only' }],
    });
    expect(() => parseStrictPageGuidelinesJsonOutput(raw, expectedH2s)).toThrow('exactly 3 guideline entries');
  });

  it('fails when guideline keys are missing', () => {
    const raw = JSON.stringify({
      guidelines: [
        { h2: 'First H2', guidelines: 'Keep terms consistent.' },
        { h2: 'Second H2', guidelines: 'Avoid contradictions.', formatting: 'Single paragraph + bullet list' },
        { h2: 'Third H2', guidelines: 'Qualify claims carefully.', formatting: 'Bullet list only (3-5 items)' },
      ],
    });
    expect(() => parseStrictPageGuidelinesJsonOutput(raw, expectedH2s)).toThrow('exactly the keys "h2", "guidelines", and "formatting"');
  });

  it('fails when H2 order does not match expected H2 order', () => {
    const raw = JSON.stringify({
      guidelines: [
        { h2: 'Second H2', guidelines: 'Keep terms consistent.', formatting: '2 short paragraphs only' },
        { h2: 'First H2', guidelines: 'Avoid contradictions.', formatting: 'Single paragraph + bullet list' },
        { h2: 'Third H2', guidelines: 'Qualify claims carefully.', formatting: 'Bullet list only (3-5 items)' },
      ],
    });
    expect(() => parseStrictPageGuidelinesJsonOutput(raw, expectedH2s)).toThrow('must match H2 "First H2"');
  });

  it('fails on duplicate H2 guideline entries', () => {
    const raw = JSON.stringify({
      guidelines: [
        { h2: 'First H2', guidelines: 'Keep terms consistent.', formatting: '2 short paragraphs only' },
        { h2: 'First H2', guidelines: 'Avoid contradictions.', formatting: 'Single paragraph + bullet list' },
        { h2: 'Third H2', guidelines: 'Qualify claims carefully.', formatting: 'Bullet list only (3-5 items)' },
      ],
    });
    expect(() => parseStrictPageGuidelinesJsonOutput(raw, ['First H2', 'First H2', 'Third H2'])).toThrow('duplicate H2 guideline entry');
  });

  it('fails when formatting recommends a table', () => {
    const raw = JSON.stringify({
      guidelines: [
        { h2: 'First H2', guidelines: 'Keep terms consistent.', formatting: 'Comparison table with 3 rows' },
        { h2: 'Second H2', guidelines: 'Avoid contradictions.', formatting: 'Single paragraph + bullet list' },
        { h2: 'Third H2', guidelines: 'Qualify claims carefully.', formatting: 'Bullet list only (3-5 items)' },
      ],
    });
    expect(() => parseStrictPageGuidelinesJsonOutput(raw, expectedH2s)).toThrow('must not recommend tables or tabular layouts');
  });
});

describe('deriveH2RowId', () => {
  it('creates stable ids from source row + order + name', () => {
    expect(deriveH2RowId('row_5', 2, 'How It Works')).toBe('h2_row_5_2_how-it-works');
  });
});

describe('buildH2ExplodedRowsFromPageRows', () => {
  const template = 'P:{PAGE_NAME} H:{H2_NAME} ALL:{ALL_H2S} G:{CONTENT_GUIDELINES}';

  it('builds stable derived rows', () => {
    const rows: PageNamesSourceRow[] = [
      {
        id: 'source_1',
        status: 'generated',
        input: 'kw',
        output: 'My Page Title',
        slots: {
          h2names: { status: 'generated', input: '', output: '[{"order":4,"h2":"Fourth H2"},{"order":5,"h2":"Fifth H2"}]' },
          guidelines: {
            status: 'generated',
            input: '',
            output: '[{"h2":"4. Fourth H2","guidelines":"g1","formatting":"f1"},{"h2":"5. Fifth H2","guidelines":"g2","formatting":"f2"}]',
          },
        },
      },
    ];
    const out = buildH2ExplodedRowsFromPageRows(rows, template);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('h2_source_1_4_fourth-h2');
    expect(out[0].metadata.pageName).toBe('My Page Title');
    expect(out[0].metadata.order).toBe('4');
    expect(out[0].metadata.h2Name).toBe('Fourth H2');
    expect(out[0].metadata.contentGuidelines).toContain('g1');
    expect(out[0].input).toContain('P:My Page Title');
    expect(out[0].input).toContain('H:Fourth H2');
    expect(out[0].input).toContain('ALL:4. Fourth H2');
  });

  it('skips rows with empty page name', () => {
    const rows: PageNamesSourceRow[] = [
      { id: 'r1', input: '', output: '   ', slots: { h2names: { status: 'generated', input: '', output: '• A' } } },
    ];
    expect(buildH2ExplodedRowsFromPageRows(rows, template)).toHaveLength(0);
  });

  it('ignores stale page or H2 slot output unless the upstream state is generated', () => {
    const rows: PageNamesSourceRow[] = [
      {
        id: 'stale_page',
        status: 'pending',
        input: 'kw',
        output: 'Old Page Title',
        slots: {
          h2names: { status: 'generated', input: '', output: '[{"order":1,"h2":"Old H2"}]' },
          guidelines: { status: 'generated', input: '', output: '{"guidelines":[{"h2":"Old H2","guidelines":"old","formatting":"old"}]}' },
        },
      },
      {
        id: 'stale_h2',
        status: 'generated',
        input: 'kw',
        output: 'Fresh Page Title',
        slots: {
          h2names: { status: 'pending', input: '', output: '[{"order":1,"h2":"Stale H2"}]' },
          guidelines: { status: 'generated', input: '', output: '{"guidelines":[{"h2":"Stale H2","guidelines":"old","formatting":"old"}]}' },
        },
      },
    ];

    expect(buildH2ExplodedRowsFromPageRows(rows, template)).toEqual([]);
  });

  it('re-derives row identities when the upstream h2 list changes', () => {
    const rows: PageNamesSourceRow[] = [
      {
        id: 'source_1',
        status: 'generated',
        input: 'kw',
        output: 'My Page Title',
        slots: {
          h2names: {
            status: 'generated',
            input: '',
            output: JSON.stringify([
              { order: 1, h2: 'Updated First H2' },
              { order: 2, h2: 'Updated Second H2' },
            ]),
          },
          guidelines: {
            status: 'generated',
            input: '',
            output: JSON.stringify({
              guidelines: [
                { h2: 'Updated First H2', guidelines: 'g1', formatting: 'f1' },
                { h2: 'Updated Second H2', guidelines: 'g2', formatting: 'f2' },
              ],
            }),
          },
        },
      },
    ];

    const out = buildH2ExplodedRowsFromPageRows(rows, template);
    expect(out.map((row) => row.id)).toEqual([
      'h2_source_1_1_updated-first-h2',
      'h2_source_1_2_updated-second-h2',
    ]);
    expect(out[0].input).toContain('Updated First H2');
    expect(out[1].input).toContain('Updated Second H2');
  });

  it('does not pass legacy table formatting guidance into H2 body prompts', () => {
    const rows: PageNamesSourceRow[] = [
      {
        id: 'source_legacy',
        status: 'generated',
        input: 'kw',
        output: 'Legacy Page Title',
        slots: {
          h2names: {
            status: 'generated',
            input: '',
            output: JSON.stringify([{ order: 1, h2: 'Compare Options' }]),
          },
          guidelines: {
            status: 'generated',
            input: '',
            output: JSON.stringify({
              guidelines: [
                {
                  h2: 'Compare Options',
                  guidelines: 'Keep comparisons straightforward.',
                  formatting: 'comparison table with 4 rows',
                },
              ],
            }),
          },
        },
      },
    ];

    const out = buildH2ExplodedRowsFromPageRows(rows, template);
    expect(out).toHaveLength(1);
    expect(out[0].metadata.contentGuidelines).toContain('Keep comparisons straightforward.');
    expect(out[0].metadata.contentGuidelines).not.toMatch(/\btable(?:s)?\b|\btabular\b/i);
    expect(out[0].input).not.toMatch(/\btable(?:s)?\b|\btabular\b/i);
  });
});

describe('mergeDerivedWithPersistedRows', () => {
  it('preserves derived metadata/input but merges saved output state', () => {
    const derived = [
      {
        id: 'h2_source_1_1_intro',
        status: 'pending' as const,
        input: 'derived input',
        output: '',
        metadata: { pageName: 'Page', order: '1', h2Name: 'Intro', contentGuidelines: 'g' },
      },
    ];
    const merged = mergeDerivedWithPersistedRows(derived, [
      {
        id: 'h2_source_1_1_intro',
        status: 'generated',
        input: 'derived input',
        output: 'saved output',
        generatedAt: '2026-03-28T12:00:00.000Z',
      },
    ]);
    expect(merged[0].status).toBe('generated');
    expect(merged[0].input).toBe('derived input');
    expect(merged[0].output).toBe('saved output');
    expect(merged[0].metadata.h2Name).toBe('Intro');
  });

  it('drops stale h2 output when the derived prompt changes', () => {
    const merged = mergeDerivedWithPersistedRows(
      [
        {
          id: 'h2_source_1_1_intro',
          status: 'pending' as const,
          input: 'fresh prompt with new page guide',
          output: '',
          metadata: { pageName: 'Page', order: '1', h2Name: 'Intro', contentGuidelines: 'new guide' },
        },
      ],
      [
        {
          id: 'h2_source_1_1_intro',
          status: 'generated',
          input: 'stale prompt with old guide',
          output: 'old body',
        },
      ],
    );

    expect(merged[0].status).toBe('pending');
    expect(merged[0].output).toBe('');
  });
});

describe('resolveH2ContentPromptTemplate', () => {
  it('uses saved when non-empty', () => {
    expect(resolveH2ContentPromptTemplate('abc', 'fallback')).toBe('abc');
  });

  it('uses fallback when saved is whitespace', () => {
    expect(resolveH2ContentPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('uses fallback when undefined', () => {
    expect(resolveH2ContentPromptTemplate(undefined, 'fallback')).toBe('fallback');
  });
});

describe('mergeH2RowsWithRatingScores', () => {
  it('adds rating score metadata only for generated rows with content', () => {
    const merged = mergeH2RowsWithRatingScores([
      {
        id: 'h2_source_1_1_intro',
        status: 'generated',
        input: 'prompt',
        output: '<answer>Body</answer>',
        metadata: { pageName: 'Page', order: '1', h2Name: 'Intro', contentGuidelines: 'g' },
      },
      {
        id: 'h2_source_1_2_next',
        status: 'pending',
        input: 'prompt',
        output: '',
        metadata: { pageName: 'Page', order: '2', h2Name: 'Next', contentGuidelines: 'g', ratingScore: '4' },
      },
    ], [
      {
        id: 'rating_h2_source_1_1_intro',
        metadata: { h2ContentRowId: 'h2_source_1_1_intro', ratingScore: '2' },
      },
      {
        id: 'rating_h2_source_1_2_next',
        metadata: { h2ContentRowId: 'h2_source_1_2_next', ratingScore: '4' },
      },
    ]);

    expect(merged[0].metadata.ratingScore).toBe('2');
    expect(merged[1].metadata.ratingScore).toBeUndefined();
  });
});

describe('loadGeneratePrimaryPrompt', () => {
  beforeEach(() => {
    getDocMock.mockReset();
  });

  it('returns trimmed prompt from Firestore doc', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ prompt: '  hello  ' }),
    });
    await expect(loadGeneratePrimaryPrompt('generate_settings_h2_content')).resolves.toBe('hello');
  });

  it('returns undefined when doc missing', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await expect(loadGeneratePrimaryPrompt('generate_settings_h2_content')).resolves.toBeUndefined();
  });
});
