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
  buildQuickAnswerPrompt,
  buildQuickAnswerRowsFromSource,
  mergeDerivedWithPersistedQuickAnswerRows,
  resolveQuickAnswerPromptTemplate,
} from './contentPipelineQuickAnswer';

describe('contentPipelineQuickAnswer', () => {
  it('builds runnable quick answer rows from generated h1 body rows', () => {
    const rows = buildQuickAnswerRowsFromSource(
      [
        {
          id: 'h1_page_1',
          status: 'generated',
          output: '<answer>You can repair credit faster when you know what is hurting it most.</answer>',
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
    expect(rows[0].input).toContain('Body:You can repair credit faster');
    expect(rows[0].metadata.h2Summaries).toContain('C');
    expect(rows[0].metadata.order).toBe('3');
    expect(rows[0].metadata.ratingScore).toBe('2');
    expect(rows[0].metadata.contentGuidelines).toBe('Keep examples simple.');
  });

  it('reuses persisted quick answers only when the h1 body is unchanged', () => {
    const merged = mergeDerivedWithPersistedQuickAnswerRows(
      [
        {
          id: 'quick_h1_page_1',
          status: 'pending',
          input: 'Prompt A',
          output: '',
          metadata: { h1Body: 'Fresh intro' },
        },
        {
          id: 'quick_h1_page_2',
          status: 'pending',
          input: 'Prompt B',
          output: '',
          metadata: { h1Body: 'New intro' },
        },
      ],
      [
        {
          id: 'quick_h1_page_1',
          status: 'generated',
          input: 'Prompt A',
          output: 'Reusable quick answer',
          metadata: { h1Body: 'Fresh intro' },
        },
        {
          id: 'quick_h1_page_2',
          status: 'generated',
          input: 'Old Prompt B',
          output: 'Stale quick answer',
          metadata: { h1Body: 'Old intro' },
        },
      ],
    );

    expect(merged[0].output).toBe('Reusable quick answer');
    expect(merged[1].output).toBe('');
  });

  it('falls back to bundled prompt when saved quick answer prompt is blank', () => {
    expect(resolveQuickAnswerPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('replaces all quick answer prompt tokens', () => {
    const prompt = buildQuickAnswerPrompt('{PAGE_NAME}|{H1_BODY}', {
      pageName: 'page',
      h1Body: 'body',
    });

    expect(prompt).toBe('page|body');
  });
});
