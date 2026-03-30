import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocMock } = vi.hoisted(() => ({ getDocMock: vi.fn() }));

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: (...args: unknown[]) => getDocMock(...args),
}));

import {
  buildRatingPrompt,
  buildRatingRowsFromH2Rows,
  deriveRatingRowId,
  formatRatingExplanation,
  mergeDerivedWithPersistedRatingRows,
  parseRatingModelOutput,
  parseRatingResponse,
  resolveRatingPromptTemplate,
  stripAnswerWrapper,
  type H2ContentSourceRow,
} from './contentPipelineRating';

describe('stripAnswerWrapper', () => {
  it('removes outer answer tags', () => {
    expect(stripAnswerWrapper('<answer>Hello</answer>')).toBe('Hello');
  });

  it('returns original content when answer tags are absent', () => {
    expect(stripAnswerWrapper('Hello')).toBe('Hello');
  });
});

describe('deriveRatingRowId', () => {
  it('creates stable ids from the upstream h2 row id', () => {
    expect(deriveRatingRowId('h2_source_1_2_how-it-works')).toBe('rating_h2_source_1_2_how-it-works');
  });
});

describe('buildRatingPrompt', () => {
  it('fills all prompt placeholders', () => {
    const prompt = buildRatingPrompt(
      'Target:{FACT_CHECK_TARGET} H2:{H2_NAME} Content:{H2_CONTENT} Page:{PAGE_NAME}',
      {
        factCheckTarget: 'Topic',
        h2Name: 'What Is It?',
        h2Content: 'Body copy',
        pageName: 'Topic',
      },
    );
    expect(prompt).toContain('Target:Topic');
    expect(prompt).toContain('H2:What Is It?');
    expect(prompt).toContain('Content:Body copy');
    expect(prompt).toContain('Page:Topic');
  });
});

describe('buildRatingRowsFromH2Rows', () => {
  const template = 'Target:{FACT_CHECK_TARGET}\nH2:{H2_NAME}\nContent:{H2_CONTENT}';

  it('derives rows only from generated h2 content rows', () => {
    const rows: H2ContentSourceRow[] = [
      {
        id: 'h2_row_1',
        status: 'generated',
        input: 'ignored',
        output: '<answer>Body A</answer>',
        metadata: { pageName: 'Page A', order: '1', h2Name: 'First H2', sourceRowId: 'source_1' },
      },
      {
        id: 'h2_row_2',
        status: 'pending',
        input: 'ignored',
        output: '<answer>Body B</answer>',
        metadata: { pageName: 'Page B', order: '2', h2Name: 'Second H2', sourceRowId: 'source_2' },
      },
    ];

    const derived = buildRatingRowsFromH2Rows(rows, template);
    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe('rating_h2_row_1');
    expect(derived[0].metadata.factCheckTarget).toBe('Page A');
    expect(derived[0].metadata.h2Name).toBe('First H2');
    expect(derived[0].metadata.h2Content).toBe('Body A');
    expect(derived[0].metadata.order).toBe('1');
    expect(derived[0].metadata.sourceRowId).toBe('source_1');
    expect(derived[0].input).toContain('Target:Page A');
    expect(derived[0].input).toContain('H2:First H2');
    expect(derived[0].input).toContain('Content:Body A');
  });

  it('skips rows that lost the required canonical h2 context', () => {
    const derived = buildRatingRowsFromH2Rows([
      {
        id: 'h2_row_1',
        status: 'generated',
        input: 'ignored',
        output: '<answer>Body A</answer>',
        metadata: { pageName: 'Page A', h2Name: 'First H2' },
      },
    ], template);

    expect(derived).toEqual([]);
  });
});

describe('mergeDerivedWithPersistedRatingRows', () => {
  it('merges saved output state without losing derived metadata', () => {
    const derived = [
      {
        id: 'rating_h2_row_1',
        status: 'pending' as const,
        input: 'prompt',
        output: '',
        metadata: {
          factCheckTarget: 'Page A',
          h2Name: 'First H2',
          h2Content: 'Body A',
          pageName: 'Page A',
          order: '1',
          sourceRowId: 'source_1',
          h2ContentRowId: 'h2_row_1',
        },
      },
    ];
    const merged = mergeDerivedWithPersistedRatingRows(derived, [
      {
        id: 'rating_h2_row_1',
        status: 'generated',
        input: 'prompt',
        output: 'saved explanation',
        generatedAt: '2026-03-28T12:00:00.000Z',
        metadata: { ratingScore: '2' },
      },
    ]);

    expect(merged[0].status).toBe('generated');
    expect(merged[0].output).toBe('saved explanation');
    expect(merged[0].metadata.h2Name).toBe('First H2');
    expect(merged[0].metadata.ratingScore).toBe('2');
  });

  it('drops stale rating output when the h2-derived prompt changes', () => {
    const merged = mergeDerivedWithPersistedRatingRows(
      [
        {
          id: 'rating_h2_row_1',
          status: 'pending' as const,
          input: 'prompt with corrected h2 body',
          output: '',
          metadata: {
            factCheckTarget: 'Page A',
            h2Name: 'First H2',
            h2Content: 'Corrected body',
            pageName: 'Page A',
            order: '1',
            sourceRowId: 'source_1',
            h2ContentRowId: 'h2_row_1',
          },
        },
      ],
      [
        {
          id: 'rating_h2_row_1',
          status: 'generated',
          input: 'stale prompt with old h2 body',
          output: 'stale explanation',
          metadata: { ratingScore: '4' },
        },
      ],
    );

    expect(merged[0].status).toBe('pending');
    expect(merged[0].output).toBe('');
    expect(merged[0].metadata.ratingScore).toBeUndefined();
  });
});

describe('parseRatingResponse', () => {
  it('parses valid rating JSON', () => {
    const parsed = parseRatingResponse(JSON.stringify({
      rating: 2,
      majorErrors: 0,
      minorErrors: 2,
      summary: 'Mostly accurate.',
      corrections: 'Tighten the state-law caveat.',
      factuallyIncorrectInfo: [{ incorrect: 'All states require notice in 3 days.', correct: 'Notice periods vary by state.' }],
    }));

    expect(parsed.rating).toBe(2);
    expect(parsed.factuallyIncorrectInfo[0].correct).toContain('vary by state');
  });

  it('rejects malformed JSON', () => {
    expect(() => parseRatingResponse('nope')).toThrow('valid JSON');
  });

  it('rejects missing score', () => {
    expect(() => parseRatingResponse(JSON.stringify({
      majorErrors: 0,
      minorErrors: 1,
      summary: 'x',
      corrections: 'y',
      factuallyIncorrectInfo: [],
    }))).toThrow('rating');
  });

  it('rejects out-of-range score', () => {
    expect(() => parseRatingResponse(JSON.stringify({
      rating: 7,
      majorErrors: 0,
      minorErrors: 0,
      summary: 'x',
      corrections: 'y',
      factuallyIncorrectInfo: [],
    }))).toThrow('1 to 5');
  });
});

describe('formatRatingExplanation', () => {
  it('formats fact issues when provided', () => {
    const formatted = formatRatingExplanation({
      rating: 3,
      majorErrors: 2,
      minorErrors: 1,
      summary: 'Has harmful errors.',
      corrections: 'Fix the venue guidance.',
      factuallyIncorrectInfo: [{ incorrect: 'Use small claims court.', correct: 'Use housing court.' }],
    });

    expect(formatted).toContain('Major Errors: 2');
    expect(formatted).toContain('Correct: Use housing court.');
  });

  it('prints None when no fact issues exist', () => {
    const formatted = formatRatingExplanation({
      rating: 1,
      majorErrors: 0,
      minorErrors: 0,
      summary: 'Accurate.',
      corrections: 'None needed',
      factuallyIncorrectInfo: [],
    });

    expect(formatted).toContain('Factually Incorrect Info: None');
  });
});

describe('parseRatingModelOutput', () => {
  it('maps parsed JSON into explanation text and metadata score', () => {
    const result = parseRatingModelOutput(JSON.stringify({
      rating: 4,
      majorErrors: 4,
      minorErrors: 0,
      summary: 'Dangerous venue guidance.',
      corrections: 'Replace the court guidance and legal-rights summary.',
      factuallyIncorrectInfo: [],
    }));

    expect(result.metadata.ratingScore).toBe('4');
    expect(result.output).toContain('Dangerous venue guidance.');
  });
});

describe('resolveRatingPromptTemplate', () => {
  beforeEach(() => {
    getDocMock.mockReset();
  });

  it('uses saved prompt when present', () => {
    expect(resolveRatingPromptTemplate('abc', 'fallback')).toBe('abc');
  });

  it('falls back on empty prompt', () => {
    expect(resolveRatingPromptTemplate('  ', 'fallback')).toBe('fallback');
  });
});
