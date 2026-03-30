import { describe, expect, it, vi } from 'vitest';

vi.mock('./contentPipelineH2', () => ({
  loadGeneratePrimaryPrompt: vi.fn(),
}));

vi.mock('./contentPipelineQuickAnswer', () => ({
  QUICK_ANSWER_ROWS_DOC_ID: 'generate_rows_quick_answer',
}));

vi.mock('./appSettingsDocStore', () => ({
  loadChunkedAppSettingsRows: vi.fn(),
}));

import {
  applyQuickAnswerHtmlValidationFeedbackToInputs,
  buildQuickAnswerHtmlRowsFromSource,
  mergeDerivedWithPersistedQuickAnswerHtmlRows,
  resolveQuickAnswerHtmlPromptTemplate,
  validateGeneratedHtmlOutput,
} from './contentPipelineQuickAnswerHtml';
import { H2_HTML_VALIDATION_STATUS_KEY } from './contentPipelineHtml';

describe('contentPipelineQuickAnswerHtml', () => {
  it('builds runnable html rows from generated quick answers', () => {
    const rows = buildQuickAnswerHtmlRowsFromSource(
      [
        {
          id: 'quick_h1_page_1',
          status: 'generated',
          output: 'Are you stuck trying to fix your credit on your own?',
          metadata: {
            pageName: 'How To Fix Credit',
            order: '3',
            h2Name: 'What Hurts Credit\nHow To Improve Credit',
            h2Content: 'A\nB',
            h2Summaries: 'C\nD',
            h1Body: 'You can repair credit faster when you know what is hurting it most.',
            ratingScore: '2',
            contentGuidelines: 'Keep examples simple.',
            sourceRowId: 'page-1',
          },
        },
      ],
      'Page:{PAGE_NAME}\nAnswer:{QUICK_ANSWER}',
    );

    expect(rows[0].input).toContain('Page:How To Fix Credit');
    expect(rows[0].input).toContain('Answer:Are you stuck trying to fix your credit on your own?');
    expect(rows[0].metadata.order).toBe('3');
    expect(rows[0].metadata.ratingScore).toBe('2');
    expect(rows[0].metadata.contentGuidelines).toBe('Keep examples simple.');
  });

  it('appends prior validator feedback into quick answer html prompts', () => {
    const rows = applyQuickAnswerHtmlValidationFeedbackToInputs(
      [
        {
          id: 'html_quick_h1_page_1',
          status: 'pending',
          input: 'Base prompt',
          output: '',
          metadata: {},
        },
      ],
      [
        {
          id: 'html_quick_h1_page_1',
          status: 'error',
          error: 'Anchor tag is missing href.',
          metadata: { validationStatus: 'Fail' },
        },
      ],
    );

    expect(rows[0].input).toContain('HTML VALIDATION FEEDBACK');
    expect(rows[0].input).toContain('Anchor tag is missing href.');
  });

  it('reuses persisted html only when the quick answer is unchanged', () => {
    const merged = mergeDerivedWithPersistedQuickAnswerHtmlRows(
      [
        {
          id: 'html_quick_h1_page_1',
          status: 'pending',
          input: 'Prompt A',
          output: '',
          metadata: { quickAnswer: 'Fresh answer' },
        },
        {
          id: 'html_quick_h1_page_2',
          status: 'pending',
          input: 'Prompt B',
          output: '',
          metadata: { quickAnswer: 'New answer' },
        },
      ],
      [
        {
          id: 'html_quick_h1_page_1',
          status: 'generated',
          input: 'Prompt A',
          output: '<p>Fresh answer</p>',
          metadata: { quickAnswer: 'Fresh answer', validationStatus: 'Pass' },
        },
        {
          id: 'html_quick_h1_page_2',
          status: 'generated',
          input: 'Old Prompt B',
          output: '<p>Old answer</p>',
          metadata: { quickAnswer: 'Old answer' },
        },
      ],
    );

    expect(merged[0].output).toBe('<p>Fresh answer</p>');
    expect(merged[0].metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Pass');
    expect(merged[1].output).toBe('');
  });

  it('falls back to bundled prompt when saved quick answer html prompt is blank', () => {
    expect(resolveQuickAnswerHtmlPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('uses the shared html validator contract', () => {
    const fail = validateGeneratedHtmlOutput('<p>Read <a>this guide</a> first.</p>');
    expect(fail.metadata[H2_HTML_VALIDATION_STATUS_KEY]).toBe('Fail');
    expect(fail.validationError).toBe('Anchor tag is missing href.');
  });
});
