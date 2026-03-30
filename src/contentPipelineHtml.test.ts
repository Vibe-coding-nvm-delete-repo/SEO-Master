import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(),
}));

import {
  ACCEPTABLE_H2_RATINGS,
  H2_HTML_LOCK_REASON_KEY,
  H2_HTML_VALIDATION_STATUS_KEY,
  appendHtmlValidationFeedback,
  applyHtmlValidationFeedbackToInputs,
  buildHtmlRowsFromSource,
  mergeDerivedWithPersistedHtmlRows,
  resolveHtmlPromptTemplate,
  validateGeneratedHtmlOutput,
} from './contentPipelineHtml';

describe('contentPipelineHtml', () => {
  it('marks only ratings 1, 2, and 5 as acceptable', () => {
    expect(ACCEPTABLE_H2_RATINGS.has('1')).toBe(true);
    expect(ACCEPTABLE_H2_RATINGS.has('2')).toBe(true);
    expect(ACCEPTABLE_H2_RATINGS.has('5')).toBe(true);
    expect(ACCEPTABLE_H2_RATINGS.has('3')).toBe(false);
    expect(ACCEPTABLE_H2_RATINGS.has('4')).toBe(false);
  });

  it('builds runnable rows for accepted ratings and locked rows for bad ratings', () => {
    const rows = buildHtmlRowsFromSource(
      [
        { id: 'h2_1', status: 'generated', output: '<answer>Alpha body</answer>', metadata: { pageName: 'Page A', order: '1', h2Name: 'Alpha', contentGuidelines: 'Guide A', sourceRowId: 'page-a' } },
        { id: 'h2_2', status: 'generated', output: '<answer>Beta body</answer>', metadata: { pageName: 'Page B', order: '2', h2Name: 'Beta', contentGuidelines: 'Guide B', sourceRowId: 'page-b' } },
      ],
      [
        { id: 'rating_1', metadata: { h2ContentRowId: 'h2_1', ratingScore: '2' } },
        { id: 'rating_2', metadata: { h2ContentRowId: 'h2_2', ratingScore: '4' } },
      ],
      'Page:{PAGE_NAME} H2:{H2_NAME} Body:{H2_CONTENT}',
    );

    expect(rows[0].input).toContain('Alpha body');
    expect(rows[0].metadata[H2_HTML_LOCK_REASON_KEY]).toBeUndefined();
    expect(rows[0].metadata.order).toBe('1');
    expect(rows[0].metadata.contentGuidelines).toBe('Guide A');
    expect(rows[1].input).toBe('');
    expect(rows[1].metadata[H2_HTML_LOCK_REASON_KEY]).toContain('rated 4');
  });

  it('skips html rows that lost the required canonical h2 context', () => {
    const rows = buildHtmlRowsFromSource(
      [{ id: 'h2_1', status: 'generated', output: '<answer>Alpha body</answer>', metadata: { pageName: 'Page A', h2Name: 'Alpha' } }],
      [{ id: 'rating_1', metadata: { h2ContentRowId: 'h2_1', ratingScore: '2' } }],
      'Page:{PAGE_NAME} H2:{H2_NAME} Body:{H2_CONTENT}',
    );

    expect(rows).toEqual([]);
  });

  it('drops stale persisted html when source content changes or row becomes locked', () => {
    const derived = buildHtmlRowsFromSource(
      [
        { id: 'h2_1', status: 'generated', output: '<answer>Fresh body</answer>', metadata: { pageName: 'Page A', order: '1', h2Name: 'Alpha', contentGuidelines: 'Guide A', sourceRowId: 'page-a' } },
        { id: 'h2_2', status: 'generated', output: '<answer>Locked body</answer>', metadata: { pageName: 'Page B', order: '2', h2Name: 'Beta', contentGuidelines: 'Guide B', sourceRowId: 'page-b' } },
      ],
      [
        { id: 'rating_1', metadata: { h2ContentRowId: 'h2_1', ratingScore: '1' } },
        { id: 'rating_2', metadata: { h2ContentRowId: 'h2_2', ratingScore: '3' } },
      ],
      '{H2_CONTENT}',
    );

    const merged = mergeDerivedWithPersistedHtmlRows(derived, [
      {
        id: 'html_h2_1',
        status: 'generated',
        input: 'Old body',
        output: '<p>Old html</p>',
        metadata: { h2Content: 'Old body', ratingScore: '1' },
      },
      {
        id: 'html_h2_2',
        status: 'generated',
        input: 'Locked body',
        output: '<p>Should clear</p>',
        metadata: { h2Content: 'Locked body', ratingScore: '1' },
      },
    ]);

    expect(merged[0].output).toBe('');
    expect(merged[1].output).toBe('');
  });

  it('reuses persisted html when source content and rating are unchanged', () => {
    const derived = buildHtmlRowsFromSource(
      [{ id: 'h2_1', status: 'generated', output: '<answer>Stable body</answer>', metadata: { pageName: 'Page A', order: '1', h2Name: 'Alpha', contentGuidelines: 'Guide A', sourceRowId: 'page-a' } }],
      [{ id: 'rating_1', metadata: { h2ContentRowId: 'h2_1', ratingScore: '5' } }],
      '{H2_CONTENT}',
    );

    const merged = mergeDerivedWithPersistedHtmlRows(derived, [
      {
        id: 'html_h2_1',
        status: 'generated',
        input: 'Stable body',
        output: '<p>Stable body</p>',
        metadata: { h2Content: 'Stable body', ratingScore: '5', validationStatus: 'Pass' },
      },
    ]);

    expect(merged[0].status).toBe('generated');
    expect(merged[0].output).toBe('<p>Stable body</p>');
    expect(merged[0].metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Pass');
  });

  it('falls back to the bundled prompt when the saved one is blank', () => {
    expect(resolveHtmlPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('appends prior validator feedback into html prompts', () => {
    const rows = applyHtmlValidationFeedbackToInputs(
      [
        {
          id: 'html_h2_1',
          status: 'pending',
          input: 'Base prompt',
          output: '',
          metadata: {},
        },
      ],
      [
        {
          id: 'html_h2_1',
          status: 'error',
          error: 'Anchor tag is missing href.',
          metadata: { validationStatus: 'Fail' },
        },
      ],
    );

    expect(rows[0].input).toContain('### HTML VALIDATION FEEDBACK');
    expect(rows[0].input).toContain('Anchor tag is missing href.');
  });

  it('still appends a default validation note when there is no prior html error', () => {
    const prompt = appendHtmlValidationFeedback('Base prompt');
    expect(prompt).toContain('Previous validator result: None.');
  });

  it('marks generated html as pass or fail using the html policy validator', () => {
    const pass = validateGeneratedHtmlOutput('<h2>Heading</h2><p>Valid body.</p>');
    expect(pass.metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Pass');
    expect(pass.validationError).toBeUndefined();

    const fail = validateGeneratedHtmlOutput('<h4>bad</h4>');
    expect(fail.metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Fail');
    expect(fail.validationError).toContain('Forbidden tag');
  });

  it('surfaces missing href anchors as the first validation error', () => {
    const fail = validateGeneratedHtmlOutput('<p>Read <a>this guide</a> first.</p>');
    expect(fail.metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Fail');
    expect(fail.validationError).toBe('Anchor tag is missing href.');
  });
});
