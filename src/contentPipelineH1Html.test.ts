import { describe, expect, it, vi } from 'vitest';

vi.mock('./contentPipelineH2', () => ({
  loadGeneratePrimaryPrompt: vi.fn(),
}));

vi.mock('./contentPipelineH1', () => ({
  H1_BODY_ROWS_DOC_ID: 'generate_rows_h1_body',
}));

vi.mock('./appSettingsDocStore', () => ({
  loadChunkedAppSettingsRows: vi.fn(),
}));

import {
  buildH1HtmlRowsFromSource,
  applyH1HtmlValidationFeedbackToInputs,
  mergeDerivedWithPersistedH1HtmlRows,
  resolveH1HtmlPromptTemplate,
  validateGeneratedHtmlOutput,
} from './contentPipelineH1Html';
import { H2_HTML_VALIDATION_STATUS_KEY } from './contentPipelineHtml';

describe('contentPipelineH1Html', () => {
  it('builds runnable html rows from generated h1 body rows', () => {
    const rows = buildH1HtmlRowsFromSource(
      [
        {
          id: 'h1_page_1',
          status: 'generated',
          output: '<answer>You can fix credit faster when you know what is hurting it.</answer>',
          metadata: {
            pageName: 'How To Fix Credit',
            order: '3',
            h2Name: 'What Hurts Credit\nHow To Improve Credit',
            h2Content: 'A\nB',
            h2Summaries: 'C\nD',
            ratingScore: '2',
            contentGuidelines: 'Keep examples simple.',
            sourceRowId: 'page-1',
          },
        },
      ],
      'Page:{PAGE_NAME}\nBody:{H1_BODY}',
    );

    expect(rows[0].input).toContain('Page:How To Fix Credit');
    expect(rows[0].input).toContain('Body:You can fix credit faster');
    expect(rows[0].metadata.h2Summaries).toContain('C');
    expect(rows[0].metadata.order).toBe('3');
    expect(rows[0].metadata.ratingScore).toBe('2');
    expect(rows[0].metadata.contentGuidelines).toBe('Keep examples simple.');
  });

  it('appends prior validator feedback into h1 html prompts', () => {
    const rows = applyH1HtmlValidationFeedbackToInputs(
      [
        {
          id: 'html_h1_page_1',
          status: 'pending',
          input: 'Base prompt',
          output: '',
          metadata: {},
        },
      ],
      [
        {
          id: 'html_h1_page_1',
          status: 'error',
          error: 'Anchor tag is missing href.',
          metadata: { validationStatus: 'Fail' },
        },
      ],
    );

    expect(rows[0].input).toContain('HTML VALIDATION FEEDBACK');
    expect(rows[0].input).toContain('Anchor tag is missing href.');
  });

  it('reuses persisted html only when the h1 body is unchanged', () => {
    const merged = mergeDerivedWithPersistedH1HtmlRows(
      [
        {
          id: 'html_h1_page_1',
          status: 'pending',
          input: 'Prompt A',
          output: '',
          metadata: { h1Body: 'Fresh intro' },
        },
        {
          id: 'html_h1_page_2',
          status: 'pending',
          input: 'Prompt B',
          output: '',
          metadata: { h1Body: 'New intro' },
        },
      ],
      [
        {
          id: 'html_h1_page_1',
          status: 'generated',
          input: 'Prompt A',
          output: '<p>Fresh intro</p>',
          metadata: { h1Body: 'Fresh intro', validationStatus: 'Pass' },
        },
        {
          id: 'html_h1_page_2',
          status: 'generated',
          input: 'Old Prompt B',
          output: '<p>Old intro</p>',
          metadata: { h1Body: 'Old intro' },
        },
      ],
    );

    expect(merged[0].output).toBe('<p>Fresh intro</p>');
    expect(merged[0].metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Pass');
    expect(merged[1].output).toBe('');
  });

  it('falls back to bundled prompt when saved h1 html prompt is blank', () => {
    expect(resolveH1HtmlPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('uses the shared html validator contract', () => {
    const fail = validateGeneratedHtmlOutput('<p>Read <a>this guide</a> first.</p>');
    expect(fail.metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Fail');
    expect(fail.validationError).toBe('Anchor tag is missing href.');
  });
});
